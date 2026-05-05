# Verified Badge in Request Lists

**Date**: 2026-05-04
**Author**: thewrz
**Status**: Approved

## Goal

Show a green checkmark next to verified users' nicknames in the request lists on both the `join` and `collect` pages. Matches the existing verified badge style in IdentityBar (`✓`, `#22c55e`).

## Approach

Outer-join the `guests` table when querying requests. Derive `requester_verified = guest.email_verified_at IS NOT NULL`. No migration needed — computed from existing columns.

## Backend

### Schema Changes

**`server/app/api/public.py` — `PublicRequestInfo`**
Add: `requester_verified: bool = False`

This propagates to `GuestRequestInfo` (extends `PublicRequestInfo`).

**`server/app/schemas/collect.py` — `CollectLeaderboardRow`**
Add: `requester_verified: bool = False`

### Query Changes

**`server/app/api/collect.py` — `leaderboard()` endpoint (line 114)**
- Join `Guest` on `SongRequest.guest_id == Guest.id` (outer join, since `guest_id` is nullable)
- Select `Guest.email_verified_at` alongside request columns
- Derive `requester_verified` in response construction

**`server/app/api/public.py` — `get_public_requests()` endpoint (line 184)**
- Either modify `get_guest_visible_requests()` in `services/request.py` to return tuples with verification status, or inline the join in the endpoint
- Same outer join pattern as collect

## Frontend

### Type Changes

**`dashboard/lib/api.ts` — `CollectLeaderboardRow`**
Add: `requester_verified?: boolean`

**`dashboard/lib/api-types.ts` — `GuestRequestInfo` (or `PublicRequestInfo`)**
Add: `requester_verified?: boolean`

### Rendering

**`dashboard/app/collect/[code]/components/LeaderboardTabs.tsx` ~line 170**
After nickname text, conditionally render:
```tsx
{r.requester_verified && <span style={{ color: '#22c55e', marginLeft: 4 }}>✓</span>}
```

**`dashboard/app/join/[code]/page.tsx` ~line 683**
Same pattern — append `✓` after "Requested by {nickname}" when `req.requester_verified` is true.

## Non-Goals

- No migration (no new DB columns)
- No changes to IdentityBar or existing badge
- No verified badge on kiosk display page
- No admin-side changes

## Testing

- Backend: add `requester_verified` field to existing test fixtures for `GuestRequestInfo` and `CollectLeaderboardRow`
- Verify field is `true` when guest has `email_verified_at` set, `false` otherwise
- Verify field is `false` when `guest_id` is null (orphaned request)
- Frontend: update existing component tests if they assert on rendered nickname rows
