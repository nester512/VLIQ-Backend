# План: Фронтенд VLIQ — React/TS/Tailwind

> Агент: Plan (Sonnet). Сгенерировано 2026-05-24.

## 1. Экраны и шиты

**Seller:** `home`, `reg`, `upload`, `status`, `balance`, `history`, `promo`, `profile`, `payout`.
**Admin:** `adash`, `review` (swipe-deck), `payouts`, `sellers`.
**Bottom Sheets:** `detail`, `seller`, `payout`, `notif`.

## 2. Структура папок

```
frontend/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── env.d.ts
    ├── api/                # axios клиенты per endpoint
    │   ├── client.ts       # axios instance + interceptors
    │   ├── auth.ts
    │   ├── receipts.ts
    │   ├── sellers.ts
    │   ├── payouts.ts
    │   ├── promotions.ts
    │   ├── bonusTransactions.ts
    │   └── notifications.ts
    ├── types/              # генерация из OpenAPI
    │   └── generated/
    ├── store/
    │   ├── authStore.ts    # Zustand: token, role, user
    │   └── uiStore.ts      # Zustand: activeSheet, toast
    ├── hooks/
    │   ├── useTmaTheme.ts
    │   ├── useTmaViewport.ts
    │   ├── useMainButton.ts
    │   ├── useBackButton.ts
    │   └── useHaptic.ts
    ├── router/
    │   └── AppRouter.tsx
    ├── components/
    │   ├── atoms/          # Btn, Pill, Field, Avatar, Icon, Spinner, Toast, Chevron
    │   ├── molecules/      # MetricCard, HeroBalance, ReceiptRow, PromoCard, ...
    │   ├── organisms/      # TgHeader, TabBar, BottomSheet, SwipeCard, SwipeDeck, UploadBox
    │   └── layout/         # ScreenLayout, PageShell
    ├── features/
    │   ├── auth/
    │   │   ├── AuthGate.tsx
    │   │   └── useAuthFlow.ts
    │   ├── seller/
    │   │   ├── pages/      # HomePage, RegPage, UploadPage, StatusPage, BalancePage, ...
    │   │   └── hooks/      # useBalance, useReceipts, useUploadReceipt, useRequestPayout
    │   └── admin/
    │       ├── pages/      # DashPage, ReviewPage, PayoutsPage, SellersPage
    │       ├── sheets/     # ReceiptDetailSheet, SellerDetailSheet, ...
    │       └── hooks/      # useReviewQueue, useSwipeAction, usePayoutActions
    └── utils/
        ├── formatMoney.ts
        ├── formatDate.ts
        └── tma.ts          # safe window.Telegram.WebApp access
```

## 3. Tailwind: маппинг CSS-переменных

```ts
// tailwind.config.ts
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Onest', '-apple-system', 'sans-serif'] },
      borderRadius: { brand: '20px', card: '20px', hero: '24px', sheet: '26px', pill: '999px' },
      colors: {
        brand:  'var(--color-brand)',
        brand2: 'var(--color-brand-2)',
        ok: '#16B981', dg: '#F0455A', wn: '#F39A12', acc: '#2F8FED',
        bg:    'var(--color-bg)',
        card:  'var(--color-card)',
        card2: 'var(--color-card-2)',
        field: 'var(--color-field)',
        text:  'var(--color-text)',
        hint:  'var(--color-hint)',
        sep:   'var(--color-sep)',
        nav:   'var(--color-nav)',
        'ok-bg': 'var(--color-ok-bg)', 'ok-ink': 'var(--color-ok-ink)',
        'dg-bg': 'var(--color-dg-bg)', 'dg-ink': 'var(--color-dg-ink)',
        'wn-bg': 'var(--color-wn-bg)', 'wn-ink': 'var(--color-wn-ink)',
      },
    },
  },
} satisfies Config
```

В `src/index.css`:
```css
:root {
  --color-brand: #6C4CF0;  --color-brand-2: #9B6BFF;
  --color-bg: #EEF0F4;     --color-card: #FFFFFF;
  --color-text: #0E1320;   --color-hint: #8A93A4;
  /* ... остальные light */
}
.dark {
  --color-brand: #7C5CFF;  --color-bg: #0E1621;
  --color-card: #17212B;   --color-text: #FFFFFF;
  /* ... остальные dark */
}
```

Хук `useTmaTheme`:
```ts
import { useLaunchParams } from '@telegram-apps/sdk-react'
export function useTmaTheme() {
  const { tmaColorScheme } = useLaunchParams()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', tmaColorScheme === 'dark')
  }, [tmaColorScheme])
}
```

## 4. Роутинг (react-router v6)

```
/                   → AuthGate → редирект по роли
/seller             → SellerLayout (TabBar)
  /seller/home
  /seller/reg
  /seller/upload
  /seller/status/:id
  /seller/balance
  /seller/history
  /seller/promo
  /seller/profile
  /seller/payout
/admin              → AdminLayout (TabBar)
  /admin/dash
  /admin/review
  /admin/payouts
  /admin/sellers
```

Bottom Sheets — через Zustand `uiStore`, не через URL.

## 5. State

**Zustand authStore:** `token`, `role`, `user`, `setAuth()`, `logout()`. Persist в `localStorage`.
**Zustand uiStore:** `activeSheet`, `sheetPayload`, `toastQueue`, `openSheet()`, `closeSheet()`, `pushToast()`.
**TanStack Query:** `useReceipts`, `useReceiptDetail`, `useBalance`, `usePromotions`, `useSellers`, `usePayoutRequests`. Mutations: `useUploadReceipt`, `useReviewReceipt`, `useRequestPayout`.
**React useState:** только локальное UI (значение поля поиска, шаг формы).

## 6. axios клиент

```ts
// src/api/client.ts
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15_000,
})

api.interceptors.request.use(config => {
  const token = authStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401) authStore.getState().logout()
  return Promise.reject(err)
})
```

**Генерация типов:** `@hey-api/openapi-ts`
```bash
openapi-ts --input http://localhost:8000/openapi.json --output src/types/generated --client axios
```

## 7. TMA-специфика

- **Инициализация:** `init()` из `@telegram-apps/sdk-react` в `main.tsx`
- **MainButton:** хук `useMainButton(text, onClick, visible)` — на `reg`, `upload`, `payout`. Нативная кнопка не перекрывается клавиатурой
- **BackButton:** `useBackButton(onBack)` — на sub-экранах
- **HapticFeedback:** на свайп deck — `impact('medium')` approve, `notification('error')` reject
- **Контакт/телефон:** в TMA нет нативного API — нужно решать (см. риски)
- **viewportHeight:** `useTmaViewport` ставит `--tma-height` CSS var

## 8. Swipe Deck

**Стек:** `framer-motion` + `@use-gesture/react`.

Из прототипа: `dx > 95` → approve, `dx < -95` → reject, `dy < -90 && |dy| > |dx|` → rework.

`SwipeCard`:
- `motion.div` с `drag`, `onDrag`, `onDragEnd`
- Внутри `.tint` ok/dg/up с `opacity` через `useMotionValue` + `useTransform`
- `.stamp` ok/dg/up — аналогично
- `animate={{ x: flyX, y: flyY, rotate, opacity: 0 }}` на finalize
- Нижние карточки `scale(1 - k * 0.045)` — статика

## 9. Bottom Sheet — `vaul`

```tsx
import { Drawer } from 'vaul'
<Drawer.Root open={isOpen} onOpenChange={onClose}>
  <Drawer.Portal>
    <Drawer.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-60" />
    <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-bg rounded-t-sheet z-61 max-h-[93%] flex flex-col">
      <div className="w-10 h-1 bg-sep rounded-full mx-auto my-3 flex-none" />
      <div className="overflow-y-auto px-4 pb-4">{children}</div>
    </Drawer.Content>
  </Drawer.Portal>
</Drawer.Root>
```

## 10. Загрузка фото чека

- **Камера:** `<input type="file" accept="image/*" capture="environment">`
- **PDF/файл:** `<input type="file" accept="image/*,application/pdf">`
- **QR:** TMA SDK `scanQrPopup()` — нативный сканер Telegram
- **Превью:** `URL.createObjectURL(file)`
- **Запрос:** `FormData` + `api.post('/receipts/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })`

## 11. package.json

```json
{
  "dependencies": {
    "react": "^18.3",
    "react-dom": "^18.3",
    "react-router-dom": "^6.26",
    "@telegram-apps/sdk-react": "^3",
    "@tanstack/react-query": "^5",
    "zustand": "^5",
    "axios": "^1.7",
    "framer-motion": "^11",
    "@use-gesture/react": "^10",
    "vaul": "^0.9"
  },
  "devDependencies": {
    "vite": "^5",
    "@vitejs/plugin-react": "^4",
    "typescript": "^5.5",
    "tailwindcss": "^3.4",
    "postcss": "^8",
    "autoprefixer": "^10",
    "@hey-api/openapi-ts": "^0.52",
    "vitest": "^2",
    "@testing-library/react": "^16",
    "@testing-library/user-event": "^14"
  }
}
```

## 12. Шаги настройки

```bash
npm create vite@latest vliq-frontend -- --template react-ts
cd vliq-frontend
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install react-router-dom @telegram-apps/sdk-react @tanstack/react-query zustand axios framer-motion @use-gesture/react vaul
npm install -D @hey-api/openapi-ts vitest @testing-library/react @testing-library/user-event
```

ENV:
- `.env.development`: `VITE_API_URL=http://localhost:8000/api/v1`
- `.env.production`: `VITE_API_URL=https://api.vliq.ru/api/v1`

Vite proxy: `server.proxy['/api'] = 'http://localhost:8000'`

## 13. Roadmap

**P0 — Скелет + Auth (3-4 дня):** Vite, Tailwind, CSS vars, темы, `PageShell`, `TgHeader`, `TabBar`, `ScreenLayout`, auth flow, Zustand authStore, роутер, базовые atoms.

**P1 — Seller flow (5-7 дней):** Home, Reg (телефон!), Upload, Status, Balance, History, Promo, Profile, Payout. TanStack Query хуки. NotifSheet.

**P2 — Admin SwipeDeck + Payouts (5-7 дней):** Dash, Review (framer-motion + use-gesture), ReceiptDetailSheet, Payouts, PayoutDetailSheet, Sellers, SellerDetailSheet. Haptic на swipe.

**P3 — Polish (3-4 дня):** notifications polling, AnimatePresence на экранах, Vitest тесты, error boundaries, skeleton states, PWA manifest.

## 14. Что отложить

Storybook, crop фото, offline/Service Worker, push через TMA, Excel-выгрузка, super_admin UI, i18n, visual regression.

## 15. Риски (нужны решения от пользователя)

**#1 Auth без HMAC.** Сейчас `/auth/login` принимает `{id}` без верификации. Бэк должен добавить `POST /auth/tma-verify` с проверкой initData HMAC.

**#2 Загрузка файлов.** `POST /receipts` принимает `file_url` (строку), а не бинарник. Нужен `POST /receipts/upload` (multipart).

**#3 Телефон.** В TMA нет нативного API. Варианты: (а) ввод вручную, (б) запрос через бота до TMA, (в) опциональное поле.

**#4 Баланс.** Нет endpoint `GET /sellers/:id/balance` — нужно агрегировать `/bonus-transactions` на фронте. Хрупко. Просить бэк добавить `GET /sellers/:id/summary`.

**#5 Review queue.** `GET /receipts` без фильтров — нужна query-param фильтрация по статусу.

**Неоднозначность #1:** super_admin UI — тот же что admin, или отдельный?
**Неоднозначность #2:** `PATH_PREFIX` — уточнить значение в ENV.
