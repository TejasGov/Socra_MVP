# Socra Design Guardrails

Status: binding for all frontend work (student app, faculty app, admin console).
Purpose: keep Socra from looking and reading like a generic AI-generated app, and give builders a concrete, checkable target.
Verification: Section 7 is the pass/fail checklist the design auditor runs against every frontend PR.

Socra is a tool students sit in for hours while debugging recursion at 11 PM, and that faculty open between lectures to see where a class is stuck. It should feel like a well-made course tool (GitHub, Linear, Stripe Dashboard, Observable, a good IDE). It should not feel like a landing page or a chatbot demo.

---

## 1. Why AI-generated UIs look the same

AI builders output the median of their training data. That means Next.js + Tailwind + shadcn/ui defaults, `bg-indigo-500` buttons (Tailwind's creator publicly apologized in Aug 2025 for making indigo the Tailwind UI default), Inter, and the same landing-page skeleton. A scan of 1,590 Show HN sites found 22% hit 4+ of these patterns. A single pattern alone is not damning. Several together read as "nobody made a decision."

The fix is not a different trendy look. Researchers also flag a "second wave" of tells that show up when the first wave is banned: cream backgrounds with serif headlines and a terracotta accent, near-black with an acid-green accent, tracked all-caps eyebrows on everything, and `01 / 02 / 03` numbering on content that isn't sequential. **Every visual choice must trace back to Socra's content or users, not to a style.**

Sources: prg.sh "Why your AI keeps building the same purple gradient website"; capitalandcompute.net "How to fix AI slop in web design, tell by tell"; adriankrebs.ch "Scoring Show HN submissions for AI design patterns"; impeccable.style/slop; The Fountain Institute "7 tells that a UI is AI-generated"; Anthropic's frontend-design skill.

---

## 2. The tells: what to look for and what to do instead

Each tell lists a **Grep** (patterns the auditor searches for in `*.tsx, *.ts, *.css, *.mdx`) and a **Do instead**. A grep hit is a flag to review, not an automatic fail. The checklist in Section 7 decides.

### 2.1 Visual tells

| #   | Tell                                                                                                            | Grep / look for                                                                                                                             | Do instead                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Purple/indigo/violet as brand or accent; purple-to-pink or purple-to-blue gradients                             | `indigo-`, `violet-`, `purple-`, `fuchsia-`, `from-.*to-`, `bg-gradient-to`, `linear-gradient(`, `#6366f1`, `#8b5cf6`, `#a855f7`            | One accent, the deep teal in Section 4, used only for primary action, selection, and focus. No gradients on surfaces, buttons, or text.                              |
| V2  | Gradient text in headings                                                                                       | `bg-clip-text`, `text-transparent`, `-webkit-background-clip`                                                                               | Solid `--fg`. Get emphasis from size and weight.                                                                                                                     |
| V3  | Glassmorphism / decorative blur                                                                                 | `backdrop-blur`, `bg-white/[0-9]`, `bg-opacity-`, `backdrop-filter`                                                                         | Opaque surfaces. Blur is allowed only on a modal scrim, if anywhere.                                                                                                 |
| V4  | Glows, halos, radial spotlights, decorative blobs                                                               | `blur-3xl`, `blur-2xl`, `radial-gradient`, `shadow-.*-500/`, `shadow-\[0_0_`, `absolute.*rounded-full.*blur`, `animate-pulse` on decoration | Delete them. Use whitespace and headings to show hierarchy.                                                                                                          |
| V5  | Emoji used as icons or bullets (🚀 ✨ 💡 🎯 📊 🔥 ✅)                                                           | Regex for emoji codepoints: `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]`                                                                        | `lucide-react` icons at 16px, only where they help someone scan. Plain text bullets otherwise.                                                                       |
| V6  | Sparkle / magic-wand / bot icons marking anything AI                                                            | `Sparkles`, `Wand`, `WandSparkles`, `Bot`, `BrainCircuit`, `Stars` imports from lucide                                                      | Socra is the product, so AI is not a special feature. Name the action instead ("Generate scaffold", "Ask for a hint"). There is no AI icon.                          |
| V7  | `rounded-2xl`/`rounded-3xl` cards in endless 3-column grids; cards nested inside cards                          | `rounded-2xl`, `rounded-3xl`, `grid-cols-3` repeated, a `Card` inside a `Card`                                                              | Radius by size (Section 4.3). Use tables and lists for tabular content, and dividers rather than nested containers.                                                  |
| V8  | Uniform soft drop shadow on every surface; hairline border plus wide shadow together                            | `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-md` on static cards                                                                         | Either a 1px border or a shadow, never both. Static surfaces use a border only. Shadow is reserved for things that float (menus, popovers, dialogs).                 |
| V9  | Centered hero with a pill badge, a big headline, and two buttons inside an app screen                           | `text-center` on page headers, `text-5xl`+ in app routes, badges above an `h1`                                                              | App pages are left-aligned: title, one line of context, then content. No hero sections inside the app.                                                               |
| V10 | Inter/Geist everywhere with no type scale; or the "second wave" Space Grotesk / Instrument Serif italic accents | `font-sans` with no custom stack, `Inter`, `Geist`, `Space_Grotesk`, `Instrument_Serif`, `italic` in headings                               | Use the stack in Section 4.2 with the defined scale. At most 2 weights per view (400, 600).                                                                          |
| V11 | Flat hierarchy: everything 14px, same gap everywhere                                                            | Same `gap-4`/`p-6` on every container; no heading-size difference                                                                           | Keep related items close (4–8px) and put more space between groups (24–32px). Headings get more space above than below.                                              |
| V12 | Tracked all-caps eyebrow labels above every heading or card                                                     | `uppercase tracking-wider`, `tracking-widest`, `text-xs uppercase`                                                                          | Sentence-case headings. All-caps is allowed only for table column headers and the 3 tiny nav-group labels. The wireframe overuses all-caps labels; do not copy that. |
| V13 | Colored top/left border stripes on cards; rainbow tab colors                                                    | `border-l-4`, `border-t-4`, `border-l-[a-z]+-500`                                                                                           | Only a real status may use a left stripe (e.g. an error callout). Tabs use one accent underline.                                                                     |
| V14 | Decorative status dots and pulsing dots                                                                         | `animate-pulse`, `animate-ping`, `rounded-full w-2 h-2 bg-green`                                                                            | Use a text label. A dot is allowed only alongside a text label for live state, and it never pulses.                                                                  |
| V15 | Decorative grid/dot-pattern backgrounds, noise, stripes                                                         | `bg-grid`, `bg-dot`, `repeating-linear-gradient`, svg patterns in backgrounds                                                               | Plain `--bg`.                                                                                                                                                        |
| V16 | Neon-on-dark, or permanent dark mode with grey-on-grey low contrast                                             | `bg-black`, `bg-zinc-950`, `text-gray-500` on dark, `cyan-400`, `lime-400`                                                                  | Light theme by default. Dark mode is optional and uses tokens that pass AA.                                                                                          |
| V17 | Generic stock illustration or blob SVG in empty states                                                          | `undraw`, `illustration`, large inline decorative `<svg>`                                                                                   | A plain-text empty state with a next action (Section 5.6).                                                                                                           |

### 2.2 Copy tells

The voice to aim for is a TA in office hours: plain, specific, short, never a hype voice.

| #   | Tell                                                                           | Grep (case-insensitive)                                                                                                                                                                                                                                 | Do instead                                                                                                                          |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Hype verbs and nouns                                                           | `unlock`, `elevate`, `empower`, `supercharge`, `seamless(ly)?`, `effortless(ly)?`, `revolutioni`, `transform your`, `next-level`, `cutting-edge`, `game-chang`, `harness`, `leverage`, `unleash`, `journey`, `delve`, `robust`, `powerful`, `intuitive` | Say what happens: "See which questions the class missed most."                                                                      |
| C2  | Chatbot openers and closers                                                    | `let's dive`, `let's get started`, `great question`, `happy to help`, `I'd be happy`, `feel free to`, `hope this helps`, `absolutely!`, `certainly!`                                                                                                    | Socra's tutor messages are drafted by the backend, but UI strings around them (placeholders, empty states) must not use this voice. |
| C3  | Exclamation-heavy friendliness                                                 | `!"` and `!<` in JSX text; count over 1 per screen                                                                                                                                                                                                      | No exclamation marks in UI chrome. One is acceptable in a success confirmation after a real achievement.                            |
| C4  | "AI-powered" / "Powered by AI" / "Smart" / "Magic" badges                      | `AI-powered`, `Powered by`, `AI magic`, `Smart `, `Magic`                                                                                                                                                                                               | Remove them. Faculty and students already know Socra uses a model; the transparency screen explains how.                            |
| C5  | Subtitles that restate the title                                               | A subtitle containing the title's noun ("Dashboard — Your dashboard overview")                                                                                                                                                                          | Use the subtitle for scope or a caveat ("CSE 115 · last 30 days · 118 students"), or drop it.                                       |
| C6  | Vague, category-level copy that would fit any product                          | `your workflow`, `your potential`, `all in one place`, `at your fingertips`, `like never before`                                                                                                                                                        | Name the course, the topic, the number, the date.                                                                                   |
| C7  | Placeholder or fabricated content shipped                                      | `lorem`, `ipsum`, `John Doe`, `Jane Doe`, `example.com`, `TODO`, `Acme`, hard-coded `\d+%` in JSX                                                                                                                                                       | Every number comes from data. Fixtures live only in tests and stories.                                                              |
| C8  | Em-dash and colon-heavy "punchy" phrasing, triads ("Learn. Practice. Master.") | `—` in UI strings, three one-word sentences                                                                                                                                                                                                             | Use plain sentences with full stops.                                                                                                |
| C9  | Buttons with vague labels                                                      | `Get started`, `Learn more`, `Submit`, `Continue` with no object, `Click here`                                                                                                                                                                          | Verb plus object: "Start quiz", "Submit stage 2", "Publish assignment", "Export CSV".                                               |
| C10 | Anthropomorphic over-warmth or praise inflation                                | `Awesome`, `Amazing`, `You're crushing it`, `🎉`, `Woohoo`                                                                                                                                                                                              | Factual acknowledgement: "Correct. Now explain why zero is reachable."                                                              |
| C11 | Permanent-ability or judgmental labels (a PRD requirement)                     | `weak`, `bad at`, `struggling student`, `failing`, `low performer`                                                                                                                                                                                      | Use the 3 topic states, which describe current evidence, not a person.                                                              |

### 2.3 Interaction and structure tells

| #   | Tell                                                                                        | Look for                                                                                            | Do instead                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | A dashboard made of identical KPI cards with arbitrary up/down arrows and % trends          | `TrendingUp`, `ArrowUpRight`, `+12%`, a 4-card row as the first thing on every dashboard            | Lead with what faculty act on (pain points, drilldowns). Show a metric only if it has a defined denominator and a comparison period. No trend arrow without a stated baseline. |
| S2  | Fake stat counters or animated count-up numbers                                             | `CountUp`, `useCountUp`, `animate` on numbers                                                       | Static numbers.                                                                                                                                                                |
| S3  | Entrance animations on everything (fade-and-slide-up per section, staggered), bounce easing | `framer-motion` `initial={{opacity:0`, `animate-in`, `fade-in`, `slide-in`, `ease-bounce`, `spring` | Motion only responds to a user action (open, close, expand), lasts 120–200ms, uses ease-out, and is disabled under `prefers-reduced-motion`.                                   |
| S4  | A toast for every action                                                                    | `toast(` call count; toasts on navigation or saves that are already visible                         | Use inline confirmation where the change happened ("Saved 2:14 PM" next to the field). Toasts only for async results off-screen or for undo.                                   |
| S5  | A modal for everything                                                                      | `Dialog`/`Modal` used for forms that could be a page or inline panel                                | Modals only for destructive confirmations and short focused tasks. Editing happens inline or on a page.                                                                        |
| S6  | Skeleton shimmer on everything / spinner-only loading                                       | `animate-pulse` skeletons on 1-line content                                                         | Static skeletons sized to the real content, or "Loading submissions…" text. No shimmer.                                                                                        |
| S7  | Typing-dots and character-by-character "AI is thinking" theatrics                           | `TypingIndicator`, `typewriter`, fake streaming delays                                              | Stream real tokens if the backend streams. Otherwise show a static "Socra is reading your code…" line.                                                                         |
| S8  | Generic chat UI: avatar circles, colored bubbles left/right, "How can I help you today?"    | `Avatar` in chat rows, `rounded-2xl` bubbles, `justify-end` user bubbles, `How can I help`          | See Section 5.8 for the tutor panel as a reasoning log.                                                                                                                        |
| S9  | Marketing pages inside the app (feature grids, testimonials, pricing-like cards)            | `Testimonial`, `Feature` grids, `Pricing`                                                           | "How Socra works" is a short document page, not a landing page.                                                                                                                |
| S10 | Dead controls (filters, buttons, or links that do nothing)                                  | `onClick={() => {}}`, `href="#"`                                                                    | Remove the control or wire it.                                                                                                                                                 |

### 2.4 Data-visualization tells

| #   | Tell                                                                  | Look for                                                      | Do instead                                                                                                                                                  |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Rainbow categorical palettes; a different color per bar for no reason | `COLORS = [` with 5+ hues, `fill={colors[i]}`                 | Single hue for one series. Highlight the selected or worst item with the accent; everything else is neutral.                                                |
| D2  | Donut/pie for anything; 3D charts                                     | `PieChart`, `Pie`, `innerRadius`, `3d`                        | Horizontal bar charts for ranked categories (pain points). Line or bars for time. A donut is never needed in V1.                                            |
| D3  | Unlabeled axes, no units, no denominator                              | Charts without `XAxis`/`YAxis` labels, `%` without `n`        | Every chart has a title stating what is counted, axis labels with units, and "n = 118 students" visible.                                                    |
| D4  | Precise % from tiny n (PRD 13.x)                                      | `toFixed(1)` on percentages; % rendered when n < threshold    | Below the configured minimum n (default 10; must come from config), render "Insufficient data (n = 4)". No decimals on percentages of fewer than 100 items. |
| D5  | Gridline-heavy or gradient-filled area charts, glow on lines          | `<defs><linearGradient` in charts, `strokeWidth={3}` + shadow | Light 1px gridlines on the y-axis only, flat fills, 1.5–2px lines.                                                                                          |
| D6  | Tooltips as the only way to read values                               | Values only in `Tooltip`                                      | Direct-label bars with their value. Tooltips are optional extras.                                                                                           |
| D7  | Meaning by color only (PRD accessibility requirement)                 | Status shown by color class alone                             | Pair color with text (and optionally an icon or shape).                                                                                                     |

---

## 3. Design direction

**Character:** a calm, dense, trustworthy academic instrument. The content (code, reasoning, class signals) is the interface, and chrome stays quiet.

Principles:

1. **One accent, used for meaning.** Deep teal (inherited from the wireframe) marks the primary action, current selection, focus ring, and Socra's voice in the tutor log. Nothing else is colored except status.
2. **Real typographic hierarchy.** Page title 24/32 semibold, section 16/24 semibold, body 14/20, meta 12/16. Code text is monospace at 13/20.
3. **Dense but calm.** Use tables over card grids and 1px borders over shadows, and keep generous outer margins with tight inner grouping. A faculty member should see the whole class picture without scrolling on a 1440×900 screen.
4. **Plain, specific copy.** Write like a TA: "You've used 1 of 3 hints." "39% answered correctly on the first attempt (n = 118)."
5. **Icons from `lucide-react` only, used sparingly.** Use them in nav items, buttons that need disambiguation, and inline status. Size 16 (nav 18), `strokeWidth={1.75}`, color `currentColor`. Never put an icon in a colored tile above a heading.
6. **Accessible by default (PRD §25, WCAG 2.2 AA).** Text contrast is at least 4.5:1 and UI component contrast at least 3:1. Focus is visible (2px accent outline, 2px offset). Everything is keyboard-reachable, labels are semantic, and dialogs trap focus and restore it on close. `prefers-reduced-motion` is honored, and meaning never depends on color alone.
7. **Light theme by default.** Dark tokens are defined but optional for V1. If shipped, they must pass the same checklist.
8. **Privacy is visible.** Faculty views carry a quiet, persistent "Anonymous, class-level view" line (from the wireframe), not a scary banner.

Reference products for tone (study, don't copy): GitHub's PR/Actions pages, Linear's issue list, the Stripe Dashboard tables, Observable notebooks, and the Gradescope grading view.

---

## 4. Token proposal (Tailwind CSS v4)

Place this in `app/globals.css`. Components use only these tokens. A raw palette class such as `bg-slate-100` or `text-indigo-600` in a component fails review, with an exception for one-off charts that read tokens via CSS vars.

### 4.1 Colors

```css
@import "tailwindcss";

@theme {
  /* Neutrals: slightly cool grey, not pure #000/#fff extremes on large areas */
  --color-bg: #fafaf9; /* app background */
  --color-surface: #ffffff; /* panels, tables, editor */
  --color-surface-2: #f3f4f3; /* sidebar, table header, code context, hover */
  --color-border: #e2e4e3; /* 1px dividers */
  --color-border-strong: #c9cdcb; /* inputs, focused containers */
  --color-fg: #1b1f1e; /* primary text  (~16:1 on surface) */
  --color-fg-muted: #535b59; /* secondary text (~6.9:1) */
  --color-fg-subtle: #6b7371; /* meta, placeholders (~4.8:1) — never below this */

  /* Single accent: deep teal (from wireframe), NOT indigo/violet */
  --color-accent: #2f6f68; /* buttons, links, focus (~5.8:1 on white) */
  --color-accent-hover: #255a54;
  --color-accent-subtle: #e8f1ef; /* selected row/nav bg, Socra log tint */
  --color-accent-fg: #ffffff;

  /* Learning states (text color / background). Muted, never alarm-red. */
  --color-state-reinforce: #8a4b0f;
  --color-state-reinforce-bg: #fbf0e4; /* NEEDS_REINFORCEMENT */
  --color-state-developing: #2b5784;
  --color-state-developing-bg: #eaf0f7; /* DEVELOPING */
  --color-state-demonstrated: #2c6a3f;
  --color-state-demonstrated-bg: #e7f2ea; /* CONSISTENTLY_DEMONSTRATED */

  /* System feedback (errors, warnings) */
  --color-danger: #b42318;
  --color-danger-bg: #fdecea;
  --color-warning: #8a5a00;
  --color-warning-bg: #fdf6e3;
  --color-success: #2c6a3f;
  --color-success-bg: #e7f2ea;

  /* Charts: one hue ramp + neutral. Highlight = accent. */
  --color-chart-1: #2f6f68;
  --color-chart-2: #7fa8a2;
  --color-chart-muted: #c9cdcb;
}

/* Optional dark tokens (only if dark mode ships) */
:root[data-theme="dark"] {
  --color-bg: #121514;
  --color-surface: #181c1b;
  --color-surface-2: #1f2423;
  --color-border: #2c3331;
  --color-border-strong: #3c4442;
  --color-fg: #e8ebea;
  --color-fg-muted: #a9b1af;
  --color-fg-subtle: #8d9593;
  --color-accent: #6db3a9;
  --color-accent-hover: #86c3ba;
  --color-accent-subtle: #1e302d;
  --color-accent-fg: #0e1312;
  --color-state-reinforce: #e8b27a;
  --color-state-reinforce-bg: #33261a;
  --color-state-developing: #9cc0e6;
  --color-state-developing-bg: #1c2836;
  --color-state-demonstrated: #8fcb9f;
  --color-state-demonstrated-bg: #1b2c20;
}
```

Contrast must be re-verified with a checker when values change. The ratios in comments are for text on `--color-surface`.

### 4.2 Typography

Pairing: **IBM Plex Sans** for UI and **IBM Plex Mono** for code. They are designed as a family, have a slightly technical and academic character, and are not the Inter/Geist default. Load them with `next/font/google` (`IBM_Plex_Sans` weights 400/500/600; `IBM_Plex_Mono` 400/500).

```css
@theme {
  --font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;

  --text-xs: 0.75rem;
  --text-xs--line-height: 1rem; /* 12/16 meta, table headers */
  --text-sm: 0.875rem;
  --text-sm--line-height: 1.25rem; /* 14/20 body, default UI */
  --text-base: 1rem;
  --text-base--line-height: 1.5rem; /* 16/24 section headings, reading text */
  --text-lg: 1.125rem;
  --text-lg--line-height: 1.75rem; /* 18/28 quiz question stem */
  --text-xl: 1.5rem;
  --text-xl--line-height: 2rem; /* 24/32 page title */
  --text-2xl: 1.875rem;
  --text-2xl--line-height: 2.25rem; /* 30/36 rare: single big number on results */
}
```

Rules: use one `h1` per page (`text-xl font-semibold`), and do not use `text-3xl` or larger inside the app. Use `tabular-nums` on every number in tables and metrics. Long-form reading text (assignment prompts, How Socra works) is capped at `max-w-[68ch]`.

### 4.3 Radii, spacing, elevation

```css
@theme {
  --radius-sm: 4px; /* badges, inputs, small buttons */
  --radius-md: 6px; /* buttons, menus, code blocks */
  --radius-lg: 8px; /* panels, dialogs — maximum in the app */
  --shadow-pop:
    0 4px 16px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.06); /* menus, popovers, dialogs only */
}
```

- Spacing uses Tailwind's 4px base. Allowed steps are `1, 1.5, 2, 3, 4, 6, 8, 12` (4–48px). Within a group use 8–12px, between groups 24–32px, and page gutter 32px (24px under 1024px).
- `rounded-xl` and larger are banned. `rounded-full` is only for avatars (which are unused in V1) and toggle switches.
- Layout: app shell = 232px sidebar (from wireframe) + content `max-w-[1200px]`. Workspace screens use a fixed right panel (400–420px) for Socra.

---

## 5. Component rules

### 5.1 Buttons

- Variants: `primary` (accent bg), `secondary` (surface + `border-strong`), `ghost` (text only, hover `surface-2`), `danger` (danger text, danger-bg on confirm only). Heights are 32px (default) and 36px (page primary). Never use a full-width 76px slab button (the wireframe does this; don't).
- At most one primary button per view region.
- Labels are verb + object (C9). A trailing `→` is allowed only for navigation to another page, never on submit actions.
- Disabled buttons explain why via adjacent text ("Answer the question to submit"), not just opacity.
- Focus: `focus-visible:outline-2 outline-offset-2 outline-[--color-accent]`.

### 5.2 Tables (the default for lists of things)

- Use them for history, assignments, roster, question insights, admin lists, and research exports.
- Header row: `surface-2`, `text-xs font-medium text-fg-muted`, uppercase allowed here. Rows are 40px tall with a 1px bottom border and hover `surface-2`. No zebra stripes and no cards-per-row.
- Numbers are right-aligned with `tabular-nums`. Dates are relative under 7 days ("8 min ago") and absolute after ("Sep 7"), with a full timestamp in `title`.
- Sortable headers are real `<button>`s with `aria-sort`.

### 5.3 Badges and topic states

- Badge: `text-xs font-medium px-1.5 py-0.5 rounded-sm`, state-colored text on state-bg, no border, no dot, no icon-only.
- Topic states (PRD §12.2) always render the full student-facing label:

| Enum                        | Label                     | Tokens               | Optional icon (lucide, 12px) |
| --------------------------- | ------------------------- | -------------------- | ---------------------------- |
| `NEEDS_REINFORCEMENT`       | Needs reinforcement       | `state-reinforce`    | `RotateCcw`                  |
| `DEVELOPING`                | Developing                | `state-developing`   | `CircleDashed`               |
| `CONSISTENTLY_DEMONSTRATED` | Consistently demonstrated | `state-demonstrated` | `CircleCheck`                |

- Never render the raw enum. Never use red for Needs reinforcement, because it is not a failure. Pair the badge with evidence when space allows ("based on 6 attempts, last Sep 7").
- Course status chips from the wireframe ("1 quiz due", "On track", "Review suggested") are neutral `surface-2` badges, with only "due" items using warning.

### 5.4 Metrics (faculty)

- A metric is a number + label + denominator line. Example: **39%** answered correctly on first attempt / _46 of 118 students · Recursion Lab Q4_.
- Lay them out as a compact row or definition list, not 8 bordered tiles. The wireframe's two rows of 4 tiles should collapse into one metric strip. The "selected metric" interaction is kept as a segmented control or tab row that drives the chart below.
- No trend arrows unless a comparison period is stated ("+23 pts vs. first attempt").

### 5.5 Insufficient-data state

- If `n < MIN_COHORT_N` (from config), replace the value with `Insufficient data` in `fg-muted`, plus `n = 4, minimum 10` in `text-xs`. Do not show a chart, a bar, or a zero.
- Charts with any suppressed category show the suppressed rows grouped as "3 topics with too few responses".

### 5.6 Empty, loading, error

- Empty states follow a simple formula: one sentence on what will appear here, plus one action. Example: "No sessions yet. Start a session from Home and it will be listed here." [Start a session]. No illustration, no emoji, no "Oops!".
- Loading uses a static skeleton matching the layout, or inline text. After 10 seconds, explain the wait ("Still waiting for the model. Your work is saved.").
- Errors say what failed, whether work was saved, and what to do: "Couldn't run your code: the sandbox timed out after 10 s. Your edits are saved. Run again." Errors are announced via `role="alert"`.

### 5.7 Code editor chrome

- Monaco or CodeMirror on `--color-surface`, using a light theme matched to tokens (not VS Code dark by default). Font is `--font-mono` 13/20, and line numbers are in `fg-subtle`.
- Toolbar is a single 36px row: file name (mono, `text-xs`), language, then right-aligned `Run` (secondary, `Play` icon) and `Submit stage` (primary). Keyboard shortcuts are shown in a `kbd` style (`Ctrl+Enter`).
- The output/console panel sits below the editor with a resizable split. It has a tabs row (Output · Tests) with stdout in mono and failing test names with expected vs. actual in a diff format. Exit code and duration are shown as meta text.
- The editor has an `aria-label` ("Code editor, stage 2"), and Escape releases the focus trap (Monaco Tab-trapping is a keyboard blocker otherwise).
- The "Observed: 5 → 3 → 1 → -1" trace from the wireframe is a mono, `surface-2` block labelled "Observed values".

### 5.8 The Socratic tutor panel (must not look like a generic chatbot)

The tutor is a **reasoning log next to the work**, not a messenger app.

- Placement: a fixed right panel (400–420px) on session, quiz, and assignment screens. On the free-form session screen it is the main column with code context on the right, per the wireframe.
- Header: "Socra" in `text-sm font-semibold` plus a one-line mode statement in `fg-muted` (e.g. "Guided mode. Socra asks questions and gives hints; it won't write the solution."). No avatar, no robot or sparkle icon, no "online" dot.
- Turns: full-width blocks, not left/right bubbles. Each turn has a small `text-xs` speaker label ("You" / "Socra"). Socra turns have a 2px accent left rule and `accent-subtle` background or no background. Student turns sit on plain `surface`. Use the wireframe's "Your reasoning" label when the student is answering a Socra question.
- Content: code in turns renders as mono blocks with copy disabled for Socra-generated snippets in graded contexts. Short traces render inline in mono.
- Hint ladder: a visible, persistent meter, e.g. "Hints: 1 of 3 used" as text plus 3 segments. Asking for a hint is an explicit secondary button ("Ask for a hint"), and the next hint level is named ("Next: point to the invariant").
- Composer: a multi-line textarea, with placeholder "Explain your next reasoning step…" (from wireframe). Not "Ask me anything". Enter sends and Shift+Enter adds a newline (state this in helper text). The send button is a labeled icon button (`aria-label="Send to Socra"`).
- Policy refusals ("I can't give you the final code for this assignment") render as a normal Socra turn with a neutral `Lock` icon and the policy name, not as a red error.
- No suggested-prompt chips inside an ongoing session. Chips are allowed only on Home (the wireframe's "Debug my code / Explain a concept…").
- Streaming shows real tokens with no fake typing dots. A "Stop" control is available while streaming.
- The log is an `aria-live="polite"` region, and each turn is an `article` with the speaker as its accessible name.

### 5.9 Forms (quiz setup, assignment maker, admin)

- Labels sit above fields in `text-sm font-medium` with help text below in `fg-subtle`. No floating labels and no placeholder-as-label (the wireframe's `TOPIC Recursion ▾` label-inside-box pattern becomes label above select).
- Segmented controls are used for small sets (question count 5 / 10 / 15; confidence "Still unsure / I understand it / I could teach it").
- Integrity constraints (assignment maker) are a checkbox list with allowed/blocked phrasing. Blocked items show `Ban` icon + text, not a red ✕ glyph.

### 5.10 Navigation shell

- Sidebar is 232px on `surface-2` with a right border. The product name "Socra" is set in text (no logo gradient). Nav items are 32–36px tall with an 18px lucide icon and label; the active item uses `accent-subtle` bg + accent text.
- Group labels ("Learn", "Recent") are `text-xs fg-subtle`, and uppercase is allowed only here.
- Role switch (student / faculty / admin) is by route and role, never a toggle on a student screen.

---

## 6. Figma wireframe inventory

Source: Figma file `1c1t79xxBAlqB73FeSCEBs`, page "Socra Wireframes" (`0:1`). It has 21 frames at 1440×900 in 5 flow sections. The wireframes are lo-fi: **follow their layout and information architecture, not their styling.** Where they conflict with this document (full-width 76px slab buttons, all-caps eyebrow labels on every block, two rows of 4 metric tiles, card-wrapped everything), these guardrails win. The wireframe palette is a muted teal on near-white, which this doc keeps as the single accent.

Three sidebars appear:

- **Student sidebar** (frames 01–13): Socra wordmark; "+ New session" button; Home, History; group _Learn_: How Socra Works, Practice Quiz; group _Recent_: 4 recent session titles.
- **LMS sidebar** (14–16): "Socra LMS"; Dashboard, Courses, Assignments, Practice, History; "Faculty view →" link at bottom (dev/demo only; real access is role-based).
- **Faculty sidebar** (17–21): "Socra Faculty"; Overview, Courses, Assignments, Question Insights, Agent Analytics; "+ Create assignment" button pinned at bottom.

The wireframe has **no admin console and no student transparency screen**. Both are required by the PRD (§31, §26.1). Build them with the same shell and the table/form rules above.

### Section 01: Student guided session ("doubt") flow

| Frame                           | Layout regions                                                                                                                                                | Key elements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Home / New Session           | Sidebar · centered 720px column · right "Practice quiz" card                                                                                                  | H1 "What are you working through?" + one-line context; question composer (textarea, "</> Code", "File", primary "Start reasoning"); mode line "Guided reasoning mode: Socra asks questions and gives hints before revealing solutions"; prompt shortcut chips (Debug my code / Explain a concept / Help me get unstuck / Practice a problem) + 3 example questions; "Continue where you left off" list of recent sessions with relative times. Make the home column left-aligned with the page grid, not a centered hero. |
| 02 Active Guided Session        | Sidebar · header (title "Recursion Base Case", "Guided reasoning · Step 2 of 4", "Save & exit") · conversation column (~700px) · code-context column (~400px) | Turn log with You / Socra / Your reasoning labels; composer "Explain your next reasoning step…" + send; right column: Code context (mono), Observed values trace, "1 of 3 hints used", button "Test this concept with a quiz".                                                                                                                                                                                                                                                                                            |
| 03 History                      | Sidebar · header · search/filter bar · list · summary block                                                                                                   | Search + Topic / Status / Sort filters; session rows (title, one-line outcome, status In progress/Completed, relative date, Continue/Review). **Build as a table.** Learning patterns block (strongest / needs practice / sessions this week) maps to topic-state badges. Quiz result summary snippet.                                                                                                                                                                                                                    |
| 04 How Socra Works              | Sidebar · document column                                                                                                                                     | Three steps (Share the problem / Reason together / Reflect); "Built for learning, not answer copying" principles list; CTA "Start a new session". Render as a short doc page with an ordered list. The 3 equal cards with 01/02/03 eyebrows are a slop pattern; a numbered list is fine because it's a real sequence.                                                                                                                                                                                                     |
| 05 Session Summary / Reflection | Sidebar · 900px column                                                                                                                                        | "You worked through it"; Key insight block; reflection textarea "Explain it in your own words"; confidence selector (Still confused / Getting there / I can explain it); next actions (Practice a similar problem / Review transcript / Complete session); footer meta "4 reasoning steps · 1 hint used".                                                                                                                                                                                                                 |

### Section 02: Student practice quiz flow

All quiz question frames are laid out as a **left 690px question column + right 400px Socra panel**, with no sidebar (focus mode) and a header showing "Practice quiz · Recursion and base cases · Question n of 5 · Exit quiz" plus a progress bar.

| Frame                          | Key elements                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 06 Quiz Setup (with sidebar)   | Topic select, Difficulty select (Adaptive), Question count 5/10/15 segmented, guided-mode options checklist (explain reasoning, progressive hints, save weak concepts), primary "Start quiz", note "You can pause anytime. Progress is saved automatically."                                                                                        |
| 07 Multiple Choice             | Stem, code sample (mono), answers A–D as radio rows, helper "You'll explain your reasoning next." Panel: "Socra coach", policy line "I won't give you the answer…", "Try this first" prompt, tool list (Trace the calls / Compare two choices / Test an assumption), "Ask for a hint", composer.                                                    |
| 08 Incorrect / Guided Hint     | Feedback headline "Not quite, but your choice reveals a useful assumption."; selected answer shown; Socra's question with trace `3 → 2 → 1 → 0 → -1`; hint meter 1/3 + "Reveal another hint"; Try again (primary) / Skip (secondary); note that skipped questions go to the review list.                                                            |
| 09 Correct / Explain Reasoning | "Correct. Now make the reasoning yours."; correct answer; "Why does this work?" prompt + textarea; confidence choices (Still unsure / I understand it / I could teach it); "Submit explanation"; note it's saved with the session.                                                                                                                  |
| 10 Short Answer                | "Predict the output and explain the call order"; code sample; answer textarea; support row (Trace the stack / Reveal one hint); "Check answer"; note "Socra evaluates the answer and the explanation separately."                                                                                                                                   |
| 11 Quiz Results                | Score summary (4/5 correct · 82% reasoning quality · 1 hint used), concept breakdown table (concept, state, x/y), next recommendation, actions (Review missed question / Practice again / Return home), note "saved to History". Map "Strong/Review" to the 3 topic states. Don't show "82% reasoning quality" without explaining what it measures. |
| 12 File Attached / Input State | "Add context to your question"; uploaded file row (name, size, detected language, Replace / Remove); question input; parsed code preview with "ready to use as context"; "Start reasoning"; privacy note "attached only to this session".                                                                                                           |
| 13 Guided Hint Level 2         | "Hint 2: focus on the values the function actually visits"; trace breakdown table (Call 1..4, n, condition); guiding question; hint meter 2/3 "One hint left"; "Retry with hint".                                                                                                                                                                   |

### Section 03: Student assignment flow

| Frame                       | Layout regions                                                                                                                                                                                  | Key elements                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 14 Student Course Dashboard | LMS sidebar · greeting header · course row · upcoming work + activity · integrity note                                                                                                          | 3 course items (code, name, assignment count, status chip); "Upcoming work" (course, due, type, est. time, "Continue assignment"); Socra learning activity (sessions, hints, strongest gain); integrity note. Prefer "Courses" and "Upcoming work" as lists/tables; drop the "Good afternoon" greeting or keep it single-line. |
| 15 Assignment Overview      | Breadcrumb "← CSE 115 / Assignments" · title + meta (due, points, est. time) · 2-col: learning objective + rubric (left), scaffolded stages (right) · Socra support policy · "Start assignment" | Stages 1–4 as an ordered list with status; rubric as a points table; AI policy in plain text.                                                                                                                                                                                                                                  |
| 16 Assignment Sandbox       | Back link · title + "Stage 2 of 4 · Test the base case" + progress · left: question, code editor, reasoning workspace textarea, "Submit stage" · right 410px Socra assignment coach             | Coach header + policy line ("I can't solve the assignment or provide final code"), turn log, composer. Add a Run/output panel under the editor (missing in the wireframe, required by the PRD).                                                                                                                                |

### Section 04: Faculty analytics flow

| Frame                             | Layout regions                                                                                                                                                                                                                                                                                                                                                                                            | Key elements                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17 Faculty Analytics Dashboard    | Faculty sidebar · header "CSE 115 Faculty insights" + "Anonymous, class-level learning signals" + privacy line · filter bar (Course, Assignment, Date range, Breakdown) · metric selector (8 metrics) · chart row (Sessions by week bar chart; Top class pain points ranked list) · insight row (Performance vs. Socra use; Faculty recommendation with "Create practice step")                           | Collapse 8 tiles into one metric strip/segmented selector with denominators. Pain points become a horizontal bar chart with % + n, each row linking to the drilldown. Apply the insufficient-data rule. "4% flagged patterns" needs a definition tooltip/link or removal. |
| 18 Question Drilldown / Anonymous | Back link "← Class pain points" · title "Question-level insight: Base-case reachability" + scope meta · privacy note "Anonymous view. No names, profiles, or individual trails." · 2×2: question preview, class outcome (39% first attempt / 67% after guidance / 1.9 avg hints), interaction funnel (118 → 92 → 64 → 46), misconception patterns (42% / 31% / 18%) · action "Create scaffolded practice" | Funnel as horizontal bars with counts and step-to-step %. Misconceptions as a ranked list with % and n. Every % needs its denominator.                                                                                                                                    |

### Section 05: Faculty authoring flow

| Frame                  | Layout regions                                                                                                                                                                                                                                                                                                 | Key elements                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19 Assignment Maker    | Back link · title "Create a scaffolded assignment" + subtitle · form (Course, Topic, Learning outcomes, Format, Difficulty, Academic integrity constraints) · right 410px "Socra faculty copilot" panel                                                                                                        | Copilot: clarifying question, suggested focus, scaffold plan (Predict → Trace → Counterexample → Repair → Explain), "Generate scaffold". Constraints as allowed/blocked checkbox list. |
| 20 AI Scaffold Builder | Back link · title "Generated scaffold" (rename from "AI-generated scaffold") + "Review and edit every stage before publishing." · 4 stage rows (number, type, prompt, Edit) · Hint ladder + Rubric side by side · right copilot review panel                                                                   | Copilot review: rationale, integrity check list, suggested improvement, "Preview as student". Stage rows are an editable ordered list with drag handle, not cards.                     |
| 21 Preview / Publish   | Back link · "Student preview · Stage 1 of 4" · question preview + response box · publish settings (course, due, attempts, anonymous analytics ON, student-level monitoring OFF) · right preview panel showing what Socra will say · "Publish assignment" + note "Publishing enables aggregate analytics only." | Publish confirmation summarizes settings (PRD requirement). It is the one place a confirm dialog is appropriate.                                                                       |

### Not in wireframe, required by PRD (build with these guardrails)

- **Student transparency screen** (§26.1): a plain document page listing what Socra can access and collect, with a single acknowledge action.
- **Learner profile / topic list**: a table of topics with state badges, evidence, last demonstrated, and a "Practice" action.
- **Admin console** (§31): course setup, instructor and roster management (CSV import with a preview table), feature flags, model config, per-course AI budget, usage, "Disable AI for this course" (danger confirm), close/reopen assignment, log export, research export, job failures. Use tables and forms only, no charts beyond simple usage bars.

---

## 7. Verification checklist (pass/fail)

Run against the diff/branch. Each item is PASS or FAIL with file:line evidence. Any FAIL on items marked **[block]** blocks merge.

**Palette and surfaces**

1. **[block]** No `indigo-*`, `violet-*`, `purple-*`, `fuchsia-*` classes or equivalent hex values anywhere in app code.
2. **[block]** No gradients: zero `bg-gradient-*`, `from-*`/`via-*`/`to-*`, `linear-gradient`/`radial-gradient` outside chart internals.
3. **[block]** No gradient text (`bg-clip-text` + `text-transparent`).
4. No `backdrop-blur` except a dialog scrim. No glow shadows, no blur blobs, no decorative pattern backgrounds.
5. Components use token classes (`bg-surface`, `text-fg-muted`, `border-border`, `bg-accent`) and not raw Tailwind palette colors.
6. Accent appears only on primary actions, links, selection, focus, and Socra turn markers.

**Shape and type** 7. No `rounded-xl`/`2xl`/`3xl`. `rounded-full` only on toggles and avatars. 8. No static card has both a border and a `shadow-*`. `shadow-lg+` appears only on popovers, menus, and dialogs. 9. No nested card containers (a bordered panel inside a bordered panel). 10. Fonts are IBM Plex Sans / IBM Plex Mono (or an approved replacement recorded in this doc). No Inter, Geist, Space Grotesk, or Instrument Serif. 11. One `h1` per page at `text-xl`. No `text-3xl`+ in app routes. Headings don't skip levels. 12. `uppercase` appears only in table headers and sidebar group labels. 13. `tabular-nums` on all numeric table cells and metrics.

**Icons and emoji** 14. **[block]** No emoji in UI strings or JSX. 15. Icons come only from `lucide-react`. No `Sparkles`, `Wand*`, `Bot`, or `BrainCircuit` imports. 16. Icon-only buttons have `aria-label`, and no icon sits in a colored tile above a heading.

**Copy** 17. **[block]** None of the C1/C4/C6 banned phrases appear (case-insensitive grep of `.tsx/.ts/.json` string literals and i18n files). 18. Zero `!` in UI chrome strings (at most one in a success message). 19. No `lorem`, `Acme`, `John Doe`, `example.com`, or `TODO` in rendered strings. No hard-coded metric values in components. 20. Every button label is verb + object. No bare "Submit", "Continue", "Learn more", or "Get started". 21. Subtitles add scope or caveat and don't restate the title. 22. Topic states render as "Needs reinforcement / Developing / Consistently demonstrated", never as raw enums, and never with words like weak, failing, or struggling.

**Structure and interaction** 23. No entrance animations on page load. All transitions are 200ms or less, respond to user action, and are wrapped in `motion-safe:` or a reduced-motion check. 24. No `animate-pulse`/`animate-ping`/`animate-bounce` (except an approved static-skeleton fallback, which also has no shimmer). 25. Toasts are used only for off-screen async results or undo. Count the `toast(` calls and justify each one. 26. Modals are used only for destructive confirmation, publish confirmation, and short focused tasks. Each has a focus trap, Escape to close, focus return, and `aria-labelledby`. 27. Lists of records (history, assignments, roster, questions, admin) are tables with semantic `<table>`/`<th scope>`, not card grids. 28. No dead controls (`href="#"`, empty `onClick`). 29. Every data view has a designed empty, loading, and error state matching Section 5.6.

**Tutor panel** 30. **[block]** The tutor uses full-width labeled turns (You / Socra / Your reasoning), with no avatars, no left/right bubbles, no typing dots, and no sparkle/bot icon. 31. The hint meter is visible with text ("Hints: n of 3 used"), and hint requests are explicit buttons. 32. The composer has a label, Enter/Shift+Enter behavior is documented in helper text, the send button has `aria-label`, and the log is `aria-live="polite"`. 33. The policy line is visible at the top of the panel, and refusals render as normal turns, not errors.

**Data viz and analytics** 34. **[block]** Every percentage shows or links its denominator (n). Values below `MIN_COHORT_N` (read from config) render "Insufficient data (n = x)", with no bar or number. 35. No pie, donut, or 3D charts. Ranked categories use horizontal bars with direct value labels. 36. Charts have a title stating what is counted, labeled axes with units, and at most 2 hues plus neutral. 37. No trend arrows or deltas without a stated comparison baseline. 38. Faculty views show the anonymous-scope line, and no student identity appears in any faculty analytics component.

**Accessibility (WCAG 2.2 AA)** 39. **[block]** Text contrast is at least 4.5:1 (large text 3:1), and UI boundaries and focus rings at least 3:1, checked in light (and dark, if shipped). 40. **[block]** Every interactive element is keyboard reachable with a visible `focus-visible` ring. The code editor has an Escape route out of the Tab trap. 41. Form fields have visible `<label>`s (no placeholder-as-label), and errors are tied with `aria-describedby` and announced. 42. No meaning is conveyed by color alone (state badges have text; chart highlights have labels).

**Wireframe fidelity** 43. Screens 01–21 exist with the layout regions listed in Section 6 (sidebar variant, main column, right Socra panel where specified). Deviations are listed in the PR. 44. Wireframe styling that conflicts with these guardrails (76px slab buttons, eyebrow labels everywhere, 8 metric tiles, centered home hero) was not copied. 45. PRD-required screens missing from the wireframe (transparency, learner profile, admin console) follow the same shell and component rules.

Auditor scoring: report the count of PASS/FAIL, list every FAIL with file:line and the specific fix, and state "merge-blocking" if any [block] item fails.

## Figma frame IDs (fileKey `1c1t79xxBAlqB73FeSCEBs`)
Load the tool with ToolSearch `select:mcp__e9d309b6-f4e8-44fe-9513-431daa998104__get_screenshot`, then call it with fileKey + nodeId to see a frame. Follow the wireframe's layout/IA; where its styling conflicts with the guardrails above, the guardrails win.
| Node | Screen | Used by |
|---|---|---|
| 4:2 | 01 Home / New Session | student /home |
| 4:3 | 02 Active Guided Session | Socra panel (conversation + code-context column) |
| 4:4 | 03 History | student home "recent sessions" |
| 4:5 | 04 How Socra Works | /how-socra-works |
| 4:6 | 05 Session Summary / Reflection | Socra panel end-of-session |
| 15:3 | 06 Quiz Setup | /practice |
| 15:4 | 07 Quiz Question / Multiple Choice | /practice/[id] |
| 15:5 | 08 Quiz Incorrect / Guided Hint | /practice/[id] feedback |
| 15:6 | 09 Quiz Correct / Explain Reasoning | /practice/[id] feedback |
| 15:7 | 10 Quiz Question / Short Answer | /practice/[id] |
| 15:8 | 11 Quiz Results | practice finish |
| 15:9 | 12 File Attached / Input State | Socra input states |
| 17:2 | 13 Quiz Guided Hint / Level 2 | guidance depth indicator |
| 21:37 | 14 Student Course Dashboard | /courses/[courseId] |
| 21:38 | 15 Assignment Overview | workspace prompt header |
| 21:39 | 16 Assignment Sandbox / Socra Agent | workspace page |
| 21:40 | 17 Faculty Analytics Dashboard | /faculty |
| 21:41 | 18 Faculty Question Drilldown / Anonymous | /faculty/insights/questions/[id] |
| 21:42 | 19 Faculty Assignment Maker | /faculty/assignments/new (+copilot) |
| 21:43 | 20 Faculty AI Scaffold Builder | authoring scaffold/hint ladder/rubric |
| 21:44 | 21 Assignment Preview / Publish | preview + publish review |
