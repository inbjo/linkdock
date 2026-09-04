use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
pub struct WebAssets;

pub fn serve_index() -> Option<Vec<u8>> {
    WebAssets::get("index.html").map(|f| f.data.to_vec())
}

pub fn serve_asset(path: &str) -> Option<(Vec<u8>, String)> {
    let asset = WebAssets::get(path)?;
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    Some((asset.data.to_vec(), mime))
}
