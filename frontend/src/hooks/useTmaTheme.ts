import { useEffect } from 'react'
import { getTgWebApp, isTmaEnvironment } from '../utils/tma'

/**
 * Syncs Telegram theme (color scheme + themeParams) with the document.
 *
 * Two channels of sync:
 *   1. `.dark` class on <html> — so Tailwind `dark:` utilities flip.
 *   2. CSS custom properties on <html> — so any component reading
 *      `var(--vliq-bg)` / `var(--vliq-text)` / etc. follows the user's
 *      Telegram theme (custom palettes for branded clients, in-app switches,
 *      system theme changes, etc.).
 *
 * Outside Telegram we fall back to `prefers-color-scheme` and the static
 * palette baked into `index.css`.
 */

type TgThemeParams = {
  bg_color?: string
  secondary_bg_color?: string
  section_bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  accent_text_color?: string
  destructive_text_color?: string
  header_bg_color?: string
  section_separator_color?: string
}

interface TgWebAppLike {
  colorScheme?: 'light' | 'dark'
  themeParams?: TgThemeParams
  onEvent?: (event: string, handler: () => void) => void
  offEvent?: (event: string, handler: () => void) => void
}

const THEMED_VARS = [
  '--vliq-bg', '--vliq-card', '--vliq-card-2', '--vliq-field',
  '--vliq-text', '--vliq-hint', '--vliq-sep', '--vliq-nav',
] as const

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

function setVar(name: string, value: string | undefined) {
  if (!value) return
  document.documentElement.style.setProperty(name, value)
}

function clearThemeParams() {
  for (const name of THEMED_VARS) {
    document.documentElement.style.removeProperty(name)
  }
}

/**
 * Map Telegram's themeParams onto the VLIQ semantic palette.
 *
 * We don't blindly overwrite every var — branded Telegram clients can return
 * very saturated colours that would shred our hierarchy (hero gradients,
 * status pills, etc.). Only the *surface* layer follows Telegram so the app
 * feels native; brand and status colours stay constant.
 *
 * Crucially: if Telegram only ships `bg_color` (no `secondary_bg_color` /
 * `section_bg_color`), we mustn't collapse `--vliq-bg` and `--vliq-card`
 * onto the same value — that flattens every card silhouette. In that case
 * we keep the static `--vliq-card` baseline from index.css.
 */
function applyThemeParams(p: TgThemeParams | undefined) {
  if (!p) return

  // Always start from a clean slate so a previous theme's leftover keys
  // don't bleed into the new one.
  clearThemeParams()

  setVar('--vliq-text', p.text_color)
  setVar('--vliq-hint', p.hint_color)
  setVar('--vliq-sep',  p.section_separator_color)

  const hasSurfaceTriad =
    Boolean(p.bg_color) && Boolean(p.secondary_bg_color) && p.bg_color !== p.secondary_bg_color
  if (hasSurfaceTriad) {
    setVar('--vliq-bg',     p.secondary_bg_color)
    setVar('--vliq-card',   p.bg_color)
    setVar('--vliq-card-2', p.section_bg_color ?? p.bg_color)
    setVar('--vliq-field',  p.secondary_bg_color)
    setVar('--vliq-nav',    p.header_bg_color ?? p.bg_color)
  }
  // else: skip surface overrides — let index.css defaults provide hierarchy.
}

export function useTmaTheme(): void {
  useEffect(() => {
    if (!isTmaEnvironment()) {
      // Browser dev: follow system theme; leave CSS vars to index.css defaults.
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyDark(mq.matches)
      const handler = (e: MediaQueryListEvent) => applyDark(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }

    const wa = getTgWebApp() as unknown as TgWebAppLike | undefined
    if (!wa) return

    const sync = () => {
      applyDark(wa.colorScheme === 'dark')
      applyThemeParams(wa.themeParams)
    }
    sync()

    wa.onEvent?.('themeChanged', sync)
    return () => {
      wa.offEvent?.('themeChanged', sync)
      clearThemeParams()
    }
  }, [])
}
