# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## App screens (the supervision lifecycle)

Each screen corresponds to a stage of the supervision workflow
(Plan → Coordinate → Review → Sign off). See the root
[`README`](../../../README.md) for the product story.

| File | URL | Screen |
| --- | --- | --- |
| `index.tsx` | `/` | **Portfolio ledger** — every matter, its stage, and the "what to scrutinise" insights panel |
| `plan.tsx` | `/plan` | **(1) Plan** a new matter — risk limits, scope, red-lines, AI reviewers, and a proactive learned suggestion |
| `coordinate/$matterId.tsx` | `/coordinate/:id` | **(2) Coordinate** — kanban board of workstreams moving across the review pipeline |
| `matter/$matterId.tsx` | `/matter/:id` | **(3) Review + (4) Sign off** — clause workspace with risk tiers, reasoning, evidence, live traces, and the sign-off flow |
| `audit.tsx` | `/audit` | **Audit trail** — the portfolio-wide, hash-verified decision record |
| `profile.tsx` | `/profile` | Account & settings (notifications, sign-off defaults, light/dark theme) |
| `__root.tsx` | — | App shell (theme init, fonts, error boundary) |

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.
