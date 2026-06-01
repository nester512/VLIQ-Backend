import { useEffect } from "react"
import { PageShell } from "./components/layout/PageShell"
import { AuthGate } from "./features/auth/AuthGate"
import { AppRouter } from "./router/AppRouter"
import { ErrorBoundary } from "./components/atoms/ErrorBoundary"

function App() {
  // Hide the inline splash from index.html the moment the first React commit
  // lands. useEffect fires after paint, so the splash dissolves exactly when
  // the real UI is visible underneath — no fixed delays, no overlay-after-mount.
  useEffect(() => {
    const splash = document.getElementById('vliq-splash')
    if (!splash) return
    splash.classList.add('hidden')
    const t = window.setTimeout(() => splash.remove(), 260)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <ErrorBoundary>
      <PageShell>
        <AuthGate>
          <AppRouter />
        </AuthGate>
      </PageShell>
    </ErrorBoundary>
  )
}

export default App
