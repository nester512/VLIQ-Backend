import axios from 'axios'
import { authStore } from "../store/authStore"

// Typed error from the unified backend envelope.
export interface ApiError {
  code: string
  userMessage: string
  debugId: string
  status: number
  /** Per-field localized validation messages (422 VALIDATION_ERROR). */
  fieldErrors?: Record<string, string>
}

// Localized fallbacks keyed by HTTP status / transport condition. We pick the
// message by `code`/status, NEVER by matching backend error text — so a legacy
// `{detail: "Not your receipt"}` or an English/HTML proxy page never reaches
// the user. Backend `user_message` (the new envelope) always wins over these.
const MSG = {
  network: 'Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.',
  timeout: 'Сервер не ответил вовремя. Попробуйте ещё раз.',
  unauthorized: 'Сессия истекла. Откройте приложение заново из Telegram.',
  forbidden: 'У вас нет доступа к этому действию.',
  payloadTooLarge: 'Файл слишком большой. Максимальный размер — 10 МБ.',
  unsupportedMedia: 'Поддерживаются изображения JPG, PNG, WebP и документы PDF.',
  tooManyRequests: 'Слишком много попыток. Подождите немного и попробуйте снова.',
  serverError: 'Что-то пошло не так. Попробуйте ещё раз.',
  generic: 'Что-то пошло не так. Попробуйте ещё раз.',
} as const

/** Map a non-envelope HTTP status to a clean localized fallback message. */
function fallbackForStatus(status: number, debugId: string): string {
  if (status === 401) return MSG.unauthorized
  if (status === 403) return MSG.forbidden
  if (status === 413) return MSG.payloadTooLarge
  if (status === 415) return MSG.unsupportedMedia
  if (status === 429) return MSG.tooManyRequests
  if (status >= 500) {
    // Never expose a traceback; append the support code when the backend
    // managed to attach one even on an unexpected error.
    return debugId ? `${MSG.serverError} Код ошибки для поддержки: ${debugId}` : MSG.serverError
  }
  return MSG.generic
}

/**
 * Extract a typed, ALWAYS-localized ApiError from an unknown thrown value.
 *
 * Priority:
 *   1. New envelope (`user_message` present) → use it verbatim; expose
 *      `field_errors` (422) as `fieldErrors`.
 *   2. No response / network error → offline message.
 *   3. Timeout → timeout message.
 *   4. Known HTTP status (401/403/413/415/429/5xx) → localized fallback;
 *      5xx appends the `debug_id` support code when present.
 *   5. Anything else (legacy `{detail}`, English/HTML body, non-Axios) →
 *      generic localized fallback.
 *
 * The returned `userMessage` is NEVER raw `detail`, `Error.message`,
 * `[object Object]`, an HTML proxy page, or English text.
 */
export function extractApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined
    const status = error.response?.status ?? 0
    const debugId = typeof data?.['debug_id'] === 'string' ? (data['debug_id'] as string) : ''

    // 1. New envelope: { code, user_message, debug_id, field_errors? }
    if (data && typeof data['user_message'] === 'string') {
      const rawFieldErrors = data['field_errors']
      let fieldErrors: Record<string, string> | undefined
      if (rawFieldErrors && typeof rawFieldErrors === 'object' && !Array.isArray(rawFieldErrors)) {
        const collected: Record<string, string> = {}
        for (const [field, message] of Object.entries(rawFieldErrors as Record<string, unknown>)) {
          if (typeof message === 'string') collected[field] = message
        }
        if (Object.keys(collected).length > 0) fieldErrors = collected
      }
      return {
        code: typeof data['code'] === 'string' ? (data['code'] as string) : 'UNKNOWN',
        userMessage: data['user_message'] as string,
        debugId,
        status,
        ...(fieldErrors ? { fieldErrors } : {}),
      }
    }

    // 2. Timeout — checked before the generic no-response branch because a
    //    timed-out request ALSO has no response (axios sets ECONNABORTED).
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return { code: 'TIMEOUT', userMessage: MSG.timeout, debugId: '', status }
    }

    // 3. No response: network failure / CORS / DNS. Axios sets code ERR_NETWORK.
    if (!error.response || error.code === 'ERR_NETWORK') {
      return { code: 'NETWORK_ERROR', userMessage: MSG.network, debugId: '', status: 0 }
    }

    // DEV aid: a non-envelope error response means the backend skipped AppError.
    // We still NEVER show its raw body — only warn so it gets fixed server-side.
    if (import.meta.env.DEV && data?.['detail'] !== undefined) {
      console.warn(
        '[ApiError] Non-envelope error response — update backend to use AppError.',
        { status, detail: data['detail'], url: error.config?.url },
      )
    }

    // 4./5. Known status fallback (covers 5xx debug_id) or generic.
    return {
      code: typeof data?.['code'] === 'string' ? (data['code'] as string) : 'UNKNOWN',
      userMessage: fallbackForStatus(status, debugId),
      debugId,
      status,
    }
  }

  // Non-Axios / unknown thrown value — never surface its `.message`.
  return {
    code: 'UNKNOWN',
    userMessage: MSG.generic,
    debugId: '',
    status: 0,
  }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    // Bypass the ngrok-free browser interstitial on XHR/fetch so API calls
    // return JSON (not the warning HTML) when the app is tunnelled via ngrok.
    'ngrok-skip-browser-warning': 'true',
  },
})

api.interceptors.request.use((config) => {
  const token = authStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401
    ) {
      authStore.getState().logout()
    }
    return Promise.reject(error)
  },
)
