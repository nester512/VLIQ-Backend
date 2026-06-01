import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { init } from '@telegram-apps/sdk-react'
import './index.css'
import App from './App.tsx'

// Initialize TMA SDK (safe to call outside Telegram context — no-ops gracefully)
try {
  init()
} catch {
  // Running outside Telegram — SDK init skipped
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

// Notify Telegram that the Mini App is ready to be shown.
// Safe to call even outside Telegram — SDK no-ops if window.Telegram.WebApp is absent.
try {
  ;(window as Window & { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } })
    .Telegram?.WebApp?.ready?.()
  ;(window as Window & { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } })
    .Telegram?.WebApp?.expand?.()
} catch {
  // ignore — not in Telegram context
}
