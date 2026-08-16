// Mirrors the Rust types in src-tauri/src/{config,db,providers/mod}.rs.
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
}

export type ThemePreference = 'light' | 'dark' | 'system'

export interface Settings {
  providers: ProviderConfig[]
  default_provider: string | null
  default_model: string | null
  theme: ThemePreference
  font_size: number
  system_prompt: string | null
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
  | { type: 'done'; tokens_in: number | null; tokens_out: number | null; duration_ms: number }
  | { type: 'error'; message: string }

export type ProviderTestResult =
  | { ok: true; models_found: number }
  | { ok: false; message: string }
