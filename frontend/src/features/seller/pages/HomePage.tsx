import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HeroBalance } from '@/components/molecules/HeroBalance'
import { QuickActionCard } from '@/components/molecules/QuickActionCard'
import { ReceiptRow } from '@/components/molecules/ReceiptRow'
import { EmptyState } from '@/components/molecules/EmptyState'
import { Icon } from '@/components/atoms/Icon'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { HeroSkeleton, ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { useBalance } from '../hooks/useBalance'
import { useReceipts } from '../hooks/useReceipts'
import { fmtMoney } from '@/utils/formatMoney'
import { isApprovedStatus, isPendingStatus } from '@/utils/receiptStatus'

const FAQ_ITEMS = [
  {
    question: 'Как загрузить чек?',
    answer: 'Откройте «Загрузить чек», прикрепите до пяти фото или PDF и отправьте их на проверку.',
  },
  {
    question: 'Нужно ли сканировать QR-код?',
    answer: 'Нет. QR-код можно добавить для удобства, но он не обязателен.',
  },
  {
    question: 'Когда начислят бонус?',
    answer: 'После проверки чека администратором. Сумму бонуса для чека назначает администратор.',
  },
  {
    question: 'Когда можно запросить выплату?',
    answer: 'Когда доступно не менее 3 000 ₽. После запроса выплата производится в течение 7 рабочих дней.',
  },
] as const

function SellerFaq() {
  const location = useLocation()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (location.hash !== '#faq') return
    document.getElementById('faq')?.scrollIntoView?.({ block: 'start' })
  }, [location.hash])

  return (
    <section id="faq" className="vliq-pad" style={{ paddingBottom: 24 }}>
      <div className="vliq-sec-t">
        <b>Вопросы и ответы</b>
      </div>
      <div className="vliq-list">
        {FAQ_ITEMS.map((item, index) => {
          const isOpen = openIndex === index
          return (
            <div key={item.question}>
              <button
                type="button"
                className="vliq-row"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex((current) => current === index ? null : index)}
              >
                <div className="vliq-row-tx">
                  <b>{item.question}</b>
                </div>
                <span aria-hidden style={{ flex: 'none', color: 'var(--vliq-hint)', display: 'inline-flex', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease' }}>
                  <Icon name="chev" size={18} />
                </span>
              </button>
              {isOpen && (
                <p style={{ margin: '0', padding: '0 48px 14px 16px', fontSize: 13, fontWeight: 500, lineHeight: 1.45, color: 'var(--vliq-hint)' }}>
                  {item.answer}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function HomeContent() {
  const navigate = useNavigate()
  const { data: balance, isLoading: balanceLoading } = useBalance()
  const { data: receipts, isLoading: receiptsLoading } = useReceipts({ limit: 50 })

  const recentReceipts = receipts?.slice(0, 3) ?? []
  // S4: the home screen shows the approved vs not-yet-approved receipt counts.
  const approvedCount = receipts?.filter((r) => isApprovedStatus(r.status)).length ?? 0
  const pendingCount  = receipts?.filter((r) => isPendingStatus(r.status)).length ?? 0
  const totalLabel    = receipts === undefined
    ? '—'
    : `${approvedCount} одобрено · ${pendingCount} на проверке`

  const balanceSubtitle = balance ? `${fmtMoney(balance.total_earned)} всего` : '—'

  return (
    <div>
      <div className="vliq-home-grid">
        {/* Hero col (desktop: left column via CSS .vliq-home-grid on wrapper) */}
        <div className="vliq-home-hero-col">
          {balanceLoading ? (
            <HeroSkeleton />
          ) : (
            <HeroBalance
              available={balance?.available ?? 0}
              pending={balance?.pending}
              onWithdraw={() => navigate('/seller/payout')}
            />
          )}
        </div>

        {/* Quick actions col */}
        <div className="vliq-home-actions-col">
          <div
            className="vliq-pad vliq-home-actions"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <QuickActionCard
              icon={<Icon name="camera" size={22} />}
              title="Загрузить чек"
              subtitle="фото · PDF · QR"
              color="--vliq-brand"
              onClick={() => navigate('/seller/upload')}
            />
            <QuickActionCard
              icon={<Icon name="wallet" size={22} />}
              title="Мой баланс"
              subtitle={balanceSubtitle}
              color="--color-acc"
              onClick={() => navigate('/seller/balance')}
            />
            <QuickActionCard
              icon={<Icon name="clock" size={22} />}
              title="История"
              subtitle={totalLabel}
              color="--color-wn"
              onClick={() => navigate('/seller/history')}
            />
            <QuickActionCard
              icon={<Icon name="gift" size={22} />}
              title="Акции"
              subtitle="Скоро"
              color="--color-ok"
              onClick={() => navigate('/seller/promo')}
            />
          </div>
        </div>

        {/* Recent receipts col (desktop: right column) */}
        <div className="vliq-home-receipts-col vliq-pad">
          <div className="vliq-sec-t">
            <b>Последние чеки</b>
            <button type="button" onClick={() => navigate('/seller/history')}>Все</button>
          </div>
          {receiptsLoading ? (
            <div className="vliq-list">
              <ReceiptRowSkeleton />
              <ReceiptRowSkeleton />
              <ReceiptRowSkeleton />
            </div>
          ) : recentReceipts.length > 0 ? (
            <div className="vliq-list">
              {recentReceipts.map((r) => (
                <ReceiptRow key={r.id} receipt={r} onClick={() => navigate(`/seller/status/${r.id}`)} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="receipt"
              tone="brand"
              title="Чеков пока нет"
              description="Загрузите первый чек — за одобренный мы начислим бонус."
              action={
                <button
                  type="button"
                  onClick={() => navigate('/seller/upload')}
                  className="vliq-btn is-sm"
                  style={{ display: 'inline-flex', width: 'auto', paddingInline: 20 }}
                >
                  Загрузить чек
                </button>
              }
            />
          )}
        </div>
      </div>
      <SellerFaq />
    </div>
  )
}

export function HomePage() {
  return (
    <ErrorBoundary>
      <HomeContent />
    </ErrorBoundary>
  )
}
