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

/// Unbounded reads/writes of theme files straight into an IPC string were the
/// only place this module didn't bound its input - a multi-hundred-MB file
/// dropped in the themes directory (or pasted as import content) would have
/// been read whole before anything could reject it.
const MAX_THEME_FILE_BYTES: u64 = 2 * 1024 * 1024;
const LIGHT_LUMA_THRESHOLD: f32 = 160.0;

fn themes_dir() -> PathBuf {
    crate::config::config_dir().join("themes")
}

/// Collapses to alphanumerics and single dashes. Still leaves real
/// collisions possible (`my_theme`/`my-theme`/`my.theme` all sanitize to the
/// same id) - that's handled by `theme_path`'s callers checking existence,
/// not by trying to make sanitization injective.
fn sanitize_id(name: &str) -> String {
    let mut id = String::with_capacity(name.len());
    let mut last_was_dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            id.push(c);
            last_was_dash = false;
        } else if !last_was_dash {
            id.push('-');
            last_was_dash = true;
        }
    }
    let id = id.trim_matches('-').to_string();
    if id.is_empty() {
        "custom-theme".into()
    } else {
        id
    }
}

/// Resolves a theme id to its file path. `sanitize_id` can only ever produce
/// ASCII alphanumerics and single dashes, so a path escaping `themes_dir()`
/// should be unreachable - this assertion is a hard stop against that
/// invariant silently breaking later, rather than resting solely on
/// sanitization.
fn theme_path(theme_id: &str) -> Result<PathBuf, String> {
    let dir = themes_dir();
    let path = dir.join(format!("{}.json", sanitize_id(theme_id)));
    if path.parent() != Some(dir.as_path()) {
        return Err("invalid theme id".into());
    }
    Ok(path)
}

pub fn ensure_themes_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(themes_dir())
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
    let path = theme_path(&theme_id)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_THEME_FILE_BYTES {
        return Err(format!(
            "theme file exceeds {MAX_THEME_FILE_BYTES} byte limit"
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_theme_content(
    theme_id: String,
    content: String,
    overwrite: bool,
) -> Result<ThemeMeta, String> {
    if content.len() as u64 > MAX_THEME_FILE_BYTES {
        return Err(format!(
            "theme content exceeds {MAX_THEME_FILE_BYTES} byte limit"
        ));
    }
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
            if is_light_hex(bg).unwrap_or(false) {
                "light".into()
            } else {
                "dark".into()
            }
        });
    let id = if theme_id.trim().is_empty() {
        sanitize_id(&name)
    } else {
        sanitize_id(&theme_id)
    };
    let path = theme_path(&id)?;
    // `my_theme`/`my-theme`/`my.theme` all sanitize to the same id, so a
    // second import can silently overwrite an unrelated theme unless the
    // caller explicitly opts in.
    if !overwrite && path.exists() {
        return Err(format!(
            "A theme named '{id}' already exists. Rename it or import with overwrite."
        ));
    }
    ensure_themes_dir().map_err(|e| e.to_string())?;
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
    let path = theme_path(&theme_id)?;
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

/// `None` on anything that isn't a recognizable hex color - previously this
/// silently read as black (`unwrap_or(0)` per channel), which reported a
/// malformed color as "dark" rather than surfacing that it couldn't be
/// parsed. Callers still default to dark on `None`, matching the old
/// behavior; the difference is now visible to anyone reading the call site.
fn is_light_hex(s: &str) -> Option<bool> {
    let hex = s.trim_start_matches('#');
    let channel = |slice: &str| u8::from_str_radix(slice, 16).ok();
    let (r, g, b) = match hex.len() {
        3 | 4 => (
            channel(&hex[0..1].repeat(2))?,
            channel(&hex[1..2].repeat(2))?,
            channel(&hex[2..3].repeat(2))?,
        ),
        6 | 8 => (
            channel(&hex[0..2])?,
            channel(&hex[2..4])?,
            channel(&hex[4..6])?,
        ),
        _ => return None,
    };
    let luma = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
    Some(luma > LIGHT_LUMA_THRESHOLD)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_id_collapses_dash_runs_and_trims() {
        assert_eq!(sanitize_id("My  Cool!!Theme"), "my-cool-theme");
        assert_eq!(
            sanitize_id("--leading-and-trailing--"),
            "leading-and-trailing"
        );
    }

    #[test]
    fn sanitize_id_falls_back_when_nothing_survives() {
        assert_eq!(sanitize_id("!!!"), "custom-theme");
        assert_eq!(sanitize_id(""), "custom-theme");
    }

    #[test]
    fn sanitize_id_neutralizes_path_traversal() {
        let id = sanitize_id("../../etc/passwd");
        assert!(!id.contains(".."));
        assert!(!id.contains('/'));
    }

    #[test]
    fn theme_path_stays_inside_themes_dir() {
        let path = theme_path("../../etc/passwd").unwrap();
        assert_eq!(path.parent(), Some(themes_dir().as_path()));
    }

    #[test]
    fn different_looking_names_collide_to_the_same_id() {
        // Documents the collision `import_theme_content`'s existence check
        // guards against - sanitization is lossy by design, not injective.
        assert_eq!(sanitize_id("my_theme"), sanitize_id("my.theme"));
        assert_eq!(sanitize_id("my_theme"), sanitize_id("my-theme"));
    }

    #[test]
    fn is_light_hex_parses_all_recognized_forms() {
        assert_eq!(is_light_hex("#ffffff"), Some(true));
        assert_eq!(is_light_hex("#000000"), Some(false));
        assert_eq!(is_light_hex("#fff"), Some(true));
        assert_eq!(is_light_hex("#000"), Some(false));
        assert_eq!(is_light_hex("#ffffffff"), Some(true));
    }

    #[test]
    fn is_light_hex_rejects_malformed_input() {
        assert_eq!(is_light_hex(""), None);
        assert_eq!(is_light_hex("not-a-color"), None);
        assert_eq!(is_light_hex("#ff"), None);
    }
}
