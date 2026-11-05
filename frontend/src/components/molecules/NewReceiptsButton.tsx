import { Icon } from '@/components/atoms/Icon'

interface NewReceiptsButtonProps {
  count: number
  loading?: boolean
  onClick: () => void
}

/** «↻ +N» at the top of the review deck: new receipts reached the queue — load them to the end. */
export function NewReceiptsButton({ count, loading = false, onClick }: NewReceiptsButtonProps) {
  return (
    <button
      type="button"
      className="vliq-btn vliq-nowrap"
      data-testid="new-receipts"
      aria-label={`Загрузить новые чеки (${count})`}
      disabled={loading}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, width: 'auto', flex: 'none', padding: '5px 12px', borderRadius: 999,
        border: 0, background: 'var(--vliq-brand)', color: '#fff', fontSize: 13, fontWeight: 800,
        cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1, boxShadow: 'var(--vliq-shadow)',
      }}
    >
      <Icon name="refresh" size={15} className={loading ? 'animate-spin' : undefined} />
      +{count}
    </button>
  )
}
