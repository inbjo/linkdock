//! Integration tests for the Floccus (Linkwarden protocol) compatibility API and core flows.
//!
//! Each test gets a fresh in-memory SQLite database and a running axum app.

use axum::http::StatusCode;
use linkdock::test_support::TestApp;
use serde_json::Value;

async fn setup() -> TestApp {
    TestApp::new().await
}

async fn register_and_login(app: &TestApp, username: &str, password: &str) -> (String, Value) {
    let resp = app
        .client
        .post(format!("{}/api/app/v1/auth/register", app.base))
        .json(&serde_json::json!({
            "username": username,
            "password": password,
            "display_name": username,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp.cookies().next().unwrap().value().to_string();
    let body: Value = resp.json().await.unwrap();
    (cookie, body)
}

async fn create_token(app: &TestApp, session: &str, name: &str) -> String {
    let resp = app
        .client
        .post(format!("{}/api/app/v1/tokens", app.base))
        .header("cookie", format!("lw_session={}", session))
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    body["plaintext"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_health() {
    let app = setup().await;
    let resp = app
        .client
        .get(format!("{}/health/live", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = app
        .client
        .get(format!("{}/health/ready", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_register_and_me() {
    let app = setup().await;
    let (session, body) = register_and_login(&app, "alice", "password123").await;
    assert_eq!(body["user"]["username"], "alice");

    let resp = app
        .client
        .get(format!("{}/api/app/v1/me", app.base))
        .header("cookie", format!("lw_session={}", session))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let me: Value = resp.json().await.unwrap();
    assert_eq!(me["username"], "alice");
    assert_eq!(me["tenant_role"], "owner");
}

#[tokio::test]
async fn test_passkey_registration_start_and_login_privacy() {
    let app = setup().await;
    let (session, _) = register_and_login(&app, "passkey-user", "password123").await;

    let resp = app
        .client
        .post(format!("{}/api/app/v1/passkeys/register/start", app.base))
        .header("cookie", format!("lw_session={}", session))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    assert!(body["flow_id"].as_str().is_some());
    assert!(body["options"]["publicKey"]["challenge"].as_str().is_some());
    assert_eq!(body["options"]["publicKey"]["rp"]["id"], "localhost");

    let no_key = app
        .client
        .post(format!("{}/api/app/v1/auth/passkey/start", app.base))
        .json(&serde_json::json!({ "username": "passkey-user" }))
        .send()
        .await
        .unwrap();
    let unknown = app
        .client
        .post(format!("{}/api/app/v1/auth/passkey/start", app.base))
        .json(&serde_json::json!({ "username": "unknown-user" }))
        .send()
        .await
        .unwrap();
    assert_eq!(no_key.status(), StatusCode::BAD_REQUEST);
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        no_key.json::<Value>().await.unwrap()["error"]["message"],
        unknown.json::<Value>().await.unwrap()["error"]["message"]
    );
}

#[tokio::test]
async fn test_passkey_management_requires_session() {
    let app = setup().await;
    let resp = app
        .client
        .get(format!("{}/api/app/v1/passkeys", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_invalid_token_returns_403() {
    let app = setup().await;
    // Floccus expects 403 for invalid tokens.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .header("Authorization", "Bearer lw_invalid_token")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_no_auth_returns_401() {
    let app = setup().await;
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_floccus_full_sync_flow() {
    let app = setup().await;
    let (session, _) = register_and_login(&app, "bob", "password123").await;
    let token = create_token(&app, &session, "floccus-sync").await;

    let auth_header = format!("Bearer {}", token);

    // 1. GET /collections — empty list.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    assert!(body["response"].as_array().unwrap().is_empty());

    // 2. Create root collection "Floccus".
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth_header)
        .json(&serde_json::json!({ "name": "Floccus" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    let root_id = body["response"]["id"].as_i64().unwrap();
    assert_eq!(body["response"]["name"], "Floccus");
    assert!(body["response"]["parentId"].is_null());

    // 3. Create a sub-collection.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth_header)
        .json(&serde_json::json!({ "name": "Rust Links", "parentId": root_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    let sub_id = body["response"]["id"].as_i64().unwrap();
    assert_eq!(body["response"]["parentId"], root_id);

    // 4. Create a link in the sub-collection.
    let resp = app
        .client
        .post(format!("{}/api/v1/links", app.base))
        .header("Authorization", &auth_header)
        .json(&serde_json::json!({
            "url": "https://www.rust-lang.org/",
            "name": "Rust",
            "collection": { "id": sub_id }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    let link_id = body["response"]["id"].as_i64().unwrap();
    assert_eq!(body["response"]["url"], "https://www.rust-lang.org/");
    assert_eq!(body["response"]["collectionId"], sub_id);

    // 5. Search returns the link.
    let resp = app
        .client
        .get(format!("{}/api/v1/search?searchQueryString=", app.base))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    let links = body["data"]["links"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["id"], link_id);
    assert_eq!(links[0]["url"], "https://www.rust-lang.org/");
    assert_eq!(links[0]["collectionId"], sub_id);
    assert!(body["data"]["nextCursor"].is_null());

    // 6. GET /collections returns both collections.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let cols = body["response"].as_array().unwrap();
    assert_eq!(cols.len(), 2);

    // 7. GET single collection.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections/{}", app.base, root_id))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["response"]["id"], root_id);
    assert_eq!(body["response"]["name"], "Floccus");

    // 8. Update link (rename + move to root).
    let resp = app
        .client
        .put(format!("{}/api/v1/links/{}", app.base, link_id))
        .header("Authorization", &auth_header)
        .json(&serde_json::json!({
            "id": link_id,
            "url": "https://www.rust-lang.org/",
            "name": "Rust Programming Language",
            "tags": [],
            "collection": { "id": root_id, "name": "Floccus", "ownerId": 1 }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["response"]["name"], "Rust Programming Language");
    assert_eq!(body["response"]["collectionId"], root_id);

    // 9. Update collection (rename).
    let resp = app
        .client
        .put(format!("{}/api/v1/collections/{}", app.base, sub_id))
        .header("Authorization", &auth_header)
        .json(&serde_json::json!({
            "name": "Rust Bookmarks",
            "parentId": root_id
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["response"]["name"], "Rust Bookmarks");

    // 10. Delete link (idempotent).
    let resp = app
        .client
        .delete(format!("{}/api/v1/links/{}", app.base, link_id))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Delete again — should still succeed (idempotent).
    let resp = app
        .client
        .delete(format!("{}/api/v1/links/{}", app.base, link_id))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 11. Delete collection (idempotent).
    let resp = app
        .client
        .delete(format!("{}/api/v1/collections/{}", app.base, sub_id))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Delete again.
    let resp = app
        .client
        .delete(format!("{}/api/v1/collections/{}", app.base, sub_id))
        .header("Authorization", &auth_header)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_duplicate_urls_not_overwritten() {
    let app = setup().await;
    let (session, _) = register_and_login(&app, "carol", "password123").await;
    let token = create_token(&app, &session, "dup-test").await;
    let auth = format!("Bearer {}", token);

    // Create a collection.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Floccus" }))
        .send()
        .await
        .unwrap();
    let col_id = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    // Create two links with the same URL.
    let resp = app
        .client
        .post(format!("{}/api/v1/links", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({
            "url": "https://example.com/",
            "name": "First",
            "collection": { "id": col_id }
        }))
        .send()
        .await
        .unwrap();
    let id1 = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    let resp = app
        .client
        .post(format!("{}/api/v1/links", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({
            "url": "https://example.com/",
            "name": "Second",
            "collection": { "id": col_id }
        }))
        .send()
        .await
        .unwrap();
    let id2 = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    assert_ne!(id1, id2);

    // Both should be in search results.
    let resp = app
        .client
        .get(format!("{}/api/v1/search?searchQueryString=", app.base))
        .header("Authorization", &auth)
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let links = body["data"]["links"].as_array().unwrap();
    assert_eq!(links.len(), 2);
}

#[tokio::test]
async fn test_multi_tenant_isolation() {
    let app = setup().await;
    let (session_a, _) = register_and_login(&app, "tenant_a", "password123").await;
    let (session_b, _) = register_and_login(&app, "tenant_b", "password123").await;
    let token_a = create_token(&app, &session_a, "token-a").await;
    let token_b = create_token(&app, &session_b, "token-b").await;

    // Tenant A creates a collection.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", format!("Bearer {}", token_a))
        .json(&serde_json::json!({ "name": "Floccus" }))
        .send()
        .await
        .unwrap();
    let col_a = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    // Tenant B should not see Tenant A's collections.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .header("Authorization", format!("Bearer {}", token_b))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert!(body["response"].as_array().unwrap().is_empty());

    // Tenant B cannot access Tenant A's collection by ID.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections/{}", app.base, col_a))
        .header("Authorization", format!("Bearer {}", token_b))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_revoked_token_returns_403() {
    let app = setup().await;
    let (session, _) = register_and_login(&app, "dave", "password123").await;
    let token = create_token(&app, &session, "revoke-me").await;

    // Verify token works.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // List tokens to get the id.
    let resp = app
        .client
        .get(format!("{}/api/app/v1/tokens", app.base))
        .header("cookie", format!("lw_session={}", session))
        .send()
        .await
        .unwrap();
    let tokens: Value = resp.json().await.unwrap();
    let token_id = tokens[0]["id"].as_i64().unwrap();

    // Revoke.
    let resp = app
        .client
        .delete(format!("{}/api/app/v1/tokens/{}", app.base, token_id))
        .header("cookie", format!("lw_session={}", session))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Token should now return 403.
    let resp = app
        .client
        .get(format!("{}/api/v1/collections", app.base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_cursor_pagination() {
    let app = setup().await;
    let (session, _) = register_and_login(&app, "pagetest", "password123").await;
    let token = create_token(&app, &session, "page-test").await;
    let auth = format!("Bearer {}", token);

    // Create a collection.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Floccus" }))
        .send()
        .await
        .unwrap();
    let col_id = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    // Create 55 links.
    for i in 0..55 {
        let resp = app
            .client
            .post(format!("{}/api/v1/links", app.base))
            .header("Authorization", &auth)
            .json(&serde_json::json!({
                "url": format!("https://example.com/{}", i),
                "name": format!("Link {}", i),
                "collection": { "id": col_id }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // Paginate through all links with a small page size by using cursor.
    // The default page size is 50, so first page should have 50 and a cursor.
    let mut all_ids = vec![];
    let mut cursor: Option<String> = None;
    loop {
        let url = if let Some(ref c) = cursor {
            format!("{}/api/v1/search?searchQueryString=&cursor={}", app.base, c)
        } else {
            format!("{}/api/v1/search?searchQueryString=", app.base)
        };
        let resp = app
            .client
            .get(&url)
            .header("Authorization", &auth)
            .send()
            .await
            .unwrap();
        let body: Value = resp.json().await.unwrap();
        let links = body["data"]["links"].as_array().unwrap();
        for l in links {
            all_ids.push(l["id"].as_i64().unwrap());
        }
        cursor = body["data"]["nextCursor"].as_str().map(|s| s.to_string());
        if cursor.is_none() {
            break;
        }
    }

    assert_eq!(all_ids.len(), 55);
    // No duplicates.
    let unique: std::collections::HashSet<_> = all_ids.iter().collect();
    assert_eq!(unique.len(), 55);
}

#[tokio::test]
async fn test_nested_collection_creation_and_move() {
    let app = setup().await;
    let (session, _) = register_and_login(&app, "nested", "password123").await;
    let token = create_token(&app, &session, "nested-test").await;
    let auth = format!("Bearer {}", token);

    // Create root.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Floccus" }))
        .send()
        .await
        .unwrap();
    let root = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    // Create child.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Child", "parentId": root }))
        .send()
        .await
        .unwrap();
    let child = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    // Create grandchild.
    let resp = app
        .client
        .post(format!("{}/api/v1/collections", app.base))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Grandchild", "parentId": child }))
        .send()
        .await
        .unwrap();
    let grandchild = resp.json::<Value>().await.unwrap()["response"]["id"]
        .as_i64()
        .unwrap();

    // Try to move root under grandchild — should fail (circular).
    let resp = app
        .client
        .put(format!("{}/api/v1/collections/{}", app.base, root))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Floccus", "parentId": grandchild }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Move child to root (no-op but valid).
    let resp = app
        .client
        .put(format!("{}/api/v1/collections/{}", app.base, child))
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "name": "Child", "parentId": root }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_unknown_api_returns_json_404() {
    let app = setup().await;
    let resp = app
        .client
        .get(format!("{}/api/v1/nonexistent", app.base))
        .header("Authorization", "Bearer lw_fake")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let ct = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(ct.contains("application/json"));
}

#[tokio::test]
async fn test_spa_served_for_non_api() {
    let app = setup().await;
    let resp = app
        .client
        .get(format!("{}/bookmarks", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.text().await.unwrap();
    assert!(body.contains("Linkdock"));
}
