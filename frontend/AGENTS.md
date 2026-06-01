# VLIQ Frontend — AGENTS.md

## Stack

| Layer | Library | Version |
|---|---|---|
| Framework | React | 19 |
| Language | TypeScript | ~6 (strict) |
| Bundler | Vite | 8 |
| Router | React Router | 7 (`BrowserRouter` + `Routes`/`Route`) |
| State (server) | TanStack Query | 5 |
| State (client) | Zustand | 5 (`persist` middleware for auth) |
| HTTP | Axios | 1.x (client in `src/api/client.ts`) |
| Styling | Tailwind CSS | 4 (CSS-based config in `src/index.css`) |
| TMA SDK | @telegram-apps/sdk-react | 3 |
| Animation | Framer Motion | 12 (P2 — SwipeDeck) |
| Gestures | @use-gesture/react | 10 (P2 — SwipeDeck) |
| Sheets | vaul | 1 (P2 — BottomSheet) |
| Testing | Vitest + @testing-library/react | — |

## Project Structure

```
src/
├── main.tsx          # Entry: init TMA SDK, QueryClient, BrowserRouter
├── App.tsx           # PageShell > AuthGate > AppRouter
├── env.d.ts          # VITE_API_URL env type
├── index.css         # Tailwind v4 @theme + CSS vars (:root / .dark)
├── api/
│   ├── client.ts     # Axios instance with auth interceptors
│   ├── auth.ts       # /auth/login, /auth/tma-verify endpoints
│   └── *.ts          # Placeholder API modules (P1: receipts, sellers, payouts...)
├── store/
│   ├── authStore.ts  # Zustand: token, role, user + persist
│   └── uiStore.ts    # Zustand: activeSheet, toastQueue
├── hooks/
│   ├── useTmaTheme.ts     # Sync TMA colorScheme → .dark class
│   ├── useTmaViewport.ts  # Set --tma-height CSS var
│   ├── useMainButton.ts   # TMA native main button wrapper
│   ├── useBackButton.ts   # TMA native back button wrapper
│   └── useHaptic.ts       # TMA haptic feedback helpers
├── router/
│   └── AppRouter.tsx # Routes: / → AuthGate, /seller/*, /admin/*
├── components/
│   ├── atoms/        # Btn, Pill, Field, Avatar, Icon, Spinner, Toast, Chevron
│   ├── molecules/    # TODO P1: MetricCard, HeroBalance, ReceiptRow, PromoCard...
│   ├── organisms/    # TgHeader, TabBar | TODO P2: BottomSheet, SwipeDeck
│   └── layout/       # PageShell (theme+viewport), ScreenLayout (header+scroll+tabbar)
├── features/
│   ├── auth/
│   │   ├── useAuthFlow.ts  # TMA init → /auth/tma-verify (fallback: /auth/login)
│   │   └── AuthGate.tsx    # Guards routes, shows loader/error/mock-login
│   ├── seller/pages/       # Stub pages (P1): Home, Reg, Upload, Status, Balance...
│   └── admin/pages/        # Stub pages (P2): Dash, Review, Payouts, Sellers
└── utils/
    ├── formatMoney.ts  # Intl.NumberFormat ruble formatter
    ├── formatDate.ts   # Intl.DateTimeFormat Russian date/time formatters
    └── tma.ts          # Safe window.Telegram.WebApp accessor
```

## Conventions

### Naming
- Files: `PascalCase.tsx` for components, `camelCase.ts` for hooks/utils/stores
- Hooks: `use` prefix (e.g. `useAuthFlow`, `useTmaTheme`)
- Stores: exported as `useXxxStore` (React hook) + `xxxStore` (raw, for interceptors)
- Components: named exports, no default exports except `App.tsx`

### Imports
- Use `@/` alias for `src/` (configured in `tsconfig.app.json` + `vite.config.ts`)
- Example: `import { Spinner } from '@/components/atoms/Spinner'`

### TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`
- No `any` — use `unknown` + type guards or proper types
- All props interfaces are named (`XxxProps`)

### Styling
- Tailwind v4 utility classes + CSS variables from `:root` / `.dark`
- CSS vars: `--vliq-brand`, `--vliq-bg`, `--vliq-card`, etc. (see `src/index.css`)
- Tailwind theme tokens: `text-[var(--vliq-text)]`, `bg-[var(--vliq-brand)]`
- No inline style objects except for dynamic values (size, height from JS)

### Components
- Atomic design: atoms → molecules → organisms → layouts → features
- Atoms: pure presentational, no store access, no data fetching
- Feature components: can use stores and TanStack Query
- `dangerouslySetInnerHTML` is allowed only for our controlled SVG constants (Icon, TabBar)

### State
- Server state: TanStack Query (P1 hooks in `src/features/*/hooks/`)
- Client/UI state: Zustand `uiStore` (sheets, toasts)
- Auth state: Zustand `authStore` with `localStorage` persist

### Auth Flow
1. `AuthGate` wraps all routes
2. `useAuthFlow` runs on mount if no token
3. In TMA: POST `/auth/tma-verify` with `initData` (HMAC — backend B1 punch-list)
4. Fallback (TMA, no verify endpoint): POST `/auth/login` with `{id: tg_user_id}`
5. DEV mode (no TMA): shows "Mock Login" button → POST `/auth/login` with `{id: 12345}`

### TMA SDK (v3)
- `init()` called once in `main.tsx` (safe outside TMA)
- Scopes: `mainButton`, `backButton`, `hapticFeedback`, `themeParams`, `viewport`
- Use named exports from `@telegram-apps/sdk-react`, e.g.:
  - `mountMainButton`, `setMainButtonParams`, `onMainButtonClick`
  - `showBackButton`, `onBackButtonClick`
  - `hapticFeedbackImpactOccurred`, `hapticFeedbackNotificationOccurred`
  - `viewportStableHeight`, `isViewportMounted` (signals — use with `useSignal`)

## ENV Variables

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API base URL (e.g. `http://localhost:8000/api/v1`) |

See `.env.example` for template. Copy to `.env.development` for local dev.

## Dev Commands

```bash
npm run dev      # Start dev server at http://localhost:5173
npm run build    # TypeScript check + Vite build
npm run lint     # ESLint
```

API proxy: `/api/*` → `http://localhost:8000` (via `vite.config.ts`).

## Roadmap Status

| Stage | Status | Description |
|---|---|---|
| P0 | **Done** | Skeleton, auth flow, base components, router |
| P1 | TODO | Seller screens, TanStack Query hooks, business logic |
| P2 | TODO | Admin SwipeDeck, BottomSheets, haptic feedback |
| P3 | TODO | Animations, tests, error boundaries, skeletons |

## Related Docs

- Backend: `/Users/kexibo/VLIQ-BOT/backend/AGENTS.md`
- Frontend Plan: `/Users/kexibo/VLIQ-BOT/docs/reviews/07-frontend-plan.md`
- Prototype: `/Users/kexibo/VLIQ-BOT/docs/VLIQ-BOT-prototype.html`
- Auth API: `backend/src/auth/handlers/api/v1/router.py`

## Known Issues / TODO

- **Backend B1:** `POST /auth/tma-verify` not implemented. Auth falls back to `/auth/login` (no HMAC verification — insecure for production).
- **Risk #3:** Phone number collection — no native TMA API. Manual input field in Reg form (P1).
- **Risk #4:** No `GET /sellers/:id/balance` endpoint. Needs backend addition or front-side aggregation of `/bonus-transactions`.
- **Risk #5:** `GET /receipts` has no status filter. Backend needs `?status=` query param.
- **Tailwind v4:** No `tailwind.config.ts` (v4 uses CSS `@theme` block). If downgrading to v3, create config file.
- **React 19:** Some third-party libs may not be fully compatible. Monitor for warnings.
