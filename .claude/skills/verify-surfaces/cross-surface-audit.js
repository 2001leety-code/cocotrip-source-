// Reusable cross-surface integration audit for the CocoTrip web planner.
// Invoke (from the verify-surfaces skill):
//   Workflow({ scriptPath: '<repoRoot>/.claude/skills/verify-surfaces/cross-surface-audit.js',
//              args: { repoRoot: '<repoRoot>', change: '<what changed>' } })
//
//   args.repoRoot = absolute path to the web-planner repo root (from `git rev-parse --show-toplevel`).
//                   No hardcoded path — the skill discovers it and passes it in.
//   args.change   = short description of what changed. If omitted, agents inspect `git diff`.
//   (args may also be a plain string — treated as `change`, repoRoot then discovered by agents.)
//
// Checks whether a plan-page change propagates correctly across ALL surfaces
// (PDF, email, share/OG, edit-mode, other components). Read-only (Explore agents); produces a gap list.
export const meta = {
  name: 'cross-surface-audit',
  description: 'Audit whether a plan-page change propagates across PDF / email / share-OG / edit-mode / undefined-sweep / component-robustness — find gaps & inconsistencies (read-only)',
  whenToUse: 'After changing plan-detail or planner UI, before merge — to catch surfaces the screen change forgot (PDF, email, share, etc.)',
  phases: [{ title: 'Audit', detail: 'parallel read-only audit per surface' }],
}

// Accept object or string form; never hardcode an absolute path.
const REPO = (args && typeof args === 'object' && args.repoRoot)
  ? args.repoRoot
  : 'the web-planner repo root (run `git rev-parse --show-toplevel` from the repo; it contains api/ai-planner-full.js)'

const CHANGE = (args && typeof args === 'object')
  ? (args.change || 'the most recent changes (inspect `git diff` and recent commits to learn what changed)')
  : (args || 'the most recent changes (inspect `git diff` and recent commits to learn what changed)')

const CONTEXT = `Repo root: ${REPO} (React/Vite + serverless api/). Use \`git -C "<repoRoot>"\` for git and read files by absolute path under that root. A plan-page change was made:
=== CHANGE UNDER AUDIT ===
${CHANGE}
===
Surfaces render the plan via SEPARATE code paths, so a screen-only change often does NOT propagate. Find where this change needs to reach but DOESN'T, or where it introduces a new gap/inconsistency/break. You are READ-ONLY: report findings, do not edit. Verify claims against the ACTUAL files — do not assert the existence of a file, rewrite rule, or dead-code status without reading it.`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    surface: { type: 'string' },
    summary: { type: 'string', description: 'one-line status of this surface vs the change' },
    notVerified: { type: 'string', description: 'what could NOT be proven offline for this surface (external APIs, live crawler, real payment) — empty if nothing' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'med', 'low'] },
          where: { type: 'string', description: 'file:line' },
          detail: { type: 'string' },
          fix: { type: 'string', description: 'concrete recommended fix (advice only — read-only run)' },
        },
        required: ['title', 'severity', 'where', 'detail', 'fix'],
      },
    },
  },
  required: ['surface', 'summary', 'findings'],
}

phase('Audit')

const AUDITS = [
  { surface: 'PDF', focus: `Audit src/pages/PlanDetailPage/pdfGenerator.ts — it builds its OWN HTML string (container.innerHTML; days.forEach), NOT the React components. Does the change appear in the PDF? html2canvas can't capture interactive Leaflet — visual additions need a STATIC image. Also check the PDF's own header/pax rendering for "undefined" or parity drift vs the screen.` },
  { surface: 'Email', focus: `Audit the LIVE confirmation email builder (find it under api/ — e.g. api/_send-email.js / api/_email-renderer.js; read to confirm which function is actually wired). Does the change reach the email? Schema gotcha: email may read a different field shape than the stored plan (e.g. day.places vs day.stops). Report any "undefined" / missing-itinerary / map gap. If a renderer looks unused, VERIFY by grep before calling it dead.` },
  { surface: 'Share / OG / public plan view', focus: `Audit ShareButton.tsx, api/og-image.js, and the public/non-owner plan render path (e.g. via /api/get-plan with PII masking). READ vercel.json to see how og-image.js is actually invoked (rewrites/headers) — do NOT assume a User-Agent/crawler rewrite exists; report what the config actually does. Does the change reach shared/public viewers? Does PII masking strip data the change needs? Note: the social-crawler OG card can only be fully proven with a live deploy — flag that as notVerified.` },
  { surface: 'Edit mode + interaction', focus: `Audit DayTimeline.tsx (edit toggle, dnd-kit), hooks/usePlanEditor.ts, SwipeContainer.tsx. If the change is a component on the day, does it re-render on add/delete/reorder stops? Does it interfere with dnd-kit drag, the swipe carousel, or page pan-y scroll? Does lazy-init (IntersectionObserver) misbehave in edit mode?` },
  { surface: 'undefined / unguarded-display sweep', focus: `Sweep the slides/cards (Intro/Outro/PreTrip, StopCard, DayTimeline, RecommendedRestaurants, ActivityGuide), planToMarkdown.ts, and the PDF + email builders for places that render user-input fields (pax/adults/children/vehicle/dates/names/area) WITHOUT guarding undefined/null/object — i.e. could print literal "undefined" or "[object Object]". Report each unguarded render + fix.` },
  { surface: 'New-component robustness (plan types, mobile, i18n, external deps)', focus: `If the change adds/edits a component: does it handle block_mode + legacy + missing-data plans (graceful null, no crash)? Mobile viewport + touch (does it trap page scroll)? Are its strings in the i18n JSON (ko/en/ja/zh), not hardcoded? Any external dependency (tiles/api) that fails silently when down/blocked (CSP/offline)? Report robustness gaps.` },
]

const results = await parallel(AUDITS.map((a) => () =>
  agent(`${CONTEXT}\n\n=== YOUR AUDIT SURFACE: ${a.surface} ===\n${a.focus}\n\nRead the ACTUAL files. Report only real gaps/risks/inconsistencies (not speculation). If the surface is fine for this change, say so in summary with an empty findings array. Put anything you could NOT prove offline in notVerified.`,
    { label: `audit:${a.surface}`, agentType: 'Explore', schema: SCHEMA })
))

return results.filter(Boolean)
