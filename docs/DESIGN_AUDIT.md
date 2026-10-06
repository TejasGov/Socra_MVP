# Socra Design Audit (round 1)

Auditor: design-quality verifier. Standard: `docs/DESIGN_GUARDRAILS.md`, with section 7 as the checklist.
Date: 2026-10-06. Branch: `main` working tree.

**Scope:** `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/**`, `src/app/_shell/**`, `(public)`, `(student)` (excluding the assignment workspace and practice routes), `(faculty)/**`, and `(admin)/**` (admin and research).

**Method:**
1. Ran every grep from guardrails section 2 over the 85 in-scope files.
2. Read the UI kit, the shell, and the main pages.
3. Computed WCAG contrast for every token pair.
4. Rendered 36 pages at 1440×900 with Playwright as student1, faculty, admin and research, then read the screenshots and the extracted page text.

Screenshots are in `.playwright-mcp/audit/*.jpg` and page text in `*.txt` (they can be regenerated with `node .playwright-mcp/audit/shoot.cjs`).

## Summary

Overall the frontend is in good shape. Most first-wave slop tells are absent:
- no purple, gradients, glass, glows, emoji, sparkle or bot icons, `rounded-xl+`, or shadows on static surfaces;
- no hype copy, no exclamation marks, no toasts, and no entrance animation;
- IBM Plex is wired in, every component uses tokens, and records are shown in semantic tables;
- metrics carry denominators and suppress small n.

Most of what remains is in three areas:
1. **Token contrast:** two failures that block merge.
2. **Shipped stubs and a grading-page data bug.**
3. **Analytics trust details:** the recommendation tie-break, contradictory misconception framing, and low-contrast or tiny chart marks.

| Severity | Count |
|----------|-------|
| block | 2 |
| major | 8 |
| minor | 24 |

Merge-blocking: **yes**, because of findings 1 and 2. Both are single-token fixes in `globals.css` and `form.tsx`.

---

## Findings

Line numbers are as of this audit. "Fix" is the exact change to apply.

### Block

**1. [block] `--color-fg-subtle` fails AA on `surface-2` (4.41:1).** `src/app/globals.css:20`
- **What's wrong:** subtle text on the sidebar fails, including the group labels ("About Socra", "My courses", "Recent", "Platform") and the course subtitles. Checklist item 39 requires 4.5:1.
- **Fix:** set `--color-fg-subtle: #626a68;`. That gives 5.04:1 on `surface-2`, 5.55:1 on `surface` and about 5.3:1 on `bg`. The dark value already passes (5.13:1). Update the ratio comment.

**2. [block] Form control boundaries fail the 3:1 non-text contrast rule.** `src/components/ui/form.tsx:14`, `globals.css:17`
- **What's wrong:** inputs, selects, textareas and checkboxes use `border-border-strong` (`#c9cdcb`), which is only 1.61:1 against white.
- **Fix:** add the token `--color-border-input: #858c8a;` (3.43:1 on surface, 3.29:1 on bg). Use `border-border-input` in the `control` class in `form.tsx`. The checkbox uses `accent-accent`, so add `border-border-input` there if a custom checkbox is used. Keep `border-strong` for decorative dividers and secondary buttons. For dark mode add `--color-border-input: #6b7472;` and verify it reaches 3:1 on `#181c1b`.

### Major

**3. [major] Stub pages ship with filler copy and raw palette.**
- **Where:** `src/app/(faculty)/faculty/courses/page.tsx`, `roster/page.tsx`, `settings/page.tsx`, and `src/components/shell/page-placeholder.tsx:18`.
- **What's wrong:** `/faculty/courses` ("Courses you teach."), `/faculty/roster` ("Course roster.") and `/faculty/settings` ("Course and Socra policy settings.") render just a title plus a subtitle that restates it. They have no content and use `text-gray-700`. This fails checklist items 21, 28 and 5.
- **Fix:**
  - Delete the three routes. Course and roster management lives in `/admin/courses` and `/admin/roster`, and per-assignment Socra policy lives in the assignment form.
  - If a URL must survive, replace the page body with `redirect("/faculty")`.
  - Delete `components/shell/page-placeholder.tsx`, and remove the three entries from `FACULTY_NAV` in `src/lib/navigation.ts:28,33,34`.

**4. [major] The grading page contradicts the returned grade and invites accidental overwrite.**
- **Where:** `src/app/(faculty)/faculty/grading/_components/grading-form.tsx:43-66` and `:257-258`.
- **What's wrong:** on `/faculty/grading/sub_student1_cse115_hw3_1` the header says "Returned: 20 / 20". Yet each question shows:
  - "8 of 8 passed · 0 of 10 test points";
  - empty rubric inputs;
  - "Computed score 0 / 10".

  The primary button reads "Update and return grade", so one click could re-return the work as 0.
- **Fix:**
  - (a) When `q.testPoints === null`, render "Test points not recorded" rather than `?? 0`.
  - (b) When the question is `FINAL` and `criterionScores` is empty, show "Returned score: {finalScore} / {points}" read-only, with a secondary button "Regrade this question" that unlocks the rubric inputs.
  - (c) Disable "Update and return grade" until a field has changed, with helper text "Change a score or comment to update the returned grade."

**5. [major] Duplicate React key in GradingForm (console error on every load).** `grading-form.tsx:267`
- **Fix:** `key={`${q.questionId}:${t.testId}:${i}`}`. Also check why two tests share a `testId` in the view model.

**6. [major] The faculty recommendation picks a 1-student signal.** `src/server/domain/analytics/aggregate.ts:759-775`
- **What's wrong:** two topics tie at 20%, "Recursive base cases" (4 of 20) and "Functions" (1 of 5). The loop keeps whichever comes first in the map, so the overview recommends Functions. It then names a misconception held by **1 of 5** students. This fails the spirit of D4 and could re-identify a student in a small group.
- **Fix:**
  - Rank by `value`, then `numerator`, then `denominator`, all descending: `if (!best || m.value > best.value || (m.value === best.value && m.numerator > best.numerator))`.
  - Only name a misconception when `topMis.m.numerator >= 2` (preferably `>= MIN_COHORT_N` from config).

**7. [major] Secondary chart bars fail 3:1 graphical contrast.** `globals.css:46`
- **What's wrong:** `--color-chart-2: #7fa8a2` is 2.62:1 against white. It is used for the non-highlighted pain-point bars and all misconception bars, drawn on a `surface-2` track.
- **Fix:** `--color-chart-2: #5f8f88;` (3.64:1 vs white, 3.30:1 vs `surface-2`).

**8. [major] Misconception and difficulty numbers contradict each other with no stated time scope.**
- **Where:** `src/app/(faculty)/faculty/page.tsx:155,203,229-230` and `faculty/insights/topics/[topicId]/page.tsx`.
- **What's wrong:** the overview says 20% of students (4/20) show difficulty on Recursive base cases. Directly below, "Assumes all decreasing sequences reach zero" (same topic) is shown for 55% (11/20). A faculty member cannot reconcile these, because one is current state and the other is "ever labelled".
- **Fix:** state the window in both metas:
  - Pain points: "Students currently showing difficulty, out of students with graded or practice work on the topic."
  - Misconceptions: "Students with at least one reviewed label this term (any assignment, confidence ≥ 0.6). Many later corrected it."
  - Unresolved: "Topics where at least 25% of students are currently in Needs reinforcement" (this also fixes the grammar).

**9. [major] Chart text is 9–10px.** `src/app/(faculty)/faculty/analytics/_components/charts.tsx:180,204,210,214,221`
- **What's wrong:** axis ticks, bar values, "n=0", "too few" and "4/10" are `text-[9px]`/`text-[10px]` in `fill-fg-subtle`, which is below the 12px floor in the type scale.
- **Fix:** use `text-xs` (12px) for bar values and week labels and 11px minimum for ticks. Move "too few / 4/10" from under each label into a single caption row, or into the `<title>` of each bar. Widen the viewBox or reduce the number of weeks shown if crowded.

**10. [major] "Question insights" is missing from faculty navigation (wireframe IA).** `src/app/_shell/nav.ts:65-68`
- **What's wrong:** `/faculty/insights` is reachable only through back links. The wireframe's faculty sidebar has "Question Insights" as a first-class item.
- **Fix:** add `{ href: "/faculty/insights", label: "Question insights", icon: "insights" }` after Analytics, mapping the `insights` icon to lucide `ListChecks` (or `FileQuestion`) in `sidebar-nav.tsx`.

### Minor

**11.** `faculty/assignments/[id]/preview/page.tsx:150-151,160`: "Available support" and "Socra will not" are `uppercase` h3 labels, against V12 and checklist 12. **Fix:** `text-sm font-semibold text-fg`, sentence case.

**12.** Same file, `:140-145`: for a closed assignment with solutions released, the card still says "Protected mode until the assignment closes… Submitting does not unlock solutions." **Fix:** branch on the assignment state. When closed and released, use `MODE_COPY.review.body`, and render the `ModeBanner` with `bannerModeFor(aiMode)` instead of hand-written text.

**13.** `src/components/ui/dev-badge.tsx:10`: "AI MOCK MODE" is uppercase monospace. **Fix:** "AI mock mode" in `font-sans`. Keep the warning tone (it is a real environment status).

**14.** `src/app/forbidden/page.tsx:9`: `text-gray-700`. **Fix:** `text-fg-muted`. Also delete the dead legacy files `src/components/auth/login-form.tsx` and `src/components/shell/app-shell.tsx`, which use the gray palette and are only imported for types. Move `NavItem`/`NavSection` types into `src/lib/navigation.ts`, drop the ignored `nav` prop and the `*_NAV` constants from the area layouts, and keep `primaryRoleLabel`.

**15.** `components/ui/metric.tsx:20` vs `analytics/_components/charts.tsx`: the same value renders as "85.3%" in the metric strip and "85%" in the panel below it on `/faculty`, and the same happens for 23.5%. **Fix:** move the percent formatter into `components/ui/format.ts` and use it in both places. Use whole percents for all faculty analytics, since cohorts are under 1000.

**16.** `charts.tsx:26,53`, `metric.tsx:61`: "Insufficient data (n = 0)" for zero responses. **Fix:** when `denominator === 0`, render "No responses yet". Keep "Insufficient data (n = x, minimum 5)" for 0 < n < minimum.

**17.** `(student)/profile/page.tsx:1,23,100`: "Recent trend" shows Improving/Steady with `TrendingUp`/`TrendingDown` icons and no baseline (checklist 37). **Fix:** rename the column to "Last 14 days" (or whatever window `topic-state.ts` uses) and add `title="Compared with the 14 days before"` on the cell. Use `ArrowUpRight`/`Minus` at 12px, or text only.

**18.** `src/server/domain/learner/topic-state.ts:312` with `profile/page.tsx:104`: the next-step sentence repeats the topic name and the link repeats it again ("Try a few Control flow practice questions…" / "Practice Control flow"). **Fix:** the sentence becomes "Answer a few practice questions without hints to confirm it." and the link becomes "Practice". Apply the same to the "Try a harder…" variant.

**19.** `faculty/assignments/new/page.tsx:16`: the subtitle opens with the slogan "Design for learning depth, not answer retrieval." (C8 forced contrast). **Fix:** `meta="Everything here is a draft until you publish."`.

**20.** `faculty/assignments/page.tsx:29`: the "Closed" state uses the `warning` tone, but closed is not a problem. **Fix:** `tone: "neutral"`. Keep warning for nothing on this table.

**21.** `DateText` (`components/ui/date-text.tsx:11`) prints "None", and `faculty/assignments/page.tsx:124`, `submissions/page.tsx:94` and `materials/page.tsx:139` render "None" while the student view says "No due date". **Fix:** use "No due date" and "Not submitted", passed in through a `fallback` prop on `DateText`.

**22.** `components/ui/date-text.tsx:14`: relative time ("just now", "8 min ago") differs between server and client, causing the hydration-mismatch console error on student pages. **Fix:** add `suppressHydrationWarning` to the `<time>`, or render absolute time on the server and swap to relative in a client effect.

**23.** `faculty/assignments/[id]/submissions/page.tsx`: the faculty status column uses student wording ("Feedback available"). **Fix:** use "Returned" for faculty, plus "Submitted", "Not started" and "In progress".

**24.** `grading-form.tsx:279`: hidden tests are badged in the warning tone ("Hidden, faculty only"). **Fix:** neutral badge with a `Lock` icon and the text "Hidden".

**25.** `src/server/domain/research/allowlist.ts`: "No personal data." is repeated as help text on 14 export fields. **Fix:** remove it where it adds nothing, and put one sentence in the Fields intro: "Unless noted, a field carries no personal data." Keep only the notes that say something specific (quasi-identifying timestamps, pseudonymous ID).

**26.** `(admin)/_components/export-form.tsx:93`: "Leave blank for every course with participants." sits on a select whose default is "All courses". **Fix:** "All courses includes every course with participants."

**27.** `(admin)/admin/roster/page.tsx:102`: tells admins to "Use GET /api/admin/roster/imports/<id>", which is a developer-only step the PRD wants removed. **Fix:** add a "View report" link per import row that renders the per-row results table, and delete the sentence.

**28.** `(admin)/admin/jobs/page.tsx:30`: "1 unresolved background job failures". **Fix:** pluralize: `${n} unresolved job failure${n === 1 ? "" : "s"}`.

**29.** `(admin)/admin/usage/page.tsx:99`: the Mode column shows raw enums (`PROTECTED_ASSESSMENT`, `FACULTY_AUTHORING`). **Fix:** map them to "Protected", "Practice", "Review" and "Faculty authoring" (reuse `MODE_COPY[...].short` plus one extra label).

**30.** `(admin)/admin/health/page.tsx:31`: "Checked 2026-10-06T13:35:16.172Z". **Fix:** `Checked {fullTimestamp(...)} (UTC)`, giving "Oct 6, 2026, 1:35:16 PM UTC".

**31.** `(student)/courses/[courseId]/page.tsx:117-118`: Attempts shows a bare "0" when there is no limit, next to rows showing "1 of 5". **Fix:** `${used} of ${limit ?? "unlimited"}` or "0 (no limit)".

**32.** `(admin)/admin/audit/page.tsx:118` "View" and `(admin)/research/participants/page.tsx:173` "Change" are bare `<summary>` labels repeated per row (C9). **Fix:** add an sr-only object, for example `View<span className="sr-only"> details for {row.action}</span>` and `Change<span className="sr-only"> condition for {participantId}</span>`.

**33.** Truncation in a few places:
- the faculty sidebar course select ("CSE 115 Introduction to"),
- the research nav ("Participants and conditi…"),
- the hint-level select ("L5 Strong directional hin"),
- the misconception topic tags on `/faculty` ("Recursive ba…").

**Fix:**
- Course select options show the code only (`CSE 115`), with the full title in the page meta.
- Shorten the nav label to "Participants".
- Give the hint select `min-w-56`.
- Drop the topic tag from the misconception rows on the overview, since it is visible on drilldown.

**34.** `faculty/analytics/page.tsx:52-53`: the default selection is the last assignment in the list, which is currently an empty E2E fixture, so the detail section opens on "Insufficient data" everywhere. **Fix:** default to the most recent assignment whose completion denominator is at or above the minimum group size, falling back to the last one.

**Not counted (environment):** the seeded dev database is full of `E2E Lists and loops 1791293…` and `E2E Review …` rows from Playwright runs. They dominate `/home`, `/faculty`, `/faculty/analytics` and `/faculty/insights` and make the product look unfinished in demos. The e2e suite should delete what it creates, or use a separate course.

**Wireframe deviations (documented, not counted):**
- Student Home is assignment-centric (Due next, Continue, Recent sessions, Suggested practice) instead of the wireframe's "What are you working through?" composer. This matches the PRD's assignment-first flow and is acceptable.
- The faculty dashboard uses one metric strip instead of 8 tiles, as the guardrails require.

---

## Checklist results (guardrails section 7)

| # | Item | Result | Evidence / finding |
|---|------|--------|--------------------|
| 1 | [block] No indigo/violet/purple/fuchsia | PASS | 0 grep hits |
| 2 | [block] No gradients | PASS | 0 hits |
| 3 | [block] No gradient text | PASS | 0 hits |
| 4 | No decorative blur/glow/patterns | PASS | only `backdrop:bg-fg/30` on the dialog scrim |
| 5 | Token classes only | FAIL (minor) | #3, #14 (`text-gray-*` in forbidden, placeholder, legacy files) |
| 6 | Accent only for action, selection, focus, Socra | PASS | |
| 7 | No rounded-xl+ | PASS | 0 hits; no `rounded-full` |
| 8 | No border+shadow on static cards | PASS | `shadow-pop` only on dialog, toast, user menu |
| 9 | No nested cards | PASS | spot-checked overview, preview, grading |
| 10 | IBM Plex Sans/Mono | PASS | `layout.tsx` next/font |
| 11 | One h1 at text-xl, no text-3xl+ | PASS | |
| 12 | Uppercase only in th and nav groups | FAIL (minor) | #11, #13 |
| 13 | tabular-nums on numbers | PASS | `TD numeric`, `Metric` |
| 14 | [block] No emoji | PASS | 0 hits |
| 15 | lucide only; no Sparkles/Bot/Wand | PASS | `TrendingUp` used for trajectory, see #17 |
| 16 | Icon-only buttons labelled; no icon tiles | PASS | dialog close labelled; mobile menu has text |
| 17 | [block] No banned phrases | PASS | "unlock" appears only literally ("does not unlock solutions") |
| 18 | No `!` in chrome | PASS | |
| 19 | No lorem/Acme/fixtures/hard-coded metrics | PASS | code clean; data pollution noted as environment |
| 20 | Verb+object labels | FAIL (minor) | #32 |
| 21 | Subtitles add scope | FAIL (major) | #3 placeholder subtitles; #19 |
| 22 | Topic states labelled, no judgmental words | PASS | `StateBadge` with full label and icon |
| 23 | No load animations; motion ≤200ms; reduced motion | PASS | `transition-colors 150ms`; global reduced-motion rule |
| 24 | No pulse/ping/bounce | PASS | static skeletons |
| 25 | Toasts justified | PASS | no `toast(` calls in scope |
| 26 | Modals limited and accessible | PASS | native `<dialog>`, labelled, focus return; used for lifecycle confirms |
| 27 | Records in semantic tables | PASS | |
| 28 | No dead controls/pages | FAIL (major) | #3 |
| 29 | Empty/loading/error states | PASS | `EmptyState`/`ErrorState`/`LoadingState` used; see #16 copy |
| 30 | [block] Tutor as labelled turns | N/A | workspace and practice out of scope this round |
| 31 | Hint meter visible | N/A | out of scope |
| 32 | Composer labelled, aria-live | N/A | out of scope |
| 33 | Policy line, refusals as turns | N/A (partial PASS) | `ModeBanner` exists; preview copy wrong, see #12 |
| 34 | [block] Denominators; small-n suppressed | PASS | `Metric`/`InlineMetric` show n and the minimum; see #6, #16 |
| 35 | No pie/donut/3D; direct labels | PASS | |
| 36 | Chart title, axes, ≤2 hues | FAIL (major) | #7 contrast, #9 tiny labels |
| 37 | No trend without baseline | FAIL (minor) | #17 |
| 38 | Anonymous scope line; no identity in analytics | PASS | the line appears on every analytics page |
| 39 | [block] Contrast AA (text 4.5, UI 3) | **FAIL (block)** | #1, #2 |
| 40 | [block] Keyboard and visible focus | PASS | global `:focus-visible` ring; tabs support arrow keys; skip link |
| 41 | Visible labels, errors tied | PASS | `Field` sets aria-describedby and aria-invalid; error role=alert |
| 42 | No meaning by color alone | PASS | badges carry text; pass/fail tests have text |
| 43 | Wireframe screens and regions | PARTIAL (minor) | assignment-centric home (documented); faculty nav missing Question insights, see #10 |
| 44 | Conflicting wireframe styling not copied | PASS | no slab buttons, eyebrows or tile grid |
| 45 | PRD screens beyond wireframe | PASS | privacy/transparency, learner profile and admin console all present and follow the shell |

**Totals:** 32 PASS, 8 FAIL, 1 PARTIAL, 4 N/A. The [block] items failing are 39 only, which covers findings #1 and #2.

## Re-verification plan
After the fixer lands the changes:
1. Re-run the section 2 greps.
2. Recompute the token contrasts.
3. Re-run `node .playwright-mcp/audit/shoot.cjs` and `err.cjs` (no console errors on the grading page or the student pages).
4. Re-check the specific pages: `/faculty` (recommendation, misconception meta, chart labels), the grading page for `sub_student1_cse115_hw3_1`, the preview of a closed assignment, and `/faculty/courses`, `/faculty/roster` and `/faculty/settings` (gone or redirected).

---

## Fixes applied

Round 1 fixer pass. Verified with `tsc --noEmit`, `eslint src` and `vitest run` (28 files, 319 tests, all passing). Files under `src/components/workspace|socra|practice`, the student assignment workspace route and `(student)/practice` were not touched; no finding lived there.

| # | Status | Change (file) |
|---|--------|---------------|
| 1 | fixed | `--color-fg-subtle: #626a68` (`src/app/globals.css`) |
| 2 | fixed | New `--color-border-input` (#858c8a light, #6b7472 dark); `control` class uses it (`src/components/ui/form.tsx`); raw filter inputs in admin/research pages and the course switcher also use it. Checkbox keeps native `accent-accent`. |
| 3 | fixed | `/faculty/courses`, `/roster`, `/settings` now `redirect("/faculty")`; nav entries removed (`src/app/_shell/nav.ts` already had none; `src/lib/navigation.ts` stripped to `primaryRoleLabel`). `page-placeholder.tsx` is now unused (see deferred note under 14). |
| 4 | fixed | `grading-form.tsx`: returned score, recorded override and rubric scores load into the form; returned questions show "Returned score X / max" read-only with "Regrade this question"; "Test points not recorded" instead of `?? 0`; update button disabled until a field changes, with helper text. Server guard in `src/server/domain/grading/service.ts` (`keepReturned`): a returned question with no rescoring input keeps its grade instead of being recomputed. |
| 5 | fixed | Key is `questionId:testId:index` (`grading-form.tsx`). Root cause of shared `testId` in the view model not investigated. |
| 6 | fixed | `aggregate.ts` `buildRecommendation`: rate, then numerator, then denominator descending; misconception named only when `numerator >= ANALYTICS_SMALL_N_THRESHOLD`. Same rule applied to the misconception list in `analytics/queries.ts` (rows below threshold are suppressed, so they are not named). |
| 7 | fixed | `--color-chart-2: #5f8f88` |
| 8 | fixed | Panel metas on `/faculty` state the denominator and window (pain points, unresolved, misconceptions). Metric definitions unchanged. |
| 9 | fixed | `charts.tsx`: ticks 11px, values/labels 12px; the "too few / n/d" row moved into each bar's `<title>`. |
| 10 | fixed | "Question insights" in the faculty nav with `FileQuestion` icon (`nav.ts`, `sidebar-nav.tsx`). |
| 11 | fixed | Sentence-case h3s in `faculty/assignments/[id]/preview/page.tsx`. |
| 12 | fixed | Preview uses `ModeBanner` with `bannerModeFor(view.mode)`; the protected-only sentence shows only in protected mode. |
| 13 | fixed | "AI mock mode", sans, in `dev-badge.tsx` and `components/shell/mock-mode-indicator.tsx` (also moved off raw amber classes). |
| 14 | partly fixed | `forbidden/page.tsx` uses `text-fg-muted`; area layouts no longer pass `nav`/`*_NAV`; `navigation.ts` no longer imports from `app-shell.tsx`. Deferred: deleting the dead files `src/components/auth/login-form.tsx`, `src/components/shell/app-shell.tsx`, `src/components/shell/page-placeholder.tsx` (file deletion was blocked in this run; nothing imports them any more). Also `nav?: unknown` in `area-shell.tsx` can be dropped. |
| 15 | fixed | `formatPercent` in `components/ui/format.ts`, used by `Metric` and `charts.tsx`; whole percents everywhere. |
| 16 | fixed | "No responses yet" when the denominator is 0 (`Metric`, `MetricText`, `DepthText`). |
| 17 | fixed | Column "Last 14 days", cell `title` "Compared with the 14 days before", trend icons removed (`profile/page.tsx`). |
| 18 | fixed | Next-step sentences no longer repeat the topic name (`topic-state.ts`); link reads "Practice" with an sr-only topic name. |
| 19 | fixed | `assignments/new/page.tsx` meta. |
| 20 | fixed | Closed state is the neutral tone. |
| 21 | fixed | `DateText` has a `fallback` prop; "No due date" and "Not submitted" in the faculty tables; materials "None" topics cell is "No topics". |
| 22 | fixed | `suppressHydrationWarning` on the `<time>` (`date-text.tsx`). |
| 23 | fixed | Faculty status label "Returned" (`submissions/page.tsx`). |
| 24 | fixed | Hidden tests use a neutral badge with a `Lock` icon and "Hidden". |
| 25 | fixed | Export form hides the repeated "No personal data." help and adds one sentence to the Fields intro (allowlist data unchanged, its unit test needs the strings). |
| 26 | fixed | `export-form.tsx` help text. |
| 27 | fixed | Per-import "View report" link and a per-row results table (`admin/roster/page.tsx`); API sentence removed. |
| 28 | fixed | Pluralized in `admin/jobs/page.tsx`. |
| 29 | fixed | Mode labels mapped in `admin/usage/page.tsx`. |
| 30 | fixed | Health page shows a formatted UTC timestamp. |
| 31 | fixed | "(no limit)" when there is no attempt limit (`courses/[courseId]/page.tsx`). |
| 32 | fixed | sr-only object text on audit "View" and participants "Change". |
| 33 | fixed | Course switcher shows the code only; research nav label "Participants"; hint select `min-w-56`; misconception topic tag dropped from the `/faculty` rows. |
| 34 | fixed | Analytics default selection is the newest assignment whose completion denominator reaches the threshold, else the last one. |

Environment item (E2E pollution): `tests/e2e/support/teardown.ts` archives every assignment titled "E2E..." (wired as `globalTeardown` in `playwright.config.ts`) and was run once, archiving 11 assignments in the dev DB. The faculty assignment list now hides ARCHIVED by default (`listAssignmentsForFaculty`, with a "Show archived" link); the student list, home, analytics overview and admin listing already excluded ARCHIVED.

Totals: 33 fixed, 1 partly fixed (14), 0 deferred findings other than the file deletions noted under 14.

---

## Phase 3: workspace

**Scope:** `src/components/workspace/**`, `src/components/socra/**`, `src/components/practice/**`, `src/app/(student)/courses/[courseId]/assignments/[assignmentId]/**` and `src/app/(student)/practice/**`. Also `src/server/domain/socra/sessions.ts`, because it supplies the panel's policy text.

**Method:**
1. Ran the section 2 greps over the 17 files.
2. Read the Socra panel, workspace, run console, editor and practice components in full.
3. Rendered the flows as student1 with Playwright at 1440×900 and 390×844 (`.playwright-mcp/audit/ws.cjs`, `ws2.cjs`; screenshots in `.playwright-mcp/audit/ws/`):
   - **HW4:** typed code, ran it, ran the public tests, asked Socra, asked for a hint. Attempts are exhausted (5 of 5), so the submit button is correctly disabled with "You have used all of your attempts". I therefore opened the submit dialog on **HW5** (2 of 5) instead and did not confirm it.
   - **HW3:** review mode, using "Explain the full solution".
   - **Quiz 2:** switched between questions 1, 2 and 3.
   - **/practice:** started a session and answered one item.
4. Checked keyboard behaviour (Tab order, the editor's Esc-then-Tab exit, dialog Escape and focus return) and live regions.

No console errors occurred.

### Summary

The tutor panel meets the section 5.8 spec in all its main points:
- **Turns:** full-width labelled turns ("You", "Your reasoning", "Socra · Level n, label"). Socra turns carry a 2px accent rule. There are no avatars, bubbles, typing dots, sparkle or bot icons, or "How can I help" copy.
- **Streaming:** a static "Socra is reading your work…" line and a real Stop button.
- **Citations:** "Course material used:" lists the sources.
- **Policy refusals:** shown as normal turns with a Lock line.
- **Accessibility:** the log is `role="log"`, the composer is labelled, and the send button has an accessible name.
- **Honest failure copy:** "Socra is unavailable. You can keep working and submit normally.", "Code runner is unavailable right now. Your work is saved.", and the limit message that refers students to their TA.
- **Save status:** specific ("Draft Saved 9:50 AM", "Offline, changes kept on this device"), with a real conflict resolver ("Keep mine" / "Use saved").
- **Submit dialog:** states the attempt number, how many questions changed, the draft status and the attempts left.
- **Editor:** the Esc-then-Tab exit works (focus lands on "Run code") and is shown in the editor toolbar.

The remaining problems are listed below.

| Severity | Count |
|----------|-------|
| block | 1 |
| major | 4 |
| minor | 15 |

Merge-blocking: **yes**, because of finding 35.

### Findings

**35. [block] Two hand-rolled textareas bypass the form-control fix and keep the 1.61:1 border.** `src/components/socra/socra-panel.tsx:501` (Socra composer) and `src/components/workspace/question-pane.tsx:358` (written-answer editor)
- **What's wrong:** both use `border-border-strong` directly, so the token fix for finding 2 (which changes `form.tsx`) will not reach them. Checklist 39.
- **Fix:** replace `border-border-strong` with `border-border-input` in both class strings, or render the UI `Textarea` component. Grep the scope for `border-border-strong` on any `input`, `textarea` or `select` after the fix.

**36. [major] The guidance meter ignores the assignment's hint cap, so students can't see how much help is left.** `src/components/socra/guidance-depth.tsx:29,33-42` and `socra-panel.tsx:340-343`
- **What's wrong:** it always shows "n of 6" with 7 segments. HW4 is capped at L5 by its policy, and faculty set this cap per assignment. "How Socra works" promises "the panel shows how far along you are" against that limit. Also, the text shows the *current* level while the segments fill to the *deepest* level reached, so the two can disagree.
- **Fix:**
  - Return `maxInterventionLevel` from `POST /api/socra/sessions` (`server/domain/socra/sessions.ts`, next to `policySummary`) and pass it to `GuidanceDepth`.
  - Render "Guidance depth: level {deepest} of {cap} on this assignment ({label})" with `cap + 1` segments.
  - Drop the separate "current" value.
  - At the cap, show "Next: ask your TA or instructor".

**37. [major] Socra copy talks about code on non-coding questions.** `src/server/domain/socra/sessions.ts:150` and `socra-panel.tsx:367`
- **What's wrong:** on Quiz 2 (multiple choice and written answers) the panel header says "Socra sees your code, your latest run, public test results…". The empty state says "Describe what you expect your code to do… Socra reads your current code". The footer correctly says "the assignment prompt, and your current answer", so the panel contradicts itself.
- **Fix:**
  - Pass the question type to `policySummaryFor(mode, directHelp, questionType)`. For MULTIPLE_CHOICE and WRITTEN use: "Socra sees the question and your current answer. It asks questions and gives hints but will not choose or write the answer for you."
  - In `socra-panel.tsx`, add a `questionType` prop. For non-code questions the empty state becomes: "Say which option you are unsure about and why, or explain your reasoning so far."

**38. [major] Socra replies lose their line breaks.** `src/components/workspace/markdown.tsx:36`
- **What's wrong:** `ReactMarkdown` without `remark-breaks` collapses single newlines. In HW3 review, a line-by-line solution walkthrough ("Line 1: … Line 2: … Line 3: …") renders as one dense paragraph, which defeats the purpose of review mode.
- **Fix:** add a `breaks` prop that enables `remark-breaks` (`<ReactMarkdown remarkPlugins={breaks ? [remarkBreaks] : []}>`), and pass `breaks` from the Socra turn renderer (`socra-panel.tsx:408`). Leave prompts unchanged.

**39. [major] The public-test table dumps harness internals and breaks identifiers mid-word.** `src/components/workspace/run-console.tsx:139-170`
- **What's wrong:**
  - For a submission that doesn't define `running_totals`, every row's Actual cell shows the full traceback, including `/opt/socra/harness.py`, `getattr(m, spec_in["entryPoint"])` and the `^^^^` markers.
  - `break-all` splits `running_t|otals`.
  - The Test and Input columns repeat the same call.
  - Socra then quotes the harness traceback back to the student.
- **Fix:**
  - (a) Strip harness frames in the runner result, so only frames from the student's file remain.
  - (b) When every test fails with the same error, show one line above the table, e.g. "Your code does not define `running_totals(nums)`. The tests call that function.", and put each row's error behind a `<details>` "Show error".
  - (c) Replace `break-all` with `[overflow-wrap:anywhere]`.
  - (d) Drop the Input column when it equals the test name.

**40. [minor] Editor line numbers drift from wrapped lines at phone width.** `src/components/workspace/code-editor.tsx` (`EditorView.lineWrapping`)
- **What's wrong:** at 390px the gutter numbers stack tightly while the wrapped code lines run longer, so a number no longer sits next to its line.
- **Fix:** re-measure after the web font loads (`document.fonts.ready.then(() => view.requestMeasure())`), or disable `lineWrapping` below `md` and let the editor scroll horizontally.

**41. [minor] Odd composer shortcut copy.** `socra-panel.tsx:492-495,505`
- **What's wrong:** "Enter or Ctrl+Shift+Enter sends" advertises a redundant chord.
- **Fix:** remove the Ctrl+Shift+Enter branch and change the help text to "Enter sends. Shift+Enter adds a line."

**42. [minor] `joinList` puts a comma before "and" when there are only two items.** `socra-panel.tsx:538-541`
- **What's wrong:** "the assignment prompt, and your current answer".
- **Fix:** `if (items.length === 2) return items.join(" and ");`.

**43. [minor] The policy statement appears twice in different words.** `sessions.ts:145`, `socra-panel.tsx:337-339`
- **What's wrong:**
  - On assignments, the page banner ("Socra can help you reason, debug…") and the panel header give two different policy sentences.
  - In practice, the header reads "Socra · Practice mode" followed by "Practice mode: Socra can explain…".
- **Fix:**
  - Drop the "Practice mode: " prefix from the practice summary.
  - On assignment pages, where the `ModeBanner` already states the policy, show only the context sentence in the panel header, e.g. "Sees your code, latest run and public test results."

**44. [minor] The guidance meter is shown in review mode ("Guidance depth: none yet").** `socra-panel.tsx:340`
- **Fix:** render it only when `mode === "PROTECTED_ASSESSMENT"`.

**45. [minor] Closed assignments still show a disabled "Resubmit assignment" button and "Attempts left 4".** `assignment-workspace.tsx:296-304`, `workspace/mode-banner.tsx:84-89`
- **Fix:** when closed, hide the submit button and the attempts item. Keep the existing line "This assignment is closed, so new submissions are not accepted."

**46. [minor] With no attempts left, the editor still edits and autosaves with no hint that the draft can't be submitted (HW4, Quiz 2).** `workspace/mode-banner.tsx`
- **Fix:** when `attemptsLeft === 0` and the assignment is not closed, add this line to the banner: "No attempts left. You can keep editing and running code, but changes will not be submitted."

**47. [minor] The practice item heading is the item type ("Short answer") instead of the question.** `src/components/practice/practice-session.tsx:309`
- **Fix:** make the h2 "Question {n}" and move the type into the meta line ("Question 1 · Functions · Short answer · difficulty 2 of 5").

**48. [minor] The practice "Explanation" box reuses the Socra-turn treatment (accent rule plus accent-subtle).** `practice-session.tsx:475-480`
- **Fix:** use `border-border bg-surface-2 border-l-2` with a `text-fg-muted` label, so the accent rule stays reserved for Socra's voice (guardrails section 3, principle 1).

**49. [minor] The practice list's "Status" column holds action links.** `src/app/(student)/practice/page.tsx:75,94`
- **Fix:** add a Status cell ("In progress" or "Finished") and a separate unlabelled action column with "Continue" or "View summary", giving each link an sr-only object.

**50. [minor] Run controls sit under the editor rather than in its toolbar (guardrails 5.7).** `question-pane.tsx:230-283`
- **Fix:** move "Run code" and "Run public tests" into the right side of the 36px editor header row, and move the shortcut hint to helper text under the editor. Lower priority; the current layout works.

**51. [minor] Hard-coded hex colours in the editor syntax theme (`#2c6a3f`, `#535b59`, …) will not follow the dark tokens.** `code-editor.tsx` (the `highlight` and `tokenTheme` definitions)
- **Fix:** use `var(--color-…)` values.

**52. [minor] `text-[13px]` literal instead of the `text-code` token in 9 places.**
- **Where:** `markdown.tsx:26`, `run-console.tsx:76,83,133,164,165,168`, `question-pane.tsx:181`, `practice-session.tsx:324,454`.
- **Fix:** replace each with `text-code`.

**53. [minor] On narrow screens the Socra panel is about 1500px below the fold, after the submit section, with no shortcut to it.**
- **Where:** `assignment-workspace.tsx:313-338`.
- **Fix:** below `xl`, add an "Ask Socra" link in the question header that jumps to the composer (give the textarea an `id` and focus it on click).

**54. [minor] The submit dialog opens with focus on the close (×) button.** `src/components/ui/dialog.tsx`
- **Fix:** add an `initialFocus` ref option, and pass the "Keep working" button from `assignment-workspace.tsx` so Enter on open does nothing destructive.

### Checklist items previously N/A

| # | Item | Result | Evidence / finding |
|---|------|--------|--------------------|
| 30 | [block] Tutor as labelled turns, no chatbot tells | PASS | Full-width `article`s labelled You / Your reasoning / Socra; no avatars, bubbles, typing dots or bot icon |
| 31 | Hint meter visible with text; hint requests explicit | FAIL (major) | "Ask for a hint" is explicit, but the meter shows "of 6" and ignores the assignment cap (#36) |
| 32 | Composer labelled, Enter/Shift+Enter documented, send labelled, aria-live | PASS | Visible label "Message to Socra", help text, `aria-label="Send to Socra"`, `role="log" aria-live="polite"`; copy nit in #41 |
| 33 | Policy line at top; refusals as normal turns | PASS | `ModeBanner` plus panel header; refusals render a Lock line inside the Socra turn; duplication noted in #43 |

Re-checked for this scope:
- **Item 39 (contrast):** FAIL (block), #35.
- **Item 40 (keyboard):** PASS. Esc then Tab leaves the editor; the dialog's Escape closes it and returns focus to the submit button.
- **Item 23 (motion):** PASS. No animation.
- **Item 25 (toasts):** PASS. None.
- **Item 26 (modals):** PASS. Submit confirmation only.
- **Item 29 (states):** PASS. Empty, running, runner-unavailable, Socra-unavailable, limit, offline and conflict are all handled with specific copy.

### Re-verification
Re-run `node .playwright-mcp/audit/ws.cjs` and `ws2.cjs` (with `MSYS_NO_PATHCONV=1`) and check:
1. The composer border is at least 3:1.
2. The meter shows the cap on HW4.
3. The Quiz 2 panel copy no longer mentions code.
4. The HW3 review reply keeps its line breaks.
5. The HW4 test table shows a single "does not define running_totals" line with no `/opt/socra` paths.

### Phase 3 fixes applied

| # | Status | What changed |
|---|--------|--------------|
| 35 | Fixed | Composer textarea now uses `border-border-input` (`socra-panel.tsx`). The written-answer textarea in `question-pane.tsx:358` also uses `border-border-input` now. |
| 36 | Fixed | `POST /api/socra/sessions` returns `maxInterventionLevel` (policy cap, additive). The meter reads "Deepest level reached: Level X of cap, label", draws cap+1 segments from the same value, shows "Next: ask your TA or instructor" at the cap, and is hidden outside protected-assessment mode (also covers #44). |
| 37 | Fixed | `policySummaryFor(mode, directHelp, questionType)` returns non-code copy for non-coding questions; the panel takes `questionType` and uses the non-code empty state. |
| 38 | Fixed | `Markdown` has a `breaks` prop (`withHardBreaks`, no plugin, fenced code untouched); used for Socra turns only. Unit-tested. |
| 39 | Fixed | `scrubHarnessText` / `scrubHarnessOutput` in `server/runner/types.ts` strip `/opt/socra/` frames and `spec_in` lines from stderr and test actual/message; applied in `toStudentRunResult` and before the run is recorded, so Socra sees the clean text. The console shows a one-line error summary with "Show error", collapses identical errors into one line above the table, drops the Input column when it duplicates the test name, and uses `[overflow-wrap:anywhere]` instead of `break-all`. |
| 41 | Fixed | Help text is "Enter sends. Shift+Enter adds a line."; redundant chord removed. |
| 42 | Fixed | Two-item lists join with " and ". |
| 43 | Partly fixed | "Practice mode:" prefix removed from the practice summary. The assignment-page duplicate policy sentence is not trimmed. |
| 44 | Fixed | See #36. |
| 45 | Fixed | Closed assignments hide the submit button and the "Attempts left" item. |
| 46 | Fixed | "No attempts left. You can keep editing and running code, but changes will not be submitted." in the banner when attempts are 0 and the assignment is open. |
| 52 | Fixed | `text-[13px]` replaced by `text-code` in markdown, run-console, question-pane and practice-session. |
| 53 | Fixed | "Jump to Socra" link below `xl` targeting `#socra-panel`. |
| 54 | Fixed | `Dialog` takes an `initialFocus` ref (Button accepts `ref`); the submit dialog focuses "Keep working". |
| 40, 47, 48, 49 | Deferred | Not attempted (time). |
| 50 | Deferred | Moving run buttons into the editor toolbar (larger refactor). |
| 51 | Deferred | Tokenized syntax theme in the editor (larger refactor). |

E2E isolation: the Playwright suite now uses only `student30@socra.local` (`USERS.student`), enrols it in CSE 115 and CSE 116 on first use (it was only in CSE 116), and the global teardown deletes its Submissions (cascading answers and grades) and Drafts, and resets AssignmentProgress, for student28-30 in the seeded courses. Append-only tables are never touched. student1-3 are no longer used by any spec. The profile assertion now checks the page heading, because a fresh account has no topic rows.
