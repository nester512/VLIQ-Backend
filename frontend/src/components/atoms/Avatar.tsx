interface AvatarProps {
  initials: string
  src?: string
  size?: number
  className?: string
}

export function Avatar({ initials, src, size = 38, className = '' }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={initials}
        width={size}
        height={size}
        className={`rounded-[12px] object-cover flex-none ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      aria-label={initials}
      className={[
        'flex-none grid place-items-center rounded-[12px]',
        'bg-gradient-to-br from-[var(--vliq-brand)] to-[var(--vliq-brand-2)]',
        'text-white font-extrabold',
        className,
      ].join(' ')}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials.slice(0, 2).toUpperCase()}
    </div>
  )
}
