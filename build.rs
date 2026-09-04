use std::process::Command;

fn main() {
    let web_dist = std::path::Path::new("web/dist");

    // Ensure web/dist exists with at least a placeholder index.html
    // so that rust-embed can compile in dev mode without a frontend build.
    if !web_dist.join("index.html").exists() {
        std::fs::create_dir_all(web_dist).ok();
        let placeholder = web_dist.join("index.html");
        if !placeholder.exists() {
            std::fs::write(
                &placeholder,
                r#"<!DOCTYPE html>
<html><head><title>Linkdock</title></head>
<body><h1>Linkdock</h1><p>Frontend not built. Run <code>cd web && npm run build</code>.</p></body>
</html>"#,
            )
            .ok();
        }
        println!("cargo:warning=Created placeholder web/dist/index.html");
    }

    // For release builds, try to build the frontend if it looks stale.
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    if profile == "release" && std::path::Path::new("web/package.json").exists() {
        // Check if a real build exists (has assets/ dir).
        let has_real_build = web_dist.join("assets").exists();
        if !has_real_build {
            println!("cargo:warning=Building frontend for release...");
            let status = Command::new("npm")
                .arg("run")
                .arg("build")
                .current_dir("web")
                .status();
            match status {
                Ok(s) if s.success() => {}
                _ => {
                    println!("cargo:warning=Frontend build failed; release binary will use placeholder SPA.");
                }
            }
        }
    }
    println!("cargo:rerun-if-changed=web/dist");
    println!("cargo:rerun-if-changed=build.rs");
}
