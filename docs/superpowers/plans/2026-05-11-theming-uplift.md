# Theming Uplift & Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded colors across DJ/admin pages with a 37-token CSS variable system that makes dark, high-contrast, and true light-mode (daylight) themes work correctly.

**Architecture:** Two PRs. PR1 expands `theme-vars.ts` and fixes `globals.css` only — zero visual change on merge. PR2 moves DJ pages into a Next.js route group with a shared layout containing ThemeToggle, replaces all inline TSX style colors, and fills the daylight token values to ship working light mode.

**Tech Stack:** Next.js 16 App Router (route groups), React 19, TypeScript, vanilla CSS custom properties, Vitest, `dashboard/lib/theme-vars.ts` (existing), `dashboard/app/globals.css` (existing)

---

## File Map

### PR1 files
| File | Action |
|---|---|
| `dashboard/lib/__tests__/theme-vars.test.ts` | Modify — update regex + expectations for 37 tokens |
| `dashboard/lib/theme-vars.ts` | Modify — expand 6 → 37 tokens |
| `dashboard/app/globals.css` | Modify — ~45 hardcoded color replacements |

### PR2 files
| File | Action |
|---|---|
| `dashboard/app/(dj)/layout.tsx` | Create — route group layout with ThemeToggle |
| `dashboard/app/(dj)/events/` | Move from `app/events/` (entire dir, URL unchanged) |
| `dashboard/app/(dj)/account/page.tsx` | Move from `app/account/page.tsx` |
| `dashboard/app/(dj)/account/__tests__/page.test.tsx` | Move from `app/account/__tests__/page.test.tsx` |
| `dashboard/app/account/confirm-email/` | **Do not move** — public page, stays at top level |
| `dashboard/app/events/[code]/page.tsx` | Modify — remove manual ThemeToggle (now in layout) |
| `dashboard/app/admin/layout.tsx` | Modify — add ThemeToggle to sidebar footer |
| `dashboard/components/ThemeToggle.tsx` | Modify — relabel "daylight" → "Day" |
| `dashboard/lib/theme-vars.ts` | Modify — fill complete daylight + HC values |
| ~30 TSX files in `app/(dj)/` + `app/admin/` | Modify — replace inline style hardcoded colors |

---

## Token Reference (37 vars)

> One spec gap discovered during planning: `.badge-accepted` uses `#8b5cf6` (violet-500), not covered by any spec token. Adding `--color-status-accepted` as tier-3 token (37 total, not 36).

### Tier 1 — Surfaces & Structure (9 vars)
```
--bg:              dark #0a0a0a  | hc #000000  | day #f8fafc
--card:            dark #1a1a1a  | hc #111111  | day #ffffff
--surface-raised:  dark #111111  | hc #0a0a0a  | day #f1f5f9
--text:            dark #ededed  | hc #ffffff  | day #0f172a
--text-secondary:  dark #9ca3af  | hc #d1d5db  | day #475569
--text-tertiary:   dark #6b7280  | hc #9ca3af  | day #64748b
--border:          dark #333333  | hc #555555  | day #e2e8f0
--border-subtle:   dark #222222  | hc #333333  | day #f1f5f9
--color-overlay:   dark rgba(0,0,0,0.7) | hc rgba(0,0,0,0.85) | day rgba(0,0,0,0.5)
```

### Tier 2 — Semantic Actions (14 vars)
```
--color-primary:        dark #3b82f6 | hc #60a5fa | day #2563eb
--color-primary-hover:  dark #2563eb | hc #3b82f6 | day #1d4ed8
--color-primary-subtle: dark rgba(59,130,246,0.12) | hc rgba(59,130,246,0.2) | day rgba(37,99,235,0.1)
--color-danger:         dark #ef4444 | hc #f87171 | day #dc2626
--color-danger-hover:   dark #dc2626 | hc #ef4444 | day #b91c1c
--color-danger-subtle:  dark rgba(239,68,68,0.12) | hc rgba(239,68,68,0.2)  | day rgba(220,38,38,0.1)
--color-success:        dark #22c55e | hc #4ade80 | day #16a34a
--color-success-hover:  dark #16a34a | hc #22c55e | day #15803d
--color-success-subtle: dark rgba(34,197,94,0.12) | hc rgba(34,197,94,0.2)  | day rgba(22,163,74,0.1)
--color-warning:        dark #f59e0b | hc #fbbf24 | day #d97706
--color-warning-hover:  dark #d97706 | hc #f59e0b | day #b45309
--color-warning-subtle: dark rgba(245,158,11,0.12) | hc rgba(245,158,11,0.2) | day rgba(245,158,11,0.1)
--color-admin:          dark #6b21a8 | hc #7c3aed | day #7c3aed
--color-admin-subtle:   dark rgba(107,33,168,0.15) | hc rgba(124,58,237,0.2) | day rgba(124,58,237,0.1)
```

### Tier 3 — Named UI Roles (14 vars)
```
--color-link:             dark #60a5fa | hc #93c5fd | day #2563eb
--color-nickname-accent:  dark #a78bfa | hc #c4b5fd | day #7c3aed
--color-code-accent:      dark #3b82f6 | hc #60a5fa | day #2563eb
--color-focus-ring:       dark rgba(59,130,246,0.4) | hc rgba(59,130,246,0.6) | day rgba(37,99,235,0.3)
--color-scrollbar:        dark #444444 | hc #666666 | day #cbd5e1
--color-log-info-bg:      dark #1e3a5f | hc #1e3a5f | day #dbeafe
--color-log-info-text:    dark #60a5fa | hc #93c5fd | day #1d4ed8
--color-log-warning-bg:   dark #78350f | hc #92400e | day #fef3c7
--color-log-warning-text: dark #fbbf24 | hc #fde68a | day #92400e
--color-log-error-bg:     dark #7f1d1d | hc #991b1b | day #fee2e2
--color-log-error-text:   dark #f87171 | hc #fca5a5 | day #991b1b
--color-accent-checkbox:  dark #3b82f6 | hc #60a5fa | day #2563eb
--color-live-badge:       dark #ef4444 | hc #f87171 | day #dc2626
--color-status-accepted:  dark #8b5cf6 | hc #a78bfa | day #7c3aed
```

---

# Phase 1 — PR1: Token Foundation + globals.css

---

## Task 1: Update theme-vars tests for the expanded token set

**Files:**
- Modify: `dashboard/lib/__tests__/theme-vars.test.ts`

The existing test uses `CSS_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/` which only matches hex. New tokens include `rgba()` values. The existing daylight test expects old values. Both must be fixed before expanding the token set.

- [ ] **Step 1: Update the test file**

Replace the full contents of `dashboard/lib/__tests__/theme-vars.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { getThemeVars, THEMES, type Theme } from '../theme-vars';

// Matches #rgb, #rrggbb, #rrggbbaa, and rgba(...) / rgb(...)
const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))$/;

const EXPECTED_TOKENS = [
  // Tier 1
  '--bg', '--card', '--surface-raised',
  '--text', '--text-secondary', '--text-tertiary',
  '--border', '--border-subtle', '--color-overlay',
  // Tier 2
  '--color-primary', '--color-primary-hover', '--color-primary-subtle',
  '--color-danger', '--color-danger-hover', '--color-danger-subtle',
  '--color-success', '--color-success-hover', '--color-success-subtle',
  '--color-warning', '--color-warning-hover', '--color-warning-subtle',
  '--color-admin', '--color-admin-subtle',
  // Tier 3
  '--color-link', '--color-nickname-accent', '--color-code-accent',
  '--color-focus-ring', '--color-scrollbar',
  '--color-log-info-bg', '--color-log-info-text',
  '--color-log-warning-bg', '--color-log-warning-text',
  '--color-log-error-bg', '--color-log-error-text',
  '--color-accent-checkbox', '--color-live-badge', '--color-status-accepted',
] as const;

describe('getThemeVars', () => {
  describe('returns correct variable maps for each theme', () => {
    it('returns dark theme surface values', () => {
      const vars = getThemeVars('dark');
      expect(vars['--bg']).toBe('#0a0a0a');
      expect(vars['--card']).toBe('#1a1a1a');
      expect(vars['--text']).toBe('#ededed');
      expect(vars['--text-secondary']).toBe('#9ca3af');
      expect(vars['--text-tertiary']).toBe('#6b7280');
      expect(vars['--color-primary']).toBe('#3b82f6');
      expect(vars['--color-danger']).toBe('#ef4444');
      expect(vars['--color-success']).toBe('#22c55e');
    });

    it('returns high-contrast theme with boosted contrast', () => {
      const vars = getThemeVars('high-contrast');
      expect(vars['--bg']).toBe('#000000');
      expect(vars['--text']).toBe('#ffffff');
      expect(vars['--text-secondary']).toBe('#d1d5db');
      expect(vars['--border']).toBe('#555555');
      expect(vars['--color-primary']).toBe('#60a5fa');
    });

    it('returns daylight theme as true light mode', () => {
      const vars = getThemeVars('daylight');
      expect(vars['--bg']).toBe('#f8fafc');
      expect(vars['--card']).toBe('#ffffff');
      expect(vars['--text']).toBe('#0f172a');
      expect(vars['--text-secondary']).toBe('#475569');
      expect(vars['--border']).toBe('#e2e8f0');
      expect(vars['--color-primary']).toBe('#2563eb');
    });
  });

  describe('variable keys consistency', () => {
    it('all three themes have exactly the same set of keys', () => {
      const darkKeys = Object.keys(getThemeVars('dark')).sort();
      const hcKeys = Object.keys(getThemeVars('high-contrast')).sort();
      const dayKeys = Object.keys(getThemeVars('daylight')).sort();
      expect(darkKeys).toEqual(hcKeys);
      expect(darkKeys).toEqual(dayKeys);
    });

    it('every theme includes all 37 expected tokens', () => {
      for (const theme of THEMES) {
        const vars = getThemeVars(theme);
        for (const key of EXPECTED_TOKENS) {
          expect(vars, `${theme} missing ${key}`).toHaveProperty(key);
          expect(vars[key], `${theme} ${key} is empty`).toBeTruthy();
        }
      }
    });

    it('has exactly 37 tokens — no extras, no missing', () => {
      const darkKeys = Object.keys(getThemeVars('dark'));
      expect(darkKeys).toHaveLength(37);
    });
  });

  describe('variable values are valid CSS colors', () => {
    for (const theme of ['dark', 'high-contrast', 'daylight'] as Theme[]) {
      it(`all values in ${theme} theme are valid CSS color strings`, () => {
        const vars = getThemeVars(theme);
        for (const [key, value] of Object.entries(vars)) {
          expect(value, `${theme} ${key} = "${value}" is not a valid CSS color`).toMatch(CSS_COLOR_RE);
        }
      });
    }
  });

  describe('THEMES constant', () => {
    it('is a non-empty array where every entry has a getThemeVars mapping', () => {
      expect(THEMES.length).toBeGreaterThan(0);
      for (const theme of THEMES) {
        expect(() => getThemeVars(theme)).not.toThrow();
        expect(Object.keys(getThemeVars(theme)).length).toBeGreaterThan(0);
      }
    });

    it('includes the three standard themes', () => {
      expect(THEMES).toContain('dark');
      expect(THEMES).toContain('high-contrast');
      expect(THEMES).toContain('daylight');
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail for the right reasons**

```bash
cd dashboard && npm test -- --run lib/__tests__/theme-vars.test.ts
```

Expected failures:
- `all three themes have exactly the same set of keys` — FAIL (key mismatch)
- `every theme includes all 37 expected tokens` — FAIL (missing new tokens)
- `has exactly 37 tokens` — FAIL (currently 6)
- `returns daylight theme as true light mode` — FAIL (old values)

Do NOT proceed to Task 2 if the tests pass — the test update would be wrong.

---

## Task 2: Expand theme-vars.ts to 37 tokens

**Files:**
- Modify: `dashboard/lib/theme-vars.ts`

**Important:** At this stage, daylight values are set **identical to dark** as placeholders. Working light mode ships in PR2 (Task 10). The goal here is zero visual change — only the token set expands.

- [ ] **Step 1: Replace the full contents of `dashboard/lib/theme-vars.ts`**

```typescript
/**
 * CSS variable maps for each theme.
 *
 * Tier 1 — surfaces & structure (9 vars)
 * Tier 2 — semantic action colors (14 vars)
 * Tier 3 — named UI roles (14 vars)
 *
 * dark:          Default. Pure dark, standard contrast.
 * high-contrast: Boosted contrast for accessibility / bright environments.
 * daylight:      True light mode — white background, dark text.
 */

export type Theme = 'dark' | 'high-contrast' | 'daylight';

export const THEMES: readonly Theme[] = ['dark', 'high-contrast', 'daylight'] as const;

const THEME_VARS: Record<Theme, Record<string, string>> = {
  dark: {
    // Tier 1 — surfaces & structure
    '--bg':             '#0a0a0a',
    '--card':           '#1a1a1a',
    '--surface-raised': '#111111',
    '--text':           '#ededed',
    '--text-secondary': '#9ca3af',
    '--text-tertiary':  '#6b7280',
    '--border':         '#333333',
    '--border-subtle':  '#222222',
    '--color-overlay':  'rgba(0,0,0,0.7)',

    // Tier 2 — semantic actions
    '--color-primary':        '#3b82f6',
    '--color-primary-hover':  '#2563eb',
    '--color-primary-subtle': 'rgba(59,130,246,0.12)',
    '--color-danger':         '#ef4444',
    '--color-danger-hover':   '#dc2626',
    '--color-danger-subtle':  'rgba(239,68,68,0.12)',
    '--color-success':        '#22c55e',
    '--color-success-hover':  '#16a34a',
    '--color-success-subtle': 'rgba(34,197,94,0.12)',
    '--color-warning':        '#f59e0b',
    '--color-warning-hover':  '#d97706',
    '--color-warning-subtle': 'rgba(245,158,11,0.12)',
    '--color-admin':          '#6b21a8',
    '--color-admin-subtle':   'rgba(107,33,168,0.15)',

    // Tier 3 — named UI roles
    '--color-link':             '#60a5fa',
    '--color-nickname-accent':  '#a78bfa',
    '--color-code-accent':      '#3b82f6',
    '--color-focus-ring':       'rgba(59,130,246,0.4)',
    '--color-scrollbar':        '#444444',
    '--color-log-info-bg':      '#1e3a5f',
    '--color-log-info-text':    '#60a5fa',
    '--color-log-warning-bg':   '#78350f',
    '--color-log-warning-text': '#fbbf24',
    '--color-log-error-bg':     '#7f1d1d',
    '--color-log-error-text':   '#f87171',
    '--color-accent-checkbox':  '#3b82f6',
    '--color-live-badge':       '#ef4444',
    '--color-status-accepted':  '#8b5cf6',
  },

  'high-contrast': {
    // Tier 1
    '--bg':             '#000000',
    '--card':           '#111111',
    '--surface-raised': '#0a0a0a',
    '--text':           '#ffffff',
    '--text-secondary': '#d1d5db',
    '--text-tertiary':  '#9ca3af',
    '--border':         '#555555',
    '--border-subtle':  '#333333',
    '--color-overlay':  'rgba(0,0,0,0.85)',

    // Tier 2
    '--color-primary':        '#60a5fa',
    '--color-primary-hover':  '#3b82f6',
    '--color-primary-subtle': 'rgba(59,130,246,0.2)',
    '--color-danger':         '#f87171',
    '--color-danger-hover':   '#ef4444',
    '--color-danger-subtle':  'rgba(239,68,68,0.2)',
    '--color-success':        '#4ade80',
    '--color-success-hover':  '#22c55e',
    '--color-success-subtle': 'rgba(34,197,94,0.2)',
    '--color-warning':        '#fbbf24',
    '--color-warning-hover':  '#f59e0b',
    '--color-warning-subtle': 'rgba(245,158,11,0.2)',
    '--color-admin':          '#7c3aed',
    '--color-admin-subtle':   'rgba(124,58,237,0.2)',

    // Tier 3
    '--color-link':             '#93c5fd',
    '--color-nickname-accent':  '#c4b5fd',
    '--color-code-accent':      '#60a5fa',
    '--color-focus-ring':       'rgba(59,130,246,0.6)',
    '--color-scrollbar':        '#666666',
    '--color-log-info-bg':      '#1e3a5f',
    '--color-log-info-text':    '#93c5fd',
    '--color-log-warning-bg':   '#92400e',
    '--color-log-warning-text': '#fde68a',
    '--color-log-error-bg':     '#991b1b',
    '--color-log-error-text':   '#fca5a5',
    '--color-accent-checkbox':  '#60a5fa',
    '--color-live-badge':       '#f87171',
    '--color-status-accepted':  '#a78bfa',
  },

  daylight: {
    // Tier 1 — PLACEHOLDER: identical to dark until PR2 Task 10 fills true light values
    '--bg':             '#0a0a0a',
    '--card':           '#1a1a1a',
    '--surface-raised': '#111111',
    '--text':           '#ededed',
    '--text-secondary': '#9ca3af',
    '--text-tertiary':  '#6b7280',
    '--border':         '#333333',
    '--border-subtle':  '#222222',
    '--color-overlay':  'rgba(0,0,0,0.7)',

    // Tier 2 — PLACEHOLDER
    '--color-primary':        '#3b82f6',
    '--color-primary-hover':  '#2563eb',
    '--color-primary-subtle': 'rgba(59,130,246,0.12)',
    '--color-danger':         '#ef4444',
    '--color-danger-hover':   '#dc2626',
    '--color-danger-subtle':  'rgba(239,68,68,0.12)',
    '--color-success':        '#22c55e',
    '--color-success-hover':  '#16a34a',
    '--color-success-subtle': 'rgba(34,197,94,0.12)',
    '--color-warning':        '#f59e0b',
    '--color-warning-hover':  '#d97706',
    '--color-warning-subtle': 'rgba(245,158,11,0.12)',
    '--color-admin':          '#6b21a8',
    '--color-admin-subtle':   'rgba(107,33,168,0.15)',

    // Tier 3 — PLACEHOLDER
    '--color-link':             '#60a5fa',
    '--color-nickname-accent':  '#a78bfa',
    '--color-code-accent':      '#3b82f6',
    '--color-focus-ring':       'rgba(59,130,246,0.4)',
    '--color-scrollbar':        '#444444',
    '--color-log-info-bg':      '#1e3a5f',
    '--color-log-info-text':    '#60a5fa',
    '--color-log-warning-bg':   '#78350f',
    '--color-log-warning-text': '#fbbf24',
    '--color-log-error-bg':     '#7f1d1d',
    '--color-log-error-text':   '#f87171',
    '--color-accent-checkbox':  '#3b82f6',
    '--color-live-badge':       '#ef4444',
    '--color-status-accepted':  '#8b5cf6',
  },
};

export function getThemeVars(theme: Theme): Record<string, string> {
  return { ...THEME_VARS[theme] };
}
```

- [ ] **Step 2: Run tests — all must pass**

```bash
cd dashboard && npm test -- --run lib/__tests__/theme-vars.test.ts
```

Expected: All tests PASS. If any fail, fix before continuing.

- [ ] **Step 3: Run TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/theme-vars.ts dashboard/lib/__tests__/theme-vars.test.ts
git commit -m "feat(theme): expand token set to 37 CSS vars across 3 tiers"
```

---

## Task 3: globals.css — replace Tier 1 surface and structural values

**Files:**
- Modify: `dashboard/app/globals.css`

This task replaces hardcoded surface/structure colors with Tier 1 CSS vars. Make one replacement at a time using your editor's find-and-replace within the file. After each group, verify the file still parses (no syntax errors).

- [ ] **Step 1: Replace admin sidebar background**

Find:
```css
.admin-sidebar {
  width: 220px;
  background: #111;
```
Replace with:
```css
.admin-sidebar {
  width: 220px;
  background: var(--surface-raised);
```

- [ ] **Step 2: Replace admin sidebar hover background**

Find:
```css
.admin-sidebar-link:hover {
  background: #222;
```
Replace with:
```css
.admin-sidebar-link:hover {
  background: var(--border-subtle);
```

- [ ] **Step 3: Replace log entry border**

Find:
```css
.log-entry {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.5rem 0;
  border-bottom: 1px solid #222;
```
Replace with:
```css
.log-entry {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-subtle);
```

- [ ] **Step 4: Replace identity bar background and border**

Find:
```css
  background: var(--card-bg, #1a1a1a);
  border-bottom: 1px solid #2a2a2a;
```
Replace with:
```css
  background: var(--card);
  border-bottom: 1px solid var(--border-subtle);
```

- [ ] **Step 5: Replace scrollbar colors**

Find:
```css
  scrollbar-color: #444 transparent;
```
Replace with:
```css
  scrollbar-color: var(--color-scrollbar) transparent;
```

Find:
```css
.scrollable-list::-webkit-scrollbar-thumb {
  background: #444;
```
Replace with:
```css
.scrollable-list::-webkit-scrollbar-thumb {
  background: var(--color-scrollbar);
```

Find:
```css
.scrollable-list::-webkit-scrollbar-thumb:hover {
  background: #555;
```
Replace with:
```css
.scrollable-list::-webkit-scrollbar-thumb:hover {
  background: var(--color-scrollbar);
```

- [ ] **Step 6: Replace modal overlay backgrounds**

Find:
```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
```
Replace with:
```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
```

- [ ] **Step 7: Replace verify digit input hardcoded surface colors**

Find:
```css
  background: #1a1a1a;
  border: 2px solid #333;
  border-radius: 10px;
  color: #ededed;
```
Replace with:
```css
  background: var(--card);
  border: 2px solid var(--border);
  border-radius: 10px;
  color: var(--text);
```

- [ ] **Step 8: Replace log-source tag background**

Find:
```css
.log-source {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  background: #333;
```
Replace with:
```css
.log-source {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--border);
```

- [ ] **Step 9: Replace btn-check and btn-check hover**

Find:
```css
  border: 1px solid #444;
```
Replace with:
```css
  border: 1px solid var(--border);
```

Find:
```css
.btn-check:hover {
  background: #333;
```
Replace with:
```css
.btn-check:hover {
  background: var(--border);
```

- [ ] **Step 10: Replace help-btn border**

Find:
```css
.help-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid #444;
```
Replace with:
```css
.help-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--border);
```

- [ ] **Step 11: Replace toggle-switch inactive background**

Find:
```css
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: #374151;
```
Replace with:
```css
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--border);
```

- [ ] **Step 12: Replace badge-status.not-configured and not-implemented**

Find:
```css
.badge-status.not-configured {
  background: #374151;
```
Replace with:
```css
.badge-status.not-configured {
  background: var(--border);
```

Find:
```css
.badge-status.not-implemented {
  background: #1f2937;
  color: #6b7280;
```
Replace with:
```css
.badge-status.not-implemented {
  background: var(--card);
  color: var(--text-tertiary);
```

- [ ] **Step 13: Replace identity-bar-name fallback and verify-timer fallback**

Find:
```css
  color: var(--text-secondary, #a0a0a0);
```
Replace with:
```css
  color: var(--text-secondary);
```

Find:
```css
  color: var(--text-secondary, #888);
```
Replace with:
```css
  color: var(--text-secondary);
```

Find:
```css
  color: var(--text-primary, #ededed);
```
Replace with:
```css
  color: var(--text);
```

- [ ] **Step 14: Replace event-tab hover border**

Find:
```css
.event-tab:hover {
  border-color: #555;
```
Replace with:
```css
.event-tab:hover {
  border-color: var(--border);
```

- [ ] **Step 15: Commit Tier 1 replacements**

```bash
git add dashboard/app/globals.css
git commit -m "refactor(theme): replace Tier 1 surface/structure hardcoded colors in globals.css"
```

---

## Task 4: globals.css — replace Tier 2 semantic action colors

**Files:**
- Modify: `dashboard/app/globals.css`

- [ ] **Step 1: Replace all primary color usages**

Find and replace each occurrence:

`.btn-primary { background: #3b82f6` → `background: var(--color-primary)`
`.btn-primary:hover { background: #2563eb` → `background: var(--color-primary-hover)`
`.input:focus { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.tab.active { background: #3b82f6` → `background: var(--color-primary)`
`.tab.active { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.admin-sidebar-header h2 { color: #3b82f6` → `color: var(--color-primary)`
`.admin-sidebar-link.active { color: #3b82f6` → `color: var(--color-primary)`
`.admin-sidebar-link.active { border-left: 3px solid #3b82f6` → `border-left: 3px solid var(--color-primary)`
`.admin-sidebar-link.active (mobile) { border-bottom: 3px solid #3b82f6` → `border-bottom: 3px solid var(--color-primary)`
`.help-btn:hover { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.help-btn-active { background: #3b82f6` → `background: var(--color-primary)`
`.help-btn-active { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.help-tour-btn { border: 1px solid #3b82f6` → `border: 1px solid var(--color-primary)`
`.help-tour-btn { color: #3b82f6` → `color: var(--color-primary)`
`.theme-toggle:hover { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.verify-digit-input { caret-color: #3b82f6` → `caret-color: var(--color-primary)`
`.verify-digit-input:focus { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.event-tab.active { border-color: #3b82f6` → `border-color: var(--color-primary)`
`.badge-new { background: #3b82f6` → `background: var(--color-primary)`
`.badge-role-dj { background: #3b82f6` → `background: var(--color-primary)`

- [ ] **Step 2: Replace primary-subtle usages**

`.help-tour-btn:hover { background: rgba(59, 130, 246, 0.1)` → `background: var(--color-primary-subtle)`
`.help-spot-highlight { outline: 2px solid rgba(59, 130, 246, 0.5)` → `outline: 2px solid var(--color-focus-ring)`
`.verify-digit-input:focus { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2)` → `box-shadow: 0 0 0 3px var(--color-focus-ring)`

- [ ] **Step 3: Replace event-tab active background**

Find:
```css
.event-tab.active {
  border-color: #3b82f6;
  background: #1e3a5f;
```
Replace with:
```css
.event-tab.active {
  border-color: var(--color-primary);
  background: var(--color-log-info-bg);
```

- [ ] **Step 4: Replace danger color usages**

`.btn-danger { background: #ef4444` → `background: var(--color-danger)`
`.btn-danger:hover { background: #dc2626` → `background: var(--color-danger-hover)`
`.badge-rejected { background: #ef4444` → `background: var(--color-danger)`
`.now-playing-live-badge { background: #ef4444` → `background: var(--color-live-badge)`
`.badge-status.no { background: #ef4444` → `background: var(--color-danger)`

- [ ] **Step 5: Replace success color usages**

`.btn-success { background: #22c55e` → `background: var(--color-success)`
`.btn-success:hover { background: #16a34a` → `background: var(--color-success-hover)`
`.badge-playing { background: #22c55e` → `background: var(--color-success)`
`.toggle-switch.active { background: #22c55e` → `background: var(--color-success)`
`.badge-status.yes { background: #22c55e` → `background: var(--color-success)`
`.collect-optin-features li::before { color: #22c55e` → `color: var(--color-success)`
`.identity-bar-verified { color: #22c55e` → `color: var(--color-success)`
`.btn-complete { background: #10b981 !important` → `background: var(--color-success) !important`

- [ ] **Step 6: Replace warning color usages**

`.btn-warning { background: #f59e0b` → `background: var(--color-warning)`
`.btn-warning:hover { background: #d97706` → `background: var(--color-warning-hover)`
`.badge-status.configured { background: #f59e0b` → `background: var(--color-warning)`
`.badge-status.configured { color: #0a0a0a` → `color: var(--bg)` *(dark text on amber badge)*
`.badge-role-pending { background: #f59e0b` → `background: var(--color-warning)`
`.badge-role-pending { color: #0a0a0a` → `color: var(--bg)`

- [ ] **Step 7: Replace admin color usages**

`.badge-role-admin { background: #6b21a8` → `background: var(--color-admin)`
`.badge-accepted { background: #8b5cf6` → `background: var(--color-status-accepted)`

- [ ] **Step 8: Replace badge guest/tracker subtle colors**

Find and replace:
```css
.badge-pending {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
```
Replace with:
```css
.badge-pending {
  background: var(--color-primary-subtle);
  color: var(--color-link);
```

Find and replace:
```css
.badge-accepted-guest {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
```
Replace with:
```css
.badge-accepted-guest {
  background: var(--color-admin-subtle);
  color: var(--color-nickname-accent);
```

Find and replace:
```css
.my-req-badge-pending {
  background: rgba(234, 179, 8, 0.15);
  color: #facc15;
```
Replace with:
```css
.my-req-badge-pending {
  background: var(--color-warning-subtle);
  color: var(--color-warning);
```

Find and replace:
```css
.my-req-badge-accepted {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
```
Replace with:
```css
.my-req-badge-accepted {
  background: var(--color-primary-subtle);
  color: var(--color-link);
```

Find and replace:
```css
.my-req-badge-playing {
  background: rgba(34, 197, 94, 0.25);
  color: #4ade80;
```
Replace with:
```css
.my-req-badge-playing {
  background: var(--color-success-subtle);
  color: var(--color-success);
```

Find and replace:
```css
.my-req-badge-rejected {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
```
Replace with:
```css
.my-req-badge-rejected {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
```

- [ ] **Step 9: Replace collection-fieldset checkbox accent**

Find:
```css
.collection-fieldset-toggle input[type='checkbox'] {
  accent-color: #3b82f6;
```
Replace with:
```css
.collection-fieldset-toggle input[type='checkbox'] {
  accent-color: var(--color-accent-checkbox);
```

- [ ] **Step 10: Replace pre-event DJ-side colors**

Find:
```css
.pre-event-bulk-selection {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.25);
```
Replace with:
```css
.pre-event-bulk-selection {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--color-primary-subtle);
  border: 1px solid var(--color-primary-subtle);
```

- [ ] **Step 11: Commit Tier 2 replacements**

```bash
git add dashboard/app/globals.css
git commit -m "refactor(theme): replace Tier 2 semantic action hardcoded colors in globals.css"
```

---

## Task 5: globals.css — replace Tier 3 named UI role colors

**Files:**
- Modify: `dashboard/app/globals.css`

- [ ] **Step 1: Replace log level badge colors**

Find and replace entire `.log-level-info` block:
```css
.log-level-info {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--color-log-info-bg);
  color: var(--color-log-info-text);
  white-space: nowrap;
}

.log-level-warning {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--color-log-warning-bg);
  color: var(--color-log-warning-text);
  white-space: nowrap;
}

.log-level-error {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--color-log-error-bg);
  color: var(--color-log-error-text);
  white-space: nowrap;
}
```

- [ ] **Step 2: Replace nickname accent colors**

`.request-nickname { color: #a78bfa` → `color: var(--color-nickname-accent)`
`.guest-request-item-nickname { color: #a78bfa` → `color: var(--color-nickname-accent)`
`.my-requests-title { color: #a78bfa` → `color: var(--color-nickname-accent)`
`.collect-row-nickname { color: #a78bfa` → `color: var(--color-nickname-accent)` *(collect page CSS — CSS vars still applied here, only TSX is excluded)*

- [ ] **Step 3: Replace event code accent**

`.event-card .code { color: #3b82f6` → `color: var(--color-code-accent)`

- [ ] **Step 4: Replace link/info colors**

`.onboarding-step-counter { color: #60a5fa` → `color: var(--color-link)`
`.identity-bar-add-email { color: #60a5fa` → `color: var(--color-link)`
`.identity-bar-pulse { background: #60a5fa` → `background: var(--color-link)`

- [ ] **Step 5: Replace collection-fieldset error color**

`.collection-fieldset-error { color: #f87171` → `color: var(--color-danger)`

- [ ] **Step 6: Replace celebration-label color**

`.celebration-label { color: #4ade80` → `color: var(--color-success)`

- [ ] **Step 7: Commit Tier 3 replacements**

```bash
git add dashboard/app/globals.css
git commit -m "refactor(theme): replace Tier 3 named UI role hardcoded colors in globals.css"
```

---

## Task 6: Verify PR1 — dark theme unchanged, run full CI

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```

Expected: All pass. Fix any failures before continuing.

- [ ] **Step 2: Visual spot-check (dark theme)**

Start the dev server:
```bash
cd dashboard && NEXT_PUBLIC_API_URL="http://localhost:8000" npm run dev
```

Open http://localhost:3000 and verify:
- Events list page looks identical to before
- Event detail page looks identical to before
- Admin sidebar looks identical to before
- All badge colors (new/accepted/playing/played/rejected) unchanged
- ThemeToggle still works (dark → high-contrast → daylight, all look dark at this stage)

- [ ] **Step 3: Create PR1**

```bash
git push -u origin feat/theming-uplift-consistency
gh pr create --title "refactor(theme): expand CSS token system to 37 vars, fix globals.css" --body "$(cat <<'EOF'
## Summary
- Expands `theme-vars.ts` from 6 → 37 CSS custom properties across 3 tiers (surfaces, semantic actions, named UI roles)
- Replaces all hardcoded hex/rgba colors in `globals.css` with CSS vars
- Zero visual change — dark theme pixel-identical, daylight placeholder = dark values

## Test plan
- [ ] All vitest tests pass
- [ ] TypeScript compiles clean
- [ ] Dark theme visual spot-check: events list, event detail, admin pages unchanged
- [ ] ThemeToggle cycles through themes (all still look dark — daylight ships in PR2)
EOF
)"
```

---

# Phase 2 — PR2: Route Group + TSX + Light Theme

> Start PR2 tasks on a new branch off the merged PR1: `git checkout main && git pull && git checkout -b feat/theming-uplift-pr2`
> Or continue on the same branch if PR1 hasn't merged yet.

---

## Task 7: Create (dj) route group layout with ThemeToggle

**Files:**
- Create: `dashboard/app/(dj)/layout.tsx`
- Modify: `dashboard/components/ThemeToggle.tsx`

- [ ] **Step 1: Read the current ThemeToggle component**

```bash
cat dashboard/components/ThemeToggle.tsx
```

Find the `THEME_LABELS` object. It currently maps `daylight` to a label string. Update it:

```typescript
const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  'high-contrast': 'Hi-C',
  daylight: 'Day',   // was 'Daylight' or similar
};
```

- [ ] **Step 2: Create the route group directory and layout**

```bash
mkdir -p dashboard/app/\(dj\)
```

Create `dashboard/app/(dj)/layout.tsx`:

```typescript
'use client';

import { type ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function DJLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div style={{
        position: 'fixed',
        top: '1rem',
        right: '4.5rem',  // offset right of existing help-btn-container (top:1rem right:1rem w:36px)
        zIndex: 50,
      }}>
        <ThemeToggle />
      </div>
      {children}
    </>
  );
}
```

> Note: `right: 4.5rem` keeps ThemeToggle left of the existing help button. The help button container is at `position: fixed; top: 1rem; right: 1rem; z-index: 1200` in globals.css — ThemeToggle at `z-index: 50` is safely below it and offset to avoid overlap. Adjust if help button is not present on a given page or if the offset feels too wide.

- [ ] **Step 3: Run TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors. The route group layout won't be used yet (no pages inside it), so this is just a syntax check.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/\(dj\)/layout.tsx dashboard/components/ThemeToggle.tsx
git commit -m "feat(theme): add (dj) route group layout with global ThemeToggle"
```

---

## Task 8: Move events/ and account/ into the (dj) route group

**Files:**
- Move: `dashboard/app/events/` → `dashboard/app/(dj)/events/`
- Move: `dashboard/app/account/page.tsx` → `dashboard/app/(dj)/account/page.tsx`
- Move: `dashboard/app/account/__tests__/page.test.tsx` → `dashboard/app/(dj)/account/__tests__/page.test.tsx`
- Modify: `dashboard/app/(dj)/events/[code]/page.tsx` — remove manual ThemeToggle

- [ ] **Step 1: Move the events directory**

```bash
git mv "dashboard/app/events" "dashboard/app/(dj)/events"
```

- [ ] **Step 2: Move the account page and its test**

```bash
mkdir -p "dashboard/app/(dj)/account/__tests__"
git mv "dashboard/app/account/page.tsx" "dashboard/app/(dj)/account/page.tsx"
git mv "dashboard/app/account/__tests__/page.test.tsx" "dashboard/app/(dj)/account/__tests__/page.test.tsx"
```

The `dashboard/app/account/confirm-email/` directory stays at `app/account/confirm-email/` — do not move it.

- [ ] **Step 3: Run TypeScript check to surface any broken imports**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors. All imports use `@/` alias which is unaffected by the move. If any relative imports break, update them to use `@/` aliases.

- [ ] **Step 4: Remove manual ThemeToggle from event detail page**

Open `dashboard/app/(dj)/events/[code]/page.tsx`. Find the manual `<ThemeToggle />` import and usage in the page header. Remove:
- The `import { ThemeToggle } from '@/components/ThemeToggle';` line
- The `<ThemeToggle />` JSX element in the page header area

The route group layout now injects it globally — no per-page instance needed.

- [ ] **Step 5: Run full test suite**

```bash
cd dashboard && npm test -- --run
```

Expected: All pass. The moved test files are picked up by Vitest's glob config automatically.

- [ ] **Step 6: Start dev server and verify routes work**

```bash
cd dashboard && NEXT_PUBLIC_API_URL="http://localhost:8000" npm run dev
```

Verify:
- `/events` loads the events list ✓
- `/events/[code]` loads event detail with ThemeToggle in top-right ✓
- `/account` loads account page with ThemeToggle in top-right ✓
- `/account/confirm-email` still works (not in DJ group, not affected) ✓
- ThemeToggle does NOT appear on `/join` or `/e/[code]` display pages ✓

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(theme): move DJ pages into (dj) route group, remove per-page ThemeToggle"
```

---

## Task 9: Add ThemeToggle to admin layout

**Files:**
- Modify: `dashboard/app/admin/layout.tsx`

- [ ] **Step 1: Read the admin layout to find the sidebar footer**

```bash
cat dashboard/app/admin/layout.tsx
```

Locate `.admin-sidebar-footer` — it contains navigation links/buttons at the bottom of the sidebar.

- [ ] **Step 2: Add ThemeToggle import and instance**

Add import at the top of `dashboard/app/admin/layout.tsx`:
```typescript
import { ThemeToggle } from '@/components/ThemeToggle';
```

Inside the `.admin-sidebar-footer` div, add `<ThemeToggle />` as the last element:
```tsx
<div className="admin-sidebar-footer">
  {/* existing footer items */}
  <ThemeToggle />
</div>
```

- [ ] **Step 3: Verify TypeScript and run tests**

```bash
cd dashboard && npx tsc --noEmit && npm test -- --run
```

Expected: All pass.

- [ ] **Step 4: Visual check — admin ThemeToggle**

With dev server running, open `/admin` and confirm ThemeToggle appears in the sidebar footer alongside other footer items.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/admin/layout.tsx
git commit -m "feat(theme): add ThemeToggle to admin sidebar footer"
```

---

## Task 10: Fill complete daylight + high-contrast values in theme-vars.ts

**Files:**
- Modify: `dashboard/lib/theme-vars.ts`

This task fills the daylight placeholder values with true light-mode colors, enabling working light mode.

- [ ] **Step 1: Update the daylight object in theme-vars.ts**

Replace the entire `daylight` object (currently all placeholder dark values) with:

```typescript
daylight: {
  // Tier 1
  '--bg':             '#f8fafc',
  '--card':           '#ffffff',
  '--surface-raised': '#f1f5f9',
  '--text':           '#0f172a',
  '--text-secondary': '#475569',
  '--text-tertiary':  '#64748b',
  '--border':         '#e2e8f0',
  '--border-subtle':  '#f1f5f9',
  '--color-overlay':  'rgba(0,0,0,0.5)',

  // Tier 2
  '--color-primary':        '#2563eb',
  '--color-primary-hover':  '#1d4ed8',
  '--color-primary-subtle': 'rgba(37,99,235,0.1)',
  '--color-danger':         '#dc2626',
  '--color-danger-hover':   '#b91c1c',
  '--color-danger-subtle':  'rgba(220,38,38,0.1)',
  '--color-success':        '#16a34a',
  '--color-success-hover':  '#15803d',
  '--color-success-subtle': 'rgba(22,163,74,0.1)',
  '--color-warning':        '#d97706',
  '--color-warning-hover':  '#b45309',
  '--color-warning-subtle': 'rgba(245,158,11,0.1)',
  '--color-admin':          '#7c3aed',
  '--color-admin-subtle':   'rgba(124,58,237,0.1)',

  // Tier 3
  '--color-link':             '#2563eb',
  '--color-nickname-accent':  '#7c3aed',
  '--color-code-accent':      '#2563eb',
  '--color-focus-ring':       'rgba(37,99,235,0.3)',
  '--color-scrollbar':        '#cbd5e1',
  '--color-log-info-bg':      '#dbeafe',
  '--color-log-info-text':    '#1d4ed8',
  '--color-log-warning-bg':   '#fef3c7',
  '--color-log-warning-text': '#92400e',
  '--color-log-error-bg':     '#fee2e2',
  '--color-log-error-text':   '#991b1b',
  '--color-accent-checkbox':  '#2563eb',
  '--color-live-badge':       '#dc2626',
  '--color-status-accepted':  '#7c3aed',
},
```

- [ ] **Step 2: Run the full theme-vars test suite**

```bash
cd dashboard && npm test -- --run lib/__tests__/theme-vars.test.ts
```

Expected: All tests PASS, including `returns daylight theme as true light mode` which now checks `--bg === '#f8fafc'`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/theme-vars.ts
git commit -m "feat(theme): fill daylight true light-mode token values"
```

---

## Task 11: Replace inline TSX hardcoded colors — DJ pages

**Files:**
- Modify: all TSX files under `dashboard/app/(dj)/` and `dashboard/app/admin/`

This is a systematic grep-and-replace pass. Work token-by-token, not file-by-file. After each token group, run `npx tsc --noEmit` to verify no breakage.

**Important:** Inline styles use JS object syntax, so CSS var usage looks like:
```tsx
// In JSX inline styles:
style={{ color: 'var(--text-secondary)' }}
style={{ background: 'var(--color-primary)' }}
```

- [ ] **Step 1: Find all files with hardcoded inline style colors (inventory)**

```bash
grep -rn --include="*.tsx" -E "style=\{.*#[0-9a-fA-F]{3,8}" \
  dashboard/app/\(dj\)/ dashboard/app/admin/ \
  | grep -v ".test." | grep -v "__tests__"
```

Save this list — these are all the files to touch.

- [ ] **Step 2: Replace --text-secondary usages (highest priority — 141 hits)**

Colors to replace: `'#9ca3af'`, `'#aaa'`, `'#888'`, `'#b0b0b0'`, `'#a0a0a0'`
Replace with: `'var(--text-secondary)'`

```bash
# Find all locations
grep -rn --include="*.tsx" -E "'(#9ca3af|#aaa|#888|#b0b0b0|#a0a0a0)'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

Open each file and replace inline. Example pattern:
```tsx
// Before
<label style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
// After
<label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
```

- [ ] **Step 3: Replace --color-primary usages**

Colors to replace: `'#3b82f6'`
Replace with: `'var(--color-primary)'`

Exception: `accentColor: '#3b82f6'` → `accentColor: 'var(--color-accent-checkbox)'`

```bash
grep -rn --include="*.tsx" "'#3b82f6'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 4: Replace --color-danger usages**

Colors to replace: `'#ef4444'`
Replace with: `'var(--color-danger)'`

Also: `'#f87171'` → `'var(--color-danger)'` (in error messages/badges)

```bash
grep -rn --include="*.tsx" -E "'(#ef4444|#f87171)'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 5: Replace --color-success usages**

Colors to replace: `'#22c55e'`, `'#4ade80'`
Replace with: `'var(--color-success)'`

```bash
grep -rn --include="*.tsx" -E "'(#22c55e|#4ade80)'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 6: Replace --color-warning usages**

Colors to replace: `'#f59e0b'`, `'#fbbf24'`, `'#facc15'`
Replace with: `'var(--color-warning)'`

```bash
grep -rn --include="*.tsx" -E "'(#f59e0b|#fbbf24|#facc15)'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 7: Replace --color-admin usages**

Colors to replace: `'#6b21a8'`
Replace with: `'var(--color-admin)'`

```bash
grep -rn --include="*.tsx" "'#6b21a8'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 8: Replace --text-tertiary usages**

Colors to replace: `'#6b7280'`
Replace with: `'var(--text-tertiary)'`

```bash
grep -rn --include="*.tsx" "'#6b7280'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 9: Replace --card / --surface-raised usages**

Colors to replace: `'#1a1a1a'` → `'var(--card)'`, `'#111'` → `'var(--surface-raised)'`, `'#333'` used as button background → `'var(--surface-raised)'`

```bash
grep -rn --include="*.tsx" -E "'(#1a1a1a|#111|#333)'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

Note: `'#333'` also appears as border color in some places. Context determines whether to use `--border` or `--surface-raised`. If it's a `background`, use `--surface-raised`. If it's a `border` or `borderColor`, use `--border`.

- [ ] **Step 10: Replace --color-link usages**

Colors to replace: `'#60a5fa'`
Replace with: `'var(--color-link)'`

```bash
grep -rn --include="*.tsx" "'#60a5fa'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 11: Replace --color-nickname-accent usages**

Colors to replace: `'#a78bfa'`
Replace with: `'var(--color-nickname-accent)'`

```bash
grep -rn --include="*.tsx" "'#a78bfa'" \
  dashboard/app/\(dj\)/ dashboard/app/admin/
```

- [ ] **Step 12: Replace rgba subtle tint usages**

Danger subtle: `rgba(239, 68, 68, ...)` or `rgba(239,68,68,...)` → `'var(--color-danger-subtle)'`
Success subtle: `rgba(34, 197, 94, ...)` → `'var(--color-success-subtle)'`
Warning subtle: `rgba(245, 158, 11, ...)` → `'var(--color-warning-subtle)'`
Primary subtle: `rgba(59, 130, 246, ...)` → `'var(--color-primary-subtle)'`
Admin subtle: `rgba(107, 33, 168, ...)` → `'var(--color-admin-subtle)'`

```bash
grep -rn --include="*.tsx" "rgba(" \
  dashboard/app/\(dj\)/ dashboard/app/admin/ \
  | grep -v ".test."
```

Also check AI page for specific `#065f46` / `#6ee7b7` (success-tinted API key badge) and `#7f1d1d` / `#fca5a5` (danger-tinted) — replace with `--color-success-subtle`/`--color-success` and `--color-danger-subtle`/`--color-danger` respectively.

- [ ] **Step 13: TypeScript check after all replacements**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors. Fix any type issues (CSS var strings are `string` type — no TS issues expected).

- [ ] **Step 14: Run full test suite**

```bash
cd dashboard && npm test -- --run
```

Expected: All pass.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor(theme): replace all inline style hardcoded colors in DJ/admin TSX"
```

---

## Task 12: Manual QA in daylight mode + final PR2 commit

**Files:** None (QA only, then PR)

- [ ] **Step 1: Start dev server**

```bash
cd dashboard && NEXT_PUBLIC_API_URL="http://localhost:8000" npm run dev
```

- [ ] **Step 2: Switch to Daylight theme**

Open http://localhost:3000/events, click ThemeToggle until "Day" is shown.

- [ ] **Step 3: Check each DJ page in daylight mode**

Work through this checklist — each item must be clearly readable with no invisible text, no white-on-white cards, no dark-on-dark elements:

- [ ] Events list: cards visible, text legible, Create Event button colored correctly
- [ ] Events list: Admin button uses admin purple (not invisible)
- [ ] Event detail page: request cards visible, badge colors (New/Accepted/Playing/Played/Rejected) all visible
- [ ] Event detail page: now-playing badge visible
- [ ] Event detail page: activity log info/warning/error rows readable with correct colored pills
- [ ] Event detail page: ThemeToggle NOT duplicated (layout provides it, page no longer has its own)
- [ ] Event management tab: tables and inputs visible
- [ ] Admin overview: stats cards visible
- [ ] Admin users: table rows visible, role badges (Admin=purple, DJ=blue, Pending=amber) visible
- [ ] Admin settings: toggle switches visible and functional
- [ ] Admin integrations: badge-status indicators visible (yes=green, no=red, configured=amber)
- [ ] Admin activity log: info/warning/error pill badges readable
- [ ] Account page: form inputs visible with correct border and background

- [ ] **Step 4: Check high-contrast mode**

Switch to "Hi-C" theme. Verify boosted contrast (brighter text on pure black background).

- [ ] **Step 5: Check dark mode is unchanged**

Switch back to "Dark". Verify pixel-identical to pre-PR state.

- [ ] **Step 6: Run full CI suite**

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```

Expected: All pass.

- [ ] **Step 7: Create PR2**

```bash
git push -u origin feat/theming-uplift-pr2  # or current branch name
gh pr create --title "feat(theme): true light mode, DJ route group, complete token system" --body "$(cat <<'EOF'
## Summary
- Moves DJ pages (`/events`, `/account`) into `app/(dj)/` route group — ThemeToggle auto-injected on all DJ pages, no per-page imports needed
- Adds ThemeToggle to admin sidebar footer
- Fills complete daylight (true light mode) token values in `theme-vars.ts`
- Replaces all inline TSX hardcoded colors across ~30 DJ/admin files with CSS vars
- Renames daylight label to "Day" in ThemeToggle

## What's excluded (intentional)
Guest join, display, collect/Tower pages, and Camelot wheel are unchanged — they have independent design languages.

## Test plan
- [ ] All CI checks pass (lint, tsc, vitest)
- [ ] Events list: all three themes render correctly
- [ ] Event detail: badges, activity log, now-playing all visible in daylight mode
- [ ] Admin pages: all three themes correct
- [ ] ThemeToggle appears on events list, event detail, account, admin (not on join/display/collect)
- [ ] `/account/confirm-email` route still works (not in route group)
- [ ] No duplicated ThemeToggle on event detail page
EOF
)"
```

---

## Appendix: Files explicitly excluded from theming

Do not add CSS vars to these files — they use intentional fixed design languages:

- `dashboard/app/e/[code]/display/` — kiosk display (absolute dark)
- `dashboard/app/join/` — guest join page
- `dashboard/app/collect/` — Tower guest UI (`#06060a`, `#00f0ff`, `#ff2bd6`)
- `dashboard/app/register/` — public page, not DJ-authenticated
- `dashboard/app/login/` — public page
- `dashboard/app/kiosk-pair/` — kiosk pairing (display surface)
- `dashboard/app/kiosk-link/` — kiosk DJ-side linking
- Camelot wheel component — fixed color semantics (music theory: key colors)
- Tower constants in `app/collect/[code]/components/` — decorative gradient arrays
