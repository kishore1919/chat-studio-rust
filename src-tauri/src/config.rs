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
            theme_id: default_theme_id(),
            accent: None,
            border_visibility: default_border_visibility(),
            font_size: 14,
            system_prompt: None,
            mcp_servers: Vec::new(),
            skills: default_skills(),
            agents: default_agents(),
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
    let mut settings: Settings = toml::from_str(&raw)?;
    if settings.theme_id.is_empty() {
        let migrated = migrate_theme_id(&settings.theme, &raw);
        if !migrated.is_empty() {
            settings.theme_id = migrated;
            let _ = save_settings(&settings);
        }
    }
    Ok(settings)
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
