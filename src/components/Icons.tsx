type P = { className?: string; size?: number }

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.35,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const IconSearch = ({ className }: P) => (
  <svg {...base()} className={className}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5 21 21" />
  </svg>
)

export const IconRefresh = ({ className }: P) => (
  <svg {...base()} className={className}>
    <path d="M20 11a8 8 0 1 0-2.6 6.2" />
    <path d="M20 4.5V11h-6" />
  </svg>
)

export const IconSettings = ({ className }: P) => (
  <svg {...base()} className={className}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </svg>
)

export const IconSun = ({ className }: P) => (
  <svg {...base()} className={className}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
)

export const IconMoon = ({ className }: P) => (
  <svg {...base()} className={className}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
)

export const IconClose = ({ className }: P) => (
  <svg {...base()} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconPlus = ({ className }: P) => (
  <svg {...base(13)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconCheck = ({ className }: P) => (
  <svg {...base(11)} className={className} strokeWidth={2.4}>
    <path d="M4 12.5 9 18 20 6" />
  </svg>
)

export const IconTrash = ({ className }: P) => (
  <svg {...base(13)} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)

export const IconSpark = ({ className }: P) => (
  <svg {...base(14)} className={className}>
    <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.2 6.2l3 3M14.8 14.8l3 3M17.8 6.2l-3 3M9.2 14.8l-3 3" />
  </svg>
)

export const IconArrow = ({ className }: P) => (
  <svg {...base(14)} className={className}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
)

export const IconExternal = ({ className }: P) => (
  <svg {...base(13)} className={className}>
    <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
)

export const IconBack = ({ className }: P) => (
  <svg {...base(15)} className={className}>
    <path d="M20 12H5M11 6l-6 6 6 6" />
  </svg>
)

export const IconCommand = ({ className }: P) => (
  <svg {...base(13)} className={className}>
    <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z" />
  </svg>
)

export const IconQuote = ({ className }: P) => (
  <svg {...base(14)} className={className} fill="currentColor" stroke="none">
    <path d="M9.5 6C6.4 7.4 5 9.8 5 13v5h6v-6H8.2c0-2 .8-3.4 2.6-4.3L9.5 6Zm9 0C15.4 7.4 14 9.8 14 13v5h6v-6h-2.8c0-2 .8-3.4 2.6-4.3L18.5 6Z" />
  </svg>
)

export const IconCopy = ({ className }: P) => (
  <svg {...base(13)} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="1" />
    <path d="M15 5H5a1 1 0 0 0-1 1v10" />
  </svg>
)

export const IconFile = ({ className }: P) => (
  <svg {...base(14)} className={className}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </svg>
)

export const IconMonitor = ({ className }: P) => (
  <svg {...base(18)} className={className}>
    <rect x="3" y="4.5" width="18" height="12" rx="1.6" />
    <path d="M8 20h8M12 16.5V20" />
    <path d="M6.5 12.5 9.5 9l2.5 3 2-2.5 3 3.5" />
  </svg>
)

export const IconNote = ({ className }: P) => (
  <svg {...base(18)} className={className}>
    <path d="M5 3.5h9l5 5v12H5z" />
    <path d="M14 3.5v5h5M8 13h8M8 16.5h5" />
  </svg>
)

export const IconClock = ({ className }: P) => (
  <svg {...base(18)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5.2l3.2 2" />
  </svg>
)
