import { api } from './client'

// City dictionary entry — the registration form only needs id + name.
export interface City {
  id: number
  name: string
}

interface BackendCity {
  id: number
  name: string
  region?: string | null
  is_active?: boolean
  sort_order?: number
}

/** GET /cities — the allowed-cities dictionary (source of truth for registration). */
export const getCities = (): Promise<City[]> =>
  api.get<BackendCity[]>('/cities').then((r) => r.data.map((c) => ({ id: c.id, name: c.name })))
