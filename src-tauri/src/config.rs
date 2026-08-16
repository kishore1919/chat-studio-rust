use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Dialect {
    OpenaiCompat,
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub display_name: String,
    pub dialect: Dialect,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub extra_headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub models: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: ThemePreference,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

fn default_theme() -> ThemePreference {
    ThemePreference::System
}

fn default_font_size() -> u32 {
    14
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            providers: vec![
                ProviderConfig {
                    id: "openrouter".into(),
                    display_name: "OpenRouter".into(),
                    dialect: Dialect::OpenaiCompat,
                    base_url: "https://openrouter.ai/api/v1".into(),
                    api_key: String::new(),
                    enabled: true,
                    extra_headers: Default::default(),
                    models: Vec::new(),
                },
                ProviderConfig {
                    id: "nvidia-nim".into(),
                    display_name: "NVIDIA NIM".into(),
                    dialect: Dialect::OpenaiCompat,
                    base_url: "https://integrate.api.nvidia.com/v1".into(),
                    api_key: String::new(),
                    enabled: true,
                    extra_headers: Default::default(),
                    models: Vec::new(),
                },
                ProviderConfig {
                    id: "ollama-cloud".into(),
                    display_name: "Ollama Cloud".into(),
                    dialect: Dialect::Ollama,
                    base_url: "https://ollama.com".into(),
                    api_key: String::new(),
                    enabled: true,
                    extra_headers: Default::default(),
                    models: Vec::new(),
                },
            ],
            default_provider: None,
            default_model: None,
            theme: ThemePreference::System,
            font_size: 14,
            system_prompt: None,
        }
    }
}

pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .expect("no config directory available on this platform")
        .join("chat-studio")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.toml")
}

pub fn load_settings() -> anyhow::Result<Settings> {
    let path = settings_path();
    if !path.exists() {
        let settings = Settings::default();
        save_settings(&settings)?;
        return Ok(settings);
    }
    let raw = std::fs::read_to_string(&path)?;
    Ok(toml::from_str(&raw)?)
}

pub fn save_settings(settings: &Settings) -> anyhow::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let path = settings_path();
    let raw = toml::to_string_pretty(settings)?;
    std::fs::write(&path, raw)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&path, perms)?;
    }

    Ok(())
}
