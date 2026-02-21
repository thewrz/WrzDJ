# Frontend Coverage Uplift Plan: Display & Events Pages

## Context

Three frontend files are dragging down dashboard coverage. The global thresholds are 77% stmts / 70% branch / 65% funcs / 78% lines. The event detail page (`events/[code]/page.tsx`) at 36% statements is the single biggest bottleneck.

| File | Current Stmts | Target | Lines of Code |
|------|--------------|--------|---------------|
| `events/[code]/page.tsx` | 36.2% | ~70% | 1073 |
| `display/page.tsx` | 67.7% | ~85% | 982 |
| `events/page.tsx` | 65.3% | ~80% | 190 |

**Estimated total: ~73 new tests across 3 files.**

---

## Phase 1: `events/page.tsx` (~11 tests, ~1 hour)

Smallest file, quickest wins, validates test infrastructure.

### File: `dashboard/app/events/__tests__/page.test.tsx` (extend existing)

Refactor `useAuth` mock to variable-based approach so admin role tests work:

```typescript
let mockRole = 'dj';
const mockLogout = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, role: mockRole, logout: mockLogout }),
}));
```

### Tests

#### `describe('Create event form')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 1 | shows form when Create Event clicked | form with "Event Name" input appears | No | Default |
| 2 | creates event and adds to list | `api.createEvent` called, new event in DOM | No | `createEvent` resolves |
| 3 | hides form and resets input after create | form gone, input cleared | No | Same |
| 4 | shows error when create fails | error message visible | No | `createEvent` rejects |
| 5 | disables button while creating | "Creating..." text, button disabled | No | Pending promise |
| 6 | ignores submit with empty name | `createEvent` not called | No | Default |
| 7 | hides form on Cancel | form disappears, no API call | No | Default |

#### `describe('Loading & navigation')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 8 | shows loading state during fetch | "Loading events..." visible | No | Pending promise |
| 9 | calls logout on Logout click | `mockLogout` called once | No | Default |

#### `describe('Admin role')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 10 | shows Admin button for admin role | button visible | No | `mockRole = 'admin'` |
| 11 | hides Admin button for dj role | button absent | No | Default |

---

## Phase 2: `display/page.tsx` (~20 tests, ~2-3 hours)

Extend existing test file. Master fake timer + polling patterns here before tackling the harder Phase 3.

### File: `dashboard/app/e/[code]/display/page.test.tsx` (extend existing)

### Tests

#### `describe('3s polling loop')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 1 | calls loadDisplay on mount | `getKioskDisplay` called once | No | Default |
| 2 | polls every 3 seconds | 3 calls after 6s (initial + 2 ticks) | Yes | Default |
| 3 | stops polling on 404 | no calls after initial 404 | Yes | Rejects 404 |
| 4 | stops polling on 410 | no calls after initial 410 | Yes | Rejects 410 |
| 5 | continues on transient error with data | polling continues after network error | Yes | 1st ok, 2nd fail, 3rd ok |

#### `describe('Sticky now-playing (10s grace)')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 6 | shows now-playing immediately | track title visible | No | `getNowPlaying` returns track |
| 7 | keeps track for 10s after null with fading | track visible + fading class at 5s | Yes | Track then null |
| 8 | clears track after 10s grace | "Now Playing" section gone | Yes | Track then null, advance 10s |
| 9 | cancels timer when new track arrives | new track replaces, no fade | Yes | A -> null -> B within 10s |

#### `describe('New item animation')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 10 | adds queue-item-new class for new items | class present on new item | Yes | 1st poll 1 item, 2nd poll 2 items |
| 11 | removes animation class after 800ms | class removed | Yes | Advance 800ms |

#### `describe('Auto-scroll (display-only mode)')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 12 | no auto-scroll when displayOnly=false | scrollBy not called | Yes | Default |
| 13 | scrolls down every 5s when displayOnly=true | scrollBy called | Yes | displayOnly=true |
| 14 | scrolls to top when near bottom | scrollTo({top:0}) | Yes | Mock scroll props near bottom |

#### `describe('Kiosk protections')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 15 | prevents context menu | `preventDefault` called on contextmenu | No | Default |
| 16 | prevents text selection | `preventDefault` called on selectstart | No | Default |

#### `describe('Banner colors')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 17 | applies banner gradient with valid colors | CSS variable set | No | `banner_colors: [3 hex]` |
| 18 | falls back for invalid color values | default color used | No | `banner_colors: ['bad', ...]` |
| 19 | renders banner image when present | `img` with correct src | No | `banner_kiosk_url` set |

#### `describe('Error display')`

| # | Test | Asserts | Timers | Mocks |
|---|------|---------|--------|-------|
| 20 | shows "Event Expired" for 410 | text visible | No | Rejects 410 |

### Tricky Pattern: Scroll Property Mocking

```typescript
const scrollByMock = vi.fn();
Object.defineProperty(HTMLDivElement.prototype, 'scrollBy', { value: scrollByMock, configurable: true });
Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', { value: 990, configurable: true });
Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { value: 500, configurable: true });
Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', { value: 1500, configurable: true });
```

### Tricky Pattern: Fake Timers + Async Polling

```typescript
vi.useFakeTimers();
render(<KioskDisplayPage />);
await act(async () => { await vi.advanceTimersByTimeAsync(100); }); // flush initial load
await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // first poll
expect(api.getKioskDisplay).toHaveBeenCalledTimes(2);
vi.useRealTimers();
```

---

## Phase 3: `events/[code]/page.tsx` (~42 tests, ~4-5 hours)

Largest file, most handlers, most complexity. By this point, fake timer and mock patterns are proven.

### File: `dashboard/app/events/[code]/__tests__/page.test.tsx` (new file)

### Mock Setup

Shallow-render all child components to isolate page logic. Capture props via module-level variables:

```typescript
let capturedSongTabProps: Record<string, unknown> = {};
vi.mock('../components/SongManagementTab', () => ({
  SongManagementTab: (props: Record<string, unknown>) => {
    capturedSongTabProps = props;
    return <div data-testid="song-tab">SongTab</div>;
  },
}));

let capturedManageTabProps: Record<string, unknown> = {};
vi.mock('../components/EventManagementTab', () => ({
  EventManagementTab: (props: Record<string, unknown>) => {
    capturedManageTabProps = props;
    return <div data-testid="manage-tab">ManageTab</div>;
  },
}));
```

Also mock: `DeleteEventModal`, `NowPlayingBadge`, `TidalLoginModal`, `BeatportLoginModal`, `ServiceTrackPickerModal`, `RequestQueueSection`, `PlayHistorySection`, `ThemeToggle`, `EventErrorCard`, help context, auth, navigation, QRCodeSVG, tab-title.

### Mock Data Factories

```typescript
function mockEvent(overrides = {}) {
  return {
    id: 1, code: 'TEST', name: 'Test Event',
    created_at: '2026-01-01T00:00:00Z', expires_at: '2026-12-31T00:00:00Z',
    is_active: true, join_url: null, requests_open: true,
    tidal_sync_enabled: false, tidal_playlist_id: null,
    beatport_sync_enabled: false, beatport_playlist_id: null,
    banner_url: null, banner_kiosk_url: null, banner_colors: null,
    ...overrides,
  };
}

function mockRequest(overrides = {}) {
  return {
    id: 1, event_id: 1, song_title: 'Strobe', artist: 'deadmau5',
    source: 'spotify', source_url: null, artwork_url: null, note: null,
    status: 'new', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', raw_search_query: null,
    tidal_track_id: null, tidal_sync_status: null,
    sync_results_json: null, genre: null, bpm: null, musical_key: null,
    vote_count: 0, ...overrides,
  };
}

function mockDisplaySettings(overrides = {}) {
  return {
    now_playing_hidden: false, now_playing_auto_hide_minutes: 10,
    requests_open: true, kiosk_display_only: false, ...overrides,
  };
}

function setupDefaultMocks() {
  vi.mocked(api.getEvent).mockResolvedValue(mockEvent());
  vi.mocked(api.getRequests).mockResolvedValue([]);
  vi.mocked(api.getPlayHistory).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getDisplaySettings).mockResolvedValue(mockDisplaySettings());
  vi.mocked(api.getTidalStatus).mockResolvedValue({
    linked: false, user_id: null, expires_at: null, integration_enabled: true,
  });
  vi.mocked(api.getBeatportStatus).mockResolvedValue({
    linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true,
  });
  vi.mocked(api.getNowPlaying).mockResolvedValue(null);
}
```

### Tests (Implementation Order)

#### 1. `describe('Initial loading and auth guard')` — 5 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 1 | redirects to /login when not authenticated | `mockPush('/login')` | No |
| 2 | shows Loading while auth resolving | "Loading..." text | No |
| 3 | shows "Loading event..." during fetch | text visible | No |
| 4 | renders event name after load | "Test Event" visible | No |
| 5 | renders QR code | `data-testid="qr-code"` | No |

#### 2. `describe('Error states')` — 4 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 6 | shows error on 404 | error card visible | No |
| 7 | shows expired state on 410 with archived data | "expired" badge + export button | No |
| 8 | shows error on 410 without archived match | error card | No |
| 9 | preserves data on transient error after load | event name still visible | Yes |

#### 3. `describe('Polling loop')` — 4 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 10 | polls every 3 seconds | `getEvent` called 2+ times | Yes |
| 11 | stops on 404 | no calls after initial 404 | Yes |
| 12 | stops on 410 | only 1 call total | Yes |
| 13 | continues on transient error | next tick still calls | Yes |

#### 4. `describe('Tab switching')` — 3 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 14 | defaults to songs tab | song-tab visible | No |
| 15 | switches to manage tab | manage-tab visible | No |
| 16 | switches back to songs | song-tab visible again | No |

#### 5. `describe('Compact mode')` — 2 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 17 | reads from localStorage | compact class present when stored | No |
| 18 | toggles via button | class toggles, localStorage updated | No |

#### 6. `describe('Action error auto-dismiss')` — 1 test

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 19 | auto-dismisses after 5s | error appears then disappears | Yes |

#### 7. `describe('Request status actions')` — 3 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 20 | passes onUpdateStatus to SongTab | prop exists in captured props | No |
| 21 | calls updateRequestStatus via handler | API called with (id, status) | No |
| 22 | shows error on status update failure | error banner appears | No |

#### 8. `describe('Accept all requests')` — 2 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 23 | calls acceptAllRequests | API called, requests refreshed | No |
| 24 | shows error on failure | error banner | No |

#### 9. `describe('Edit expiry')` — 3 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 25 | shows edit form on click | datetime-local input visible | No |
| 26 | saves new expiry | `updateEvent` called, form hidden | No |
| 27 | cancels editing | form hidden, no API call | No |

#### 10. `describe('Delete event')` — 3 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 28 | shows delete modal | modal visible | No |
| 29 | deletes and redirects on confirm | `deleteEvent` called, `push('/events')` | No |
| 30 | shows error on failure | error banner, no redirect | No |

#### 11. `describe('CSV export')` — 2 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 31 | calls exportEventCsv | API called with 'TEST' | No |
| 32 | shows error on failure | error banner | No |

#### 12. `describe('Display settings')` — 1 test

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 33 | passes toggle handlers to ManageTab | props include handler functions | No |

#### 13. `describe('Tidal auth flow')` — 5 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 34 | starts auth and shows modal | `startTidalAuth` called, modal visible | No |
| 35 | polls checkTidalAuth every 2s | called 2x after 4s | Yes |
| 36 | stops polling after 10min | no more calls after timeout | Yes |
| 37 | handles auth error | error banner, polling stops | Yes |
| 38 | cancels auth | `cancelTidalAuth` called, modal hides | No |

#### 14. `describe('Beatport auth flow')` — 2 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 39 | opens login modal | modal visible | No |
| 40 | calls loginBeatport | API called with credentials | No |

#### 15. `describe('Banner upload')` — 2 tests

| # | Test | Asserts | Timers |
|---|------|---------|--------|
| 41 | passes onBannerSelect to ManageTab | handler is function | No |
| 42 | rejects files over 5MB | error banner "File size must be under 5MB" | No |

### Tricky Pattern: Testing Handlers via Captured Props

```typescript
it('calls updateRequestStatus via handler', async () => {
  setupDefaultMocks();
  vi.mocked(api.getRequests).mockResolvedValue([mockRequest()]);
  vi.mocked(api.updateRequestStatus).mockResolvedValue(mockRequest({ status: 'accepted' }));

  render(<EventQueuePage />);
  await waitFor(() => expect(screen.getByText('Test Event')).toBeInTheDocument());

  // Invoke the captured handler
  const onUpdateStatus = capturedSongTabProps.onUpdateStatus as (id: number, s: string) => Promise<void>;
  await act(async () => { await onUpdateStatus(1, 'accepted'); });
  expect(api.updateRequestStatus).toHaveBeenCalledWith(1, 'accepted');
});
```

---

## Verification

After implementation, run:

```bash
cd dashboard && npx vitest run --coverage --reporter=verbose 2>&1 | grep -E "(events|display)"
```

Expected results:
- `events/[code]/page.tsx`: ~70% stmts (up from 36%)
- `display/page.tsx`: ~85% stmts (up from 68%)
- `events/page.tsx`: ~80% stmts (up from 65%)
- Global thresholds should remain green (77% stmts / 70% branch / 65% funcs / 78% lines)

Also run full CI checks:
```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```
