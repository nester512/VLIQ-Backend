import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * ErrorBoundary — catches render errors and shows a friendly fallback.
 * Wrap pages or major sections with this component.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Component stack can include serialized props/state (potentially tokens
    // or payout details). Only log in DEV; route to Sentry in prod (TODO).
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack)
    }
  }

  reset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60dvh',
            padding: '48px 24px',
            textAlign: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--vliq-dg-bg)',
              color: 'var(--vliq-dg-ink)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 28,
            }}
          >
            ⚠
          </div>
          <p
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--vliq-text)',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Что-то пошло не так — обнови экран
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--vliq-brand)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              padding: '13px 28px',
              borderRadius: 15,
              border: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
