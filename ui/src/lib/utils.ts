import { useCallback, useEffect, useRef } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** `` `${prefix}-${Date.now()}` `` collides when multiple items are created in
 * the same millisecond (e.g. programmatic imports); `crypto.randomUUID` does not. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/** Shared across every per-message timestamp render - constructing a fresh
 * `Intl.DateTimeFormat` per row is measurable once a conversation grows past
 * ~100 messages. */
export const TIME_FMT = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })

/** Trailing-edge debounce for an IPC/network call driven by a rapid-fire UI
 * control (a slider or color-picker drag). The visual change should still
 * apply on every tick - only the expensive call this wraps gets delayed and
 * collapsed to the last value once ticks stop arriving. */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return useCallback(
    (...args: Args) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => callbackRef.current(...args), delayMs)
    },
    [delayMs],
  )
}
