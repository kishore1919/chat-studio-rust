import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../store/settings'
import { ipc } from '../../lib/ipc'
import { useDebouncedCallback } from '../../lib/utils'
import type { LastRequestInfo, Settings } from '../../lib/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function ContextPane() {
  const settings = useSettingsStore((s) => s.settings)
  const setLocalSettings = useSettingsStore((s) => s.setLocalSettings)
  const [lastRequest, setLastRequest] = useState<LastRequestInfo | null>(null)

  const debouncedPersist = useDebouncedCallback((next: Settings) => {
    void ipc.saveSettings(next)
  }, 250)
  const applyLive = (next: Settings) => {
    setLocalSettings(next)
    debouncedPersist(next)
  }

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      ipc
        .getLastRequest()
        .then((r) => {
          if (!cancelled) setLastRequest(r)
        })
        .catch(() => {
          // Advisory only - a failed poll just leaves the last known snapshot.
        })
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!settings) return null

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-base font-semibold text-foreground">Context</h2>

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <div className="mb-1 flex items-center justify-between">
          <Label htmlFor="context-tokens" className="text-xs font-medium text-foreground">
            Context window budget
          </Label>
          <Input
            id="context-tokens"
            type="number"
            min={1024}
            step={1024}
            value={settings.context_tokens}
            onChange={(e) => {
              const context_tokens = Math.max(1024, Number(e.target.value) || 0)
              applyLive({ ...settings, context_tokens })
            }}
            className="h-7 w-28 text-right text-xs"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          How much conversation history (in tokens) is sent with each request. This is an
          estimate, not an exact tokenizer count - no tokenizer is bundled, so a conservative
          characters-per-token proxy is used instead. When a conversation grows past this
          budget, the oldest messages are dropped first; pin a message to always keep it, or
          exclude one to keep it out of every request.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="memory-enabled" className="text-xs font-medium text-foreground">
              Rolling memory
            </Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              When history exceeds the budget, have the conversation's own provider compress the
              oldest turns into a summary instead of dropping them silently. The summary is
              injected into later requests so the model can still answer about earlier turns.
            </p>
          </div>
          <Switch
            id="memory-enabled"
            checked={settings.memory_enabled}
            onCheckedChange={(checked) => applyLive({ ...settings, memory_enabled: checked })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="mb-2 text-xs font-medium text-foreground">Last request</p>
        {lastRequest ? (
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>
              Conversation #{lastRequest.conversation_id} · {lastRequest.provider_id} /{' '}
              {lastRequest.model}
            </p>
            <p>
              {lastRequest.message_roles.length} messages sent · {lastRequest.used_tokens} /{' '}
              {lastRequest.budget_tokens} tokens used
            </p>
            {lastRequest.dropped_count > 0 && (
              <p className="text-amber-500">
                {lastRequest.dropped_count} earlier message
                {lastRequest.dropped_count === 1 ? '' : 's'} dropped to fit the budget
              </p>
            )}
            <p className="break-all font-mono text-[10px]">
              {lastRequest.message_roles.join(' → ')}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No request sent yet this session.
          </p>
        )}
      </div>
    </div>
  )
}
