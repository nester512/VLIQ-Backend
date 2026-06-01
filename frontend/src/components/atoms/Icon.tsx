type IconName =
  | 'chev' | 'back' | 'dots' | 'receipt' | 'wallet' | 'clock' | 'gift'
  | 'cashout' | 'bell' | 'user' | 'users' | 'chart' | 'check' | 'x'
  | 'arrUp' | 'camera' | 'file' | 'qr' | 'shield' | 'alert' | 'edit'
  | 'block' | 'cmt' | 'send' | 'search' | 'zoom' | 'home' | 'store'
  | 'loc' | 'phone' | 'list' | 'pay'

interface IconProps {
  name: IconName
  size?: number
  className?: string
  'aria-hidden'?: boolean
}

// SVG path data extracted from prototype
const ICONS: Record<IconName, string> = {
  chev: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  dots: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
  receipt: '<path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h13a2 2 0 0 1 2 2v0"/><circle cx="16.5" cy="13" r="1.3" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 13h18M12 9v12"/><path d="M12 9C12 9 9.5 3 7 5s2 4 5 4 7.5-1 5-4-5 4-5 4"/>',
  cashout: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M12 16V9m0 0-3 3m3-3 3 3"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 21a6 6 0 0 1 12 0"/><path d="M16 5.6a3.5 3.5 0 0 1 0 6.8M21 21a6 6 0 0 0-5-5.9"/>',
  chart: '<path d="M4 4v16h16"/><path d="M7 14l3.5-4 3 2.5L20 6"/>',
  check: '<path d="M5 12.5 10 17.5 19.5 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="13" cy="13" r="3.6"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3M20 14v6M14 20h3"/>',
  shield: '<path d="M12 3l7 3v6c0 5-3 7.5-7 9-4-1.5-7-4-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17.5v.5"/>',
  edit: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z"/><path d="M14 7l3 3"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
  cmt: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12z"/>',
  send: '<path d="M21 3 11 13M21 3l-6.5 18-3.5-8-8-3.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
  store: '<path d="M4 9 5.2 4h13.6L20 9M5 9v11h14V9M5 9a2 2 0 0 0 4 0 2 2 0 0 0 3.5 0 2 2 0 0 0 3.5 0 2 2 0 0 0 4 0"/>',
  loc: '<path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  phone: '<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M10.5 18h3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  pay: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>',
}

const FILL_ICONS: Set<IconName> = new Set(['dots'])

export function Icon({ name, size = 24, className = '', 'aria-hidden': ariaHidden = true }: IconProps) {
  const isFill = FILL_ICONS.has(name)
  const strokeProps = isFill
    ? ''
    : 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={isFill ? 'currentColor' : 'none'}
      aria-hidden={ariaHidden}
      className={className}
      // Safe: content is from our controlled ICONS record, not user input
      dangerouslySetInnerHTML={{ __html: `<g ${strokeProps}>${ICONS[name]}</g>` }}
    />
  )
}
