import { lazy, Suspense, type ComponentType } from 'react'
import { CableIcon } from 'lucide-react'
import type { Dialect } from './types'
import { cn } from './utils'

const BRAND_DIALECTS = new Set<Dialect>(['openai', 'anthropic', 'gemini', 'ollama'])

// @lobehub/icons is a heavy barrel for 4 brand marks - lazy-loading it keeps
// it off the eager chat bundle. The `openai_compat` branch below already
// falls back to CableIcon, so using the same icon as the Suspense fallback
// makes the loading state indistinguishable from a real state the UI shows.
const BrandIcon = lazy(() =>
  import('@lobehub/icons').then((m) => ({
    default: ({ dialect, className }: { dialect: Dialect; className?: string }) => {
      const Icon = (
        {
          openai: m.OpenAI,
          anthropic: m.Anthropic,
          gemini: m.Gemini,
          ollama: m.Ollama,
        } as Partial<Record<Dialect, ComponentType<{ className?: string }>>>
      )[dialect]
      if (!Icon) return <CableIcon className={cn('size-4', className)} aria-hidden="true" />
      return <Icon className={cn('size-4', className)} aria-hidden="true" />
    },
  })),
)

interface ProviderIconProps {
  dialect: Dialect
  className?: string
}

/** Brand mark for a provider's dialect - `openai_compat` covers arbitrary
 * custom endpoints with no fixed brand, so it falls back to a generic icon. */
export function ProviderIcon({ dialect, className }: ProviderIconProps) {
  if (!BRAND_DIALECTS.has(dialect)) {
    return <CableIcon className={cn('size-4', className)} aria-hidden="true" />
  }
  return (
    <Suspense fallback={<CableIcon className={cn('size-4', className)} aria-hidden="true" />}>
      <BrandIcon dialect={dialect} className={className} />
    </Suspense>
  )
}
