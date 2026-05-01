# Song Detail Panels, Vibes Enrichment & Collect UX — Design Spec

**Date:** 2026-04-30
**Status:** Approved

## Problem Summary

Five distinct issues across three layers:

1. `SongDetailSheet` on `/join` renders artwork full-viewport-width (375px on iPhone) — title and stats require scrolling
2. `/collect` leaderboard rows are not tappable — no detail panel exists
3. `bpm`, `musical_key`, and `genre` are stripped from both `GuestRequestInfo` and `CollectLeaderboardRow` API responses — even when the DB has them
4. `/collect` submit endpoint never calls `enrich_request_metadata` — so collect picks never get BPM/key/genre populated
5. "HIGHLIGHT BY VIBES" toggle is missing from `/collect` search results — it exists only on `/join`

---

## Approach: Full Fix (Approach 2)

Fix all five issues end-to-end. No shared component extraction — the join and collect detail panels differ enough in data shape and context to warrant separate components.

---

## Section 1 — Backend Schema Exposure

**Files:** `server/app/api/public.py`, `server/app/schemas/collect.py`, `server/app/api/collect.py`

Add three nullable fields to both public response schemas:

```python
bpm: int | None = None
musical_key: str | None = None
genre: str | None = None
```

### `PublicRequestInfo` (`server/app/api/public.py`)
Add the three fields. They propagate automatically to `GuestRequestInfo` via inheritance.

Populate in `get_public_requests` by reading `r.bpm`, `r.musical_key`, `r.genre` from the `SongRequest` model row. Same for the `now_playing` matched-request path.

### `CollectLeaderboardRow` (`server/app/schemas/collect.py`)
Add the three fields directly to the schema class.

Populate in the leaderboard endpoint (`server/app/api/collect.py`) by reading the same columns from the `SongRequest` row.

**No Alembic migration needed.** These columns already exist on the `SongRequest` model — this is pure schema exposure.

---

## Section 2 — Enrichment Trigger on Collect Submit

**File:** `server/app/api/collect.py`

The `submit` endpoint creates a `SongRequest` row but never fires enrichment. Add `BackgroundTasks` as a FastAPI dependency and call `enrich_request_metadata` after commit — identical to the pattern in `events.py`.

```python
# After db.commit() / db.refresh(row):
background_tasks.add_task(enrich_request_metadata, db, row.id)
```

Import: `from app.services.sync.orchestrator import enrich_request_metadata`

This fills BPM/key/genre asynchronously from Beatport/Tidal/MusicBrainz depending on source URL. Duplicate-vote path (`is_duplicate=True`) does not need enrichment — the original row already has or will have it.

---

## Section 3 — Enrich-Preview Endpoint

**File:** `server/app/api/collect.py` (new route added to the existing collect router — event-code-scoped, keeps auth/rate-limit context consistent)

New public endpoint for search-time vibes enrichment:

```
POST /api/public/collect/{code}/enrich-preview
```

**Request body:**
```json
[
  { "title": "Levels", "artist": "Avicii", "source_url": "https://open.spotify.com/track/..." },
  ...
]
```

**Response:**
```json
[
  { "title": "Levels", "artist": "Avicii", "bpm": 128, "key": "6B", "genre": "Progressive House" },
  ...
]
```

**Constraints:**
- Accepts up to 10 items per request (slice server-side, ignore excess)
- Calls Beatport fuzzy search only — no MusicBrainz (too slow for interactive use)
- No DB writes — purely a lookup / pass-through
- Rate-limited: 10 requests/minute per guest (`@limiter.limit("10/minute")`)
- Returns best-effort: items with no Beatport match return `{ title, artist, bpm: null, key: null, genre: null }`

---

## Section 4 — Join Page: Fix `SongDetailSheet`

**File:** `dashboard/app/join/[code]/components/SongDetailSheet.tsx`

### Artwork size fix
Replace:
```tsx
width: '100%', aspectRatio: '1'
```
With:
```tsx
width: 160, height: 160, margin: '0 auto'
```
Keep the existing glow, border-radius, shadow, and gradient fallback — just at fixed 160px.

### BPM / key pills
After the artist name `<div>`, add a pill row — rendered only when at least one field is non-null:

```tsx
{(track.bpm || track.musical_key) && (
  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'center' }}>
    {track.bpm && (
      <span style={/* cyan pill */}>{track.bpm} BPM</span>
    )}
    {track.musical_key && (
      <span style={/* dim pill */}>{track.musical_key}</span>
    )}
  </div>
)}
```

Pill styles match the WrzDJ aesthetic: cyan (`#00f0ff`) background tint with cyan border for BPM; dim white surface with dim border for key.

### Type update
`GuestRequestInfo` in `dashboard/lib/api.ts` (or generated from `api-types.ts`) gains:
```ts
bpm?: number | null
musical_key?: string | null
genre?: string | null
```

---

## Section 5 — Collect Page: New `CollectDetailSheet` Component

**File:** `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx`

### Props
```ts
interface Props {
  row: CollectLeaderboardRow;
  rank: number;
  totalCount: number;
  voted: boolean;
  onVote: () => void;
  onClose: () => void;
}
```

### Mobile layout (< 640px)
Full-screen bottom sheet using the existing `gst-detail-sheet` CSS class. Structure:
- Header bar: "PRE-EVENT · #rank" label + close button
- Artwork: 160px × 160px square, centered, same gradient fallback as SongDetailSheet
- BPM + key pills (null-guarded, same style as Section 4)
- Stats row: VOTES card + RANK card (side-by-side)
- "Suggested by" row (shown only when `row.nickname` is non-null)
- Bottom vote CTA: full-width, gradient button — disabled + outlined when already voted

### Desktop layout (≥ 640px)
Fixed-position overlay with `rgba(0,0,0,0.7)` backdrop covering the full viewport. Click backdrop to close.

Centered card: `max-width: 480px`, `border-radius: 20px`, dark surface background. Inside the card:
- Header bar (same as mobile)
- Art (96px) side-by-side with title / artist / pills in a horizontal row
- Stats row beneath
- Vote button beneath stats

The breakpoint is detected via a `useEffect`-tracked `isWide` boolean:
```ts
const [isWide, setIsWide] = useState(false);
useEffect(() => {
  const check = () => setIsWide(window.innerWidth >= 640);
  check();
  window.addEventListener('resize', check);
  return () => window.removeEventListener('resize', check);
}, []);
```

`isWide` switches between the two layout branches in the return statement.

### Wiring into `LeaderboardTabs`
Add optional prop: `onRowClick?: (row: CollectLeaderboardRow) => void`

On the outer `div` of each leaderboard row:
```tsx
onClick={() => onRowClick?.(r)}
```

On the vote button inside the row:
```tsx
onClick={(e) => { e.stopPropagation(); handleVote(r.id, r.vote_count); }}
```

### Wiring into `collect/[code]/page.tsx`
```ts
const [detailRow, setDetailRow] = useState<CollectLeaderboardRow | null>(null);
```
- Pass `onRowClick={setDetailRow}` to `<LeaderboardTabs />`
- Render `<CollectDetailSheet>` when `detailRow` is non-null

---

## Section 6 — Collect Page: "Highlight by Vibes" in Search

**File:** `dashboard/app/collect/[code]/page.tsx`

### State additions
```ts
const [sortByVibes, setSortByVibes] = useState(false);
const [enriching, setEnriching] = useState(false);
const [enrichedResults, setEnrichedResults] = useState<SearchResult[]>([]);
```

### Vibe scoring
Port the `vibeScored` `useMemo` from `join/[code]/page.tsx`. Reference BPM is the leaderboard's average (computed from `leaderboard?.requests` with non-null BPM values). No `nowPlaying` reference — key distance defaults to 0 when no reference key exists, so sorting is purely BPM-proximity to the collection average. Tier thresholds, labels, and rail colors are identical to join.

### Toggle behavior
When the user clicks "HIGHLIGHT BY VIBES":

1. `setSortByVibes(true)` immediately — button label changes, loading state begins
2. `setEnriching(true)` — triggers the loading animation on all result rows
3. Fire `POST /api/public/collect/{code}/enrich-preview` with the first 10 results (those lacking `bpm`/`key`)
4. On response: merge by positional index (request was sent in the same order as `searchResults.slice(0, 10)`) — returned array length matches input length, so `result[i]` maps to `searchResults[i]`. Merge into `enrichedResults` state, `setEnriching(false)`
5. `vibeScored` re-runs with merged data, rows reorder

Toggling off resets `sortByVibes` and `enrichedResults`.

### Loading animation (Option C — scanline)
While `enriching === true`, each result row:
- Gets a cyan→magenta horizontal scanline sweeping top-to-bottom (CSS `@keyframes` via inline `style` + `className`)
- Shows `"ANALYZING…"` blinking text below artist name (replaces tier label slot)
- Popularity ring is hidden during enrichment

On resolve:
- Scanlines and "ANALYZING…" removed
- Rows reorder by vibe score
- Tier labels fade in with `opacity: 0 → 1` + `translateY(3px → 0)` over 300ms

Button label during enrichment: `"READING VIBES…"` with a bouncing 🔍 icon. Returns to `"HIGHLIGHT BY VIBES"` after resolve.

### Toggle placement
Right-aligned in the results header row (same position as join) — visible only once results load:
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 10px' }}>
  <span>{searchResults.length} RESULTS</span>
  <div style={{ flex: 1 }} />
  <button onClick={handleVibesToggle}>
    {enriching ? '🔍 READING VIBES…' : 'HIGHLIGHT BY VIBES'}
  </button>
</div>
```

---

## Data Flow Summary

```
Guest searches on /collect
  └── searchResults arrive (Beatport results have bpm/key already)
      └── Guest clicks "HIGHLIGHT BY VIBES"
            └── POST /enrich-preview (Beatport lookup, no DB write)
                  └── Results merged → rows reorder by vibe score

Guest submits a pick on /collect
  └── POST /public/collect/{code}/requests
        └── SongRequest row created in DB
            └── BackgroundTask: enrich_request_metadata(db, row.id)
                  └── Beatport/Tidal/MusicBrainz fills bpm/musical_key/genre
                        └── Leaderboard poll returns row with bpm/musical_key/genre
                              └── CollectDetailSheet shows pills when guest taps row

Guest taps row on /collect leaderboard
  └── CollectDetailSheet opens
        └── Shows bpm/key pills (if enrichment has run)
        └── Desktop (≥640px): centered dialog; Mobile: full-screen sheet

Guest taps row on /join leaderboard
  └── SongDetailSheet opens (existing component, art now capped at 160px)
        └── Shows bpm/key pills (from GuestRequestInfo, now exposed)
```

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `server/app/api/public.py` | Add `bpm`/`musical_key`/`genre` to `PublicRequestInfo`; populate in endpoint |
| `server/app/schemas/collect.py` | Add same three fields to `CollectLeaderboardRow` |
| `server/app/api/collect.py` | Populate fields in leaderboard endpoint; add `BackgroundTasks` + `enrich_request_metadata` to submit; add `enrich-preview` route |

### Frontend
| File | Change |
|------|--------|
| `dashboard/lib/api.ts` | Add `bpm?`/`musical_key?`/`genre?` to `CollectLeaderboardRow` interface |
| `dashboard/app/join/[code]/components/SongDetailSheet.tsx` | Fix art size; add BPM/key pills |
| `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx` | **New** — responsive detail panel |
| `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx` | Add `onRowClick` prop; wire row clicks |
| `dashboard/app/collect/[code]/page.tsx` | Wire `CollectDetailSheet`; add vibes toggle + enrichment flow |

No Alembic migrations. No changes to bridge, bridge-app, or kiosk.

---

## Out of Scope

- Sharing the `SongDetailSheet` / `CollectDetailSheet` as a single component (deferred — different data shapes and context)
- Genre display in the detail panel (genre is enrichment metadata, not display data)
- MusicBrainz in the enrich-preview endpoint (too slow for interactive use)
- Vibes on the join page leaderboard rows (not requested)
