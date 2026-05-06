# Collect Song Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline Spotify/Tidal iframe preview to `CollectDetailSheet` via a lazy-fetch endpoint that protects source URLs from bulk scraping.

**Architecture:** New `GET /api/public/collect/{code}/requests/{id}/preview` endpoint returns `source` + `source_url` for a single request, gated by human verification and rate limiting. Frontend fetches on detail sheet open, renders embed iframe (Spotify/Tidal) or external link (Beatport) using existing `preview-embed.ts` utilities.

**Tech Stack:** Python/FastAPI (backend endpoint), React/TypeScript (frontend embed), existing `preview-embed.ts` utilities.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `server/app/schemas/collect.py` | Add `CollectPreviewResponse` schema |
| Modify | `server/app/api/collect.py` | Add preview endpoint |
| Modify | `server/tests/test_collect_public.py` | Tests for preview endpoint |
| Modify | `dashboard/lib/api.ts` | Add `getCollectPreview()` method + `CollectPreviewResponse` interface |
| Modify | `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx` | Fetch + render embed |

---

### Task 1: Backend Schema

**Files:**
- Modify: `server/app/schemas/collect.py:73` (after `CollectLeaderboardRow`)

- [ ] **Step 1: Add `CollectPreviewResponse` schema**

Add after line 73 in `server/app/schemas/collect.py` (after `CollectLeaderboardRow` class):

```python
class CollectPreviewResponse(BaseModel):
    source: Literal["spotify", "tidal", "beatport", "manual"]
    source_url: str | None
```

- [ ] **Step 2: Export from the schema import in collect API**

In `server/app/api/collect.py`, add `CollectPreviewResponse` to the import block from `app.schemas.collect` (line 23-37):

```python
from app.schemas.collect import (
    CollectEventPreview,
    CollectLeaderboardResponse,
    CollectLeaderboardRow,
    CollectMyPicksItem,
    CollectMyPicksResponse,
    CollectPreviewResponse,  # NEW
    CollectProfileRequest,
    CollectProfileResponse,
    CollectSubmitRequest,
    CollectVoteRequest,
    EnrichPreviewItem,  # noqa: F401
    EnrichPreviewRequest,
    EnrichPreviewResponse,
    EnrichPreviewResult,
)
```

- [ ] **Step 3: Commit**

```bash
git add server/app/schemas/collect.py server/app/api/collect.py
git commit -m "feat(collect): add CollectPreviewResponse schema"
```

---

### Task 2: Backend Endpoint

**Files:**
- Modify: `server/app/api/collect.py` (add endpoint after existing endpoints)

- [ ] **Step 1: Write the failing test**

Add to `server/tests/test_collect_public.py`:

```python
def test_collect_preview_returns_source_url(client, db, test_event, collection_requests):
    """Preview endpoint returns source + source_url for a valid request."""
    _enable_collection(db, test_event)
    req = collection_requests[0]
    req.source_url = "https://open.spotify.com/track/abc123"
    db.commit()

    r = client.get(
        f"/api/public/collect/{test_event.code}/requests/{req.id}/preview"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "spotify"
    assert body["source_url"] == "https://open.spotify.com/track/abc123"


def test_collect_preview_null_source_url_for_manual(client, db, test_event, collection_requests):
    """Preview endpoint returns source_url=null for manual entries."""
    _enable_collection(db, test_event)
    req = collection_requests[0]
    req.source = "manual"
    req.source_url = None
    db.commit()

    r = client.get(
        f"/api/public/collect/{test_event.code}/requests/{req.id}/preview"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "manual"
    assert body["source_url"] is None


def test_collect_preview_404_wrong_event(client, db, test_event, collection_requests):
    """Preview endpoint returns 404 when request belongs to a different event."""
    _enable_collection(db, test_event)
    req = collection_requests[0]

    r = client.get(f"/api/public/collect/ZZZZZZ/requests/{req.id}/preview")
    assert r.status_code == 404


def test_collect_preview_404_nonexistent_request(client, db, test_event):
    """Preview endpoint returns 404 for nonexistent request ID."""
    _enable_collection(db, test_event)

    r = client.get(f"/api/public/collect/{test_event.code}/requests/99999/preview")
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py::test_collect_preview_returns_source_url tests/test_collect_public.py::test_collect_preview_null_source_url_for_manual tests/test_collect_public.py::test_collect_preview_404_wrong_event tests/test_collect_public.py::test_collect_preview_404_nonexistent_request -v`

Expected: FAIL with 404 (no matching route)

- [ ] **Step 3: Implement the endpoint**

Add at the end of `server/app/api/collect.py` (after the `enrich_preview` endpoint):

```python
@router.get(
    "/{code}/requests/{request_id}/preview",
    response_model=CollectPreviewResponse,
)
@limiter.limit("10/minute")
def request_preview(
    code: str,
    request_id: int,
    request: Request,
    _human: int | None = Depends(require_verified_human_soft),
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    song_request = (
        db.query(SongRequest)
        .filter(SongRequest.id == request_id, SongRequest.event_id == event.id)
        .one_or_none()
    )
    if song_request is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return CollectPreviewResponse(
        source=song_request.source,
        source_url=song_request.source_url,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py::test_collect_preview_returns_source_url tests/test_collect_public.py::test_collect_preview_null_source_url_for_manual tests/test_collect_public.py::test_collect_preview_404_wrong_event tests/test_collect_public.py::test_collect_preview_404_nonexistent_request -v`

Expected: All 4 PASS

- [ ] **Step 5: Run full backend CI checks**

```bash
cd server && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest --tb=short -q
```

- [ ] **Step 6: Commit**

```bash
git add server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat(collect): add preview endpoint for lazy source_url fetch"
```

---

### Task 3: Frontend API Client

**Files:**
- Modify: `dashboard/lib/api.ts` (add interface + method)

- [ ] **Step 1: Add `CollectPreviewResponse` interface**

Add after the `CollectMyPicksResponse` interface (around line 150) in `dashboard/lib/api.ts`:

```typescript
export interface CollectPreviewResponse {
  source: 'spotify' | 'tidal' | 'beatport' | 'manual';
  source_url: string | null;
}
```

- [ ] **Step 2: Add `getCollectPreview()` method**

Add in the `ApiClient` class, after the `enrichCollectPreview` method (in the Pre-Event Collection section):

```typescript
  async getCollectPreview(code: string, requestId: number): Promise<CollectPreviewResponse> {
    const res = await fetch(
      `${getApiUrl()}/api/public/collect/${code}/requests/${requestId}/preview`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' },
    );
    if (!res.ok) throw new ApiError(`getCollectPreview failed: ${res.status}`, res.status);
    return res.json();
  }
```

- [ ] **Step 3: Run frontend type check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat(collect): add getCollectPreview API client method"
```

---

### Task 4: Frontend Embed in Detail Sheet

**Files:**
- Modify: `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx`

- [ ] **Step 1: Add `code` prop to component interface**

The detail sheet needs the event code to call the preview endpoint. Update the `Props` interface:

```typescript
interface Props {
  row: CollectLeaderboardRow;
  code: string;  // NEW — event code for preview fetch
  rank: number;
  totalCount: number;
  voted: boolean;
  onVote: () => void;
  onClose: () => void;
}
```

Update the destructuring:

```typescript
export default function CollectDetailSheet({
  row, code, rank, totalCount, voted, onVote, onClose,
}: Props) {
```

- [ ] **Step 2: Add preview fetch + embed state**

Add imports at the top:

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { CollectLeaderboardRow, CollectPreviewResponse } from '@/lib/api';
import { apiClient } from '@/lib/api';
import { getEmbedUrl, getPreviewSource } from '@/lib/preview-embed';
```

Add state and fetch effect after the `isWide` effect (around line 44):

```typescript
  const [preview, setPreview] = useState<CollectPreviewResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.getCollectPreview(code, row.id).then((data) => {
      if (!cancelled) setPreview(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [code, row.id]);
```

- [ ] **Step 3: Create the embed section JSX**

Add a variable before the `if (isWide === null)` guard (around line 154):

```typescript
  const previewSection = (() => {
    if (!preview || !preview.source_url) return null;

    const previewData = { source: preview.source, sourceUrl: preview.source_url };
    const embedUrl = getEmbedUrl(previewData);
    const source = getPreviewSource(previewData);

    if (embedUrl) {
      return (
        <div style={{ marginTop: 12 }}>
          <iframe
            src={embedUrl + (source === 'tidal' ? '?coverImageStyle=round&tracklist=false' : '')}
            width="100%"
            height={152}
            style={{ borderRadius: 14, border: 'none' }}
            allow="encrypted-media"
            loading="lazy"
          />
        </div>
      );
    }

    if (source === 'beatport') {
      return (
        <div style={{ marginTop: 12 }}>
          <a
            href={preview.source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', height: 44, borderRadius: 12,
              background: surface, border: `1px solid ${border}`,
              fontFamily: 'var(--font-mono, monospace)', fontSize: 11, fontWeight: 700,
              color: 'rgba(255,255,255,0.7)', textDecoration: 'none', letterSpacing: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
            </svg>
            OPEN IN BEATPORT
          </a>
        </div>
      );
    }

    return null;
  })();
```

- [ ] **Step 4: Insert `previewSection` in the desktop layout**

In the desktop (wide) branch, add `{previewSection}` after `{suggestedBy}` and before `{voteBtn}` in the bottom `<div>` (around line 200-205):

```typescript
          <div style={{ padding: '0 16px 16px' }}>
            {statsRow}
            {suggestedBy}
            {previewSection}
            {voteBtn}
          </div>
```

- [ ] **Step 5: Insert `previewSection` in the mobile layout**

In the mobile branch, add `{previewSection}` after `{suggestedBy}` inside the scrollable area (around line 247):

```typescript
        {statsRow}
        {suggestedBy}
        {previewSection}
      </div>
```

- [ ] **Step 6: Pass `code` prop from the parent page**

In `dashboard/app/collect/[code]/page.tsx`, update the `CollectDetailSheet` usage (line 435):

```typescript
      {detailRow && (
        <CollectDetailSheet
          row={detailRow}
          code={code}
          rank={(leaderboard?.requests ?? []).findIndex((r) => r.id === detailRow.id) + 1 || 1}
          totalCount={leaderboard?.requests.length ?? 0}
          voted={detailVoted || votedIds.has(detailRow.id)}
          onVote={async () => {
```

- [ ] **Step 7: Run frontend type check and lint**

```bash
cd dashboard && npx tsc --noEmit && npm run lint
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/collect/\[code\]/components/CollectDetailSheet.tsx dashboard/app/collect/\[code\]/page.tsx
git commit -m "feat(collect): render song preview embed in detail sheet"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full backend CI**

```bash
cd server && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/bandit -r app -c pyproject.toml -q && .venv/bin/pytest --tb=short -q
```

- [ ] **Step 2: Run full frontend CI**

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```

- [ ] **Step 3: Manual smoke test**

Start the dev server and verify:
1. Open `/collect/{code}` page
2. Tap a song with a Spotify `source_url` — iframe embed appears in detail sheet
3. Tap a song with a Tidal `source_url` — iframe embed appears
4. Tap a song with a Beatport `source_url` — "OPEN IN BEATPORT" link appears
5. Tap a manual entry — no preview section visible
6. Verify embed doesn't cause layout shift on mobile

- [ ] **Step 4: Final commit (if any lint/format fixes needed)**

```bash
cd server && .venv/bin/ruff format .
git add -u && git commit -m "style: format fixes"
```
