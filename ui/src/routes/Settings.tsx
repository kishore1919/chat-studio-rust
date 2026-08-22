import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  BotIcon,
  CableIcon,
  DatabaseIcon,
  MessageSquareTextIcon,
  PaletteIcon,
  PlugIcon,
  SparklesIcon,
  WandSparklesIcon,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FEATURES } from '../lib/features'

// Each settings section is behind a nav click, not shown on first render -
// lazy-loading keeps the whole settings surface out of the eager chat bundle
// and each section out of every other section's chunk.
const ModelProviderPane = lazy(() =>
  import('../components/settings/ModelProviderPane').then((m) => ({ default: m.ModelProviderPane })),
)
const DefaultModelPane = lazy(() =>
  import('../components/settings/DefaultModelPane').then((m) => ({ default: m.DefaultModelPane })),
)
const AgentsPane = lazy(() => import('../components/AgentsPane').then((m) => ({ default: m.AgentsPane })))
const SkillsPane = lazy(() => import('../components/SkillsPane').then((m) => ({ default: m.SkillsPane })))
const PromptsPane = lazy(() => import('../components/PromptsPane').then((m) => ({ default: m.PromptsPane })))
const McpPane = lazy(() => import('../components/McpPane').then((m) => ({ default: m.McpPane })))
const AppearancePane = lazy(() =>
  import('../components/settings/AppearancePane').then((m) => ({ default: m.AppearancePane })),
)
const ContextPane = lazy(() =>
  import('../components/settings/ContextPane').then((m) => ({ default: m.ContextPane })),
)

interface SettingsProps {
  onBack: () => void
}

type NavSection =
  | 'model-provider'
  | 'default-model'
  | 'agents'
  | 'skills'
  | 'prompts'
  | 'mcp'
  | 'appearance'
  | 'context'

const NAV_GROUPS: { label: string; items: { id: NavSection; label: string; icon: LucideIcon }[] }[] = [
  {
    label: 'Providers',
    items: [
      { id: 'model-provider', label: 'Model Provider', icon: CableIcon },
      { id: 'default-model', label: 'Default Model', icon: SparklesIcon },
    ],
  },
  {
    label: 'Agents & Skills',
    items: [
      // Gated behind lib/features.ts until each has real backend wiring
      // (both now apply via `set_conversation_system_prompt`). Prompts has
      // no flag - it's a real feature from the start.
      ...(FEATURES.agents ? [{ id: 'agents' as const, label: 'Agents & Assistants', icon: BotIcon }] : []),
      ...(FEATURES.skills ? [{ id: 'skills' as const, label: 'Skills', icon: WandSparklesIcon }] : []),
      { id: 'prompts', label: 'Prompts', icon: MessageSquareTextIcon },
      { id: 'mcp', label: 'MCP Servers', icon: PlugIcon },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
      { id: 'context', label: 'Context', icon: DatabaseIcon },
    ],
  },
]

export function Settings({ onBack }: SettingsProps) {
  const [section, setSection] = useState<NavSection>('model-provider')
  const settings = useSettingsStore((s) => s.settings)
  const load = useSettingsStore((s) => s.load)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!settings) load()
  }, [settings, load])

  useEffect(() => {
    // App.tsx swaps routes by conditional render with no router - without
    // this, focus lands on <body> on every navigation into Settings.
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to chat" className="text-xs font-medium text-foreground">
          <ArrowLeftIcon /> Back
        </Button>
        <h1 ref={headingRef} tabIndex={-1} className="text-[13px] font-semibold tracking-tight text-foreground outline-none">
          Settings
        </h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-border px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-3.5">
              <div className="px-2 pb-1.5 text-[11px] font-bold tracking-wider text-foreground/80 uppercase">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors',
                    section === item.id
                      ? 'border-primary/40 bg-primary/20 font-bold text-primary shadow-xs'
                      : 'border-transparent text-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <item.icon className="size-3.5 shrink-0" aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Suspense fallback={null}>
            {section === 'model-provider' ? (
              <div className="h-full">
                <ModelProviderPane />
              </div>
            ) : (
              <div className="mx-auto max-w-3xl h-full">
                {section === 'default-model' && <DefaultModelPane />}
                {section === 'agents' && <AgentsPane />}
                {section === 'skills' && <SkillsPane />}
                {section === 'prompts' && <PromptsPane />}
                {section === 'mcp' && <McpPane />}
                {section === 'appearance' && <AppearancePane />}
                {section === 'context' && <ContextPane />}
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  )
}
