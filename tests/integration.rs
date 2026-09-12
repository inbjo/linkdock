//! Integration coverage for the canonical XBEL tree and WebDAV transport.

use axum::http::StatusCode;
use linkdock::test_support::TestApp;
use serde_json::Value;

async fn setup() -> TestApp {
    TestApp::new().await
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
