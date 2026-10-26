import { useEffect, useState } from 'react'
import type { ThemePreference } from '@shared/types'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function resolveDark(preference: ThemePreference | undefined): boolean {
  return preference === 'dark' || (preference !== 'light' && media.matches)
}

/** Tracks the `dark` class App puts on <html>, so components follow theme changes. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function onSystemThemeChange(listener: () => void): () => void {
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
