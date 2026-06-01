import type { ReactNode } from 'react'
import { Icon } from '@/components/atoms/Icon'

interface NavRowProps {
  icon: ReactNode
  label: string
  value?: string
  onClick?: () => void
  className?: string
}

export function NavRow({ icon, label, value, onClick, className = '' }: NavRowProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={[
        'vliq-row',
        onClick ? '' : 'is-static',
        className,
      ].join(' ')}
    >
      <div className="vliq-row-ic bg-[var(--vliq-field)] text-[var(--vliq-hint)]">
        {icon}
      </div>
      <div className="vliq-row-tx">
        <b style={{ fontWeight: 600 }}>{label}</b>
      </div>
      {value !== undefined && value !== '' && (
        <span className="text-[13px] text-[var(--vliq-hint)] font-medium mr-[6px] flex-none">
          {value}
        </span>
      )}
      <div className="text-[var(--vliq-hint)] flex-none">
        <Icon name="chev" size={20} />
      </div>
    </Tag>
  )
}
