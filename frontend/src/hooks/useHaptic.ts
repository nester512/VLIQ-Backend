import {
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  hapticFeedbackSelectionChanged,
  isHapticFeedbackSupported,
} from '@telegram-apps/sdk-react'

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type NotificationStyle = 'error' | 'success' | 'warning'

/**
 * Returns haptic feedback helpers, safe to call outside TMA context.
 *
 * @example
 * const { impact, notification } = useHaptic()
 * impact('medium')          // on approve swipe
 * notification('error')     // on reject swipe
 */
export function useHaptic() {
  const supported = (() => {
    try {
      return isHapticFeedbackSupported()
    } catch {
      return false
    }
  })()

  const impact = (style: ImpactStyle = 'medium') => {
    if (!supported) return
    try {
      hapticFeedbackImpactOccurred(style)
    } catch {
      // ignore
    }
  }

  const notification = (type: NotificationStyle) => {
    if (!supported) return
    try {
      hapticFeedbackNotificationOccurred(type)
    } catch {
      // ignore
    }
  }

  const selectionChange = () => {
    if (!supported) return
    try {
      hapticFeedbackSelectionChanged()
    } catch {
      // ignore
    }
  }

  return { impact, notification, selectionChange, supported }
}
