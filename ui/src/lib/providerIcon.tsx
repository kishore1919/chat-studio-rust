import type { ComponentType } from 'react'
import { CableIcon } from 'lucide-react'
import { Anthropic, Gemini, Ollama, OpenAI } from '@lobehub/icons'
import type { Dialect } from './types'
import { cn } from './utils'

const ICON_BY_DIALECT: Partial<Record<Dialect, ComponentType<{ className?: string }>>> = {
  openai: OpenAI,
  anthropic: Anthropic,
  gemini: Gemini,
  ollama: Ollama,
}

interface ProviderIconProps {
  dialect: Dialect
  className?: string
}

/** Brand mark for a provider's dialect - `openai_compat` covers arbitrary
 * custom endpoints with no fixed brand, so it falls back to a generic icon. */
export function ProviderIcon({ dialect, className }: ProviderIconProps) {
  const Icon = ICON_BY_DIALECT[dialect]
  if (!Icon) return <CableIcon className={cn('size-4', className)} aria-hidden="true" />
  return <Icon className={cn('size-4', className)} aria-hidden="true" />
}
