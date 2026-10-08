import { useNavigate, useSearchParams } from 'react-router-dom'
import { SearchBar } from '@/components/molecules/SearchBar'
import { FilterPills } from '@/components/molecules/FilterPills'
import { Avatar } from '@/components/atoms/Avatar'
import { Pill } from '@/components/atoms/Pill'
import { RowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useSellersInfinite } from '@/features/admin/hooks/useSellersList'
import { LoadMore } from '@/features/admin/components/LoadMore'
import { RiskPill } from '@/features/admin/components/SellerStats'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getInitials, getFullName } from '@/utils/initials'
import { fmtInt, plural } from '@/utils/formatMoney'
import type { AdminSellerRow, AdminSellersFilters, SellerRiskLevel } from '@/api/admin'

type StatusFilter = '' | 'active' | 'pending' | 'blocked'
type RiskFilter = '' | SellerRiskLevel

const STATUS_PILLS: Array<{ value: StatusFilter; label: string }> = [
  { value: '',        label: 'Все' },
  { value: 'active',  label: 'Активные' },
  { value: 'pending', label: 'Ожидают' },
  { value: 'blocked', label: 'Заблокированные' },
]

const RISK_PILLS: Array<{ value: RiskFilter; label: string }> = [
  { value: '',       label: 'Любой риск' },
  { value: 'low',    label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high',   label: 'Высокий' },
]

const SORT_OPTIONS: Array<{ value: NonNullable<AdminSellersFilters['sort']>; label: string }> = [
  { value: 'created_at:desc',      label: 'Сначала новые' },
  { value: 'last_receipt_at:desc', label: 'По последней активности' },
  { value: 'receipts_total:desc',  label: 'По популярности (всего чеков)' },
  { value: 'receipts_30d:desc',    label: 'По частоте (чеков за 30 дней)' },
  { value: 'risk_score:desc',      label: 'По риску' },
]
const DEFAULT_SORT = SORT_OPTIONS[0]!.value

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback
}

interface SellerRowProps {
  seller: AdminSellerRow
  onClick: () => void
}

export function SellerRow({ seller, onClick }: SellerRowProps) {
  const fullName = getFullName(seller, seller.telegram_id ?? seller.id)
  const initials = getInitials(seller)
  const place = [seller.store_name, seller.city].filter(Boolean).join(' · ') || '—'
  const stats = seller.stats
  const activity = stats
    ? `${fmtInt(stats.receipts_total)} ${plural(stats.receipts_total, ['чек', 'чека', 'чеков'])} · ${fmtInt(stats.receipts_30d)} за 30 дн.`
    : null

  let pillKind: 'ok' | 'wn' | 'dg' = 'ok'
  let pillLabel = 'Активен'
  if (seller.status === 'pending') {
    pillKind = 'wn'
    pillLabel = 'Ожидает'
  } else if (seller.status === 'blocked') {
    pillKind = 'dg'
    pillLabel = 'Блок'
  }

  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <Avatar initials={initials} size={40} className="rounded-[13px] flex-none" />
      <div className="vliq-row-tx">
        <b>{fullName}</b>
        <span>{place}</span>
        {activity && <span>{activity}</span>}
      </div>
      <div style={{ flex: 'none', textAlign: 'right', marginRight: 4, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <Pill kind={pillKind}>{pillLabel}</Pill>
        {stats && stats.risk_level !== 'low' && <RiskPill stats={stats} />}
        {stats && stats.receipts_on_review > 0 && <Pill kind="brand">{stats.receipts_on_review} на проверке</Pill>}
      </div>
    </button>
  )
}

function SellersContent() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // Filters live in the URL so «назад» from a seller page restores the same list.
  const search = params.get('q') ?? ''
  const status = pick<StatusFilter>(params.get('status'), ['', 'active', 'pending', 'blocked'], '')
  const risk = pick<RiskFilter>(params.get('risk'), ['', 'low', 'medium', 'high'], '')
  const sort = pick(params.get('sort'), SORT_OPTIONS.map((o) => o.value), DEFAULT_SORT)
  const onReview = params.get('review') === '1'

  function setParam(key: string, value: string, fallback = '') {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value === fallback) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }

  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useSellersInfinite({
    search: debouncedSearch || undefined,
    status: status || undefined,
    risk: risk || undefined,
    has_on_review: onReview ? true : undefined,
    sort,
  })

  const sellers = data?.pages.flatMap((p) => p.items) ?? []
  const total = data?.pages[0]?.total ?? 0
  const isFiltered = Boolean(debouncedSearch || status || risk || onReview)

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SearchBar
        placeholder="Имя, телефон, точка, город или Telegram ID"
        value={search}
        onChange={(v) => setParam('q', v)}
      />

      <FilterPills options={STATUS_PILLS} value={status} onChange={(v) => setParam('status', v)} />
      <FilterPills options={RISK_PILLS} value={risk} onChange={(v) => setParam('risk', v)} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => setParam('sort', e.target.value, DEFAULT_SORT)}
          style={{
            flex: '1 1 200px',
            minWidth: 0,
            padding: '10px 12px',
            borderRadius: 12,
            border: 0,
            background: 'var(--vliq-card)',
            boxShadow: 'var(--vliq-shadow-sm)',
            color: 'var(--vliq-text)',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <FilterPills
          options={[{ value: '1', label: 'Есть чеки на проверке' }]}
          value={onReview ? '1' : ''}
          onChange={() => setParam('review', onReview ? '' : '1')}
        />
      </div>

      {!isLoading && !isError && (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--vliq-hint)' }} data-testid="sellers-total">
          Найдено: {fmtInt(total)}{sellers.length < total ? ` · показано ${fmtInt(sellers.length)}` : ''}
        </div>
      )}

      {isLoading ? (
        <div className="vliq-list">
          <RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton />
        </div>
      ) : isError ? (
        <EmptyState icon="alert" tone="muted" title="Не удалось загрузить продавцов" description="Проверьте соединение и попробуйте ещё раз." />
      ) : sellers.length === 0 ? (
        <EmptyState
          icon="users"
          tone="brand"
          title={isFiltered ? 'Ничего не нашли' : 'Продавцов пока нет'}
          description={
            isFiltered
              ? 'Попробуйте другой запрос или сбросьте фильтры.'
              : 'Когда первые продавцы зарегистрируются — они появятся здесь.'
          }
        />
      ) : (
        <>
          <div className="vliq-list">
            {sellers.map((seller) => (
              <SellerRow
                key={seller.id}
                seller={seller}
                onClick={() => navigate(`/admin/sellers/${seller.telegram_id ?? seller.id}/receipts`)}
              />
            ))}
          </div>
          <LoadMore hasMore={Boolean(hasNextPage)} isLoading={isFetchingNextPage} onLoadMore={fetchNextPage} />
        </>
      )}
    </div>
  )
}

export function SellersPage() {
  return (
    <ErrorBoundary>
      <SellersContent />
    </ErrorBoundary>
  )
}
