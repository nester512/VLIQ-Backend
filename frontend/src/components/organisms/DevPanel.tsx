import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { Icon } from '@/components/atoms/Icon'
import { loginByTgId } from '@/api/auth'

/**
 * Floating developer panel — only rendered in DEV builds. Stripped from the
 * production bundle by Vite's tree-shaker via the `import.meta.env.DEV` gate
 * at the call-site, but we double-guard inside as well.
 *
 * Affordances:
 *   • Switch identity (seller mock / admin mock) — calls dev-only /auth/login.
 *   • Open the in-app notifications sheet.
 *   • Re-fetch all React Query data.
 *   • Logout.
 */

// IDs that exist in seed_dev.sql.
const SELLER_TG_ID = 12345
const ADMIN_TG_ID  = 809296638

interface SwitchTo {
  label: string
  telegramId: number
  toast: string
}

const PROFILES: SwitchTo[] = [
  { label: 'Продавец (#12345)',  telegramId: SELLER_TG_ID, toast: 'Вход как продавец' },
  { label: 'Админ (#809296638)', telegramId: ADMIN_TG_ID,  toast: 'Вход как админ' },
]

export function DevPanel() {
  if (!import.meta.env.DEV) return null
  return <DevPanelInner />
}

function DevPanelInner() {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)

  const navigate = useNavigate()
  const qc = useQueryClient()
  const setAuth = useAuthStore((s) => s.setAuth)
  const logout = useAuthStore((s) => s.logout)
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)
  const role = useAuthStore((s) => s.role)

  async function switchProfile(p: SwitchTo) {
    setWorking(true)
    try {
      // Authenticate FIRST so a failure leaves the existing session intact —
      // otherwise we strand the user with no token and an open DevPanel.
      const res = await loginByTgId({ id: p.telegramId })
      qc.removeQueries()
      setAuth(res.access_token, res.role)
      pushToast(p.toast, 'ok')
      navigate(res.role === 'seller' ? '/seller/home' : '/admin/dash', { replace: true })
      setOpen(false)
    } catch {
      pushToast('Не удалось переключить профиль', 'dg')
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      {/* Floating trigger — anchored just above the tabbar safe-area + extra
          12px so it never lands on top of the last list row / action button. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Закрыть dev-панель' : 'Открыть dev-панель'}
        style={{
          position: 'fixed',
          right: 14,
          bottom: 'calc(74px + env(safe-area-inset-bottom, 0px) + 12px)',
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--vliq-text)',
          color: 'var(--vliq-bg)',
          border: 0,
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: '.4px',
          boxShadow: '0 12px 24px -10px rgba(0,0,0,.5)',
          zIndex: 70,
          opacity: 0.7,
        }}
        title={`DEV · ${role ?? '—'}`}
      >
        ⚙
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Панель разработчика"
          style={{
            position: 'fixed',
            right: 14,
            bottom: 'calc(74px + env(safe-area-inset-bottom, 0px) + 60px)',
            width: 260,
            background: 'var(--vliq-card)',
            border: '1px solid var(--vliq-sep)',
            borderRadius: 16,
            padding: 12,
            boxShadow: '0 20px 40px -12px rgba(0,0,0,.4)',
            zIndex: 71,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vliq-hint)', letterSpacing: '.6px', textTransform: 'uppercase', padding: '2px 4px' }}>
            DEV · текущая роль: {role ?? '—'}
          </div>

          {PROFILES.map((p) => (
            <DevButton key={p.telegramId} disabled={working} onClick={() => void switchProfile(p)}>
              <Icon name="user" size={16} />
              {p.label}
            </DevButton>
          ))}

          <DevButton onClick={() => { openSheet('notif'); setOpen(false) }}>
            <Icon name="bell" size={16} />
            Открыть уведомления
          </DevButton>

          <DevButton
            onClick={() => {
              navigate('/seller/upload')
              setOpen(false)
            }}
          >
            <Icon name="camera" size={16} />
            Открыть «Загрузить чек»
          </DevButton>

          <DevButton
            onClick={() => {
              void qc.invalidateQueries()
              pushToast('Кэш React Query очищен', 'info')
            }}
          >
            <Icon name="clock" size={16} />
            Сбросить React Query кэш
          </DevButton>

          <DevButton
            onClick={() => {
              logout()
              qc.removeQueries()
              navigate('/', { replace: true })
              setOpen(false)
            }}
            tone="dg"
          >
            <Icon name="block" size={16} />
            Logout
          </DevButton>
        </div>
      )}
    </>
  )
}

function DevButton({
  children, onClick, disabled, tone = 'normal',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'normal' | 'dg'
}) {
  const ink = tone === 'dg' ? 'var(--vliq-dg-ink)' : 'var(--vliq-text)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        background: 'var(--vliq-field)',
        color: ink,
        border: 0,
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}
    >
      {children}
    </button>
  )
}
