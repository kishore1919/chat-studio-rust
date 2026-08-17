use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeMeta {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub theme_type: String,
    pub builtin: bool,
}

fn themes_dir() -> PathBuf {
    crate::config::config_dir().join("themes")
}

fn sanitize_id(name: &str) -> String {
    let id = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let id = id.trim_matches('-').to_string();
    if id.is_empty() { "custom-theme".into() } else { id }
}

pub fn ensure_themes_dir() -> anyhow::Result<()> {
    std::fs::create_dir_all(themes_dir())?;
    Ok(())
}

#[tauri::command]
pub fn list_themes() -> Result<Vec<ThemeMeta>, String> {
    let dir = themes_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let name = v
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("Custom Theme")
            .to_string();
        let theme_type = v
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("dark")
            .to_string();
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&name)
            .to_string();
        out.push(ThemeMeta {
            id: sanitize_id(&id),
            name,
            theme_type,
            builtin: false,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn get_theme_content(theme_id: String) -> Result<String, String> {
    let path = themes_dir().join(format!("{}.json", sanitize_id(&theme_id)));
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_theme_content(theme_id: String, content: String) -> Result<ThemeMeta, String> {
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Custom Theme")
        .to_string();
    if v.get("colors").is_none() && v.get("tokenColors").is_none() {
        return Err("Not a valid VS Code theme: missing colors/tokenColors".into());
    }
    let theme_type = v
        .get("type")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let bg = v
                .get("colors")
                .and_then(|c| c.get("editor.background"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            if is_light_hex(bg) { "light".into() } else { "dark".into() }
        });
    let id = if theme_id.trim().is_empty() {
        sanitize_id(&name)
    } else {
        sanitize_id(&theme_id)
    };
    ensure_themes_dir().map_err(|e| e.to_string())?;
    let path = themes_dir().join(format!("{}.json", id));
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(ThemeMeta {
        id,
        name,
        theme_type,
        builtin: false,
    })
}

#[tauri::command]
pub fn delete_custom_theme(theme_id: String) -> Result<(), String> {
    let path = themes_dir().join(format!("{}.json", sanitize_id(&theme_id)));
    if !path.exists() {
        return Err("Theme not found".into());
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_themes_dir() -> Result<(), String> {
    ensure_themes_dir().map_err(|e| e.to_string())?;
    open::that(themes_dir()).map_err(|e| e.to_string())
}

fn is_light_hex(s: &str) -> bool {
    let hex = s.trim_start_matches('#');
    if hex.len() < 6 {
        return false;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f32;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f32;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f32;
    let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma > 160.0
}
