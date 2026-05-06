# Collect Page Song Preview

**Date:** 2026-05-05
**Status:** Approved

## Problem

Guests on the `/collect` page can vote on songs but cannot preview them before voting. Adding inline playback lets guests make more informed decisions and increases engagement.

## Solution

Add an iframe embed player (Spotify/Tidal) to the `CollectDetailSheet` component, fetched lazily via a new rate-limited endpoint to prevent bulk URL harvesting.

## Backend

### New Endpoint

```
GET /api/public/collect/{code}/requests/{request_id}/preview
```

**Response (200):**
```json
{
  "source": "spotify",
  "source_url": "https://open.spotify.com/track/abc123"
}
```

**Response (200 with null):** Request exists but has no `source_url` (manual entry) — returns `{ "source": "manual", "source_url": null }`.

**Response (404):** Request not found or doesn't belong to the given event.

**Guards:**
- `require_verified_human_soft` dependency (Turnstile-verified `wrzdj_human` cookie)
- Rate limit: `10/minute` per guest (via `get_guest_id`)
- Validates that `request_id` belongs to the event identified by `code`

**Schema:**
```python
class CollectPreviewResponse(BaseModel):
    source: Literal["spotify", "tidal", "beatport", "manual"]
    source_url: str | None
```

### No Changes To

- `CollectLeaderboardRow` schema (source_url stays excluded from bulk responses)
- Database models (no new columns)
- Existing enrichment pipeline

## Frontend

### CollectDetailSheet Changes

On mount (when sheet opens):
1. Fetch `GET /api/public/collect/{code}/requests/{row.id}/preview`
2. While loading: render nothing in preview area (avoid layout shift for fast responses)
3. On success, determine embed type via `getEmbedUrl()` from `preview-embed.ts`:
   - **Spotify/Tidal** (embeddable): Render `<iframe>` with embed URL
   - **Beatport** (not embeddable): Render "Open in Beatport" external link button
   - **No source_url / manual**: Render nothing (section absent)

### Iframe Specs

- Height: 152px (matches Spotify/Tidal compact player)
- Width: 100%
- Border radius: 14px (matches sheet card style)
- `allow="encrypted-media"` attribute
- `loading="lazy"` attribute
- Dark theme parameter where supported (`?theme=0` for Tidal)

### Position in Sheet

- **Mobile:** Below `suggestedBy` card, above the fixed-position vote button. Inside the scrollable area so it doesn't eat viewport on small screens.
- **Desktop:** Below `suggestedBy` card, above vote button (both in-flow).

### External Link Fallback (Beatport)

Styled as a subtle outlined button matching the sheet's design language:
- Monospace label: "OPEN IN BEATPORT"
- External link icon
- Opens in new tab (`target="_blank" rel="noopener noreferrer"`)

### No New Dependencies

Uses existing `preview-embed.ts` utilities: `getEmbedUrl()`, `getPreviewSource()`, `canEmbed()`.

## Abuse Mitigation

| Vector | Protection |
|--------|-----------|
| Bulk URL harvesting from leaderboard | `source_url` not in `CollectLeaderboardRow` — only via per-request endpoint |
| Automated embed loading | `wrzdj_human` cookie required (Cloudflare Turnstile-verified) |
| Rate abuse on preview endpoint | `10/minute` per `guest_id` — human-friendly, bot-hostile |
| Cross-event request enumeration | Endpoint validates `request.event_id` matches event with given `code` |
| Iframe embed play-count inflation | Spotify/Tidal enforce their own anti-fraud; we limit how many embed URLs a single guest can obtain per minute |

### API Call Impact Analysis

- **Zero additional calls to Spotify/Tidal from our backend.** The endpoint only reads `source_url` from our DB.
- Embed iframes load directly from Spotify/Tidal CDNs (client-side). Their infrastructure handles scale.
- Our backend cost: one DB query per detail sheet open (select `source`, `source_url` from `requests` where `id` and `event.code` match). Negligible.

## Testing

### Backend
- Endpoint returns correct `source` and `source_url` for Spotify/Tidal/Beatport requests
- Returns 200 with `source_url: null` for manual entries (no source_url)
- Returns 404 for request IDs not belonging to the given event code
- Rate limit triggers at 11th request within 1 minute
- Human verification cookie enforced (when `human_verification_enforced=True`)

### Frontend
- Iframe renders with correct embed URL for Spotify track
- Iframe renders with correct embed URL for Tidal track
- External link renders for Beatport track
- Nothing renders for manual entry (no source_url)
- Loading state doesn't cause layout shift
- Preview section scrollable on small mobile screens
