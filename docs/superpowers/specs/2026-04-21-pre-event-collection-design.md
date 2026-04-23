# Pre-Event Song Collection — Design Spec

**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Date:** 2026-04-21
**Branch:** `feat/pre-event-requests`
**Author:** brainstorming session with djfreaq

## Summary

A new pre-event song-collection mode for WrzDJ events. DJs configure an "opens at" date and a "live at" date. Between those dates, guests visit a dedicated `/collect/[code]` page (distinct from the existing `/join/[code]`) where they submit songs, upvote others, and see themselves on a live leaderboard. Requests accumulate in the `NEW` state and are reviewed in bulk by the DJ — either anytime during collection, or via a sweep pass before (or during) the live event. At live-start the collection link auto-redirects to the normal join flow with a celebratory splash.

The collection UI is deliberately different from the live join page: it emphasizes social proof (ranked public leaderboard), personal stake ("my picks" with status badges), and lightweight gamification ("first to suggest", "top contributor"). An optional email opt-in unlocks cross-device identity and a future "notify me when my song plays" channel.

## Goals

- Let DJs open song voting before the event begins, driving engagement and shaping the setlist in advance.
- Provide a collection UI that is more engaging than the current join page (leaderboard, my-picks, gamification).
- Let DJs review accumulated requests in bulk (accept top N, accept by threshold, reject remaining) or cherry-pick individually.
- Keep the feature optional per event — events that don't set `collection_opens_at` behave exactly as today.
- Enforce security best practices consistent with the rest of the codebase: input sanitization, encrypted sensitive data, rate limiting, parameterized queries, no plaintext secrets, no error-message leakage.

## Non-Goals

- Notification delivery (email/SMS when a song plays). The *opt-in* is captured now; *sending* is a follow-up feature.
- Background jobs or scheduled tasks. Phase computation is entirely derived from timestamps at request time.
- Separate pre-event event entity. Collection is a phase of an existing event, not a new aggregate root.
- Redesign of the existing `/join/[code]` live page. Minimal change: a soft "pre-event voting is open" banner when applicable.

## Design Decisions Locked In

| Topic | Decision |
|---|---|
| Engagement model | Live ranked leaderboard + personal "my picks" view + lightweight gamification (top contributor, first-to-suggest) |
| Lifecycle | Time-driven auto-transitions (`collection_opens_at`, `live_starts_at`), with DJ manual override |
| Guest identity | Anonymous + nickname (localStorage) default; landing page promotes optional email opt-in with feature comparison panel |
| DJ review | Hybrid — cherry-pick anytime + dedicated bulk-sweep view (multi-select, accept top N, accept ≥X votes, reject remaining) |
| URL | Separate `/collect/[code]`, auto-redirect to `/join/[code]` after live-start with splash |
| Submission cap | DJ-configurable per event, default 15, `0` = unlimited |
| Unreviewed at live-start | Stay as `NEW` (forgiving — DJ can ignore or review mid-event) |
| Leaderboard visibility | Two tabs — "Trending" + "All", no minimum-votes floor |
| Architecture | Approach 1 — minimal extension of existing models (columns on `events` + `requests`, new `guest_profiles` table) |

## Architecture

### Data Model Changes

**Migration:** `server/alembic/versions/010_add_pre_event_collection.py`

`events` table — four new columns:

```python
collection_opens_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
live_starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
submission_cap_per_guest: Mapped[int] = mapped_column(Integer, default=15, server_default="15")
collection_phase_override: Mapped[str | None] = mapped_column(String(20), nullable=True)
# collection_phase_override ∈ {"force_collection", "force_live", None}
```

`requests` table — one new column:

```python
submitted_during_collection: Mapped[bool] = mapped_column(
    Boolean, default=False, server_default="0", index=True
)
```

Indexed along with `status` for the bulk-review query (`event_id + submitted_during_collection + status`).

**New table:** `guest_profiles`

```python
class GuestProfile(Base):
    __tablename__ = "guest_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    client_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    nickname: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    submission_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("event_id", "client_fingerprint"),)
```

**Security rules for `guest_profiles`:**
- `email` uses the `EncryptedText` TypeDecorator (Fernet AES-128-CBC + HMAC) — never plaintext, per CLAUDE.md hard rule.
- `(event_id, client_fingerprint)` uniqueness prevents duplicate profiles per event per device.
- `submission_count` is denormalized for fast cap checks and updated atomically inside the submission transaction.

### Derived Phase (Computed Property)

Not stored. Added as a property on `Event`:

```python
@property
def phase(self) -> Literal["pre_announce", "collection", "live", "closed"]:
    if self.collection_phase_override == "force_live":
        return "live"
    if self.collection_phase_override == "force_collection":
        return "collection"
    now = utcnow()
    if self.collection_opens_at and now < self.collection_opens_at:
        return "pre_announce"
    if self.live_starts_at and now < self.live_starts_at:
        return "collection"
    if now < self.expires_at:
        return "live"
    return "closed"
```

Events without `collection_opens_at` skip `pre_announce` and `collection` entirely and behave exactly like today — no migration data changes, full backward compatibility.

### API Surface

New router: `server/app/api/collect.py`, mounted at `/api/public/collect`.

#### Public endpoints (no auth, rate-limited)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/public/collect/{code}` | Event preview (name, banner, phase, dates, `submission_cap_per_guest`, `registration_enabled`, feature flags) |
| `GET` | `/api/public/collect/{code}/leaderboard` | Paginated ranked requests, `?tab=trending\|all` |
| `POST` | `/api/public/collect/{code}/requests` | Submit a song (rate-limited, cap-enforced, phase-gated) |
| `POST` | `/api/public/collect/{code}/vote` | Upvote (reuses existing vote service) |
| `POST` | `/api/public/collect/{code}/profile` | Set/update nickname + optional email |
| `GET` | `/api/public/collect/{code}/profile/me` | Returns this guest's "my picks" by fingerprint |

#### DJ endpoints (authenticated, `get_current_active_user`, ownership-checked)

Added to `server/app/api/events.py`:

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/events/{code}/collection` | Set/update collection settings (`collection_opens_at`, `live_starts_at`, `submission_cap_per_guest`, `collection_phase_override`) |
| `GET` | `/api/events/{code}/pending-review` | List `NEW` requests with `submitted_during_collection=True`, sorted by `vote_count DESC` |
| `POST` | `/api/events/{code}/bulk-review` | Bulk action (`accept_top_n`, `accept_threshold`, `accept_ids`, `reject_ids`, `reject_remaining`) |

#### Existing endpoint changes

- `POST /api/events` — accept optional new collection fields (null = today's behavior).
- `POST /api/requests` — when `event.phase == "collection"`, set `submitted_during_collection=True` and enforce cap via `GuestProfile.submission_count`.

### Frontend Components

#### New route: `/collect/[code]`

`dashboard/app/collect/[code]/page.tsx` plus components:

- **Event banner header** — reuses existing banner/phase-badge rendering with a countdown to `live_starts_at`.
- **Feature opt-in panel** — collapsible, dismissible, promotes email opt-in with a feature comparison ("🔔 Notify me when my song plays", "🏆 Cross-device leaderboard", "📊 Persistent profile"). Renders only when guest has no email on file.
- **"My Picks" panel** — fetched from `GET /profile/me`; shows submitted + upvoted songs with status badges (`submitted`, `trending`, `queued`, `played`) and gamification badges ("⭐ First to suggest", "🏆 Top contributor").
- **Leaderboard tabs** — "Trending" (requests with `vote_count >= 1`, sorted DESC) and "All" (every submission, newest first). Each row: artwork, title, artist, vote count, upvote button, submitter nickname, status chip.
- **Sticky request button** — opens the existing `SongSearch` component (reused from `/join/[code]`). Shows "X of Y picks used" counter, disables at cap.

#### DJ dashboard changes

Event page (`dashboard/app/events/[code]/page.tsx`) gets a **third tab** alongside existing `SongManagementTab` and `EventManagementTab`:

- **`PreEventVotingTab.tsx`** — full-width tab content area:
  - Phase stats card (current phase, submission count, unique guests, top submitter)
  - Phase override buttons (Open now / Start live now / Pause) with confirmation modals
  - Share link + QR for `/collect/[code]`, distinct from the existing live-event share
  - Inline bulk-review table — multi-select, "Accept top N", "Accept ≥ X votes", "Reject remaining"
  - Filter chip: "Pending only" (default) vs "All pre-event submissions"

The tab is **hidden entirely** if `event.collection_opens_at` is null, keeping the UI clean for DJs who don't use the feature.

Event creation/edit form gets a new collapsible "Pre-event collection" section (off by default):
- Enable checkbox
- `collection_opens_at` datetime picker
- `live_starts_at` datetime picker
- `submission_cap_per_guest` number input
- Post-save: "Copy pre-event link" + QR display

## Phase Transitions

**Almost nothing happens "at transition time."** `Event.phase` is derived on demand. Unreviewed collection requests stay `NEW` and flow into the live queue.

### Phase-aware behavior summary

| Action | Phase | Behavior |
|---|---|---|
| `POST /collect/*/requests` | `collection` | Accept (cap-enforced) |
| `POST /collect/*/requests` | `live` or `closed` | 409 "Collection has ended" |
| `GET /collect/[code]` frontend | `pre_announce` | Show "opens in Xd Yh" countdown |
| `GET /collect/[code]` frontend | `collection` | Full experience |
| `GET /collect/[code]` frontend | `live` | `router.replace('/join/[code]')` + splash |
| `GET /collect/[code]` frontend | `closed` | Redirect to `/join/[code]` (handles expired state) |
| `GET /join/[code]` frontend | `pre_announce` or `collection` | Soft banner linking to `/collect/[code]` |
| `GET /join/[code]` frontend | `live` or `closed` | Today's behavior (unchanged) |

### Redirect mechanics

1. **First-render redirect** — initial `GET /api/public/collect/{code}` returns `phase`; if not `pre_announce`/`collection`, redirect fires before mount.
2. **Poll-triggered redirect** — leaderboard poll (every 5s, paused when tab hidden) returns phase; phase change triggers redirect + splash.

**Splash** — pre-redirect sets `sessionStorage["wrzdj_live_splash_{code}"] = "1"`. The `/join/[code]` page checks once, renders a 3-second banner "🎉 The event is now live — you're in!", clears the flag. No persistent state, no URL params to forge.

### Manual override

`collection_phase_override` wins over timestamp-based computation. DJ clicks "Start live now" → backend sets `override = "force_live"`. Public endpoints reject new submissions immediately; guests on next poll see new phase and redirect. DJ can clear override to resume timestamp behavior.

### Edge cases

| Case | Behavior |
|---|---|
| `collection_opens_at` in past on new event | Allowed — starts immediately |
| `live_starts_at` edited earlier than now mid-collection | Collection ends immediately, frontend redirects on next poll |
| DJ deletes `collection_opens_at` on event with submissions | Submissions stay (they're just `NEW` requests with `submitted_during_collection=True`); Pre-Event Voting tab hides |
| `collection_opens_at >= live_starts_at` | Rejected at validation time (zod + Pydantic) |
| `expires_at <= live_starts_at` | Rejected at validation time |
| Clock skew between server and client | Server is source of truth; client phase is advisory for UI only |

## Security Design

Security is treated as a first-class requirement. Every cross-cutting concern matches established codebase patterns — no new auth paths, no novel crypto, no custom input-validation layer. All new input goes through both client-side zod and server-side Pydantic (defense in depth). All sensitive data is encrypted at rest. All public endpoints are rate-limited.

### Input sanitization checklist

| Field | Client (zod) | Server (Pydantic) | DB column |
|---|---|---|---|
| `nickname` | `z.string().trim().min(1).max(30).regex(/^[a-zA-Z0-9 _.-]+$/)` | `constr(strip_whitespace=True, min_length=1, max_length=30, pattern=r'^[a-zA-Z0-9 _.-]+$')` | `String(30)` |
| `email` | `z.string().email().max(254)` | `EmailStr` (from `pydantic[email]`) | `EncryptedText` |
| `note` | `z.string().trim().max(500)` | `constr(strip_whitespace=True, max_length=500)` | `Text` |
| `song_title`, `artist` | Existing search flow | Existing search flow | `String(255)` |
| datetimes | Native input + ISO parse | `datetime` + custom validator (`< 1yr future`, ordering) | `DateTime` |
| `collection_phase_override` | Enum | `Literal["force_collection", "force_live"] \| None` | `String(20)` |
| bulk-review `action` | Enum | Pydantic discriminated union | — |

**No raw HTML rendering of user input.** React renders nickname/note as text nodes by default. The feature must not introduce any unsafe HTML-injection escape hatches; reviewer should grep the PR for such patterns and reject if any are introduced.

**`artwork_url` whitelist** — only accepted values from known CDNs (Spotify, Beatport, Tidal) via the existing search layer. Collection endpoints never accept user-supplied `artwork_url` directly.

### Rate limits (slowapi)

| Endpoint | Limit | Rationale |
|---|---|---|
| `POST /collect/{code}/requests` | 10/min per IP | Matches live submission rate |
| `POST /collect/{code}/vote` | 60/min per IP | Matches existing vote endpoint |
| `POST /collect/{code}/profile` | 5/min per IP | Prevents nickname/email churn abuse |
| `GET /collect/{code}/leaderboard` | No hard limit | 5s in-process TTL cache in service layer |
| `GET /collect/{code}` | No hard limit | Cheap phase check, polled frequently |

Limit values stored in DB-backed `system_settings` (reuses `search_rate_limit_per_minute` pattern) so admin can tune at runtime.

### Submission cap (defense in depth)

- **Client-side** — button disables at `submission_count >= cap`, counter visible. UX only; never the trust boundary.
- **Server-side** — `POST /requests` opens a DB transaction, re-reads `GuestProfile.submission_count`, compares to `event.submission_cap_per_guest`, increments atomically. Over-cap → 429 "Picks limit reached".
- `cap=0` = unlimited (explicit).

### Identity hardening

- Reuses existing `client_fingerprint` helper (`X-Forwarded-For`-aware from `votes.py`). No new fingerprinting path.
- `(event_id, client_fingerprint)` is the identity key — not the nickname. Two guests can share a nickname; top-contributor badges tie to the fingerprint, preventing rank theft via nickname copy.
- Optional email stored via `EncryptedText` (Fernet) — never plaintext, per CLAUDE.md hard rule.

### Authorization

- Every DJ route: `get_current_active_user` + ownership check (`event.created_by_user_id == current_user.id` OR `role == "admin"`). Mirrors `events.py` existing guards.
- No new auth paths — reuses `api/deps.py` dependencies.
- `pending` users blocked via `get_current_active_user` (existing behavior).

### Error-message hygiene

- Phase-mismatch: `{"detail": "Collection has ended"}`.
- Over-cap: `{"detail": "Picks limit reached"}` (no cap or count disclosed).
- Global 500 handler (`server/app/main.py`) strips stack traces in production.

### DoS / abuse surface

- Leaderboard cached 5s at service layer; poll-storms don't flatten DB.
- Phase endpoint single-row query; no N+1.
- Bulk-review actions bounded at ≤200 IDs per call; UI paginates past that.
- Concurrent bulk-review actions run in a single DB transaction per call (prevents double-accept from two tabs).

### Dependency review

**Zero new Python packages.** `EncryptedText`, `EmailStr`, `Pydantic`, `slowapi`, `SQLAlchemy` all already present.
**Zero new JS packages.** `zod` already in use; no new UI libraries (staying on vanilla CSS + React).
**Zero net-new CVE surface.**

## Testing Strategy

### Backend tests (`server/tests/`, pytest, 80% coverage floor)

New test files:
- `test_collect_public.py` — guest-facing endpoints (submit, vote, profile, leaderboard, phase gate)
- `test_collect_dj.py` — DJ-side (collection settings, bulk-review, pending-review listing)
- `test_event_phase.py` — derived `phase` across all timestamp/override combinations
- `test_guest_profile.py` — `GuestProfile` model, submission_count atomicity, email encryption round-trip

Coverage targets:
- Every branch of `Event.phase` (`pre_announce`, `collection`, `live`, `closed`, both override modes)
- Submit during each phase → correct 200 vs 409
- Cap enforcement: over-cap → 429, `cap=0` → unlimited, atomic increment
- Ownership: non-owner → 403 on every DJ route (parametrized)
- Bulk-review actions: each type with empty / mid-size / 200-row-limit fixtures
- Email encryption: DB column verified to not contain plaintext
- Datetime validation: ordering, past-date edge cases

New `conftest.py` fixtures:
- `event_with_collection` (currently in `collection` phase)
- `event_in_pre_announce`
- `event_post_live` (had submissions)
- `guest_profile`
- `collection_requests` (factory for N `NEW` collection requests)

Existing fixtures (`client`, `auth_headers`, etc.) reused as-is.

### Frontend tests (`dashboard/`, vitest + jsdom)

New test files:
- `app/collect/[code]/page.test.tsx` — render states per phase, redirect on live
- `app/collect/[code]/components/LeaderboardTabs.test.tsx` — tab filtering, optimistic vote update + rollback
- `app/collect/[code]/components/MyPicksPanel.test.tsx` — empty state, badges
- `app/collect/[code]/components/SubmissionCapCounter.test.tsx` — counter, disabled state
- `app/events/[code]/components/PreEventVotingTab.test.tsx` — DJ tab, multi-select, bulk actions
- `lib/__tests__/collect-api.test.ts` — API client methods, error paths (401, 409, 429)

Coverage targets:
- Phase-change redirect fires on mount AND on poll
- Splash flag written + consumed + cleared exactly once
- Optimistic vote/submit rolls back on API error
- zod validation mirrors server Pydantic rules (prevents client/server drift)
- Polling pauses when tab hidden
- Feature opt-in panel hides after email is set

Shared-type fixtures updated whenever new fields land on `PublicRequestInfo` or equivalent — per CLAUDE.md pitfall note.

### Security test suite (`~/wrzdj-testing/`)

New suite file: `11-pre-event-collection.sh`. Covers:

- Unauthorized DJ route access (non-owner, pending, unauthenticated)
- Phase gate enforcement (submit during `live` → 409, `closed` → 409)
- Submission-cap bypass (concurrent POSTs, cap=3 → submit 10)
- Rate-limit enforcement (hit each new endpoint past its cap → 429)
- Nickname injection attempts (script-tag payloads, RTL overrides, null bytes, 1000-char)
- Email injection attempts (SQL-style, bidirectional chars, 10k-char)
- Bulk-review ownership bypass (another DJ's code → 403)
- `collection_phase_override` enum enforcement (free-form string rejected)
- Leaderboard cache key integrity (not user-controlled)

Integrated via `~/wrzdj-testing/run-all.sh 11`.

### CI enforcement

No workflow changes needed. Existing `.github/workflows/ci.yml` pipeline covers:
- Backend: ruff + bandit + pip-audit + pytest (`--cov-fail-under=80`)
- Frontend: ESLint + `tsc --noEmit` + vitest + npm audit
- Alembic drift: `alembic upgrade head && alembic check` (migration 010)

### Manual verification (PR description checklist)

- [ ] Create event with collection enabled; pre-event link works on mobile (LAN IP)
- [ ] Two browsers submit → leaderboard updates within 5s on both
- [ ] Hit submission cap → UI + server both block
- [ ] Manual phase override → `/collect/*` redirects immediately
- [ ] Auto transition via `live_starts_at` in 1min → auto-redirect fires
- [ ] Bulk-accept top 20 → all visible in Song Management tab
- [ ] Delete collection dates → Pre-Event Voting tab hides cleanly
- [ ] Inspect DB — email column has no plaintext

## Open Questions / Deferred

- Notification delivery (email/SMS on song-played) — opt-in captured, sending pipeline is a follow-up spec.
- Reminder emails ("event starts in 1h, you have N pending reviews") — deferred.
- Analytics on collection-vs-live performance (acceptance rate, vote distribution) — future.

## Files Touched (Preliminary)

**New:**
- `server/alembic/versions/010_add_pre_event_collection.py`
- `server/app/models/guest_profile.py`
- `server/app/api/collect.py`
- `server/app/schemas/collect.py`
- `server/app/services/collect.py`
- `server/tests/test_collect_public.py`
- `server/tests/test_collect_dj.py`
- `server/tests/test_event_phase.py`
- `server/tests/test_guest_profile.py`
- `dashboard/app/collect/[code]/page.tsx`
- `dashboard/app/collect/[code]/components/*` (LeaderboardTabs, MyPicksPanel, FeatureOptInPanel, SubmissionCapCounter, SearchRequestForm wrapper)
- `dashboard/app/events/[code]/components/PreEventVotingTab.tsx`
- `dashboard/app/collect/[code]/__tests__/*`
- `dashboard/app/events/[code]/components/__tests__/PreEventVotingTab.test.tsx`
- `dashboard/lib/__tests__/collect-api.test.ts`
- `~/wrzdj-testing/11-pre-event-collection.sh` (outside repo)

**Modified:**
- `server/app/models/event.py` — new columns + derived `phase` property
- `server/app/models/request.py` — new `submitted_during_collection` column
- `server/app/api/events.py` — new DJ routes (`PATCH /collection`, `GET /pending-review`, `POST /bulk-review`)
- `server/app/api/requests.py` — phase-aware submission (sets `submitted_during_collection`, enforces cap)
- `server/app/main.py` — register new `collect` router
- `server/app/schemas/event.py` — new optional collection fields on create/update
- `dashboard/app/events/[code]/page.tsx` — third tab registration
- `dashboard/app/events/new/page.tsx` and edit form — collapsible collection section
- `dashboard/app/join/[code]/page.tsx` — soft banner linking to collect link when phase allows
- `dashboard/lib/api.ts` — new collect API methods
- `~/wrzdj-testing/run-all.sh` — register suite 11
