use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize)]
pub struct SiteSettings {
    pub site_name: String,
    pub site_title: String,
    pub site_description: String,
    pub site_keywords: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSiteSettings {
    pub site_name: String,
    pub site_title: String,
    pub site_description: String,
    #[serde(default)]
    pub site_keywords: String,
}

pub struct SiteSettingsService;

const AMP: &str = "\x26amp;";
const LT: &str = "\x26lt;";
const GT: &str = "\x26gt;";
const QUOT: &str = "\x26quot;";

impl SiteSettingsService {
    pub async fn get(state: &AppState) -> AppResult<SiteSettings> {
        let row = sqlx::query(
            "SELECT site_name, site_title, site_description, site_keywords FROM site_settings WHERE id=1",
        )
        .fetch_one(&state.pool)
        .await?;
        Ok(SiteSettings {
            site_name: row.get("site_name"),
            site_title: row.get("site_title"),
            site_description: row.get("site_description"),
            site_keywords: row.get("site_keywords"),
        })
    }

    pub async fn update(state: &AppState, input: UpdateSiteSettings) -> AppResult<SiteSettings> {
        if input.site_name.trim().is_empty() || input.site_title.trim().is_empty() {
            return Err(AppError::Validation(
                "site name and title are required".into(),
            ));
        }
        sqlx::query(
            "UPDATE site_settings SET site_name=?, site_title=?, site_description=?, site_keywords=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1",
        )
        .bind(input.site_name.trim())
        .bind(input.site_title.trim())
        .bind(input.site_description.trim())
        .bind(input.site_keywords.trim())
        .execute(&state.pool)
        .await?;
        Self::get(state).await
    }

    /// Inject TDK into the index.html before serving it.
    pub fn inject_tdk(html: &str, settings: &SiteSettings) -> String {
        let title = html_escape(&settings.site_title);
        let description = html_escape(&settings.site_description);
        let keywords = html_escape(&settings.site_keywords);

        let mut result = html.to_string();

        // Replace <title>...</title>
        if let Some(start) = result.find("<title>") {
            if let Some(end) = result.find("</title>") {
                result.replace_range(start..end + 8, &format!("<title>{title}</title>"));
            }
        }

        // Remove existing description meta and inject new one
        result = strip_meta(&result, "name=\"description\"");
        if !description.is_empty() {
            let tag = format!("name=\"description\" content=\"{description}\"");
            result = inject_meta(&result, &tag);
        }

        // Remove existing keywords meta and inject new one
        result = strip_meta(&result, "name=\"keywords\"");
        if !keywords.is_empty() {
            let tag = format!("name=\"keywords\" content=\"{keywords}\"");
            result = inject_meta(&result, &tag);
        }

        result
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', AMP)
        .replace('<', LT)
        .replace('>', GT)
        .replace('"', QUOT)
}

fn strip_meta(html: &str, attr_pattern: &str) -> String {
    let mut result = String::new();
    let mut remaining = html;
    while let Some(pos) = remaining.find("<meta") {
        result.push_str(&remaining[..pos]);
        let after = &remaining[pos..];
        if let Some(end) = after.find('>') {
            let tag = &after[..=end];
            if tag.contains(attr_pattern) {
                remaining = &after[end + 1..];
            } else {
                result.push_str(tag);
                remaining = &after[end + 1..];
            }
        } else {
            result.push_str(after);
            return result;
        }
    }
    result.push_str(remaining);
    result
}

fn inject_meta(html: &str, meta_attrs: &str) -> String {
    let tag = format!("    <meta {meta_attrs} />");
    if let Some(pos) = html.find("<head>") {
        let mut result = html[..pos + 6].to_string();
        result.push('\n');
        result.push_str(&tag);
        result.push_str(&html[pos + 6..]);
        result
    } else if let Some(pos) = html.find("<head ") {
        let close = html[pos..].find('>').map(|c| pos + c + 1).unwrap_or(0);
        if close > 0 {
            let mut result = html[..close].to_string();
            result.push('\n');
            result.push_str(&tag);
            result.push_str(&html[close..]);
            result
        } else {
            html.to_string()
        }
    } else {
        html.to_string()
    }
}
