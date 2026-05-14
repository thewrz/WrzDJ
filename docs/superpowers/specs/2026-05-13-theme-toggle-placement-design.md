# Theme Toggle Placement & IdentityBar Dark Fix

**Date:** 2026-05-13  
**Author:** thewrz  
**Status:** Approved

---

## Problem

Two theming inconsistencies to fix:

1. **Admin ThemeToggle in wrong location** — currently renders in the admin sidebar footer; should be in the upper right next to the help button, consistent with the DJ layout.

2. **IdentityBar flashes white on guest pages** — `/join/[code]` and `/collect/[code]` use hardcoded dark backgrounds (`#06060a`, `#0a0a12`) but `IdentityBar` uses CSS variables. In day mode, `var(--card)` resolves to `#ffffff`, producing a bright white bar over a dark page.

---

## Out of Scope

- No ThemeToggle on `/login`, `/register`, `/pending`, `/kiosk-pair`, `/kiosk-link` — these pages intentionally have no toggle
- No changes to guest tower styling or kiosk display pages
- No changes to the DJ `(dj)/layout.tsx` — ThemeToggle already correctly positioned there

---

## Design

### Change 1 — Admin ThemeToggle relocation

**File:** `dashboard/app/admin/layout.tsx`

- Remove `<ThemeToggle />` from inside `admin-sidebar-footer` div
- Add `<ThemeToggle />` at fixed position `top: 1rem, right: 4.5rem` (same as `(dj)/layout.tsx`)

No new components. One line removed, one added.

### Change 2 — IdentityBar `forceDark` prop

**Files:**
- `dashboard/components/IdentityBar.tsx`
- `dashboard/app/join/[code]/page.tsx`
- `dashboard/app/collect/[code]/page.tsx`

Add `forceDark?: boolean` prop to `IdentityBar`. When `true`, replace CSS variable references with their dark-theme resolved values:

| CSS var | Hardcoded fallback |
|---|---|
| `var(--card)` | `#1a1a1a` |
| `var(--text-secondary)` | `#9ca3af` |
| `var(--color-success)` | (keep CSS var — success green is legible on dark) |
| `var(--color-link)` | (keep CSS var — link blue is legible on dark) |
| border `var(--border-subtle)` | `rgba(255,255,255,0.08)` |

Both `/join/[code]/page.tsx` and `/collect/[code]/page.tsx` pass `forceDark={true}` at their IdentityBar render sites.

Default behavior (`forceDark` omitted or `false`) unchanged — all other consumers get normal CSS-var theming.

---

## Files Changed

| File | Change |
|---|---|
| `dashboard/app/admin/layout.tsx` | Move ThemeToggle from sidebar footer to fixed top-right |
| `dashboard/components/IdentityBar.tsx` | Add `forceDark` prop, swap CSS vars when true |
| `dashboard/app/join/[code]/page.tsx` | Pass `forceDark={true}` to IdentityBar |
| `dashboard/app/collect/[code]/page.tsx` | Pass `forceDark={true}` to IdentityBar |

---

## Testing

- Switch to day mode → visit `/admin/*` — toggle visible top-right, not in sidebar footer
- Switch to day mode → visit `/join/[code]` — IdentityBar stays dark, no white flash
- Switch to day mode → visit `/collect/[code]` — same
- Dark mode: verify all pages unchanged
- High-contrast mode: verify all pages unchanged
- DJ layout: verify toggle still present top-right, unaffected
