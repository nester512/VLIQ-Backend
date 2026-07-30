import { useNavigate } from 'react-router-dom'
import { Btn } from '@/components/atoms/Btn'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'

function PersonalDataConsentContent() {
  const navigate = useNavigate()

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 32 }}>
      <section className="vliq-card" style={{ padding: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--vliq-text)' }}>
          Согласие на обработку персональных данных
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 14, fontWeight: 500, lineHeight: 1.45, color: 'var(--vliq-hint)' }}>
          Здесь будет опубликован утверждённый текст согласия на обработку персональных данных.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 14,
            background: 'var(--vliq-field)',
            color: 'var(--vliq-hint)',
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.45,
          }}
        >
          До публикации финальной редакции согласие в форме регистрации используется только для
          подтверждения ознакомления с условиями сервиса.
        </div>

        <Btn variant="ghost" onClick={() => navigate(-1)} style={{ marginTop: 18 }}>
          Назад
        </Btn>
      </section>
    </div>
  )
}

export function PersonalDataConsentPage() {
  return (
    <ErrorBoundary>
      <PersonalDataConsentContent />
    </ErrorBoundary>
  )
}
