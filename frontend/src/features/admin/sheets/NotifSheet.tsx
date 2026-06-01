import { Icon } from '@/components/atoms/Icon'
import { Spinner } from '@/components/atoms/Spinner'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useNotifications, useMarkNotificationRead } from '@/features/seller/hooks/useNotifications'

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export function NotifSheet() {
  const { data: notifications, isLoading } = useNotifications()
  const { mutate: markRead } = useMarkNotificationRead()

  return (
    <div className="vliq-pad" style={{ paddingTop: 6, paddingBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14, color: 'var(--vliq-text)' }}>
        Уведомления
      </h2>

      {isLoading && !notifications ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '32px 0' }}>
          <Spinner size={28} className="text-[var(--vliq-brand)]" />
        </div>
      ) : notifications && notifications.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notifications.map((n) => {
            const interactive = !n.read
            const sharedStyle = {
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              padding: 14,
              borderRadius: 16,
              border: 0,
              textAlign: 'left' as const,
              background: n.read ? 'var(--vliq-field)' : 'var(--vliq-card)',
              boxShadow: n.read ? 'none' : 'var(--vliq-shadow-sm)',
              width: '100%',
            }
            const Wrapper: 'button' | 'div' = interactive ? 'button' : 'div'
            const interactiveProps = interactive
              ? { type: 'button' as const, onClick: () => markRead(n.id), style: { ...sharedStyle, cursor: 'pointer' } }
              : { style: { ...sharedStyle, cursor: 'default' } }
            return (
              <Wrapper key={n.id} {...interactiveProps}>
              <div
                style={{
                  width: 36, height: 36, borderRadius: 12,
                  display: 'grid', placeItems: 'center',
                  background: n.read ? 'var(--vliq-field)' : 'var(--vliq-brand)',
                  color: n.read ? 'var(--vliq-hint)' : '#fff',
                  flex: 'none',
                  marginTop: 2,
                }}
              >
                <Icon name="bell" size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontSize: 14, fontWeight: 700, color: 'var(--vliq-text)' }}>{n.title}</b>
                  {!n.read && (
                    <span aria-hidden style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'var(--vliq-brand)', flex: 'none',
                    }} />
                  )}
                </div>
                {n.body && (
                  <p style={{
                    fontSize: 13, fontWeight: 500,
                    color: 'var(--vliq-hint)',
                    marginTop: 3, lineHeight: 1.4,
                  }}>
                    {n.body}
                  </p>
                )}
                <span style={{ display: 'block', fontSize: 11, color: 'var(--vliq-hint)', marginTop: 6 }}>
                  {formatDate(n.created_at)}
                </span>
              </div>
            </Wrapper>
          )})}
        </div>
      ) : (
        <EmptyState
          icon="bell"
          tone="brand"
          title="Уведомлений пока нет"
          description="Здесь будут появляться статусы по чекам и выплатам."
        />
      )}
    </div>
  )
}
