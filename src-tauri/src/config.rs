use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Dialect {
    OpenaiCompat,
    Ollama,
    Anthropic,
    Gemini,
    Openai,
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
    /// Escape hatch for endpoints that reject an unrecognized
    /// `stream_options` field outright instead of ignoring it.
    #[serde(default)]
    pub disable_stream_options: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    #[serde(default)]
    pub slash_command: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub path: Option<String>,
}

fn default_source() -> String {
    "builtin".into()
}

fn default_skills() -> Vec<Skill> {
    vec![
        Skill {
            id: "code-review".into(),
            name: "Code Reviewer".into(),
            description: "Thorough code reviews with bug detection and idiomatic suggestions.".into(),
            system_prompt: "You are an expert software engineer. Review the provided code for correctness, security vulnerabilities, edge cases, performance, and readability. Provide concrete code diffs or examples for improvements.".into(),
            slash_command: "review".into(),
            icon: "code".into(),
            enabled: true,
            source: "builtin".into(),
            path: None,
        },
        Skill {
            id: "summarize".into(),
            name: "Summarizer".into(),
            description: "Extract executive bullet points and key takeaways.".into(),
            system_prompt: "You are a concise executive summarizer. Analyze the text provided and give a high-level summary followed by numbered key takeaways and actionable conclusions.".into(),
            slash_command: "summarize".into(),
            icon: "file-text".into(),
            enabled: true,
            source: "builtin".into(),
            path: None,
        },
        Skill {
            id: "problem-solver".into(),
            name: "Problem Solver".into(),
            description: "Step-by-step reasoning for complex logic, math, and algorithms.".into(),
            system_prompt: "You are a senior problem solver. Break down difficult questions or algorithms into structured step-by-step explanations before giving the final answer.".into(),
            slash_command: "solve".into(),
            icon: "brain".into(),
            enabled: true,
            source: "builtin".into(),
            path: None,
        },
        Skill {
            id: "translator".into(),
            name: "Translator".into(),
            description: "Translate content fluently preserving tone and formatting.".into(),
            system_prompt: "You are a professional multilingual translator. Translate the text accurately while preserving nuance, cultural context, and markdown formatting.".into(),
            slash_command: "translate".into(),
            icon: "languages".into(),
            enabled: true,
            source: "builtin".into(),
            path: None,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub role: String,
    pub system_prompt: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub icon: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_agents() -> Vec<AgentConfig> {
    vec![
        AgentConfig {
            id: "general-assistant".into(),
            name: "General Assistant".into(),
            description: "Friendly and intelligent AI assistant for every task.".into(),
            role: "Helpful Assistant".into(),
            system_prompt: "You are a thoughtful, helpful, and highly capable AI assistant.".into(),
            provider: None,
            model: None,
            skills: vec![],
            icon: "bot".into(),
            enabled: true,
        },
        AgentConfig {
            id: "code-architect".into(),
            name: "Code Architect".into(),
            description: "Senior systems and software design engineer.".into(),
            role: "Software Architect".into(),
            system_prompt: "You are an elite software architect and senior developer. When discussing code, give clean, idiomatic, robust, and well-structured solutions with full attention to edge cases, performance, and best practices.".into(),
            provider: None,
            model: None,
            skills: vec!["code-review".into(), "problem-solver".into()],
            icon: "code".into(),
            enabled: true,
        },
        AgentConfig {
            id: "research-analyst".into(),
            name: "Research Analyst".into(),
            description: "Deep dive research, fact-checking, and structured reports.".into(),
            role: "Research Specialist".into(),
            system_prompt: "You are a meticulous research analyst. Provide deep, balanced, well-referenced, and synthesized insights on any topic.".into(),
            provider: None,
            model: None,
            skills: vec!["summarize".into()],
            icon: "search".into(),
            enabled: true,
        },
    ]
}

/// A saved message snippet, applied via `/prompt <name>` in the composer -
/// distinct from a Skill/Agent's `system_prompt`: this is inserted as the
/// draft message text for the user to review and send, not a persona change
/// applied to the conversation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub content: String,
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
    #[serde(default = "default_theme_id")]
    pub theme_id: String,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default = "default_border_visibility")]
    pub border_visibility: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
    #[serde(default = "default_skills")]
    pub skills: Vec<Skill>,
    #[serde(default = "default_agents")]
    pub agents: Vec<AgentConfig>,
    #[serde(default)]
    pub prompts: Vec<PromptTemplate>,
    /// Soft budget for how much history `prepare_chat` sends per turn. Not an
    /// exact token count - no tokenizer is bundled - just a conservative
    /// chars-per-token proxy, so undercounting drops one old turn rather than
    /// overshooting a provider's real limit.
    #[serde(default = "default_context_tokens")]
    pub context_tokens: u32,
}

fn default_theme() -> ThemePreference {
    ThemePreference::System
}

fn default_theme_id() -> String {
    "system".into()
}

fn default_border_visibility() -> String {
    "subtle".into()
}

fn migrate_theme_id(theme: &ThemePreference, raw: &str) -> String {
    if raw.contains("theme_id") {
        return String::new();
    }
    match theme {
        ThemePreference::Light => "light-modern".into(),
        ThemePreference::Dark => "dark-modern".into(),
        ThemePreference::System => "system".into(),
    }
}

fn default_font_size() -> u32 {
    16
}

fn default_context_tokens() -> u32 {
    32768
}

fn builtin_providers() -> Vec<ProviderConfig> {
    vec![
        ProviderConfig {
            id: "openrouter".into(),
            display_name: "OpenRouter".into(),
            dialect: Dialect::OpenaiCompat,
            base_url: "https://openrouter.ai/api/v1".into(),
            api_key: String::new(),
            enabled: true,
            extra_headers: Default::default(),
            models: Vec::new(),
            disable_stream_options: false,
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
            disable_stream_options: false,
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
            disable_stream_options: false,
        },
        ProviderConfig {
            id: "openai".into(),
            display_name: "OpenAI".into(),
            dialect: Dialect::Openai,
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            enabled: true,
            extra_headers: Default::default(),
            models: Vec::new(),
            disable_stream_options: false,
        },
        ProviderConfig {
            id: "anthropic".into(),
            display_name: "Anthropic".into(),
            dialect: Dialect::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            api_key: String::new(),
            enabled: true,
            extra_headers: Default::default(),
            models: Vec::new(),
            disable_stream_options: false,
        },
        ProviderConfig {
            id: "gemini".into(),
            display_name: "Google Gemini".into(),
            dialect: Dialect::Gemini,
            base_url: "https://generativelanguage.googleapis.com".into(),
            api_key: String::new(),
            enabled: true,
            extra_headers: Default::default(),
            models: Vec::new(),
            disable_stream_options: false,
        },
    ]
}

fn ensure_builtin_providers(settings: &mut Settings) -> bool {
    let mut changed = false;
    for builtin in builtin_providers() {
        if !settings.providers.iter().any(|p| p.id == builtin.id) {
            settings.providers.push(builtin);
            changed = true;
        }
    }
    changed
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            providers: builtin_providers(),
            default_provider: None,
            default_model: None,
            theme: ThemePreference::System,
            theme_id: default_theme_id(),
            accent: None,
            border_visibility: default_border_visibility(),
            font_size: 16,
            system_prompt: None,
            mcp_servers: Vec::new(),
            skills: default_skills(),
            agents: default_agents(),
            prompts: Vec::new(),
            context_tokens: default_context_tokens(),
        }
    }
}

/// Resolved once and cached. The fallback chain exists because the previous
/// `expect` turned an unusual environment into a silent abort at startup - in a
/// release build there is no console, so the user just sees nothing happen.
pub fn config_dir() -> PathBuf {
    static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        if let Some(dir) = dirs::config_dir() {
            return dir.join("chat-studio");
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(local).join("chat-studio");
        }
        // Last resort: sit next to the executable. Never ideal, but it keeps
        // the app usable instead of refusing to launch.
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.join("chat-studio")))
            .unwrap_or_else(|| PathBuf::from("chat-studio"))
    })
    .clone()
}

pub fn log_dir() -> PathBuf {
    config_dir().join("logs")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.toml")
}

/// Moves an unreadable `settings.toml` aside so the app can start on defaults
/// without destroying whatever the user had. Returns the backup path for the
/// warning shown to them.
pub fn quarantine_settings_file() -> Option<PathBuf> {
    let path = settings_path();
    if !path.exists() {
        return None;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = path.with_extension(format!("toml.bad.{stamp}"));
    match std::fs::rename(&path, &backup) {
        Ok(()) => Some(backup),
        Err(e) => {
            tracing::error!(error = %e, "could not quarantine settings file");
            None
        }
    }
}

#[derive(thiserror::Error, Debug)]
pub enum ConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid settings format: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("could not serialize settings: {0}")]
    Serialize(#[from] toml::ser::Error),
}

pub fn load_settings() -> Result<Settings, ConfigError> {
    let path = settings_path();
    if !path.exists() {
        let settings = Settings::default();
        save_settings(&settings)?;
        return Ok(settings);
    }
    let raw = std::fs::read_to_string(&path)?;
    let mut settings: Settings = toml::from_str(&raw)?;
    let mut needs_save = false;
    if settings.theme_id.is_empty() {
        let migrated = migrate_theme_id(&settings.theme, &raw);
        if !migrated.is_empty() {
            settings.theme_id = migrated;
            needs_save = true;
        }
    }
    if ensure_builtin_providers(&mut settings) {
        needs_save = true;
    }
    if needs_save {
        if let Err(e) = save_settings(&settings) {
            tracing::warn!(error = %e, "could not persist migrated settings");
        }
    }
    Ok(settings)
}

pub fn save_settings(settings: &Settings) -> Result<(), ConfigError> {
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
