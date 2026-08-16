import { create } from 'zustand'
import { ipc, listenToStream } from '../lib/ipc'
import type { Conversation, Message } from '../lib/types'

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
  // Kept as its own top-level key so updating it during a stream never
  // changes the `messagesByConversation` reference - components that select
  // only settled messages don't re-render on every token flush.
  streaming: StreamingState | null
  error: string | null

  loadConversations: () => Promise<void>
  selectConversation: (id: number) => Promise<void>
  loadOlderMessages: (conversationId: number) => Promise<void>
  createConversation: (provider: string, model: string) => Promise<Conversation>
  renameConversation: (id: number, title: string) => Promise<void>
  setConversationModel: (id: number, provider: string, model: string) => Promise<void>
  editMessage: (message: Message, content: string) => Promise<void>
  deleteMessage: (message: Message) => Promise<void>
  deleteConversation: (id: number) => Promise<void>
  sendMessage: (text: string) => Promise<void>
  cancelStream: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messagesByConversation: {},
  hasMoreByConversation: {},
  streaming: null,
  error: null,

  loadConversations: async () => {
    const conversations = await ipc.listConversations()
    set({ conversations })
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

  sendMessage: async (text) => {
    const conversationId = get().activeConversationId
    if (conversationId === null) return

    const optimisticUser: Message = {
      id: -Date.now(),
      conversation_id: conversationId,
      role: 'user',
      content: text,
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

    const streamId = await ipc.sendMessage(conversationId, text)
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
        // The backend persists whatever text arrived before the error, so
        // the frontend must do the same - otherwise a mid-stream network
        // drop would silently discard output the user already saw.
        if (current.text) {
          const partial: Message = {
            id: -Date.now() - 1,
            conversation_id: conversationId,
            role: 'assistant',
            content: current.text,
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
  },

  cancelStream: async () => {
    const streaming = get().streaming
    if (!streaming) return
    await ipc.cancelStream(streaming.streamId)
  },
}))

/** Selector-only hook: subscribes solely to the in-flight text, so only the
 * streaming bubble re-renders per flush - never the settled message list. */
export function useStreamingMessage() {
  return useChatStore((s) => s.streaming)
}
