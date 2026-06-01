interface ChevronProps {
  size?: number
  className?: string
}

export function Chevron({ size = 20, className = '' }: ChevronProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`text-[var(--vliq-hint)] flex-none ${className}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
