import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@/components/atoms/Avatar'
import { NavRow } from '@/components/molecules/NavRow'
import { Icon } from '@/components/atoms/Icon'
import { ProfileCardSkeleton } from '@/components/atoms/Skeleton'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { getMe } from '@/api/sellers'
import { getTgWebApp } from '@/utils/tma'

// Single support contact for everyone (spec S9: @nester256).
const ADMIN_SUPPORT_USERNAME = 'nester256'
// Telegram-username syntax — used both to validate the constant and as the
// runtime guard if the value ever becomes server-supplied.
const TG_USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/

interface TgWebAppOpenLinks {
  openTelegramLink?: (url: string) => void
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void
}

function openTelegramChat(username: string) {
  if (!TG_USERNAME_RE.test(username)) return
  const wa = getTgWebApp() as unknown as TgWebAppOpenLinks | undefined
  const tgUrl = `https://t.me/${username}`
  if (wa?.openTelegramLink) { wa.openTelegramLink(tgUrl); return }
  if (wa?.openLink)         { wa.openLink(tgUrl); return }
  window.open(tgUrl, '_blank', 'noopener,noreferrer')
}

export function ProfilePage() {
  const navigate = useNavigate()
  const pushToast = useUiStore((s) => s.pushToast)
  const authUser = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const { data: profile, isLoading } = useQuery({
    queryKey: ['sellers', 'me'],
    queryFn: getMe,
    staleTime: 60_000,
    retry: false,
  })

  // Telegram first/last_name as a fallback when the profile object hasn't loaded
  // (or the seller hasn't completed registration yet).
  const tgUser = getTgWebApp()?.initDataUnsafe?.user
  const fallbackFirst = tgUser?.first_name ?? (authUser?.name ?? '').split(' ')[0] ?? ''
  const fallbackLast  = tgUser?.last_name  ?? (authUser?.name ?? '').split(' ').slice(1).join(' ') ?? ''

  const firstName = (profile?.first_name ?? fallbackFirst).trim()
  const lastName  = (profile?.last_name  ?? fallbackLast).trim()
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Продавец'

  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'V'

  const storeLine = [profile?.store_name, profile?.city].filter(Boolean).join(' · ') || 'Профиль не заполнен'
  const tgPhotoUrl = tgUser?.photo_url

  return (
    <div className="vliq-pad" style={{ paddingTop: 16 }}>
      {/* User card */}
      {isLoading && !profile ? (
        <ProfileCardSkeleton />
      ) : (
        <div className="vliq-card" style={{ padding: 20, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar initials={initials} src={tgPhotoUrl} size={54} className="rounded-[16px]" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: '-.2px',
                color: 'var(--vliq-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {displayName}
            </h2>
            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--vliq-hint)',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {storeLine}
            </p>
          </div>
          {profile?.status === 'pending' && (
            <button
              type="button"
              onClick={() => navigate('/seller/reg')}
              style={{
                flex: 'none',
                background: 'var(--vliq-wn-bg)',
                color: 'var(--vliq-wn-ink)',
                fontSize: 11.5,
                fontWeight: 700,
                padding: '6px 10px',
                borderRadius: 999,
                border: 0,
                cursor: 'pointer',
              }}
            >
              Заполнить
            </button>
          )}
        </div>
      )}

      {/* Nav rows */}
      <div className="vliq-list">
        <NavRow icon={<Icon name="wallet"  size={21} />} label="Мой баланс"             onClick={() => navigate('/seller/balance')} />
        <NavRow icon={<Icon name="cashout" size={21} />} label="Мои заявки на выплату"   onClick={() => navigate('/seller/payouts')} />
        <NavRow icon={<Icon name="list"    size={21} />} label="Вопросы и ответы"        onClick={() => navigate('/seller/home#faq')} />
        <NavRow
          icon={<Icon name="user" size={21} />}
          label="Помощь"
          value="Telegram-чат"
          onClick={() => {
            openTelegramChat(ADMIN_SUPPORT_USERNAME)
            pushToast('Открываем чат…', 'info')
          }}
        />
      </div>

      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={() => { logout(); navigate('/', { replace: true }) }}
          style={{
            display: 'block',
            margin: '24px auto 0',
            background: 'transparent',
            border: 0,
            color: 'var(--vliq-hint)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '.4px',
          }}
        >
          [DEV] Выйти
        </button>
      )}

      <p
        style={{
          textAlign: 'center',
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--vliq-hint)',
          marginTop: 18,
          letterSpacing: '.2px',
        }}
      >
        VLIQ · Telegram Mini App
      </p>
    </div>
  )
}
