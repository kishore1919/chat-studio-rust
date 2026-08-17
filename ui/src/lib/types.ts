// Mirrors the Rust types in src-tauri/src/{config,db,providers/mod,mcp,skills}.rs.
// Keep field names/casing in sync - commands.rs serializes with serde's
// default camelCase-free (snake_case) representation, matched here verbatim.

export type Dialect = 'openai_compat' | 'ollama'

export interface ProviderConfig {
  id: string
  display_name: string
  dialect: Dialect
  base_url: string
  api_key: string
  enabled: boolean
  extra_headers: Record<string, string>
  models: string[]
  /** Escape hatch for endpoints that reject an unrecognized `stream_options` field. */
  disable_stream_options: boolean
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface McpTool {
  name: string
  description?: string | null
  inputSchema: Record<string, unknown>
  server_id: string
  server_name: string
}

export interface Skill {
  id: string
  name: string
  description: string
  system_prompt: string
  slash_command: string
  icon: string
  enabled: boolean
  source?: 'builtin' | 'custom' | 'global' | string
  path?: string | null
}

export interface AgentConfig {
  id: string
  name: string
  description: string
  role: string
  system_prompt: string
  provider: string | null
  model: string | null
  skills: string[]
  icon: string
  enabled: boolean
}

export type ThemePreference = 'light' | 'dark' | 'system'

/** A saved message snippet, applied via `/prompt <name>` in the composer -
 * distinct from a Skill/Agent's system_prompt: this is inserted as the draft
 * message text for the user to review and send, not a persona change. */
export interface PromptTemplate {
  id: string
  name: string
  content: string
}

export interface Settings {
  providers: ProviderConfig[]
  default_provider: string | null
  default_model: string | null
  theme: ThemePreference
  theme_id: string
  accent: string | null
  border_visibility: string
  font_size: number
  system_prompt: string | null
  mcp_servers: McpServerConfig[]
  skills: Skill[]
  agents: AgentConfig[]
  prompts: PromptTemplate[]
  /** Soft budget (in tokens) for how much history is sent per turn. */
  context_tokens: number
}

export interface Conversation {
  id: number
  title: string
  provider: string
  model: string
  system_prompt: string | null
  pinned: boolean
  created_at: number
  updated_at: number
}

export type Role = 'user' | 'assistant' | 'system'

export interface Message {
  id: number
  conversation_id: number
  role: Role
  content: string
  reasoning: string | null
  provider: string | null
  model: string | null
  duration_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
  created_at: number
}

export interface ModelInfo {
  id: string
  display_name: string
}

// Emitted on the `stream://{stream_id}` event channel.
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'done'
      /** Null when nothing was persisted (an empty reply). */
      message_id: number | null
      provider: string
      model: string
      created_at: number
      tokens_in: number | null
      tokens_out: number | null
      duration_ms: number
    }
  | {
      type: 'error'
      message: string
      /** Set when partial output was still persisted before the error. */
      message_id: number | null
    }

/** Returned by send_message/retry_message/edit_and_resend_message. */
export interface StreamHandle {
  stream_id: string
  /** Rowid of the user turn just inserted; null for retry/edit-resend. */
  user_message_id: number | null
  /** Set when the auto-titler renamed a "New chat". */
  title: string | null
}

export type ProviderTestResult =
  | { ok: true; models_found: number }
  | { ok: false; message: string }

export interface Diagnostics {
  app_version: string
  log_dir: string
  config_dir: string
  db_path: string
  schema_version: number
  provider_count: number
  /** Recovered startup failures - corrupt settings, unopenable history. Shown
   * to the user once on mount so a degraded launch is never silent. */
  startup_warnings: string[]
}
