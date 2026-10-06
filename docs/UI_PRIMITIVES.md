# UI primitives (`@/components/ui`)

Import from `@/components/ui`. Tokens live in `src/app/globals.css` (guardrails §4): use `bg-bg`, `bg-surface`, `bg-surface-2`, `border-border`, `border-border-strong`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `bg-accent`/`text-accent`/`bg-accent-subtle`, `text-state-reinforce`/`-developing`/`-demonstrated` (+ `-bg`), `text-danger`/`bg-danger-bg`, `warning`, `success`, `chart-1`/`chart-2`/`chart-muted`. Fonts: `font-sans` (IBM Plex Sans), `font-mono` (IBM Plex Mono), `text-code` = 13/20 mono size. Radii: `rounded-sm` 4, `rounded-md` 6, `rounded-lg` 8 (max). `shadow-pop` only on things that float. Never raw palette classes (`bg-slate-100`).

| Component | Props (key) | Notes |
| --- | --- | --- |
| `Button` | `variant` primary/secondary(default)/ghost/danger, `size` sm 28px / md 32px / lg 36px, `loading`, `loadingLabel`, `icon`, + button attrs | `type="button"` default. Verb + object labels. One primary per region. |
| `LinkButton` | same variants/sizes + next/link props (`href`) | Navigation styled as a button. |
| `TextLink` | next/link props | Accent inline link. |
| `buttonClasses(variant, size, extra)` | | For `<a>`/`<label>`/form submit elements you build yourself. |
| `Input`, `Textarea` (`mono`), `Select` | native attrs | Bordered controls, `aria-invalid` turns border danger. |
| `Field` | `id`, `label`, `help?`, `error?`, `required?`, one child control | Injects `id`, `aria-describedby`, `aria-invalid` into the child. Error has `role="alert"`. |
| `Label` | label attrs | Above the field, `text-sm font-medium`. |
| `Checkbox` | `id`, `label`, `help?`, + input attrs | Label right, help below. |
| `Badge` | `tone` neutral/accent/warning/danger/success | No dots, no icon-only. |
| `StateBadge` | `state`: NEEDS_REINFORCEMENT / DEVELOPING / CONSISTENTLY_DEMONSTRATED | Full label + shape icon. Unknown/null -> "Not enough evidence yet". `TOPIC_STATE_LABELS` exported. Never print raw enums. |
| `ModeBanner` | `mode` protected/practice/review, `compact?`, `children?` | PRD §46 copy, `data-testid="mode-banner"`, `data-mode`. `bannerModeFor(aiMode)` maps PROTECTED_ASSESSMENT/PRACTICE/POST_ASSESSMENT_REVIEW. `MODE_COPY` exported. |
| `ModeTag` | `mode` | Small inline icon + "Protected"/"Practice"/"Review" for table rows. |
| `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` | `Table caption?`; `TH`/`TD` `numeric?` | Semantic table in a 1px bordered box. `TH` defaults `scope="col"`; use `scope="row"` for row headers. `numeric` = right-aligned `tabular-nums`. |
| `Panel` (alias `Card`) | `title?`, `titleAs` h2/h3, `meta?`, `actions?`, `padded?` | Flat, 1px border, no shadow. Never nest panels. |
| `Section` | `title`, `id?`, `meta?`, `actions?` | h2 group heading without a container. Prefer this over Panel. |
| `PageHeader` | `title`, `meta?`, `actions?`, `back?: {href,label}` | The single `h1` per page (24/32). `meta` = scope/caveat, not a restated title. |
| `EmptyState` | `children` (one sentence), `action?` | Dashed border, no illustration. |
| `ErrorState` | `title`, `children?` (saved? what to do), `action?` | `role="alert"`, danger left rule. |
| `LoadingState` | `label?`, `lines?` | Static skeleton bars, no shimmer, `role="status"`. `LoadingText` for inline "Loading submissions…". |
| `Metric` | `label`, `metric: {numerator, denominator, value, suppressed}`, `format` percent/count/decimal, `unit?`, `context?`, `minN?` | `data-testid="analytics-metric"`. Suppressed/null -> "Insufficient data" + "n = x, minimum y". Percent value may be 0..1 or 0..100. Wrap in `MetricStrip` (a `<dl>`). |
| `Tabs` | `items: {id,label,content}[]`, `label` (aria), `defaultId?`, `onChange?` | Client. Arrow/Home/End keys. One accent underline. |
| `TabLinks` | `items: {href,label,active?}[]`, `label` | Route-based tabs (`aria-current`). |
| `Dialog` | `open`, `onClose`, `title`, `description?`, `children?`, `footer?` | Client. Native `<dialog>` + `showModal()`: inert background, Escape, focus return, `aria-labelledby`. Only for destructive/publish confirmation and short tasks. |
| `ToastProvider` / `useToast()` | `toast({title, message?, tone: "error"/"info", action?})` | Client. Only for off-screen async failures or undo. Mount the provider in your own client subtree. |
| `DevBadge` | | "AI MOCK MODE" marker. The shell already shows it when `env().AI_MOCK_MODE`. |
| `DateText` | `date` | `<time>`: relative under 7 days, absolute after, full timestamp in `title`. Helpers: `formatRelative`, `formatShortDate`, `formatDue`, `fullTimestamp`. |
| `cx(...)` | | Class joiner. |

Rules: icons from `lucide-react` at 16 (nav 18), `strokeWidth={1.75}`, `aria-hidden`; icon-only buttons need `aria-label`. No `uppercase` outside table headers and nav group labels. `tabular-nums` on numbers. Reading text max `max-w-[68ch]`. Transitions ≤200ms, user-triggered only.

Shell: pages render inside `src/app/_shell` (232px sidebar, content capped at 1200px). Add an element with `data-shell-width="full"` to lift the cap (workspace). Faculty pages read `?courseId=` from the sidebar course switcher. Do not render a second AI MOCK MODE badge; the shell shows it.
