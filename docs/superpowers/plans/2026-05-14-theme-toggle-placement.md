# Theme Toggle Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix ThemeToggle placement so it appears consistently on all DJ/admin pages, fix IdentityBar white-flash on guest pages, and migrate the old `/dashboard` page into the `(dj)` route group so it gains the layout toggle.

**Architecture:** Four independent tasks in dependency order — admin toggle relocation (standalone layout change), IdentityBar forceDark (component + call sites), dashboard migration (merge two pages, move components folder, delete retired file). All changes are frontend-only in `dashboard/`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + Testing Library, CSS custom properties.

---

## File Map

| File | Action |
|---|---|
| `dashboard/app/admin/layout.tsx` | Modify — move ThemeToggle, fix redirect |
| `dashboard/components/IdentityBar.tsx` | Modify — add `forceDark` prop |
| `dashboard/components/__tests__/IdentityBar.test.tsx` | Create — new test file |
| `dashboard/app/join/[code]/page.tsx` | Modify — pass `forceDark` at two call sites (lines 430, 485) |
| `dashboard/app/collect/[code]/page.tsx` | Modify — pass `forceDark` at call site (line 329) |
| `dashboard/app/(dj)/dashboard/page.tsx` | Create — merged dashboard page |
| `dashboard/app/(dj)/dashboard/__tests__/page.test.tsx` | Create — test file for merged page |
| `dashboard/app/(dj)/dashboard/components/ActivityLogPanel.tsx` | Move from `app/dashboard/components/` |
| `dashboard/app/dashboard/page.tsx` | Delete |
| `dashboard/app/dashboard/components/` | Delete (after move) |
| `dashboard/app/(dj)/events/page.tsx` | Delete |
| `dashboard/app/(dj)/events/__tests__/page.test.tsx` | Delete |

---

## Task 1: Move Admin ThemeToggle to fixed top-right

**Files:**
- Modify: `dashboard/app/admin/layout.tsx`

- [ ] **Step 1: Remove ThemeToggle from sidebar footer and add at fixed top-right**

In `dashboard/app/admin/layout.tsx`, make two changes:

Change 1 — fix the non-admin redirect (line 18) from `/events` to `/dashboard` since `/events` list page is being retired:
```tsx
} else if (!isLoading && role !== 'admin') {
  router.push('/dashboard');
}
```

Change 2 — remove `<ThemeToggle />` from inside `admin-sidebar-footer` (line 67) and add it as a fixed-position element above the layout. The full updated return:

```tsx
return (
  <>
    <div style={{
      position: 'fixed',
      top: '1rem',
      right: '4.5rem',
      zIndex: 50,
    }}>
      <ThemeToggle />
    </div>
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <h2>Admin</h2>
        </div>
        <nav className="admin-sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-sidebar-link${pathname === item.href ? ' active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <Link href="/dashboard" className="admin-sidebar-link">
            DJ View
          </Link>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--surface-raised)', width: '100%' }}
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  </>
);
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/admin/layout.tsx
git commit -m "fix(theme): move admin ThemeToggle to fixed top-right, fix redirect"
```

---

## Task 2: Add `forceDark` prop to IdentityBar

**Files:**
- Modify: `dashboard/components/IdentityBar.tsx`
- Create: `dashboard/components/__tests__/IdentityBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/components/__tests__/IdentityBar.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IdentityBar } from '../IdentityBar';

vi.mock('../EmailVerification', () => ({
  default: () => null,
}));

describe('IdentityBar', () => {
  it('renders nickname', () => {
    const { getByText } = render(
      <IdentityBar nickname="TestDJ" emailVerified={false} onVerified={vi.fn()} />,
    );
    expect(getByText(/TestDJ/)).toBeInTheDocument();
  });

  it('applies no CSS var overrides by default', () => {
    const { container } = render(
      <IdentityBar nickname="DJ" emailVerified={false} onVerified={vi.fn()} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue('--card')).toBe('');
    expect(root.style.getPropertyValue('--text-secondary')).toBe('');
  });

  it('overrides CSS vars when forceDark=true', () => {
    const { container } = render(
      <IdentityBar nickname="DJ" emailVerified={false} onVerified={vi.fn()} forceDark />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue('--card')).toBe('#1a1a1a');
    expect(root.style.getPropertyValue('--border-subtle')).toBe('rgba(255,255,255,0.08)');
    expect(root.style.getPropertyValue('--text-secondary')).toBe('#9ca3af');
  });

  it('forceDark=false behaves same as omitted', () => {
    const { container } = render(
      <IdentityBar nickname="DJ" emailVerified={false} onVerified={vi.fn()} forceDark={false} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue('--card')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd dashboard && npm test -- --run components/__tests__/IdentityBar.test.tsx
```
Expected: FAIL — `forceDark` prop does not exist yet.

- [ ] **Step 3: Implement forceDark in IdentityBar**

Replace the entire `dashboard/components/IdentityBar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import EmailVerification from './EmailVerification';

interface Props {
  nickname: string;
  emailVerified: boolean;
  onVerified: () => void;
  picksLabel?: string;
  forceDark?: boolean;
}

export function IdentityBar({ nickname, emailVerified, onVerified, picksLabel, forceDark }: Props) {
  const [showEmailForm, setShowEmailForm] = useState(false);

  const darkVars = forceDark ? ({
    '--card': '#1a1a1a',
    '--border-subtle': 'rgba(255,255,255,0.08)',
    '--text-secondary': '#9ca3af',
  } as React.CSSProperties) : undefined;

  return (
    <div className="identity-bar" style={darkVars}>
      <span className="identity-bar-name">👤 {nickname}</span>
      {emailVerified ? (
        <span className="identity-bar-verified">✓ Verified</span>
      ) : showEmailForm ? (
        <div className="identity-bar-email-form">
          <EmailVerification
            isVerified={false}
            onVerified={() => {
              onVerified();
              setShowEmailForm(false);
            }}
            onSkip={() => setShowEmailForm(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="identity-bar-add-email"
          onClick={() => setShowEmailForm(true)}
        >
          <span className="identity-bar-pulse" aria-hidden="true" />
          + Add email →
        </button>
      )}
      {picksLabel && (
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}>
          {picksLabel}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd dashboard && npm test -- --run components/__tests__/IdentityBar.test.tsx
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/IdentityBar.tsx dashboard/components/__tests__/IdentityBar.test.tsx
git commit -m "feat(theme): add forceDark prop to IdentityBar"
```

---

## Task 3: Pass `forceDark` on join and collect pages

**Files:**
- Modify: `dashboard/app/join/[code]/page.tsx` (lines 430, 485)
- Modify: `dashboard/app/collect/[code]/page.tsx` (line 329)

- [ ] **Step 1: Update join page — both IdentityBar call sites**

In `dashboard/app/join/[code]/page.tsx`, find line 430 and line 485. Both are identical calls:

Before (both instances):
```tsx
<IdentityBar nickname={nickname} emailVerified={emailVerified} onVerified={() => setEmailVerified(true)} />
```

After (both instances):
```tsx
<IdentityBar nickname={nickname} emailVerified={emailVerified} onVerified={() => setEmailVerified(true)} forceDark />
```

- [ ] **Step 2: Update collect page — IdentityBar call site**

In `dashboard/app/collect/[code]/page.tsx`, find the IdentityBar at line 329. It has a `picksLabel` prop. Add `forceDark`:

Before:
```tsx
<IdentityBar
  nickname={nickname}
  emailVerified={emailVerified}
  onVerified={() => setEmailVerified(true)}
  picksLabel={
```

After:
```tsx
<IdentityBar
  forceDark
  nickname={nickname}
  emailVerified={emailVerified}
  onVerified={() => setEmailVerified(true)}
  picksLabel={
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/join/\[code\]/page.tsx dashboard/app/collect/\[code\]/page.tsx
git commit -m "fix(theme): pass forceDark to IdentityBar on guest pages"
```

---

## Task 4: Migrate dashboard into `(dj)` route group

**Files:**
- Create: `dashboard/app/(dj)/dashboard/__tests__/page.test.tsx`
- Create: `dashboard/app/(dj)/dashboard/page.tsx`
- Create: `dashboard/app/(dj)/dashboard/components/ActivityLogPanel.tsx` (moved)
- Delete: `dashboard/app/dashboard/page.tsx`
- Delete: `dashboard/app/dashboard/components/` (entire folder)
- Delete: `dashboard/app/(dj)/events/page.tsx`
- Delete: `dashboard/app/(dj)/events/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/app/(dj)/dashboard/__tests__/page.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DashboardPage from '../page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/help/HelpContext', () => ({
  useHelp: () => ({
    helpMode: false, onboardingActive: false, currentStep: 0, activeSpotId: null,
    toggleHelpMode: vi.fn(), registerSpot: vi.fn(() => vi.fn()),
    getSpotsForPage: vi.fn(() => []), startOnboarding: vi.fn(),
    nextStep: vi.fn(), prevStep: vi.fn(), skipOnboarding: vi.fn(),
    hasSeenPage: vi.fn(() => true),
  }),
}));

vi.mock('@/components/help/HelpSpot', () => ({
  HelpSpot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/help/HelpButton', () => ({
  HelpButton: () => null,
}));
vi.mock('@/components/help/OnboardingOverlay', () => ({
  OnboardingOverlay: () => null,
}));

vi.mock('../components/ActivityLogPanel', () => ({
  ActivityLogPanel: () => <div data-testid="activity-log-panel" />,
}));

let mockRole = 'dj';
let mockIsAuthenticated = true;
let mockIsLoading = false;
const mockLogout = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockIsLoading,
    role: mockRole,
    logout: mockLogout,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getEvents: vi.fn(),
    createEvent: vi.fn(),
    bulkDeleteEvents: vi.fn(),
    getTidalStatus: vi.fn(),
    getBeatportStatus: vi.fn(),
    getActivityLog: vi.fn(),
    patchCollectionSettings: vi.fn(),
  },
  Event: undefined,
}));

import { api } from '@/lib/api';

function mockEvent(overrides = {}) {
  return {
    id: 1,
    code: 'EVT01',
    name: 'Friday Night',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-01-02T00:00:00Z',
    is_active: true,
    join_url: null,
    tidal_sync_enabled: false,
    tidal_playlist_id: null,
    beatport_sync_enabled: false,
    beatport_playlist_id: null,
    banner_url: null,
    banner_kiosk_url: null,
    banner_colors: null,
    requests_open: true,
    collection_opens_at: null,
    live_starts_at: null,
    submission_cap_per_guest: 15,
    collection_phase_override: null,
    archived_at: null,
    request_count: null,
    status: null,
    ...overrides,
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'dj';
    mockIsAuthenticated = true;
    mockIsLoading = false;
    vi.mocked(api.getTidalStatus).mockResolvedValue(null);
    vi.mocked(api.getBeatportStatus).mockResolvedValue(null);
    vi.mocked(api.getActivityLog).mockResolvedValue([]);
  });

  it('renders page heading and create button', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<DashboardPage />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Event' })).toBeInTheDocument();
  });

  it('renders Account button linking to /account', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<DashboardPage />);

    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
  });

  it('renders activity log panel', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-log-panel')).toBeInTheDocument();
    });
  });

  it('renders cloud providers section', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);
    vi.mocked(api.getTidalStatus).mockResolvedValue({ linked: true } as never);
    vi.mocked(api.getBeatportStatus).mockResolvedValue({ linked: false } as never);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Tidal')).toBeInTheDocument();
      expect(screen.getByText('Beatport')).toBeInTheDocument();
    });
  });

  it('shows empty state when no events exist', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/No events yet/)).toBeInTheDocument();
    });
  });

  it('displays events when loaded', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([mockEvent()]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Friday Night')).toBeInTheDocument();
      expect(screen.getByText('EVT01')).toBeInTheDocument();
    });
  });

  it('shows error message when events API fails', async () => {
    vi.mocked(api.getEvents).mockRejectedValue(new Error('Network error'));

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard data')).toBeInTheDocument();
    });
  });

  it('shows logout button', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<DashboardPage />);

    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('shows inactive badge for inactive events', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([mockEvent({ is_active: false })]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  describe('Loading & auth redirects', () => {
    it('shows Loading while auth is resolving', () => {
      mockIsLoading = true;
      mockIsAuthenticated = false;
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('shows "Loading events..." during fetch', async () => {
      let resolveEvents!: (v: never[]) => void;
      vi.mocked(api.getEvents).mockImplementation(
        () => new Promise((r) => { resolveEvents = r; }),
      );

      render(<DashboardPage />);

      expect(screen.getByText('Loading events...')).toBeInTheDocument();

      await act(async () => { resolveEvents([]); });
    });

    it('redirects unauthenticated users to /login', () => {
      mockIsAuthenticated = false;
      mockIsLoading = false;
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    it('redirects pending users to /pending', () => {
      mockRole = 'pending';
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      expect(mockPush).toHaveBeenCalledWith('/pending');
    });
  });

  describe('Create event form', () => {
    it('shows form when Create Event clicked', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

      expect(screen.getByLabelText('Event Name')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('creates event and adds to list', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      const newEvent = mockEvent({ id: 2, code: 'NEW01', name: 'New Party' });
      vi.mocked(api.createEvent).mockResolvedValue(newEvent);

      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'New Party' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      expect(api.createEvent).toHaveBeenCalledWith('New Party');
      await waitFor(() => {
        expect(screen.getByText('New Party')).toBeInTheDocument();
      });
    });

    it('hides form and resets input after create', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      vi.mocked(api.createEvent).mockResolvedValue(mockEvent());

      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Test' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      await waitFor(() => {
        expect(screen.queryByLabelText('Event Name')).not.toBeInTheDocument();
      });
    });

    it('shows error when create fails', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      vi.mocked(api.createEvent).mockRejectedValue(new Error('Name taken'));

      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Dup' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      await waitFor(() => {
        expect(screen.getByText('Name taken')).toBeInTheDocument();
      });
    });

    it('hides form on Cancel', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      expect(screen.getByLabelText('Event Name')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Event Name')).not.toBeInTheDocument();
      expect(api.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('Logout', () => {
    it('calls logout on Logout click', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

      expect(mockLogout).toHaveBeenCalledOnce();
    });
  });

  describe('Admin role', () => {
    it('shows Admin button for admin role', async () => {
      mockRole = 'admin';
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    });

    it('hides Admin button for dj role', async () => {
      mockRole = 'dj';
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<DashboardPage />);

      expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    });
  });

  describe('Batch delete (selection mode)', () => {
    const twoEvents = [
      mockEvent({ id: 1, code: 'EVT01', name: 'Friday Night' }),
      mockEvent({ id: 2, code: 'EVT02', name: 'Saturday Bash' }),
    ];

    it('renders Advanced checkbox', async () => {
      vi.mocked(api.getEvents).mockResolvedValue(twoEvents);
      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText('Friday Night')).toBeInTheDocument());
      expect(screen.getByLabelText('Advanced')).toBeInTheDocument();
    });

    it('toggles selection mode', async () => {
      vi.mocked(api.getEvents).mockResolvedValue(twoEvents);
      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText('Friday Night')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Advanced'));
      expect(screen.getByLabelText('Select All')).toBeInTheDocument();
    });

    it('calls bulkDeleteEvents and re-fetches on confirm', async () => {
      vi.mocked(api.getEvents)
        .mockResolvedValueOnce(twoEvents)
        .mockResolvedValueOnce([twoEvents[1]]);
      vi.mocked(api.bulkDeleteEvents).mockResolvedValue({ status: 'ok', count: 1 });
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText('Friday Night')).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText('Advanced'));
      const checkboxes = screen.getAllByRole('checkbox', { name: /Select event/ });
      fireEvent.click(checkboxes[0]);

      await act(async () => {
        fireEvent.click(screen.getByText('Delete Selected (1)'));
      });

      expect(api.bulkDeleteEvents).toHaveBeenCalledWith(['EVT01']);
      expect(api.getEvents).toHaveBeenCalledTimes(2);
    });

    it('clears selection after delete', async () => {
      vi.mocked(api.getEvents)
        .mockResolvedValueOnce(twoEvents)
        .mockResolvedValueOnce([twoEvents[1]]);
      vi.mocked(api.bulkDeleteEvents).mockResolvedValue({ status: 'ok', count: 1 });
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<DashboardPage />);
      await waitFor(() => expect(screen.getByText('Friday Night')).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText('Advanced'));
      const checkboxes = screen.getAllByRole('checkbox', { name: /Select event/ });
      fireEvent.click(checkboxes[0]);

      await act(async () => {
        fireEvent.click(screen.getByText('Delete Selected (1)'));
      });

      await waitFor(() => {
        expect(screen.queryByText(/Delete Selected/)).not.toBeInTheDocument();
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd dashboard && npm test -- --run "app/\(dj\)/dashboard/__tests__/page.test.tsx"
```
Expected: FAIL — module `../page` not found.

- [ ] **Step 3: Move ActivityLogPanel into the new location**

```bash
mkdir -p dashboard/app/\(dj\)/dashboard/components
cp dashboard/app/dashboard/components/ActivityLogPanel.tsx dashboard/app/\(dj\)/dashboard/components/ActivityLogPanel.tsx
```

- [ ] **Step 4: Create the merged dashboard page**

Create `dashboard/app/(dj)/dashboard/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Event, TidalStatus, BeatportStatus, ActivityLogEntry } from '@/lib/api-types';
import { useHelp } from '@/lib/help/HelpContext';
import { HelpSpot } from '@/components/help/HelpSpot';
import { HelpButton } from '@/components/help/HelpButton';
import { OnboardingOverlay } from '@/components/help/OnboardingOverlay';
import { ActivityLogPanel } from './components/ActivityLogPanel';
import { CollectionFieldset, collectionSchema } from '@/components/CollectionFieldset';

const PAGE_ID = 'events';

export default function DashboardPage() {
  const { isAuthenticated, isLoading, role, logout } = useAuth();
  const { hasSeenPage, startOnboarding } = useHelp();
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [tidalStatus, setTidalStatus] = useState<TidalStatus | null>(null);
  const [beatportStatus, setBeatportStatus] = useState<BeatportStatus | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  const [showCollection, setShowCollection] = useState(false);
  const [collectionOpensAt, setCollectionOpensAt] = useState('');
  const [liveStartsAt, setLiveStartsAt] = useState('');
  const [submissionCap, setSubmissionCap] = useState(0);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    } else if (!isLoading && role === 'pending') {
      router.push('/pending');
    }
  }, [isAuthenticated, isLoading, role, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !loadingEvents && !hasSeenPage(PAGE_ID)) {
      const timer = setTimeout(() => startOnboarding(PAGE_ID), 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isAuthenticated, loadingEvents, hasSeenPage, startOnboarding]);

  const loadData = async () => {
    try {
      const [eventsData, tidalData, beatportData, logData] = await Promise.allSettled([
        api.getEvents(),
        api.getTidalStatus(),
        api.getBeatportStatus(),
        api.getActivityLog(),
      ]);

      if (eventsData.status === 'fulfilled') {
        setEvents(eventsData.value);
      } else {
        setErrorMsg('Failed to load dashboard data');
      }
      if (tidalData.status === 'fulfilled') setTidalStatus(tidalData.value);
      if (beatportData.status === 'fulfilled') setBeatportStatus(beatportData.value);
      if (logData.status === 'fulfilled') setActivityLog(logData.value);
    } finally {
      setLoadingEvents(false);
    }
  };

  const loadEvents = async () => {
    try {
      const data = await api.getEvents();
      setEvents(data);
    } catch {
      setErrorMsg('Failed to load events');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName.trim()) return;

    if (showCollection) {
      const parsed = collectionSchema.safeParse({
        collection_opens_at: collectionOpensAt || undefined,
        live_starts_at: liveStartsAt || undefined,
        submission_cap_per_guest: submissionCap,
      });
      if (!parsed.success) {
        setCollectionError(parsed.error.issues[0].message);
        return;
      }
    }
    setCollectionError(null);
    setCreating(true);

    let createdEvent;
    try {
      createdEvent = await api.createEvent(newEventName);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create event');
      setCreating(false);
      return;
    }

    setEvents([createdEvent, ...events]);

    if (showCollection && (collectionOpensAt || liveStartsAt || submissionCap > 0)) {
      try {
        await api.patchCollectionSettings(createdEvent.code, {
          collection_opens_at: collectionOpensAt
            ? new Date(collectionOpensAt).toISOString()
            : null,
          live_starts_at: liveStartsAt
            ? new Date(liveStartsAt).toISOString()
            : null,
          submission_cap_per_guest: submissionCap,
        });
      } catch (err) {
        setErrorMsg(
          `Event "${createdEvent.name}" was created, but collection settings failed: ${
            err instanceof Error ? err.message : 'unknown error'
          }. Open the event and finish setup on the Pre-Event Voting tab.`,
        );
        setCreating(false);
        return;
      }
    }

    setNewEventName('');
    setShowCreate(false);
    setShowCollection(false);
    setCollectionOpensAt('');
    setLiveStartsAt('');
    setSubmissionCap(0);
    setCreating(false);
  };

  const toggleSelection = (code: string) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEvents.size === events.length) {
      setSelectedEvents(new Set());
    } else {
      setSelectedEvents(new Set(events.map((e) => e.code)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedEvents.size === 0) return;
    if (!window.confirm(`Delete ${selectedEvents.size} event${selectedEvents.size === 1 ? '' : 's'}? This cannot be undone.`)) return;

    setDeletingSelected(true);
    try {
      await api.bulkDeleteEvents([...selectedEvents]);
      setSelectedEvents(new Set());
      await loadEvents();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete events');
    } finally {
      setDeletingSelected(false);
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <HelpButton page={PAGE_ID} />
      <OnboardingOverlay page={PAGE_ID} />

      {errorMsg && (
        <div style={{ background: 'var(--color-danger-subtle)', color: 'var(--color-danger)', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {errorMsg}
        </div>
      )}

      <HelpSpot spotId="events-header" page={PAGE_ID} order={1} title="Your Events" description="This is your events dashboard. All your DJ events appear here.">
        <div className="header">
          <h1>Dashboard</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {role === 'admin' && (
              <HelpSpot spotId="events-admin" page={PAGE_ID} order={3} title="Admin Panel" description="Access the admin panel to manage users, view all events, and configure integrations.">
                <Link href="/admin">
                  <button className="btn" style={{ background: 'var(--color-admin)', color: 'white' }}>Admin</button>
                </Link>
              </HelpSpot>
            )}
            <HelpSpot spotId="events-create" page={PAGE_ID} order={2} title="Create Event" description="Click to create a new event. Each event gets a unique code and QR that guests scan to submit requests.">
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create Event
              </button>
            </HelpSpot>
            <a
              href="https://github.com/thewrz/WrzDJ/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm"
              style={{ background: 'var(--surface-raised)', textDecoration: 'none', color: 'var(--text)' }}
            >
              Bridge App
            </a>
            <Link href="/account" className="btn" style={{ background: 'var(--surface-raised)', textDecoration: 'none', color: 'var(--text)' }}>
              Account
            </Link>
            <button className="btn" style={{ background: 'var(--surface-raised)' }} onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      </HelpSpot>

      {showCreate && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Create New Event</h2>
          <form onSubmit={handleCreateEvent}>
            <div className="form-group">
              <label htmlFor="eventName">Event Name</label>
              <input
                id="eventName"
                type="text"
                className="input"
                placeholder="Friday Night Party"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <CollectionFieldset
              enabled={showCollection}
              onEnabledChange={setShowCollection}
              collectionOpensAt={collectionOpensAt}
              onCollectionOpensAtChange={setCollectionOpensAt}
              liveStartsAt={liveStartsAt}
              onLiveStartsAtChange={setLiveStartsAt}
              submissionCap={submissionCap}
              onSubmissionCapChange={setSubmissionCap}
              error={collectionError}
            />
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: 'var(--surface-raised)' }}
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Cloud Providers</h3>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tidalStatus?.linked ? '#22c55e' : '#6b7280', display: 'inline-block' }} />
            <span style={{ fontWeight: 500 }}>Tidal</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {tidalStatus?.linked ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: beatportStatus?.linked ? '#22c55e' : '#6b7280', display: 'inline-block' }} />
            <span style={{ fontWeight: 500 }}>Beatport</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {beatportStatus?.linked ? 'Connected' : 'Not connected'}
            </span>
          </div>
        </div>
      </div>

      <ActivityLogPanel entries={activityLog} />

      {loadingEvents ? (
        <div className="loading">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>No events yet. Create your first event!</p>
        </div>
      ) : (
        <>
          {events.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectionMode}
                  onChange={(e) => {
                    setSelectionMode(e.target.checked);
                    if (!e.target.checked) setSelectedEvents(new Set());
                  }}
                  style={{ accentColor: 'var(--color-accent-checkbox)' }}
                  aria-label="Advanced"
                />
                Advanced
              </label>
              {selectionMode && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedEvents.size === events.length && events.length > 0}
                      onChange={toggleSelectAll}
                      style={{ accentColor: 'var(--color-accent-checkbox)' }}
                      aria-label="Select All"
                    />
                    Select All
                  </label>
                  {selectedEvents.size > 0 && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={handleBulkDelete}
                      disabled={deletingSelected}
                    >
                      {deletingSelected ? 'Deleting...' : `Delete Selected (${selectedEvents.size})`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <HelpSpot spotId="events-grid" page={PAGE_ID} order={4} title="Event Cards" description="Your events appear as cards. Click any card to manage its request queue, sync settings, and kiosk controls.">
            <div className="event-grid">
              {events.map((event) => (
                selectionMode ? (
                  <div
                    key={event.id}
                    className="event-card"
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      outline: selectedEvents.has(event.code) ? '2px solid var(--color-primary)' : 'none',
                    }}
                    onClick={() => toggleSelection(event.code)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.has(event.code)}
                      onChange={() => toggleSelection(event.code)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: 'var(--color-accent-checkbox)', width: '1rem', height: '1rem', marginTop: '0.25rem', flexShrink: 0 }}
                      aria-label={`Select event ${event.code}`}
                    />
                    <div>
                      <h3>{event.name}</h3>
                      <div className="code">{event.code}</div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        Expires: {new Date(event.expires_at).toLocaleString()}
                      </p>
                      {!event.is_active && (
                        <span className="badge badge-rejected" style={{ marginTop: '0.5rem' }}>
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <Link key={event.id} href={`/events/${event.code}`}>
                    <div className="event-card" style={{ cursor: 'pointer' }}>
                      <h3>{event.name}</h3>
                      <div className="code">{event.code}</div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        Expires: {new Date(event.expires_at).toLocaleString()}
                      </p>
                      {!event.is_active && (
                        <span className="badge badge-rejected" style={{ marginTop: '0.5rem' }}>
                          Inactive
                        </span>
                      )}
                    </div>
                  </Link>
                )
              ))}
            </div>
          </HelpSpot>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd dashboard && npm test -- --run "app/\(dj\)/dashboard/__tests__/page.test.tsx"
```
Expected: all tests PASS.

- [ ] **Step 6: Delete retired files**

```bash
rm dashboard/app/dashboard/page.tsx
rm -rf dashboard/app/dashboard/components
rm dashboard/app/\(dj\)/events/page.tsx
rm dashboard/app/\(dj\)/events/__tests__/page.test.tsx
```

- [ ] **Step 7: Run full test suite and TypeScript check**

```bash
cd dashboard && npx tsc --noEmit && npm test -- --run
```
Expected: no TypeScript errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/\(dj\)/dashboard/ dashboard/app/admin/layout.tsx
git rm dashboard/app/dashboard/page.tsx
git rm -r dashboard/app/dashboard/components/
git rm dashboard/app/\(dj\)/events/page.tsx
git rm dashboard/app/\(dj\)/events/__tests__/page.test.tsx
git commit -m "feat(theme): migrate dashboard into (dj) route group, retire events list page"
```

---

## Final Verification

- [ ] Run complete frontend CI locally:

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```
Expected: lint clean, no type errors, all tests pass.
