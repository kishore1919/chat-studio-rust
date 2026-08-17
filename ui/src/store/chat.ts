import { create } from 'zustand'
import { ipc, listenToStream } from '../lib/ipc'
import type { Conversation, Message } from '../lib/types'
import { useSettingsStore } from './settings'

const PAGE_SIZE = 50

/** Sentinel id for a row that's been optimistically rendered but not yet
 * persisted. `MAX_SAFE_INTEGER` rather than a negative number: negative
 * sentinels used to sort *below* every real autoincrement rowid, which broke
 * every `id > `/`id <` comparison retry and edit rely on to find "the next
 * message" - a real id is always numerically less than this one, so a
 * pending row sorts last, where it actually belongs. */
export const PENDING_ID = Number.MAX_SAFE_INTEGER
export function isPending(message: Message): boolean {
  return message.id === PENDING_ID
}

interface StreamingState {
  streamId: string
  conversationId: number
  text: string
  reasoning: string
}

const MAX_CACHED_CONVERSATIONS = 8

interface ChatState {
  conversations: Conversation[]
  activeConversationId: number | null
  messagesByConversation: Record<number, Message[]>
  hasMoreByConversation: Record<number, boolean>
  /** Most-recently-used first. Virtualization bounds the DOM as a
   * conversation grows, not the heap - this bounds how many conversations'
   * worth of messages stay resident across a long session of switching
   * between many chats. */
  cacheOrder: number[]
  streaming: StreamingState | null
  error: string | null
  activeAgentId: string | null

  loadConversations: () => Promise<void>
  selectConversation: (id: number) => Promise<void>
  loadOlderMessages: (conversationId: number) => Promise<void>
  createConversation: (
    provider: string,
    model: string,
    systemPrompt?: string | null,
    agentId?: string | null,
  ) => Promise<Conversation>
  renameConversation: (id: number, title: string) => Promise<void>
  pinConversation: (id: number, pinned: boolean) => Promise<void>
  clearConversation: (id: number) => Promise<void>
  setConversationModel: (id: number, provider: string, model: string) => Promise<void>
  setConversationSystemPrompt: (id: number, systemPrompt: string | null) => Promise<void>
  setActiveAgentId: (agentId: string | null) => void
  editMessage: (message: Message, content: string) => Promise<void>
  editAndResendMessage: (message: Message, content: string, reasoningEffort?: string | null) => Promise<void>
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
  cacheOrder: [],
  streaming: null,
  error: null,
  activeAgentId: 'general-assistant',

  setActiveAgentId: (activeAgentId) => set({ activeAgentId }),

  loadConversations: async () => {
    const conversations = await ipc.listConversations()
    set({ conversations })
    const activeAgent = get().activeAgentId
    const matching = activeAgent
      ? conversations.find((c) => (c.agent_id || 'general-assistant') === activeAgent)
      : conversations[0]
    if (get().activeConversationId === null && matching) {
      await get().selectConversation(matching.id)
    }
  },

  selectConversation: async (id) => {
    const conv = get().conversations.find((c) => c.id === id)
    if (conv?.agent_id) {
      set({ activeAgentId: conv.agent_id, activeConversationId: id })
    } else {
      set({ activeConversationId: id })
    }
    if (get().messagesByConversation[id]) {
      set((s) => touchCache(s, id))
      return
    }
    const messages = await ipc.getMessages(id, PAGE_SIZE, null)
    set((s) => {
      const touched = touchCache(s, id)
      return {
        ...touched,
        messagesByConversation: { ...touched.messagesByConversation, [id]: messages },
        hasMoreByConversation: { ...touched.hasMoreByConversation, [id]: messages.length === PAGE_SIZE },
      }
    })
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
    set((s) => {
      const touched = touchCache(s, conversationId)
      const current = touched.messagesByConversation[conversationId] ?? existing
      return {
        ...touched,
        messagesByConversation: {
          ...touched.messagesByConversation,
          [conversationId]: [...older, ...current],
        },
        hasMoreByConversation: {
          ...touched.hasMoreByConversation,
          [conversationId]: older.length === PAGE_SIZE,
        },
      }
    })
  },

  createConversation: async (provider, model, systemPrompt, agentId) => {
    const conv = await ipc.createConversation(provider, model, systemPrompt, agentId)
    set((s) => {
      const touched = touchCache(s, conv.id)
      return {
        conversations: [conv, ...s.conversations],
        ...touched,
        messagesByConversation: { ...touched.messagesByConversation, [conv.id]: [] },
        activeConversationId: conv.id,
        activeAgentId: conv.agent_id || agentId || s.activeAgentId,
      }
    })
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

  setConversationSystemPrompt: async (id, systemPrompt) => {
    await ipc.setConversationSystemPrompt(id, systemPrompt)
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, system_prompt: systemPrompt } : c,
      ),
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
        cacheOrder: s.cacheOrder.filter((x) => x !== id),
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
        cacheOrder: s.cacheOrder.filter((x) => !idSet.has(x)),
        activeConversationId:
          s.activeConversationId && idSet.has(s.activeConversationId)
            ? (nextConversations[0]?.id ?? null)
            : s.activeConversationId,
      }
    })
  },

  editMessage: async (message, content) => {
    await ipc.editMessage(message.id, content)
    set((s) => {
      // If this conversation was evicted from the cache, leave it evicted
      // rather than resurrecting a one-message stub - the next
      // `selectConversation` will refetch it whole.
      const existing = s.messagesByConversation[message.conversation_id]
      if (!existing) return {}
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [message.conversation_id]: existing.map((m) => (m.id === message.id ? { ...m, content } : m)),
        },
      }
    })
  },

  editAndResendMessage: async (message, content, reasoningEffort) => {
    const conversationId = message.conversation_id
    if (get().activeConversationId !== conversationId) return

    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: (s.messagesByConversation[conversationId] ?? [])
          .filter((m) => m.id <= message.id)
          .map((m) => (m.id === message.id ? { ...m, content } : m)),
      },
      error: null,
    }))

    const streamId = crypto.randomUUID()
    const unlisten = await attachStreamListener(set, get, conversationId, streamId)
    try {
      await ipc.editAndResendMessage(conversationId, message.id, content, reasoningEffort, streamId)
    } catch (err) {
      unlisten()
      set({ streaming: null, error: String(err) })
    }
  },

  deleteMessage: async (message) => {
    await ipc.deleteMessage(message.id)
    set((s) => {
      const existing = s.messagesByConversation[message.conversation_id]
      if (!existing) return {}
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [message.conversation_id]: existing.filter((m) => m.id !== message.id),
        },
      }
    })
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
      id: PENDING_ID,
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

    // The stream id is minted here, not by the backend, and the listener is
    // attached before the invoke resolves: `start_stream` spawns its emitter
    // task as soon as the command runs, and Tauri silently drops events with
    // no subscriber. Waiting for the invoke's response to attach lost the
    // occasional un-coalesced `reasoning` event to that race.
    const streamId = crypto.randomUUID()
    const unlisten = await attachStreamListener(set, get, conversationId, streamId)
    try {
      const handle = await ipc.sendMessage(conversationId, text, reasoningEffort, streamId)
      set((s) => ({
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: (s.messagesByConversation[conversationId] ?? []).map((m) =>
            m === optimisticUser ? { ...m, id: handle.user_message_id ?? m.id } : m,
          ),
        },
      }))
    } catch (err) {
      unlisten()
      set((s) => ({
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: (s.messagesByConversation[conversationId] ?? []).filter(
            (m) => m !== optimisticUser,
          ),
        },
        streaming: null,
        error: String(err),
      }))
    }
  },

  retryMessage: async (message, reasoningEffort) => {
    const conversationId = message.conversation_id
    if (get().activeConversationId !== conversationId) return

    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: (s.messagesByConversation[conversationId] ?? []).filter((m) =>
          message.role === 'user' ? m.id <= message.id : m.id < message.id,
        ),
      },
      error: null,
    }))

    const streamId = crypto.randomUUID()
    const unlisten = await attachStreamListener(set, get, conversationId, streamId)
    try {
      // Retrying a user message must keep that message and drop only what
      // came after it - `edit_and_resend_message` already deletes with that
      // exclusive semantics via a no-op edit, so reuse it rather than
      // duplicating the delete logic. Retrying an assistant message drops
      // the reply itself too, which is `retry_message`'s inclusive delete.
      if (message.role === 'user') {
        await ipc.editAndResendMessage(conversationId, message.id, message.content, reasoningEffort, streamId)
      } else {
        await ipc.retryMessage(conversationId, message.id, reasoningEffort, streamId)
      }
    } catch (err) {
      unlisten()
      set({ streaming: null, error: String(err) })
    }
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

/** The active conversation and whichever one is currently streaming can
 * never be evicted, regardless of their position in the MRU list - streaming
 * in particular must survive since `attachStreamListener`'s done/error
 * handlers still need somewhere to append the finished message. */
function pinnedIds(s: Pick<ChatState, 'activeConversationId' | 'streaming'>): number[] {
  const ids = [s.activeConversationId, s.streaming?.conversationId ?? null]
  return ids.filter((x): x is number => x !== null)
}

/** Moves `id` to the front of the MRU list and evicts the coldest cached
 * conversations beyond `MAX_CACHED_CONVERSATIONS`, skipping pinned ids. `id`
 * itself is always exempt from its own touch, since it's placed at the front
 * before eviction runs. */
function touchCache(
  s: Pick<ChatState, 'cacheOrder' | 'messagesByConversation' | 'hasMoreByConversation' | 'activeConversationId' | 'streaming'>,
  id: number,
): Pick<ChatState, 'cacheOrder' | 'messagesByConversation' | 'hasMoreByConversation'> {
  const nextOrder = [id, ...s.cacheOrder.filter((x) => x !== id)]
  const pinned = new Set(pinnedIds(s))
  const evictable = nextOrder.filter((x) => !pinned.has(x))
  const toEvict = new Set(evictable.slice(MAX_CACHED_CONVERSATIONS))

  if (toEvict.size === 0) {
    return {
      cacheOrder: nextOrder,
      messagesByConversation: s.messagesByConversation,
      hasMoreByConversation: s.hasMoreByConversation,
    }
  }

  const messagesByConversation = { ...s.messagesByConversation }
  const hasMoreByConversation = { ...s.hasMoreByConversation }
  for (const evictId of toEvict) {
    delete messagesByConversation[evictId]
    delete hasMoreByConversation[evictId]
  }
  return {
    cacheOrder: nextOrder.filter((x) => !toEvict.has(x)),
    messagesByConversation,
    hasMoreByConversation,
  }
}

/** Shared by sendMessage/retryMessage/editAndResendMessage - all three mint a
 * stream id up front and need to accumulate the same delta/reasoning/done/
 * error events onto it. Returns the unlisten fn so a failed invoke can detach
 * a listener that will now never receive a terminal event. */
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
      // `message_id` is null when the reply was empty - nothing was
      // persisted, so there is no row to add, just clear the streaming state.
      if (event.message_id !== null) {
        const finished: Message = {
          id: event.message_id,
          conversation_id: conversationId,
          role: 'assistant',
          content: current.text,
          reasoning: current.reasoning || null,
          provider: event.provider,
          model: event.model,
          duration_ms: event.duration_ms,
          tokens_in: event.tokens_in,
          tokens_out: event.tokens_out,
          created_at: event.created_at,
        }
        set((s) => {
          // The conversation is pinned (see `pinnedIds`) while it's the one
          // streaming, so eviction can't have removed it - but stay
          // defensive rather than resurrecting a stub if that ever changes.
          const existing = s.messagesByConversation[conversationId]
          if (!existing) return { streaming: null }
          return {
            messagesByConversation: {
              ...s.messagesByConversation,
              [conversationId]: [...existing, finished],
            },
            streaming: null,
          }
        })
      } else {
        set({ streaming: null })
      }
      unlisten()
    } else if (event.type === 'error') {
      // The backend persists whatever text arrived before the error, so the
      // frontend must do the same - otherwise a mid-stream network drop
      // would silently discard output the user already saw. Use the real row
      // id when the backend managed to save it; fall back to the pending
      // sentinel (mutations disabled) when the save itself failed.
      if (current.text) {
        const partial: Message = {
          id: event.message_id ?? PENDING_ID,
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
        set((s) => {
          const existing = s.messagesByConversation[conversationId]
          if (!existing) return {}
          return {
            messagesByConversation: {
              ...s.messagesByConversation,
              [conversationId]: [...existing, partial],
            },
          }
        })
      }
      set({ streaming: null, error: event.message })
      unlisten()
    }
  })
  return unlisten
}

/** Selector-only hook: subscribes solely to the in-flight text, so only the
 * streaming bubble re-renders per flush - never the settled message list. */
export function useStreamingMessage() {
  return useChatStore((s) => s.streaming)
}

/** The module-level constant is load-bearing: a `?? []` literal written inline
 * in a selector returns a fresh reference on every call, which
 * useSyncExternalStore reads as a perpetual change - that caused a real
 * infinite render loop in this codebase once. Kept here as the single shared
 * definition so no component has to remember the rule. */
export const EMPTY_MESSAGES: Message[] = []

/** Subscribes to one conversation's messages only, so an update to any other
 * conversation cannot re-render the caller. */
export function useConversationMessages(conversationId: number | null) {
  return useChatStore((s) =>
    conversationId === null
      ? EMPTY_MESSAGES
      : (s.messagesByConversation[conversationId] ?? EMPTY_MESSAGES),
  )
}
