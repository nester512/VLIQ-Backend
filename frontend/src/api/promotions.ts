import { api } from './client'
import type { Promotion } from '../types/models'

interface BackendPromotion {
  id: number
  brand_id: number
  name: string
  tag: string | null
  description: string | null
  starts_at: string
  ends_at: string
  status: 'draft' | 'active' | 'paused' | 'finished'
  priority: number
}

// Gradient palette cycled by priority bucket so each card gets a distinct
// look without polluting the backend schema with a UI-only field.
const GRADIENTS = [
  'linear-gradient(135deg, #6C4CF0, #9B6BFF)',
  'linear-gradient(135deg, #16B981, #0BA37A)',
  'linear-gradient(135deg, #F39A12, #E07B0A)',
  'linear-gradient(135deg, #2F8FED, #1A7BD4)',
] as const

function mapPromotion(p: BackendPromotion, idx: number): Promotion {
  return {
    id: String(p.id),
    tag: p.tag ?? '',
    title: p.name,
    description: p.description ?? '',
    gradient: GRADIENTS[idx % GRADIENTS.length] ?? GRADIENTS[0],
    active_until: p.ends_at,
  }
}

export const listPromotions = () =>
  api
    .get<BackendPromotion[]>('/promotions')
    .then((r) => r.data.map(mapPromotion))
