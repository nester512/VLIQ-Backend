import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import { extractApiError } from './client'

// Build an AxiosError that `axios.isAxiosError` recognises. We set `code` and a
// minimal `response` so extractApiError's branches are exercised exactly as in
// production (it reads error.code, error.response.status, error.response.data).
function axiosErr(opts: {
  status?: number
  data?: unknown
  code?: string
  hasResponse?: boolean
}): AxiosError {
  const config = { headers: new AxiosHeaders(), url: '/x' } as InternalAxiosRequestConfig
  const response =
    opts.hasResponse === false
      ? undefined
      : ({
          status: opts.status ?? 0,
          statusText: '',
          data: opts.data,
          headers: {},
          config,
        } as AxiosResponse)
  return new AxiosError('Request failed', opts.code, config, {}, response)
}

describe('extractApiError', () => {
  it('uses the new envelope user_message verbatim', () => {
    const e = extractApiError(
      axiosErr({
        status: 409,
        data: {
          code: 'RECEIPT_INVALID_STATE_TRANSITION',
          user_message: 'Этот чек уже обработан.',
          debug_id: 'abc-123',
        },
      }),
    )
    expect(e.code).toBe('RECEIPT_INVALID_STATE_TRANSITION')
    expect(e.userMessage).toBe('Этот чек уже обработан.')
    expect(e.debugId).toBe('abc-123')
    expect(e.status).toBe(409)
  })

  it('exposes 422 field_errors but the page never shows raw English', () => {
    const e = extractApiError(
      axiosErr({
        status: 422,
        data: {
          code: 'VALIDATION_ERROR',
          user_message: 'Проверьте введённые данные.',
          debug_id: 'd-1',
          field_errors: { phone: 'Неверный формат', name: 'Обязательное поле' },
        },
      }),
    )
    expect(e.userMessage).toBe('Проверьте введённые данные.')
    expect(e.fieldErrors).toEqual({ phone: 'Неверный формат', name: 'Обязательное поле' })
    // The localized user_message must not be English.
    expect(e.userMessage).not.toMatch(/[a-z]/i)
  })

  it('NEVER returns the raw legacy {detail} English text', () => {
    const e = extractApiError(
      axiosErr({ status: 403, data: { detail: 'Not your receipt' } }),
    )
    expect(e.userMessage).not.toContain('Not your receipt')
    expect(e.userMessage).not.toMatch(/[a-z]/i) // no English at all
    expect(e.userMessage).toBe('У вас нет доступа к этому действию.')
  })

  it('maps offline / no response to a network message', () => {
    const e = extractApiError(axiosErr({ hasResponse: false, code: 'ERR_NETWORK' }))
    expect(e.code).toBe('NETWORK_ERROR')
    expect(e.userMessage).toBe('Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.')
    expect(e.status).toBe(0)
  })

  it('maps ERR_NETWORK even when a response object is present', () => {
    const e = extractApiError(axiosErr({ status: 0, code: 'ERR_NETWORK', data: undefined }))
    expect(e.userMessage).toBe('Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.')
  })

  it('maps a timeout (ECONNABORTED) to the timeout message', () => {
    const e = extractApiError(axiosErr({ hasResponse: false, code: 'ECONNABORTED' }))
    expect(e.userMessage).toBe('Сервер не ответил вовремя. Попробуйте ещё раз.')
  })

  it('maps a timeout (ETIMEDOUT) to the timeout message', () => {
    const e = extractApiError(axiosErr({ status: 0, code: 'ETIMEDOUT', data: {} }))
    expect(e.userMessage).toBe('Сервер не ответил вовремя. Попробуйте ещё раз.')
  })

  it('maps 401 to a session-expired message', () => {
    const e = extractApiError(axiosErr({ status: 401, data: {} }))
    expect(e.status).toBe(401)
    expect(e.userMessage).toBe('Сессия истекла. Откройте приложение заново из Telegram.')
  })

  it('maps 403 to a no-access message', () => {
    const e = extractApiError(axiosErr({ status: 403, data: {} }))
    expect(e.userMessage).toBe('У вас нет доступа к этому действию.')
  })

  it('maps 409 (no envelope) to a generic fallback, surfacing the status', () => {
    const e = extractApiError(axiosErr({ status: 409, data: {} }))
    expect(e.status).toBe(409)
    expect(e.userMessage).toBe('Что-то пошло не так. Попробуйте ещё раз.')
    expect(e.userMessage).not.toMatch(/[a-z]/i)
  })

  it('maps 413 to a file-too-large message', () => {
    const e = extractApiError(axiosErr({ status: 413, data: {} }))
    expect(e.userMessage).toBe('Файл слишком большой. Максимальный размер — 10 МБ.')
  })

  it('maps 415 to an unsupported-media message', () => {
    const e = extractApiError(axiosErr({ status: 415, data: {} }))
    expect(e.userMessage).toBe('Поддерживаются изображения JPG, PNG, WebP и документы PDF.')
  })

  it('maps 429 to a rate-limit message', () => {
    const e = extractApiError(axiosErr({ status: 429, data: {} }))
    expect(e.userMessage).toBe('Слишком много попыток. Подождите немного и попробуйте снова.')
  })

  it('appends the debug_id to a 500 when present', () => {
    const e = extractApiError(axiosErr({ status: 500, data: { debug_id: 'xyz-789' } }))
    expect(e.userMessage).toBe('Что-то пошло не так. Попробуйте ещё раз. Код ошибки для поддержки: xyz-789')
    expect(e.debugId).toBe('xyz-789')
  })

  it('omits the support code on a 500 without a debug_id (and never leaks a traceback)', () => {
    const e = extractApiError(
      axiosErr({ status: 500, data: { detail: 'Traceback (most recent call last): ...' } }),
    )
    expect(e.userMessage).toBe('Что-то пошло не так. Попробуйте ещё раз.')
    expect(e.userMessage).not.toContain('Traceback')
    expect(e.userMessage).not.toContain('Код ошибки')
  })

  it('never echoes an HTML proxy page body', () => {
    const e = extractApiError(
      axiosErr({ status: 502, data: '<html><body>Bad Gateway</body></html>' }),
    )
    expect(e.userMessage).not.toContain('<html>')
    expect(e.userMessage).not.toContain('Bad Gateway')
    expect(e.userMessage).toBe('Что-то пошло не так. Попробуйте ещё раз.')
  })

  it('handles an unknown non-Axios value without leaking its message', () => {
    const e = extractApiError(new Error('boom: internal jwt decode failed'))
    expect(e.code).toBe('UNKNOWN')
    expect(e.status).toBe(0)
    expect(e.userMessage).toBe('Что-то пошло не так. Попробуйте ещё раз.')
    expect(e.userMessage).not.toContain('boom')
    expect(e.userMessage).not.toContain('jwt')
  })

  it('never returns [object Object] for a non-string thrown value', () => {
    const e = extractApiError({ weird: true })
    expect(e.userMessage).not.toContain('[object Object]')
    expect(e.userMessage).toBe('Что-то пошло не так. Попробуйте ещё раз.')
  })
})
