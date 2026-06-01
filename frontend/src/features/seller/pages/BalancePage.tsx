import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HeroBalance } from '@/components/molecules/HeroBalance'
import { MetricCard } from '@/components/molecules/MetricCard'
import { AccrualRow } from '@/components/molecules/AccrualRow'
import { FilterPills } from '@/components/molecules/FilterPills'
import { EmptyState } from '@/components/molecules/EmptyState'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { HeroSkeleton, MetricCardSkeleton, ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { useBalance } from '../hooks/useBalance'
import { useReceipts } from '../hooks/useReceipts'
import { listMyBonusTransactions } from '@/api/bonusTransactions'
import { fmtMoney, fmtInt } from '@/utils/formatMoney'
import { isApprovedStatus, isPendingStatus } from '@/utils/receiptStatus'

type TxFilter = 'all' | 'bonus' | 'payout'

const FILTERS: Array<{ value: TxFilter; label: string }> = [
  { value: 'all',    label: 'Все' },
  { value: 'bonus',  label: 'Начисления' },
  { value: 'payout', label: 'Выплаты' },
]

function BalanceContent() {
  const navigate = useNavigate()
  const { data: balance, isLoading: balanceLoading } = useBalance()
  const { data: receipts } = useReceipts({ limit: 200 })
  const [filter, setFilter] = useState<TxFilter>('all')

  // Approved-of-total receipt ratio is derived client-side because the backend
  // balance endpoint doesn't return it.
  const receiptsTotal    = receipts?.length ?? 0
  const receiptsApproved = receipts?.filter((r) => isApprovedStatus(r.status)).length ?? 0
  const receiptsPending  = receipts?.filter((r) => isPendingStatus(r.status)).length ?? 0

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['bonus-transactions', 'me'],
    queryFn: () => listMyBonusTransactions(100),
    staleTime: 30_000,
    retry: false,
  })

  const visibleTx = transactions?.filter((t) => (filter === 'all' ? true : t.type === filter))

  return (
    <div>
      {/* Hero (inside .pad — override default 16px-side margin) */}
      {balanceLoading ? (
        <HeroSkeleton />
      ) : (
        <HeroBalance
          available={balance?.available ?? 0}
          onWithdraw={() => navigate('/seller/payout')}
          actionLabel="Запросить выплату"
          margin="16px 16px 14px"
        />
      )}

      {/* Metrics grid */}
      <div
        className="vliq-pad"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
      >
        {balanceLoading ? (
          <>
            <MetricCardSkeleton /><MetricCardSkeleton />
            <MetricCardSkeleton /><MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              title="На проверке"
              value={fmtMoney(balance?.pending)}
              delta={receiptsPending > 0 ? `${fmtInt(receiptsPending)} ожидают` : 'нет в очереди'}
              deltaColor={receiptsPending > 0 ? 'wn' : 'hint'}
            />
            <MetricCard
              title="Всего начислено"
              value={fmtMoney(balance?.total_earned)}
              delta="за всё время"
              deltaColor="ok"
            />
            <MetricCard
              title="Всего выплачено"
              value={fmtMoney(balance?.total_paid)}
              delta={balance && balance.total_paid > 0 ? 'на реквизиты' : 'пока ничего'}
              deltaColor={balance && balance.total_paid > 0 ? 'ok' : 'hint'}
            />
            <MetricCard
              title="Чеков одобрено"
              value={receipts === undefined ? '—' : fmtInt(receiptsApproved)}
              delta={receipts === undefined ? undefined : `из ${fmtInt(receiptsTotal)}`}
              deltaColor="ok"
            />
          </>
        )}
      </div>

      {/* Accrual history */}
      <div className="vliq-pad">
        <div className="vliq-sec-t">
          <b>История начислений</b>
        </div>
        <div style={{ marginBottom: 12 }}>
          <FilterPills
            options={FILTERS}
            value={filter}
            onChange={(v) => setFilter(v as TxFilter)}
          />
        </div>
        {txLoading ? (
          <div className="vliq-list">
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
          </div>
        ) : visibleTx && visibleTx.length > 0 ? (
          <div className="vliq-list">
            {visibleTx.map((tx) => (
              <AccrualRow key={tx.id} transaction={tx} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="wallet"
            tone="brand"
            title={filter === 'all' ? 'Начислений пока нет' : 'Пусто под этот фильтр'}
            description={
              filter === 'all'
                ? 'Загрузите чек — за одобренный мы начислим бонус.'
                : 'Сбросьте фильтр или дождитесь новых операций.'
            }
          />
        )}
      </div>
    </div>
  )
}

export function BalancePage() {
  return (
    <ErrorBoundary>
      <BalanceContent />
    </ErrorBoundary>
  )
}
