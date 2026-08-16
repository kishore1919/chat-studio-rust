import { useState, type KeyboardEvent } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'

interface ChatHeaderProps {
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

export function ChatHeader({ onToggleSidebar, onOpenSettings }: ChatHeaderProps) {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const setConversationModel = useChatStore((s) => s.setConversationModel)
  const settings = useSettingsStore((s) => s.settings)
  const modelsByProvider = useSettingsStore((s) => s.modelsByProvider)
  const active = conversations.find((c) => c.id === activeConversationId)

  const [editing, setEditing] = useState(false)
  const [draftProvider, setDraftProvider] = useState('')
  const [draftModel, setDraftModel] = useState('')

  const startEditing = () => {
    if (!active) return
    setDraftProvider(active.provider)
    setDraftModel(active.model)
    setEditing(true)
  }

  const commit = () => {
    if (active && draftModel.trim()) {
      setConversationModel(active.id, draftProvider, draftModel.trim())
    }
    setEditing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') setEditing(false)
  }

  const suggestions = modelsByProvider[draftProvider] ?? []

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-3">
      <button
        onClick={onToggleSidebar}
        className="rounded px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        title="Toggle sidebar"
      >
        ☰
      </button>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-semibold">Chat Studio</span>
        {active && !editing && (
          <>
            <span className="text-[var(--text-muted)]">·</span>
            <select
              value={active.provider}
              onChange={(e) => setConversationModel(active.id, e.target.value, active.model)}
              className="rounded-md bg-transparent px-1 py-0.5 text-[var(--text-muted)] outline-none hover:bg-[var(--bg-hover)]"
            >
              {(settings?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <button
              onClick={startEditing}
              className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
              title="Click to change model"
            >
              {active.model || 'set model...'}
            </button>
          </>
        )}
        {active && editing && (
          <>
            <span className="text-[var(--text-muted)]">·</span>
            <input
              autoFocus
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commit}
              list="model-suggestions"
              placeholder="Type a model id..."
              className="w-48 rounded-md border border-[var(--accent)] bg-[var(--bg-elevated)] px-2 py-0.5 outline-none"
            />
            <datalist id="model-suggestions">
              {suggestions.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </>
        )}
      </div>
      <div className="flex-1" />
      <button
        onClick={onOpenSettings}
        className="rounded px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        title="Settings"
      >
        ⚙
      </button>
    </header>
  )
}
