import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  Conversation,
  Message,
  ModelInfo,
  ProviderConfig,
  ProviderTestResult,
  Settings,
  StreamEvent,
} from './types'

// Typed wrappers over the #[tauri::command] surface in src-tauri/src/commands.rs.
// Every function here corresponds 1:1 to a command by name.

export const ipc = {
  listConversations: () => invoke<Conversation[]>('list_conversations'),

  getMessages: (conversationId: number, limit: number, beforeId: number | null) =>
    invoke<Message[]>('get_messages', { conversationId, limit, beforeId }),

  createConversation: (provider: string, model: string) =>
    invoke<Conversation>('create_conversation', { provider, model }),

  renameConversation: (conversationId: number, title: string) =>
    invoke<void>('rename_conversation', { conversationId, title }),

  deleteConversation: (conversationId: number) =>
    invoke<void>('delete_conversation', { conversationId }),

  pinConversation: (conversationId: number, pinned: boolean) =>
    invoke<void>('pin_conversation', { conversationId, pinned }),

  clearConversation: (conversationId: number) =>
    invoke<void>('clear_conversation', { conversationId }),

  setConversationModel: (conversationId: number, provider: string, model: string) =>
    invoke<void>('set_conversation_model', { conversationId, provider, model }),

  sendMessage: (conversationId: number, text: string, reasoningEffort?: string | null) =>
    invoke<string>('send_message', { conversationId, text, reasoningEffort: reasoningEffort ?? null }),

  retryMessage: (conversationId: number, messageId: number, reasoningEffort?: string | null) =>
    invoke<string>('retry_message', { conversationId, messageId, reasoningEffort: reasoningEffort ?? null }),

  cancelStream: (streamId: string) => invoke<void>('cancel_stream', { streamId }),

  editMessage: (messageId: number, content: string) =>
    invoke<void>('edit_message', { messageId, content }),

  deleteMessage: (messageId: number) => invoke<void>('delete_message', { messageId }),

  listModels: (providerId: string, forceRefresh: boolean) =>
    invoke<ModelInfo[]>('list_models', { providerId, forceRefresh }),

  getSettings: () => invoke<Settings>('get_settings'),

  saveSettings: (settings: Settings) => invoke<void>('save_settings', { settings }),

  addProvider: (provider: ProviderConfig) => invoke<void>('add_provider', { provider }),

  removeProvider: (providerId: string) => invoke<void>('remove_provider', { providerId }),

  testProvider: (providerId: string) => invoke<ProviderTestResult>('test_provider', { providerId }),

  testMcpServer: (command: string, args: string[], env: Record<string, string>) =>
    invoke<import('./types').McpTool[]>('test_mcp_server', { command, args, env }),

  listMcpTools: () => invoke<import('./types').McpTool[]>('list_mcp_tools'),

  callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) =>
    invoke<string>('call_mcp_tool', { serverId, toolName, arguments: args }),

  listGlobalSkills: () => invoke<import('./types').Skill[]>('list_global_skills'),

  openConfigDir: () => invoke<void>('open_config_dir'),
}

/** Subscribes to the coalesced delta stream for one in-flight message. */
export function listenToStream(
  streamId: string,
  onEvent: (event: StreamEvent) => void,
): Promise<UnlistenFn> {
  return listen<StreamEvent>(`stream://${streamId}`, (e) => onEvent(e.payload))
}
