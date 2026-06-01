import axios from 'axios'
import { authStore } from "../store/authStore"

// Typed error from the unified backend envelope.
export interface ApiError {
  code: string
  userMessage: string
  debugId: string
  status: number
}

/**
 * Extract a typed ApiError from an axios error.
 * Reads `user_message` (new envelope), falls back to `detail` (legacy), then
 * to the raw axios message so callers always get a human-readable string.
 */
export function extractApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined
    const status = error.response?.status ?? 0

    // New envelope: { code, user_message, debug_id }
    if (data && typeof data['user_message'] === 'string') {
      return {
        code: typeof data['code'] === 'string' ? data['code'] : 'UNKNOWN',
        userMessage: data['user_message'],
        debugId: typeof data['debug_id'] === 'string' ? data['debug_id'] : '',
        status,
      }
    }

    // Legacy FastAPI: { detail: string | object }
    const detail = data?.['detail']
    const legacyMessage =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
        ? 'Проверь введённые данные.'
        : 'Что-то пошло не так. Попробуй ещё раз.'

    if (import.meta.env.DEV && detail !== undefined) {
      console.warn(
        '[ApiError] Non-envelope error response — update backend to use AppError.',
        { status, detail, url: error.config?.url },
      )
    }

    return {
      code: 'UNKNOWN',
      userMessage: legacyMessage,
      debugId: '',
      status,
    }
  }

  return {
    code: 'UNKNOWN',
    userMessage: 'Что-то пошло не так. Попробуй ещё раз.',
    debugId: '',
    status: 0,
  }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
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
