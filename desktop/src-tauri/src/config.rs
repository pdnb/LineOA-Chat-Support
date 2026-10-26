//! Which Hotline server the app talks to, kept in `<app config dir>/config.json`.
use std::{fs, path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url};

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Origin only (`https://host[:port]`): the console calls `/api/...` from the site root.
    pub server_url: Option<String>,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Config {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, config: &Config) -> Result<(), String> {
    let p = path(app).ok_or("ไม่พบโฟลเดอร์สำหรับเก็บการตั้งค่า")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(p, serde_json::to_string_pretty(config).unwrap()).map_err(|e| e.to_string())
}

/// `example.com/inbox` → `https://example.com`; only http(s) origins are accepted.
fn normalize(input: &str) -> Result<String, String> {
    let input = input.trim();
    let with_scheme = if input.contains("://") { input.to_string() } else { format!("https://{input}") };
    let url = Url::parse(&with_scheme).map_err(|_| "URL ไม่ถูกต้อง".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("URL ต้องขึ้นต้นด้วย http:// หรือ https://".into());
    }
    Ok(url.origin().ascii_serialization())
}

/// The server's `/health` answers `{ ok: true }` once its database is reachable.
async fn check_health(origin: &str) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Health {
        ok: bool,
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let res = client
        .get(format!("{origin}/health"))
        .send()
        .await
        .map_err(|e| format!("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: {e}"))?;
    match res.json::<Health>().await {
        Ok(Health { ok: true }) => Ok(()),
        _ => Err("URL นี้ไม่ใช่เซิร์ฟเวอร์ Hotline หรือเซิร์ฟเวอร์ยังไม่พร้อม".into()),
    }
}

#[tauri::command]
pub fn get_server_url(app: AppHandle) -> String {
    load(&app)
        .server_url
        .unwrap_or_else(|| option_env!("HOTLINE_SERVER_URL").unwrap_or("http://localhost:3000").into())
}

/// Async on purpose: creating a window from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn set_server_url(app: AppHandle, url: String) -> Result<(), String> {
    let origin = normalize(&url)?;
    check_health(&origin).await?;
    save(&app, &Config { server_url: Some(origin.clone()) })?;
    crate::open_console(&app, &origin).map_err(|e| e.to_string())?;
    if let Some(setup) = app.get_webview_window(crate::SETUP) {
        let _ = setup.close();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn keeps_only_the_origin() {
        assert_eq!(normalize(" https://hotline.example.com/inbox/ ").unwrap(), "https://hotline.example.com");
        assert_eq!(normalize("http://localhost:3000/").unwrap(), "http://localhost:3000");
        assert_eq!(normalize("hotline.example.com").unwrap(), "https://hotline.example.com");
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(normalize("ftp://example.com").is_err());
        assert!(normalize("file:///C:/x").is_err());
        assert!(normalize("").is_err());
    }
}
