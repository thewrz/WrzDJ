# IdentityBar Hidden Behind Banner Image — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the IdentityBar (login/status banner) visible above the event banner image on `/join` and `/collect` guest pages.

**Architecture:** Pure CSS z-index fix. The `.identity-bar` has no `position` or `z-index`, so it sits behind the absolutely-positioned `.join-banner-bg` (which has `z-index: 0`). Fix by giving `.identity-bar` `position: relative` and `z-index: 2` — above both the banner bg (0) and the ambient glows (0).

**Tech Stack:** CSS (globals.css), no JS changes needed.

---

## Root Cause

| Element | `position` | `z-index` | Result |
|---------|-----------|-----------|--------|
| `.join-banner-bg` | `absolute` | `0` | Creates stacking context, paints over static-flow siblings |
| `.identity-bar` | *(none — static)* | *(none — auto)* | No stacking context, rendered behind absolute elements |
| `.guest-tower-inner` | `relative` | *(auto)* | Content inside gets relative stacking but bar is outside |
| `.collect-container` | `relative` (inline) | `1` (inline) | Main content works, but IdentityBar is before this in DOM |

On **join page** (`page.tsx:481–486`): BannerBg renders before IdentityBar — absolute `z-index: 0` covers the static identity bar.

On **collect page** (`page.tsx:328–340`): IdentityBar renders before `bannerNode` — banner paints after in DOM order, covering the bar.

Both pages use the same CSS class `.join-banner-bg` for the banner background.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `dashboard/app/globals.css:2062-2071` | Add `position: relative; z-index: 2` to `.identity-bar` |

That's the entire fix. One CSS rule change.

---

### Task 1: Fix IdentityBar z-index

**Files:**
- Modify: `dashboard/app/globals.css:2062-2071`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b fix/identity-bar-z-index
```

- [ ] **Step 2: Apply the CSS fix**

In `dashboard/app/globals.css`, change the `.identity-bar` rule from:

```css
.identity-bar {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--card-bg, #1a1a1a);
  border-bottom: 1px solid #2a2a2a;
  font-size: 0.875rem;
}
```

To:

```css
.identity-bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--card-bg, #1a1a1a);
  border-bottom: 1px solid #2a2a2a;
  font-size: 0.875rem;
}
```

- [ ] **Step 3: Run frontend CI checks**

```bash
cd dashboard && npx tsc --noEmit && npm run lint
```

Expected: both pass (CSS-only change, no TS impact).

- [ ] **Step 4: Visual verification**

Start dev server and verify on both pages with an event that has a banner image:

1. Navigate to `/join/{code}` — IdentityBar should be visible above the banner image
2. Navigate to `/collect/{code}` — IdentityBar should be visible above the banner image
3. Verify banner image still renders correctly (blurred, fades out)
4. Verify IdentityBar email form expands without clipping
5. Check on mobile viewport (375px width) — bar should not overlap content

```bash
cd dashboard && NEXT_PUBLIC_API_URL="http://192.168.20.5:8000" npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/globals.css
git commit -m "fix(guest): identity bar hidden behind event banner image

Add position: relative and z-index: 2 to .identity-bar so it stacks
above the absolutely-positioned .join-banner-bg (z-index: 0) on both
/join and /collect pages."
```

---

## Z-Index Reference (guest pages)

After this fix, the stacking order on guest pages is:

| Layer | z-index | Element |
|-------|---------|---------|
| Ambient glows | 0 | `.gst-glow-top`, `.gst-glow-bottom` |
| Banner background | 0 | `.join-banner-bg` |
| **Identity bar** | **2** | **`.identity-bar`** |
| Main content | 1+ | `.guest-tower-inner`, `.collect-container` |
| Modals/overlays | 10+ | CelebrationOverlay, Toast |
