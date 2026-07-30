import { useNavigate, useParams } from 'react-router-dom'
import { Btn } from '@/components/atoms/Btn'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'

function OfferPlaceholderContent() {
  const navigate = useNavigate()
  const { offerId } = useParams()
  const offerNumber = offerId === '2' ? '2' : '1'
  const title = `Оферта №${offerNumber}`
  const description = 'Текст оферты будет опубликован здесь позже.'

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 32 }}>
      <section className="vliq-card" style={{ padding: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--vliq-text)' }}>
          {title}
        </h1>
        <p style={{ margin: '10px 0 18px', fontSize: 14, fontWeight: 500, lineHeight: 1.45, color: 'var(--vliq-hint)' }}>
          {description}
        </p>
        <Btn variant="ghost" onClick={() => navigate(-1)}>Назад</Btn>
      </section>
    </div>
  )
}

export function OfferPlaceholderPage() {
  return (
    <ErrorBoundary>
      <OfferPlaceholderContent />
    </ErrorBoundary>
  )
}
