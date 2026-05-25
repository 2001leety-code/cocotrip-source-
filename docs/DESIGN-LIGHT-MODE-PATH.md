# Light Mode Expansion Path (2026-05-24)

> Mirror of memory SSOT `project_cocotrip_design_ssot.md` — Light mode 2-layer token section.
> PR #583 follow-up. Operator decision required before activation.

## Background

PR #583 (2026-05-24) added Motion / Z-index / Primitive token spec.
External audit identified a follow-up gap:

> "Light mode expansion path: no semantic vs raw 2-layer separation → adding light mode would break `bg.base` meaning"

Currently `bg.base = #0a0f1e` (dark navy). If light mode is added without 2-layer separation, any component that uses `bg.base` would need a manual hex change — error-prone and non-scalable.

---

## Token 2-Layer Design

### Layer 1 — Raw (Tailwind Palette)

Color primitives, no semantic meaning. Reference via Tailwind classes or `theme()`:

| Raw token        | Hex       | Tailwind        |
|------------------|-----------|-----------------|
| `slate-950`      | `#0a0f1e` | `bg-slate-950`  |
| `slate-900`      | `#111827` | `bg-slate-900`  |
| `slate-800`      | `#1e293b` | `bg-slate-800`  |
| `slate-50`       | `#f8fafc` | `bg-slate-50`   |
| `slate-100`      | `#f1f5f9` | `bg-slate-100`  |
| `slate-200`      | `#e2e8f0` | `bg-slate-200`  |
| `purple-600`     | `#7c3aed` | `text-purple-600` |
| `pink-500`       | `#ec4899` | `text-pink-500` |

### Layer 2 — Semantic (CSS Variables)

Meaning-based tokens that resolve differently per theme. Components should reference these, not raw hex.

```css
/* Dark mode (current / default) — already in src/index.css */
:root.dark, .dark {
  --color-bg-base:        hsl(222 73% 7.3%);   /* slate-950 #0a0f1e */
  --color-bg-card:        hsl(222 47% 11.2%);  /* slate-900 #111827 */
  --color-bg-elevated:    hsl(220 40% 16.7%);  /* #1a2235           */

  --color-text-primary:   hsl(210 40% 96.1%);  /* slate-100 #f1f5f9 */
  --color-text-secondary: hsl(215 14% 60%);    /* slate-400 #94a3b8 */
  --color-text-muted:     hsl(215 15% 55%);    /* #7c8a9e WCAG AA ✅ */

  --color-border:         hsl(215 28% 17%);    /* #1e293b */
  --color-brand-purple:   hsl(262 83% 58%);    /* #7c3aed */
  --color-brand-pink:     hsl(330 81% 60%);    /* #ec4899 */
}

/* Light mode (COMMENTED OUT — activate after operator decision)
:root:not(.dark) {
  --color-bg-base:        hsl(210 40% 98%);    /* slate-50   #f8fafc */
  --color-bg-card:        hsl(0 0% 100%);      /* white      #ffffff */
  --color-bg-elevated:    hsl(210 40% 96.1%);  /* slate-100  #f1f5f9 */

  --color-text-primary:   hsl(222 47% 11.2%);  /* slate-900  #0f172a */
  --color-text-secondary: hsl(215 16% 47%);    /* slate-500  #64748b */
  --color-text-muted:     hsl(215 14% 34%);    /* slate-600  #475569 */

  --color-border:         hsl(214 32% 91%);    /* slate-200  #e2e8f0 */
  --color-brand-purple:   hsl(262 83% 58%);    /* purple-600 #7c3aed (same) */
}
*/
```

---

## Component Migration Pattern

When light mode is activated, components should switch from:

```tsx
// Before (raw hex — breaks in light mode)
<div className="bg-[#0a0f1e] text-[#f1f5f9]">

// After (semantic var — theme-aware)
<div style={{ background: 'var(--color-bg-base)', color: 'var(--color-text-primary)' }}>
// or via Tailwind custom utility (after tailwind.config.js extension):
<div className="bg-bg-base text-text-primary">
```

---

## Token Comparison Table

| Semantic Token      | Dark value (`#`) | Light value (`#`) | Purpose              |
|---------------------|------------------|-------------------|----------------------|
| `--color-bg-base`   | `#0a0f1e`        | `#f8fafc`         | Page background      |
| `--color-bg-card`   | `#111827`        | `#ffffff`         | Card / panel / modal |
| `--color-bg-elevated`| `#1a2235`       | `#f1f5f9`         | Hover / sidebar / input |
| `--color-text-primary`| `#f1f5f9`      | `#0f172a`         | Body text            |
| `--color-text-secondary`| `#94a3b8`   | `#64748b`         | Supporting text      |
| `--color-text-muted`| `#7c8a9e`        | `#475569`         | Placeholder / caption|
| `--color-border`    | `#1e293b`        | `#e2e8f0`         | Dividers / outlines  |
| `--color-brand-purple`| `#7c3aed`      | `#7c3aed`         | CTA / active nav (same) |

---

## Phased Activation Plan (Operator Decision Required)

### Phase 0 — Current (dark only)
- `<html class="dark">` fixed in `src/main.tsx`
- All semantic vars are set; light vars are stubbed but commented out
- **No action needed** — everything works as before

### Phase 1 — Partial (specific pages)
Activate light mode on admin pages only (operator currently wants admin to stay light):
```tsx
// Admin entry point — remove dark class for admin routes
if (isAdminRoute) {
  document.documentElement.classList.remove('dark');
} else {
  document.documentElement.classList.add('dark');
}
```
Uncomment `:root:not(.dark)` block in `src/index.css`.

### Phase 2 — Full (user-toggle)
Add theme toggle button to header. Persist preference to `localStorage`:
```tsx
const [theme, setTheme] = useLocalStorage<'dark' | 'light'>('cocotrip-theme', 'dark');
useEffect(() => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}, [theme]);
```

### Phase 3 — System preference
Respect `prefers-color-scheme` as default, allow override:
```tsx
const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const savedTheme = localStorage.getItem('cocotrip-theme');
const initialTheme = savedTheme ?? (systemDark ? 'dark' : 'light');
```

---

## What This PR Does NOT Do

- Does NOT activate light mode (operator decision pending)
- Does NOT change any existing dark token values
- Does NOT migrate components from raw hex to semantic vars (separate PR per component)

---

## Files Changed

| File | Change |
|------|--------|
| `src/index.css` | Added dark semantic var block + commented light stub |
| `docs/DESIGN-LIGHT-MODE-PATH.md` | This file — operator guide |
| Memory SSOT `project_cocotrip_design_ssot.md` | Added "토큰 2-layer 분리" section |

---

**Related memory**: `project_cocotrip_design_ssot.md` — "토큰 2-layer 분리 (Light mode 확장 path)" section.
