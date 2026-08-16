use crate::config::Skill;
use std::fs;
use std::path::{Path, PathBuf};

/// Finds all global and system skill files across common agent and LLM directories.
pub fn discover_global_skills() -> Vec<Skill> {
    let mut discovered = Vec::new();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        search_dirs.push(home.join(".agents").join("skills"));
        search_dirs.push(home.join(".claude").join("skills"));
        search_dirs.push(home.join(".codex").join("skills"));
        search_dirs.push(home.join(".gemini").join("antigravity-cli").join("builtin").join("skills"));
        search_dirs.push(home.join(".config").join("chat-studio").join("skills"));
    }

    if let Some(config) = dirs::config_dir() {
        search_dirs.push(config.join("chat-studio").join("skills"));
    }

    // Local current directory skills
    search_dirs.push(PathBuf::from("skills"));

    for dir in search_dirs {
        if dir.exists() && dir.is_dir() {
            scan_skills_directory(&dir, &mut discovered);
        }
    }

    discovered
}

fn scan_skills_directory(dir: &Path, out: &mut Vec<Skill>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check for SKILL.md or skill.md or README.md inside subfolder
                let skill_md = path.join("SKILL.md");
                let skill_md_lower = path.join("skill.md");
                if skill_md.exists() {
                    if let Some(skill) = parse_skill_file(&skill_md, &path) {
                        out.push(skill);
                    }
                } else if skill_md_lower.exists() {
                    if let Some(skill) = parse_skill_file(&skill_md_lower, &path) {
                        out.push(skill);
                    }
                } else {
                    // Recurse one level
                    scan_skills_directory(&path, out);
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(skill) = parse_skill_file(&path, dir) {
                    out.push(skill);
                }
            }
        }
    }
}

fn parse_skill_file(file_path: &Path, parent_dir: &Path) -> Option<Skill> {
    let raw = fs::read_to_string(file_path).ok()?;
    let dir_name = parent_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skill")
        .to_string();

    let mut name = dir_name.replace('-', " ");
    let mut description = format!("Global skill from {}", parent_dir.display());
    let mut system_prompt = raw.clone();
    let mut slash_command = dir_name.to_lowercase().replace(' ', "-");
    let mut icon = "sparkles".to_string();

    // Parse YAML frontmatter if present (--- ... ---)
    if raw.starts_with("---") {
        if let Some(end_idx) = raw[3..].find("---") {
            let frontmatter = &raw[3..3 + end_idx];
            let body = raw[3 + end_idx + 3..].trim();
            system_prompt = body.to_string();

            for line in frontmatter.lines() {
                let trimmed = line.trim();
                if let Some((k, v)) = trimmed.split_once(':') {
                    let key = k.trim().to_lowercase();
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    match key.as_str() {
                        "name" => {
                            if !val.is_empty() {
                                name = val;
                            }
                        }
                        "description" => {
                            if !val.is_empty() {
                                description = val;
                            }
                        }
                        "slash_command" | "command" => {
                            if !val.is_empty() {
                                slash_command = val.replace('/', "");
                            }
                        }
                        "icon" => {
                            if !val.is_empty() {
                                icon = val;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    Some(Skill {
        id: format!("global-{}", slash_command),
        name,
        description,
        system_prompt,
        slash_command,
        icon,
        enabled: true,
        source: "global".into(),
        path: Some(file_path.to_string_lossy().to_string()),
    })
}
