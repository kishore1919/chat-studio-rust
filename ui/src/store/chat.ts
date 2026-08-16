import { create } from 'zustand'
import { ipc, listenToStream } from '../lib/ipc'
import type { Conversation, Message } from '../lib/types'
import { useSettingsStore } from './settings'

const PAGE_SIZE = 50

interface StreamingState {
  streamId: string
  conversationId: number
  text: string
  reasoning: string
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: number | null
  messagesByConversation: Record<number, Message[]>
  hasMoreByConversation: Record<number, boolean>
  streaming: StreamingState | null
  error: string | null
  activeAgentId: string | null

  loadConversations: () => Promise<void>
  selectConversation: (id: number) => Promise<void>
  loadOlderMessages: (conversationId: number) => Promise<void>
  createConversation: (provider: string, model: string) => Promise<Conversation>
  renameConversation: (id: number, title: string) => Promise<void>
  pinConversation: (id: number, pinned: boolean) => Promise<void>
  clearConversation: (id: number) => Promise<void>
  setConversationModel: (id: number, provider: string, model: string) => Promise<void>
  setActiveAgentId: (agentId: string | null) => void
  editMessage: (message: Message, content: string) => Promise<void>
  deleteMessage: (message: Message) => Promise<void>
  deleteConversation: (id: number) => Promise<void>
  deleteConversations: (ids: number[]) => Promise<void>
  sendMessage: (text: string, reasoningEffort?: string | null) => Promise<void>
  retryMessage: (message: Message, reasoningEffort?: string | null) => Promise<void>
  cancelStream: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messagesByConversation: {},
  hasMoreByConversation: {},
  streaming: null,
  error: null,
  activeAgentId: 'general-assistant',

  setActiveAgentId: (activeAgentId) => set({ activeAgentId }),

  loadConversations: async () => {
    const conversations = await ipc.listConversations()
    set({ conversations })
    if (get().activeConversationId === null && conversations.length > 0) {
      await get().selectConversation(conversations[0].id)
    }
  },

  selectConversation: async (id) => {
    set({ activeConversationId: id })
    if (get().messagesByConversation[id]) return
    const messages = await ipc.getMessages(id, PAGE_SIZE, null)
    set((s) => ({
      messagesByConversation: { ...s.messagesByConversation, [id]: messages },
      hasMoreByConversation: { ...s.hasMoreByConversation, [id]: messages.length === PAGE_SIZE },
    }))
  },

  loadOlderMessages: async (conversationId) => {
    const existing = get().messagesByConversation[conversationId] ?? []
    if (!get().hasMoreByConversation[conversationId] || existing.length === 0) return
    const oldest = existing[0]
    const older = await ipc.getMessages(conversationId, PAGE_SIZE, oldest.id)
    if (older.length === 0) {
      set((s) => ({ hasMoreByConversation: { ...s.hasMoreByConversation, [conversationId]: false } }))
      return
    }
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: [...older, ...existing],
      },
      hasMoreByConversation: {
        ...s.hasMoreByConversation,
        [conversationId]: older.length === PAGE_SIZE,
      },
    }))
  },

  createConversation: async (provider, model) => {
    const conv = await ipc.createConversation(provider, model)
    set((s) => ({
      conversations: [conv, ...s.conversations],
      messagesByConversation: { ...s.messagesByConversation, [conv.id]: [] },
      activeConversationId: conv.id,
    }))
    return conv
  },

  renameConversation: async (id, title) => {
    await ipc.renameConversation(id, title)
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }))
  },

  setConversationModel: async (id, provider, model) => {
    await ipc.setConversationModel(id, provider, model)
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, provider, model } : c)),
    }))
  },

  pinConversation: async (id, pinned) => {
    await ipc.pinConversation(id, pinned)
    set((s) => ({
      // Mirrors the backend's `ORDER BY pinned DESC, updated_at DESC` so the
      // sidebar re-sorts immediately instead of waiting for a refetch.
      conversations: s.conversations
        .map((c) => (c.id === id ? { ...c, pinned } : c))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at),
    }))
  },

  clearConversation: async (id) => {
    await ipc.clearConversation(id)
    set((s) => ({
      messagesByConversation: { ...s.messagesByConversation, [id]: [] },
      hasMoreByConversation: { ...s.hasMoreByConversation, [id]: false },
    }))
  },

  deleteConversation: async (id) => {
    await ipc.deleteConversation(id)
    set((s) => {
      const { [id]: _removed, ...rest } = s.messagesByConversation
      return {
        conversations: s.conversations.filter((c) => c.id !== id),
        messagesByConversation: rest,
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
      }
    })
  },

  deleteConversations: async (ids) => {
    await Promise.all(ids.map((id) => ipc.deleteConversation(id)))
    const idSet = new Set(ids)
    set((s) => {
      const rest = { ...s.messagesByConversation }
      for (const id of ids) {
        delete rest[id]
      }
      const nextConversations = s.conversations.filter((c) => !idSet.has(c.id))
      return {
        conversations: nextConversations,
        messagesByConversation: rest,
        activeConversationId:
          s.activeConversationId && idSet.has(s.activeConversationId)
            ? (nextConversations[0]?.id ?? null)
            : s.activeConversationId,
      }
    })
  },

  editMessage: async (message, content) => {
    await ipc.editMessage(message.id, content)
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [message.conversation_id]: (s.messagesByConversation[message.conversation_id] ?? []).map(
          (m) => (m.id === message.id ? { ...m, content } : m),
        ),
      },
    }))
  },

  deleteMessage: async (message) => {
    await ipc.deleteMessage(message.id)
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [message.conversation_id]: (s.messagesByConversation[message.conversation_id] ?? []).filter(
          (m) => m.id !== message.id,
        ),
      },
    }))
  },

  sendMessage: async (text, reasoningEffort) => {
    let conversationId = get().activeConversationId
    if (conversationId === null) {
      const settings = useSettingsStore.getState().settings
      const providerId = settings?.default_provider ?? settings?.providers[0]?.id ?? 'default'
      const model = settings?.default_model ?? ''
      const conv = await get().createConversation(providerId, model)
      conversationId = conv.id
    }

    const optimisticUser: Message = {
      id: -Date.now(),
      conversation_id: conversationId,
      role: 'user',
      content: text,
      reasoning: null,
      provider: null,
      model: null,
      duration_ms: null,
      tokens_in: null,
      tokens_out: null,
      created_at: Math.floor(Date.now() / 1000),
    }
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: [...(s.messagesByConversation[conversationId] ?? []), optimisticUser],
      },
      error: null,
    }))

    // If conversation is named "New chat", immediately update the title to the first word
    const currentConv = get().conversations.find((c) => c.id === conversationId)
    if (currentConv && currentConv.title === 'New chat') {
      const firstWord = text.trim().split(/\s+/)[0]?.replace(/^[^\w]+|[^\w]+$/g, '') || text.trim().slice(0, 20)
      if (firstWord) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, title: firstWord } : c,
          ),
        }))
      }
    }

    const streamId = await ipc.sendMessage(conversationId, text, reasoningEffort)
    attachStreamListener(set, get, conversationId, streamId)
  },

  retryMessage: async (message, reasoningEffort) => {
    const conversationId = message.conversation_id
    if (get().activeConversationId !== conversationId) return

    if (message.role === 'user') {
      const messages = get().messagesByConversation[conversationId] ?? []
      const nextAssistant = messages.find((m) => m.id > message.id)
      if (nextAssistant) {
        set((s) => ({
          messagesByConversation: {
            ...s.messagesByConversation,
            [conversationId]: (s.messagesByConversation[conversationId] ?? []).filter(
              (m) => m.id <= message.id,
            ),
          },
          error: null,
        }))
        const streamId = await ipc.retryMessage(conversationId, nextAssistant.id, reasoningEffort)
        attachStreamListener(set, get, conversationId, streamId)
        return
      }
    }

    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: (s.messagesByConversation[conversationId] ?? []).filter(
          (m) => m.id < message.id,
        ),
      },
      error: null,
    }))

    const streamId = await ipc.retryMessage(conversationId, message.id, reasoningEffort)
    attachStreamListener(set, get, conversationId, streamId)
  },

  cancelStream: async () => {
    const streaming = get().streaming
    if (!streaming) return
    await ipc.cancelStream(streaming.streamId)
  },
}))

type Set = (
  partial:
    | Partial<ChatState>
    | ((state: ChatState) => Partial<ChatState>),
) => void
type Get = () => ChatState

/** Shared by sendMessage and retryMessage - both just kick off a stream_id
 * on the backend and then need to accumulate the same delta/reasoning/done/
 * error events onto it. */
async function attachStreamListener(set: Set, get: Get, conversationId: number, streamId: string) {
  set({ streaming: { streamId, conversationId, text: '', reasoning: '' } })

  const unlisten = await listenToStream(streamId, (event) => {
    const current = get().streaming
    if (!current || current.streamId !== streamId) return

    if (event.type === 'delta') {
      set({ streaming: { ...current, text: current.text + event.text } })
    } else if (event.type === 'reasoning') {
      set({ streaming: { ...current, reasoning: current.reasoning + event.text } })
    } else if (event.type === 'done') {
      const finished: Message = {
        id: -Date.now() - 1,
        conversation_id: conversationId,
        role: 'assistant',
        content: current.text,
        reasoning: current.reasoning || null,
        provider: null,
        model: null,
        duration_ms: event.duration_ms,
        tokens_in: event.tokens_in,
        tokens_out: event.tokens_out,
        created_at: Math.floor(Date.now() / 1000),
      }
      set((s) => ({
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: [...(s.messagesByConversation[conversationId] ?? []), finished],
        },
        streaming: null,
      }))
      unlisten()
    } else if (event.type === 'error') {
      // The backend persists whatever text arrived before the error, so the
      // frontend must do the same - otherwise a mid-stream network drop
      // would silently discard output the user already saw.
      if (current.text) {
        const partial: Message = {
          id: -Date.now() - 1,
          conversation_id: conversationId,
          role: 'assistant',
          content: current.text,
          reasoning: current.reasoning || null,
          provider: null,
          model: null,
          duration_ms: null,
          tokens_in: null,
          tokens_out: null,
          created_at: Math.floor(Date.now() / 1000),
        }
        set((s) => ({
          messagesByConversation: {
            ...s.messagesByConversation,
            [conversationId]: [...(s.messagesByConversation[conversationId] ?? []), partial],
          },
        }))
      }
      set({ streaming: null, error: event.message })
      unlisten()
    }
  })
}

/** Selector-only hook: subscribes solely to the in-flight text, so only the
 * streaming bubble re-renders per flush - never the settled message list. */
export function useStreamingMessage() {
  return useChatStore((s) => s.streaming)
}
