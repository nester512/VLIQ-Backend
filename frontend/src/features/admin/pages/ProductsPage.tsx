import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SearchBar } from '@/components/molecules/SearchBar'
import { FilterPills } from '@/components/molecules/FilterPills'
import { Field } from '@/components/atoms/Field'
import { Btn } from '@/components/atoms/Btn'
import { Pill } from '@/components/atoms/Pill'
import { Icon } from '@/components/atoms/Icon'
import { RowSkeleton } from '@/components/atoms/Skeleton'
import { EmptyState } from '@/components/molecules/EmptyState'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { useUiStore } from '@/store/uiStore'
import { extractApiError } from '@/api/client'
import { listSkus, createSku, deleteSku, type Sku } from '@/api/sku'
import { fmtMoney } from '@/utils/formatMoney'

// Single brand for now (matches the seller default and the single-brand spec).
const BRAND_ID = 1

interface ProductFormState {
  name: string
  category: string
  code: string
  bonus: string
}
const EMPTY_FORM: ProductFormState = { name: '', category: '', code: '', bonus: '' }

function ProductsContent() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const { data: skus, isLoading } = useQuery({
    queryKey: ['admin', 'skus', BRAND_ID],
    queryFn: () => listSkus({ brand_id: BRAND_ID }),
    staleTime: 30_000,
  })

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of skus ?? []) if (s.category) set.add(s.category)
    return Array.from(set).sort()
  }, [skus])

  const categoryPills = useMemo(
    () => [{ value: 'all', label: 'Все' }, ...categories.map((c) => ({ value: c, label: c }))],
    [categories],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (skus ?? []).filter((s) => {
      if (category !== 'all' && s.category !== category) return false
      if (q && !(s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))) return false
      return true
    })
  }, [skus, search, category])

  const createMut = useMutation({
    mutationFn: () =>
      createSku({
        brand_id: BRAND_ID,
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        default_bonus: Math.max(0, Math.round(Number(form.bonus) || 0)),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'skus', BRAND_ID] })
      pushToast('Товар добавлен', 'ok')
      setForm(EMPTY_FORM)
      setShowForm(false)
    },
    onError: (err: unknown) => pushToast(extractApiError(err).userMessage, 'dg'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteSku(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'skus', BRAND_ID] })
      pushToast('Товар удалён', 'ok')
      setConfirmId(null)
    },
    onError: (err: unknown) => pushToast(extractApiError(err).userMessage, 'dg'),
  })

  const formValid = form.name.trim() !== '' && form.code.trim() !== ''
  const isEmpty = !isLoading && visible.length === 0
  const isFiltered = Boolean(search.trim() || category !== 'all')

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Add product */}
      {showForm ? (
        <div className="vliq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <b style={{ fontSize: 15, fontWeight: 700 }}>Новый товар</b>
          <Field label="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Жидкость VLIQ Манго 30мл" />
          <Field label="Категория" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Жидкости" />
          <Field label="Код маркировки" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MK-0001" />
          <Field label="Сумма выплат, ₽" inputMode="numeric" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value.replace(/[^\d]/g, '') })} placeholder="250" />
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
              style={{ flex: 1, background: 'var(--vliq-field)', border: 0, borderRadius: 12, padding: '12px', fontWeight: 600, color: 'var(--vliq-text)', cursor: 'pointer' }}>
              Отмена
            </button>
            <div style={{ flex: 2 }}>
              <Btn loading={createMut.isPending} disabled={!formValid || createMut.isPending} onClick={() => createMut.mutate()}>
                Добавить товар
              </Btn>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowForm(true)} className="vliq-press"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--vliq-brand)', color: '#fff', border: 0, borderRadius: 14, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          <Icon name="edit" size={18} /> Добавить товар
        </button>
      )}

      <SearchBar placeholder="Поиск по названию или коду" value={search} onChange={setSearch} />
      {categories.length > 0 && (
        <FilterPills options={categoryPills} value={category} onChange={setCategory} />
      )}

      {isLoading ? (
        <div className="vliq-list"><RowSkeleton /><RowSkeleton /><RowSkeleton /></div>
      ) : isEmpty ? (
        <EmptyState icon="list" tone="brand"
          title={isFiltered ? 'Ничего не нашли' : 'Товаров пока нет'}
          description={isFiltered ? 'Измените запрос или сбросьте фильтр.' : 'Добавьте первый товар кнопкой выше.'} />
      ) : (
        <div className="vliq-list">
          {visible.map((s: Sku) => (
            <div key={s.id} className="vliq-row is-static" style={{ alignItems: 'center' }}>
              <div className="vliq-row-tx" style={{ minWidth: 0 }}>
                <b style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</b>
                <span>{[s.category, s.code].filter(Boolean).join(' · ') || '—'}</span>
              </div>
              <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, marginRight: 2 }}>
                <Pill kind="ok">{fmtMoney(s.default_bonus)}</Pill>
                {confirmId === s.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => deleteMut.mutate(s.id)} disabled={deleteMut.isPending}
                      style={{ background: 'var(--vliq-dg-bg)', color: 'var(--vliq-dg-ink)', border: 0, borderRadius: 9, padding: '6px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Удалить
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)}
                      style={{ background: 'var(--vliq-field)', color: 'var(--vliq-hint)', border: 0, borderRadius: 9, padding: '6px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button type="button" aria-label="Удалить товар" onClick={() => setConfirmId(s.id)}
                    style={{ width: 30, height: 30, borderRadius: 9, border: 0, display: 'grid', placeItems: 'center', background: 'var(--vliq-field)', color: 'var(--vliq-hint)', cursor: 'pointer' }}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProductsPage() {
  return (
    <ErrorBoundary>
      <ProductsContent />
    </ErrorBoundary>
  )
}
