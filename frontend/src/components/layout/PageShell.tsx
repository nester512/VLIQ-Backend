import type { ReactNode } from 'react'
import { ToastContainer } from '../atoms/Toast'
import { BottomSheet } from '../organisms/BottomSheet'
import { DevPanel } from '../organisms/DevPanel'
import { useTmaTheme } from '../../hooks/useTmaTheme'
import { useTmaViewport } from '../../hooks/useTmaViewport'

interface PageShellProps {
  children: ReactNode
}

/**
 * PageShell — root application shell.
 *
 * Sets up:
 *   - Telegram theme sync (.dark class + themeParams CSS vars)
 *   - --tma-height CSS variable (Telegram viewport)
 *   - Global ToastContainer + BottomSheet
 *   - DevPanel (only rendered in DEV builds)
 *
 * Responsive sizing (all governed by responsive.css via CSS classes):
 *   • < 768 px  — full width, phone/TMA mode.
 *   • 768–1279 px — max-width 720 px, centered (tablet).
 *   • ≥ 1280 px  — max-width 1200 px, full adaptive layout (desktop/wide).
 */
export function PageShell({ children }: PageShellProps) {
  useTmaTheme()
  useTmaViewport()

  return (
    <div
      className="vliq-page-outer"
      style={{
        height: 'var(--tma-height, 100dvh)',
        position: 'relative',
        background: 'var(--vliq-bg)',
        overflow: 'hidden',
      }}
    >
      <div
        className="vliq-page-inner vliq-themed"
        style={{
          position: 'relative',
          height: '100%',
          marginInline: 'auto',
          background: 'var(--vliq-bg)',
          color: 'var(--vliq-text)',
          overflow: 'hidden',
        }}
      >
        {children}
        <BottomSheet />
        <ToastContainer />
        <DevPanel />
      </div>
    </div>
  )
}
