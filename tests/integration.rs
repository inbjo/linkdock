//! Integration coverage for the canonical XBEL tree and WebDAV transport.

use axum::http::StatusCode;
use linkdock::test_support::TestApp;
use serde_json::Value;

async fn setup() -> TestApp {
    TestApp::new().await
}

#[tokio::test]
async fn restoring_a_folder_does_not_restore_previously_deleted_children() {
    let app = setup().await;
    let (session, _) = register(&app, "subtree-recovery").await;
    let token = token(&app, &session, "device").await;
    let url = format!("{}/webdav/bookmarks.xbel", app.base);
    let xbel = r#"<xbel><folder id="1"><title>Folder</title><bookmark id="2" href="https://earlier.example"/><bookmark id="3" href="https://later.example"/></folder></xbel>"#;
    assert_eq!(
        app.client
            .put(&url)
            .basic_auth("x", Some(&token))
            .body(xbel)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    let doc: i64 = sqlx::query_scalar("SELECT id FROM sync_documents")
        .fetch_one(&app.state.pool)
        .await
        .unwrap();
    let nodes: Vec<(i64, String)> =
        sqlx::query_as("SELECT id,external_id FROM bookmark_nodes ORDER BY external_id")
            .fetch_all(&app.state.pool)
            .await
            .unwrap();
    let parent = nodes[0].0;
    let child = nodes[1].0;
    assert_eq!(
        app.client
            .delete(format!(
                "{}/api/app/v1/nodes/{child}?expected_revision=1",
                app.base
            ))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    // Give the earlier deletion a distinct, stable timestamp even on coarse clocks.
    sqlx::query("UPDATE bookmark_nodes SET deleted_at='2000-01-01T00:00:00Z' WHERE id=?")
        .bind(child)
        .execute(&app.state.pool)
        .await
        .unwrap();
    assert_eq!(
        app.client
            .delete(format!(
                "{}/api/app/v1/nodes/{parent}?expected_revision=2",
                app.base
            ))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        app.client
            .post(format!("{}/api/app/v1/nodes/{parent}/restore", app.base))
            .json(&serde_json::json!({"expected_revision":3}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let view = document_view(&app, doc).await;
    let children = view["nodes"][0]["children"].as_array().unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0]["url"], "https://later.example");
}

async fn document_view(app: &TestApp, id: i64) -> Value {
    app.client
        .get(format!("{}/api/app/v1/documents/{id}/view", app.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn visual_revisions_search_and_trash_are_consistent() {
    let app = setup().await;
    register(&app, "recovery").await;
    let doc: Value = app
        .client
        .post(format!("{}/api/app/v1/documents/default", app.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = doc["id"].as_i64().unwrap();
    let response = app.client.post(format!("{}/api/app/v1/nodes", app.base)).json(&serde_json::json!({
        "document_id":id,"expected_revision":0,"node_type":"bookmark","title":"Rust reference","url":"https://rust.example","tags":["language"]
    })).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let node: Value = response.json().await.unwrap();
    let node_id = node["id"].as_i64().unwrap();
    let view = document_view(&app, id).await;
    assert_eq!(view["revision"], 1);
    let response = app
        .client
        .put(format!("{}/api/app/v1/nodes/{node_id}", app.base))
        .json(&serde_json::json!({"title":"stale","expected_revision":0}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);
    let results: Vec<Value> = app
        .client
        .get(format!(
            "{}/api/app/v1/documents/{id}/search?q=Rust",
            app.base
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["title"], "Rust reference");
    assert_eq!(
        app.client
            .delete(format!(
                "{}/api/app/v1/nodes/{node_id}?expected_revision=0",
                app.base
            ))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        app.client
            .delete(format!(
                "{}/api/app/v1/nodes/{node_id}?expected_revision=1",
                app.base
            ))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let results: Vec<Value> = app
        .client
        .get(format!(
            "{}/api/app/v1/documents/{id}/search?q=Rust",
            app.base
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(results.is_empty());
    let trash: Vec<Value> = app
        .client
        .get(format!("{}/api/app/v1/documents/{id}/trash", app.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(
        app.client
            .post(format!("{}/api/app/v1/nodes/{node_id}/restore", app.base))
            .json(&serde_json::json!({"expected_revision":2}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let view = document_view(&app, id).await;
    assert_eq!(view["revision"], 3);
    assert_eq!(view["nodes"][0]["tags"][0], "language");
    register(&app, "other-recovery").await;
    for suffix in ["search?q=Rust", "trash", "snapshots"] {
        let results: Vec<Value> = app
            .client
            .get(format!("{}/api/app/v1/documents/{id}/{suffix}", app.base))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(results.is_empty());
    }
    assert_eq!(
        app.client
            .post(format!("{}/api/app/v1/nodes/{node_id}/restore", app.base))
            .json(&serde_json::json!({"expected_revision":3}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn conditional_webdav_writes_and_snapshot_restore() {
    let app = setup().await;
    let (session, _) = register(&app, "conditional").await;
    let token = token(&app, &session, "device").await;
    let url = format!("{}/webdav/bookmarks.xbel", app.base);
    let old =
        r#"<xbel><bookmark id="1" href="https://old.example"><title>Old</title></bookmark></xbel>"#;
    let new =
        r#"<xbel><bookmark id="1" href="https://new.example"><title>New</title></bookmark></xbel>"#;
    assert_eq!(
        app.client
            .put(&url)
            .basic_auth("x", Some(&token))
            .header("if-none-match", "*")
            .body(old)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.client
            .put(&url)
            .basic_auth("x", Some(&token))
            .header("if-none-match", "*")
            .body(new)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::PRECONDITION_FAILED
    );
    let response = app
        .client
        .get(&url)
        .basic_auth("x", Some(&token))
        .send()
        .await
        .unwrap();
    let etag = response.headers()["etag"].to_str().unwrap().to_string();
    let a = app
        .client
        .put(&url)
        .basic_auth("x", Some(&token))
        .header("if-match", &etag)
        .body(new)
        .send();
    let b = app
        .client
        .put(&url)
        .basic_auth("x", Some(&token))
        .header("if-match", &etag)
        .body(new)
        .send();
    let (a, b) = tokio::join!(a, b);
    let statuses = [a.unwrap().status(), b.unwrap().status()];
    assert!(statuses.contains(&StatusCode::NO_CONTENT));
    assert!(statuses.contains(&StatusCode::PRECONDITION_FAILED));
    let docs: Vec<Value> = app
        .client
        .get(format!("{}/api/app/v1/documents", app.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = docs[0]["id"].as_i64().unwrap();
    let snapshots: Vec<Value> = app
        .client
        .get(format!("{}/api/app/v1/documents/{id}/snapshots", app.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(snapshots.len(), 1);
    let snapshot = snapshots[0]["id"].as_i64().unwrap();
    assert_eq!(
        app.client
            .post(format!(
                "{}/api/app/v1/snapshots/{snapshot}/restore",
                app.base
            ))
            .json(&serde_json::json!({"expected_revision":2}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let restored = app
        .client
        .get(&url)
        .basic_auth("x", Some(&token))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(restored.contains("https://old.example"));
    assert_eq!(document_view(&app, id).await["revision"], 3);
}

#[tokio::test]
async fn move_rolls_back_document_and_snapshot_when_staging_cleanup_fails() {
    let app = setup().await;
    let (session, _) = register(&app, "atomic-move").await;
    let token = token(&app, &session, "device").await;
    let url = format!("{}/webdav/bookmarks.xbel", app.base);
    let old = r#"<xbel><bookmark id="1" href="https://old.example"/></xbel>"#;
    let new = r#"<xbel><bookmark id="1" href="https://new.example"/></xbel>"#;
    assert_eq!(
        app.client
            .put(&url)
            .basic_auth("x", Some(&token))
            .body(old)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.client
            .put(format!("{url}.temp"))
            .basic_auth("x", Some(&token))
            .body(new)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );
    sqlx::query("CREATE TRIGGER fail_staging_cleanup BEFORE DELETE ON webdav_staging BEGIN SELECT RAISE(ABORT,'injected failure'); END;")
        .execute(&app.state.pool).await.unwrap();
    let response = app
        .client
        .request(
            reqwest::Method::from_bytes(b"MOVE").unwrap(),
            format!("{url}.temp"),
        )
        .basic_auth("x", Some(&token))
        .header("destination", &url)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let content = app
        .client
        .get(&url)
        .basic_auth("x", Some(&token))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(content.contains("https://old.example"));
    assert!(!content.contains("https://new.example"));
    let snapshots: i64 = sqlx::query_scalar("SELECT count(*) FROM document_snapshots")
        .fetch_one(&app.state.pool)
        .await
        .unwrap();
    assert_eq!(snapshots, 0);
    assert_eq!(
        app.client
            .get(format!("{url}.temp"))
            .basic_auth("x", Some(&token))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn browser_security_is_same_origin_by_default() {
    let app = setup().await;
    let response = app
        .client
        .get(format!("{}/login", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["x-frame-options"], "DENY");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        response.headers()["cross-origin-resource-policy"],
        "same-origin"
    );
    assert!(response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("script-src 'self'"));
    assert!(!response.headers().contains_key("strict-transport-security"));
    let url = format!("{}/api/app/v1/auth/register", app.base);
    let response = app.client.post(&url).header("origin", "https://evil.example")
        .json(&serde_json::json!({"username":"blocked","email":"blocked@example.com","password":"password123"}))
        .send().await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(!response
        .headers()
        .contains_key("access-control-allow-origin"));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&app.state.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    for origin in ["null", "https://evil.example"] {
        let response = app
            .client
            .request(reqwest::Method::OPTIONS, &url)
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let response = app
        .client
        .get(format!("{}/api/app/v1/auth/setup", app.base))
        .header("origin", &app.base)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let response = app
        .client
        .post(&url)
        .header("sec-fetch-site", "cross-site")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn explicit_cors_allowlist_and_https_headers() {
    let app = TestApp::new_with_config(|config| {
        config.public_url = "https://dock.example".into();
        config.cors_origins = vec!["https://trusted.example".into()];
    })
    .await;
    let response = app
        .client
        .request(
            reqwest::Method::OPTIONS,
            format!("{}/api/app/v1/me", app.base),
        )
        .header("origin", "https://trusted.example")
        .header("access-control-request-method", "PUT")
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "https://trusted.example"
    );
    assert_eq!(
        response.headers()["strict-transport-security"],
        "max-age=31536000"
    );
    let response = app
        .client
        .get(format!("{}/api/app/v1/auth/setup", app.base))
        .header("origin", "https://untrusted.example")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn readonly_admin_token_cannot_administer_accounts() {
    let app = setup().await;
    register(&app, "admin-token").await;
    let response = app
        .client
        .post(format!("{}/api/app/v1/tokens", app.base))
        .json(&serde_json::json!({"name":"readonly","scopes":"bookmarks:read"}))
        .send()
        .await
        .unwrap();
    let value: Value = response.json().await.unwrap();
    let token = value["plaintext"].as_str().unwrap();
    // Bearer takes precedence even if the browser also supplies a session cookie.
    for (method, path, body) in [
        (reqwest::Method::GET, "/admin/stats", serde_json::json!({})),
        (
            reqwest::Method::PUT,
            "/admin/site",
            serde_json::json!({"site_name":"bad","site_title":"bad","site_description":"bad","site_keywords":"bad"}),
        ),
        (reqwest::Method::PUT, "/admin/smtp", serde_json::json!({})),
        (
            reqwest::Method::PUT,
            "/me",
            serde_json::json!({"email":"changed@example.com"}),
        ),
        (reqwest::Method::GET, "/passkeys", serde_json::json!({})),
        (
            reqwest::Method::POST,
            "/passkeys/register/start",
            serde_json::json!({}),
        ),
        (
            reqwest::Method::POST,
            "/passkeys/register/finish",
            serde_json::json!({}),
        ),
        (
            reqwest::Method::DELETE,
            "/passkeys/1",
            serde_json::json!({}),
        ),
        (reqwest::Method::GET, "/sessions", serde_json::json!({})),
        (
            reqwest::Method::DELETE,
            "/sessions/1",
            serde_json::json!({}),
        ),
        (
            reqwest::Method::POST,
            "/tokens",
            serde_json::json!({"name":"escalate"}),
        ),
    ] {
        let response = app
            .client
            .request(method, format!("{}/api/app/v1{path}", app.base))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
    }
    assert_eq!(
        app.client
            .get(format!("{}/api/app/v1/admin/stats", app.base))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn authentication_attempts_are_rate_limited() {
    let app = setup().await;
    let url = format!("{}/api/app/v1/auth/login", app.base);
    // Malformed requests also consume the budget without doing expensive hashes.
    for _ in 0..30 {
        assert_eq!(
            app.client
                .post(&url)
                .json(&serde_json::json!({}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let response = app
        .client
        .post(&url)
        .header("x-forwarded-for", "192.0.2.1")
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()["retry-after"], "60");
}

async fn register(app: &TestApp, username: &str) -> (String, Value) {
    let response = app
        .client
        .post(format!("{}/api/app/v1/auth/register", app.base))
        .json(&serde_json::json!({
            "username": username,
            "email": format!("{username}@example.com"),
            "password": "password123",
            "display_name": username,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let session = response.cookies().next().unwrap().value().to_string();
    (session, response.json().await.unwrap())
}

async fn login(app: &TestApp, identifier: &str, password: &str) -> reqwest::Response {
    app.client
        .post(format!("{}/api/app/v1/auth/login", app.base))
        .json(&serde_json::json!({
            "username": identifier,
            "password": password,
        }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn password_login_accepts_username_or_email() {
    let app = setup().await;
    register(&app, "email-login-a").await;
    register(&app, "email-login-b").await;

    let response = login(&app, "EMAIL-LOGIN-A@EXAMPLE.COM", "password123").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.json::<Value>().await.unwrap()["user"]["username"],
        "email-login-a"
    );
    assert_eq!(
        login(&app, "email-login-a", "password123").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        login(&app, "email-login-b@example.com", "wrong-password")
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        login(&app, "unknown@example.com", "password123")
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
}

async fn token(app: &TestApp, session: &str, name: &str) -> String {
    let response = app
        .client
        .post(format!("{}/api/app/v1/tokens", app.base))
        .header("cookie", format!("linkdock_session={session}"))
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response.json::<Value>().await.unwrap()["plaintext"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn health_and_registration_work() {
    let app = setup().await;
    let response = app
        .client
        .get(format!("{}/health/ready", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let (session, _) = register(&app, "owner").await;
    let response = app
        .client
        .get(format!("{}/api/app/v1/me", app.base))
        .header("cookie", format!("linkdock_session={session}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.json::<Value>().await.unwrap()["username"], "owner");
}

#[tokio::test]
async fn password_change_is_session_only_and_user_scoped() {
    let app = setup().await;
    let (session_a, _) = register(&app, "password-a").await;
    let (session_b, _) = register(&app, "password-b").await;
    let other_session_a_response = login(&app, "password-a", "password123").await;
    assert_eq!(other_session_a_response.status(), StatusCode::OK);
    let other_session_a = other_session_a_response
        .cookies()
        .next()
        .unwrap()
        .value()
        .to_string();
    let access_token_a = token(&app, &session_a, "password-client").await;
    let endpoint = format!("{}/api/app/v1/me/password", app.base);

    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .put(&endpoint)
        .json(&serde_json::json!({
            "current_password": "password123",
            "new_password": "new-password-456",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .client
        .put(&endpoint)
        .bearer_auth(&access_token_a)
        .json(&serde_json::json!({
            "current_password": "password123",
            "new_password": "new-password-456",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let response = app
        .client
        .put(&endpoint)
        .header("cookie", format!("linkdock_session={session_a}"))
        .json(&serde_json::json!({
            "user_id": 2,
            "current_password": "password123",
            "new_password": "new-password-456",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let response = app
        .client
        .put(&endpoint)
        .header("cookie", format!("linkdock_session={session_a}"))
        .json(&serde_json::json!({
            "current_password": "wrong-password",
            "new_password": "new-password-456",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let response = app
        .client
        .put(&endpoint)
        .header("cookie", format!("linkdock_session={session_a}"))
        .json(&serde_json::json!({
            "current_password": "password123",
            "new_password": "new-password-456",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .client
        .get(format!("{}/api/app/v1/me", app.base))
        .header("cookie", format!("linkdock_session={session_a}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .client
        .get(format!("{}/api/app/v1/me", app.base))
        .header("cookie", format!("linkdock_session={other_session_a}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    assert_eq!(
        login(&app, "password-a", "password123").await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        login(&app, "password-a", "new-password-456").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        login(&app, "password-b", "password123").await.status(),
        StatusCode::OK
    );
    let response = app
        .client
        .get(format!("{}/api/app/v1/me", app.base))
        .header("cookie", format!("linkdock_session={session_b}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn webdav_round_trip_preserves_mixed_tree_order() {
    let app = setup().await;
    let (session, _) = register(&app, "sync-owner").await;
    let device_a = token(&app, &session, "device-a").await;
    let device_b = token(&app, &session, "device-b").await;
    let xbel = r#"<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0"><title>Everywhere</title>
  <bookmark id="10" href="https://first.example"><title>First</title></bookmark>
  <folder id="11"><title>Middle folder</title>
    <bookmark id="12" href="https://nested.example"><title>Nested</title></bookmark>
  </folder>
  <separator/>
  <bookmark id="13" href="https://last.example"><title>Last</title></bookmark>
</xbel>"#;

    let propfind = reqwest::Method::from_bytes(b"PROPFIND").unwrap();
    let response = app
        .client
        .request(propfind.clone(), format!("{}/webdav/", app.base))
        .basic_auth("device-a", Some(&device_a))
        .header("depth", "0")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::MULTI_STATUS);

    let response = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel.lock", app.base))
        .basic_auth("device-a", Some(&device_a))
        .body("lock")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel.temp", app.base))
        .basic_auth("device-a", Some(&device_a))
        .header("content-type", "application/xml")
        .body(xbel)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = app
        .client
        .get(format!("{}/webdav/bookmarks.xbel.temp", app.base))
        .basic_auth("device-b", Some(&device_b))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .client
        .request(propfind, format!("{}/webdav/bookmarks.xbel.temp", app.base))
        .basic_auth("device-a", Some(&device_a))
        .header("depth", "0")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::MULTI_STATUS);
    assert!(response
        .text()
        .await
        .unwrap()
        .contains(&xbel.len().to_string()));

    let move_method = reqwest::Method::from_bytes(b"MOVE").unwrap();
    let response = app
        .client
        .request(
            move_method,
            format!("{}/webdav/bookmarks.xbel.temp", app.base),
        )
        .basic_auth("device-a", Some(&device_a))
        .header("destination", format!("{}/webdav/bookmarks.xbel", app.base))
        .header("overwrite", "T")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .client
        .get(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("device-b", Some(&device_b))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let output = response.text().await.unwrap();
    let first = output.find("First").unwrap();
    let middle = output.find("Middle folder").unwrap();
    let separator = output.find("<separator").unwrap();
    let last = output.find("Last").unwrap();
    assert!(first < middle && middle < separator && separator < last);

    let response = app
        .client
        .get(format!("{}/api/app/v1/documents", app.base))
        .header("cookie", format!("linkdock_session={session}"))
        .send()
        .await
        .unwrap();
    let documents = response.json::<Value>().await.unwrap();
    let document_id = documents[0]["id"].as_i64().unwrap();
    let response = app
        .client
        .get(format!(
            "{}/api/app/v1/documents/{document_id}/tree",
            app.base
        ))
        .header("cookie", format!("linkdock_session={session}"))
        .send()
        .await
        .unwrap();
    let tree = response.json::<Value>().await.unwrap();
    assert_eq!(tree[0]["node_type"], "bookmark");
    assert_eq!(tree[1]["node_type"], "folder");
    assert_eq!(tree[1]["children"][0]["title"], "Nested");
    assert_eq!(tree[2]["node_type"], "separator");
    assert_eq!(tree[3]["title"], "Last");
}

#[tokio::test]
async fn visual_api_edits_and_reorders_the_xbel_tree() {
    let app = setup().await;
    let (session, _) = register(&app, "visual-owner").await;
    let cookie = format!("linkdock_session={session}");
    let response = app
        .client
        .post(format!("{}/api/app/v1/documents/default", app.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let document = response.json::<Value>().await.unwrap();
    let document_id = document["id"].as_i64().unwrap();

    let mut ids = Vec::new();
    for body in [
        serde_json::json!({
            "document_id": document_id, "node_type": "bookmark",
            "title": "Alpha", "url": "https://alpha.example", "tags": ["work"]
        }),
        serde_json::json!({
            "document_id": document_id, "node_type": "folder", "title": "Folder"
        }),
        serde_json::json!({
            "document_id": document_id, "node_type": "bookmark",
            "title": "Omega", "url": "https://omega.example"
        }),
    ] {
        let response = app
            .client
            .post(format!("{}/api/app/v1/nodes", app.base))
            .header("cookie", &cookie)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        ids.push(
            response.json::<Value>().await.unwrap()["id"]
                .as_i64()
                .unwrap(),
        );
    }

    ids.reverse();
    let response = app
        .client
        .put(format!(
            "{}/api/app/v1/documents/{document_id}/order",
            app.base
        ))
        .header("cookie", &cookie)
        .json(&serde_json::json!({ "parent_id": null, "node_ids": ids }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .client
        .get(format!(
            "{}/api/app/v1/documents/{document_id}/tree",
            app.base
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let tree = response.json::<Value>().await.unwrap();
    assert_eq!(tree[0]["title"], "Omega");
    assert_eq!(tree[1]["title"], "Folder");
    assert_eq!(tree[2]["title"], "Alpha");
    assert_eq!(tree[2]["tags"][0], "work");
}

#[tokio::test]
async fn webdav_locks_prevent_cross_device_writes() {
    let app = setup().await;
    let (session, _) = register(&app, "lock-owner").await;
    let device_a = token(&app, &session, "device-a").await;
    let device_b = token(&app, &session, "device-b").await;

    let first = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel.lock", app.base))
        .basic_auth("a", Some(&device_a))
        .body("lock")
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);
    let second = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel.lock", app.base))
        .basic_auth("b", Some(&device_b))
        .body("lock")
        .send()
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::LOCKED);

    let xbel = r#"<?xml version="1.0"?><xbel><bookmark id="1" href="https://safe.example"><title>Safe</title></bookmark></xbel>"#;
    let blocked_write = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("b", Some(&device_b))
        .body(xbel)
        .send()
        .await
        .unwrap();
    assert_eq!(blocked_write.status(), StatusCode::LOCKED);

    let owner_write = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("a", Some(&device_a))
        .body(xbel)
        .send()
        .await
        .unwrap();
    assert_eq!(owner_write.status(), StatusCode::NO_CONTENT);

    let documents = app
        .client
        .get(format!("{}/api/app/v1/documents", app.base))
        .header("cookie", format!("linkdock_session={session}"))
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    let blocked_visual_write = app
        .client
        .post(format!("{}/api/app/v1/nodes", app.base))
        .header("cookie", format!("linkdock_session={session}"))
        .json(&serde_json::json!({
            "document_id": documents[0]["id"],
            "node_type": "folder",
            "title": "Conflicting edit"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(blocked_visual_write.status(), StatusCode::LOCKED);
}

#[tokio::test]
async fn malformed_xbel_never_replaces_the_existing_tree() {
    let app = setup().await;
    let (session, _) = register(&app, "atomic-owner").await;
    let access_token = token(&app, &session, "device").await;
    let valid = r#"<?xml version="1.0"?><xbel><bookmark id="1" href="https://kept.example"><title>Kept</title></bookmark></xbel>"#;

    let response = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("device", Some(&access_token))
        .body(valid)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("device", Some(&access_token))
        .body("<xbel><folder><title>broken</title></xbel>")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let content = app
        .client
        .get(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("device", Some(&access_token))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(content.contains("Kept"));
    assert!(!content.contains("broken"));
}

#[tokio::test]
async fn webdav_documents_are_user_isolated() {
    let app = setup().await;
    let (session_a, _) = register(&app, "user-a").await;
    let (session_b, _) = register(&app, "user-b").await;
    let token_a = token(&app, &session_a, "a").await;
    let token_b = token(&app, &session_b, "b").await;
    let xbel = r#"<?xml version="1.0"?><xbel><bookmark id="1" href="https://private.example"><title>Private</title></bookmark></xbel>"#;

    let response = app
        .client
        .put(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("a", Some(&token_a))
        .body(xbel)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = app
        .client
        .get(format!("{}/webdav/bookmarks.xbel", app.base))
        .basic_auth("b", Some(&token_b))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn legacy_api_is_removed() {
    let app = setup().await;
    let response = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn spa_fallback_still_serves_frontend_routes() {
    let app = setup().await;
    let response = app
        .client
        .get(format!("{}/bookmarks", app.base))
        .send()
        .await
        .unwrap();
    assert!(matches!(
        response.status(),
        StatusCode::OK | StatusCode::NOT_FOUND
    ));
}
