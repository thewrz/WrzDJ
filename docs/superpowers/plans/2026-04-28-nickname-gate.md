# Nickname Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mandatory pre-step nickname gate to the join and collect pages that captures guest identity before any interaction, saves to the guest profile, and nudges email verification — while leaving the kiosk modal completely unchanged.

**Architecture:** A new `NicknameGate` component renders as a full-screen overlay, calls `GET /api/public/collect/{code}/profile` to determine routing (new guest → nickname input; returning + no email → email prompt; returning + email → skip gate), then fires `onComplete(result)` when done. A new `IdentityBar` component persists at the top of both pages for the rest of the session showing the saved name and an animated "Add email" nudge. No new backend endpoints — all calls reuse existing APIs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, `@testing-library/react`, zod (already installed), vanilla CSS in `dashboard/app/globals.css`.

---

## Context for the implementer

This plan builds on the `fix/guest-auth-hardening` branch (PR #258). Branch from there.

**Key existing APIs (all already in `dashboard/lib/api.ts`):**
- `apiClient.getCollectProfile(code)` → `CollectProfileResponse { nickname, email_verified, submission_count, submission_cap }`
- `apiClient.setCollectProfile(code, { nickname })` → `CollectProfileResponse`

**Key existing component:** `dashboard/app/collect/[code]/components/EmailVerification.tsx` — self-contained OTP email verification. Currently accepts `{ isVerified, onVerified }`. We add an optional `onSkip` prop in Task 1.

**Nickname validation rule** (matches `FeatureOptInPanel.tsx`):
```typescript
z.string().trim().min(1).max(30).regex(/^[a-zA-Z0-9 _.-]+$/, 'Letters, numbers, spaces, . _ - only')
```

**Kiosk modal** (`dashboard/app/e/[code]/display/components/RequestModal.tsx`) — do NOT touch. Not part of this plan.

---

## File Structure

### Create
- `dashboard/components/NicknameGate.tsx` — full-screen gate overlay
- `dashboard/components/IdentityBar.tsx` — persistent post-gate identity strip
- `dashboard/components/__tests__/NicknameGate.test.tsx`
- `dashboard/components/__tests__/IdentityBar.test.tsx`

### Modify
- `dashboard/app/collect/[code]/components/EmailVerification.tsx` — add `onSkip?` prop
- `dashboard/app/collect/[code]/components/EmailVerification.tsx` tests (if they exist — check first)
- `dashboard/app/collect/[code]/page.tsx` — wire gate, remove `FeatureOptInPanel`, add `IdentityBar`
- `dashboard/app/join/[code]/page.tsx` — wire gate, remove optional nickname field, add `IdentityBar`
- `dashboard/app/globals.css` — add `.identity-bar` CSS + `@keyframes identity-pulse`

---

## Task 0: Branch

- [ ] **Step 1: Create branch from the guest-auth-hardening branch**

```bash
git checkout fix/guest-auth-hardening
git checkout -b feat/nickname-gate
git status
```

Expected: clean working tree on `feat/nickname-gate`.

---

## Task 1: Add `onSkip` prop to `EmailVerification`

**Files:**
- Modify: `dashboard/app/collect/[code]/components/EmailVerification.tsx`

This is the smallest atomic change. The gate's `email_prompt` state renders `EmailVerification` with a "Skip for now" link. The link only appears when `onSkip` is provided — existing usages without the prop are unchanged.

- [ ] **Step 1: Check whether an `EmailVerification` test file already exists**

```bash
ls dashboard/app/collect/\[code\]/components/
```

If `EmailVerification.test.tsx` exists, read it and append the new tests below. If it does not exist, create it.

- [ ] **Step 2: Write the failing test**

Create (or append to) `dashboard/app/collect/[code]/components/EmailVerification.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailVerification from './EmailVerification';

describe('EmailVerification — onSkip prop (Task 1)', () => {
  it('renders "Skip for now" button when onSkip is provided', () => {
    render(
      <EmailVerification isVerified={false} onVerified={vi.fn()} onSkip={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
  });

  it('does NOT render "Skip for now" button when onSkip is omitted', () => {
    render(<EmailVerification isVerified={false} onVerified={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /skip for now/i })).toBeNull();
  });

  it('calls onSkip when "Skip for now" is clicked', () => {
    const onSkip = vi.fn();
    render(
      <EmailVerification isVerified={false} onVerified={vi.fn()} onSkip={onSkip} />
    );
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd dashboard && npm test -- --run "app/collect/\[code\]/components/EmailVerification"
```

Expected: 3 failures — "Skip for now" button is not found.

- [ ] **Step 4: Add `onSkip` to `EmailVerification`**

In `dashboard/app/collect/[code]/components/EmailVerification.tsx`, change the `Props` interface and the input-state render:

```typescript
// Change Props interface from:
interface Props {
  isVerified: boolean;
  onVerified: () => void;
}

// To:
interface Props {
  isVerified: boolean;
  onVerified: () => void;
  onSkip?: () => void;
}
```

In the function signature: `export default function EmailVerification({ isVerified, onVerified, onSkip }: Props)`

In the **`input` state return block** (the last `return` in the function, which renders the email input form), add the skip button just before the closing `</div>`:

```tsx
{onSkip && (
  <button
    type="button"
    className="btn-link"
    onClick={onSkip}
    style={{ fontSize: '0.8rem', marginTop: '0.5rem', display: 'block' }}
  >
    Skip for now
  </button>
)}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd dashboard && npm test -- --run "app/collect/\[code\]/components/EmailVerification"
```

Expected: all 3 new tests PASS, no existing tests broken.

- [ ] **Step 6: TypeScript clean**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "dashboard/app/collect/[code]/components/EmailVerification.tsx"
# Also stage the test file — adjust path if it existed vs. newly created
git add "dashboard/app/collect/[code]/components/EmailVerification.test.tsx"
git commit -m "feat: add onSkip prop to EmailVerification for nickname gate flow"
```

---

## Task 2: Create `NicknameGate` component

**Files:**
- Create: `dashboard/components/NicknameGate.tsx`
- Create: `dashboard/components/__tests__/NicknameGate.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/components/__tests__/NicknameGate.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '../../lib/api';

// Mock apiClient before importing the component
vi.mock('../../lib/api', () => ({
  apiClient: {
    getCollectProfile: vi.fn(),
    setCollectProfile: vi.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// Must import AFTER mock
import { NicknameGate } from '../NicknameGate';
import { apiClient } from '../../lib/api';

const mockGetProfile = apiClient.getCollectProfile as ReturnType<typeof vi.fn>;
const mockSetProfile = apiClient.setCollectProfile as ReturnType<typeof vi.fn>;

function baseProfile(overrides: Partial<{
  nickname: string | null;
  email_verified: boolean;
  submission_count: number;
  submission_cap: number;
}> = {}) {
  return {
    nickname: null,
    email_verified: false,
    submission_count: 0,
    submission_cap: 5,
    ...overrides,
  };
}

describe('NicknameGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows nickname input for a new guest (no nickname on profile)', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what.s your nickname/i })).toBeInTheDocument();
    });
  });

  it('shows email prompt for returning guest with nickname but no email', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: 'DJ_Foo', email_verified: false }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/add your email/i)).toBeInTheDocument();
    });
  });

  it('calls onComplete immediately when nickname and email are already set', async () => {
    const onComplete = vi.fn();
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: 'DJ_Foo', email_verified: true }));
    render(<NicknameGate code="TEST01" onComplete={onComplete} />);
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        nickname: 'DJ_Foo',
        emailVerified: true,
        submissionCount: 0,
        submissionCap: 5,
      });
    });
  });

  it('calls onComplete (pass-through) on 404', async () => {
    const onComplete = vi.fn();
    mockGetProfile.mockRejectedValue(new ApiError('Not found', 404));
    render(<NicknameGate code="GONE" onComplete={onComplete} />);
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        nickname: '',
        emailVerified: false,
        submissionCount: 0,
        submissionCap: 0,
      });
    });
  });

  it('shows error state on network failure with Retry button', async () => {
    mockGetProfile.mockRejectedValue(new Error('Network error'));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn.t connect/i)).toBeInTheDocument();
  });

  it('Save button is disabled when nickname input is empty', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('Save button is enabled after typing a nickname', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DancingQueen' } });
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('shows "Nickname saved!" flash and advances to email prompt after successful save', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    mockSetProfile.mockResolvedValue(baseProfile({ nickname: 'DancingQueen', email_verified: false }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DancingQueen' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/nickname saved/i)).toBeInTheDocument();
    });
  });

  it('shows inline error when save fails', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    mockSetProfile.mockRejectedValue(new Error('Server error'));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DancingQueen' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/couldn.t save/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd dashboard && npm test -- --run "components/__tests__/NicknameGate"
```

Expected: all tests fail with "Cannot find module '../NicknameGate'".

- [ ] **Step 3: Create `NicknameGate.tsx`**

Create `dashboard/components/NicknameGate.tsx`:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { apiClient, ApiError, CollectProfileResponse } from '../lib/api';
import { ModalOverlay } from './ModalOverlay';
import EmailVerification from '../app/collect/[code]/components/EmailVerification';

const nicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[a-zA-Z0-9 _.-]+$/, 'Letters, numbers, spaces, . _ - only');

export interface GateResult {
  nickname: string;
  emailVerified: boolean;
  submissionCount: number;
  submissionCap: number;
}

interface Props {
  code: string;
  onComplete: (result: GateResult) => void;
}

type GateState = 'loading' | 'error' | 'nickname_input' | 'email_prompt';

export function NicknameGate({ code, onComplete }: Props) {
  const [gateState, setGateState] = useState<GateState>('loading');
  const [savedNickname, setSavedNickname] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [profileCache, setProfileCache] = useState<CollectProfileResponse | null>(null);

  const loadProfile = useCallback(async () => {
    setGateState('loading');
    try {
      const p = await apiClient.getCollectProfile(code);
      setProfileCache(p);
      if (p.nickname && p.email_verified) {
        onComplete({
          nickname: p.nickname,
          emailVerified: true,
          submissionCount: p.submission_count,
          submissionCap: p.submission_cap,
        });
      } else if (p.nickname) {
        setSavedNickname(p.nickname);
        setGateState('email_prompt');
      } else {
        setGateState('nickname_input');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onComplete({ nickname: '', emailVerified: false, submissionCount: 0, submissionCap: 0 });
      } else {
        setGateState('error');
      }
    }
  }, [code, onComplete]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSaveNickname = async () => {
    const parsed = nicknameSchema.safeParse(nicknameInput);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setInputError(null);
    try {
      const p = await apiClient.setCollectProfile(code, { nickname: parsed.data });
      setProfileCache(p);
      setSavedNickname(parsed.data);
      setSavedFlash(true);
      setTimeout(() => {
        setSavedFlash(false);
        setGateState('email_prompt');
      }, 1500);
    } catch (err) {
      setInputError(err instanceof ApiError ? err.message : "Couldn't save — please try again");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onComplete({
      nickname: savedNickname,
      emailVerified: false,
      submissionCount: profileCache?.submission_count ?? 0,
      submissionCap: profileCache?.submission_cap ?? 0,
    });
  };

  const handleVerified = () => {
    onComplete({
      nickname: savedNickname,
      emailVerified: true,
      submissionCount: profileCache?.submission_count ?? 0,
      submissionCap: profileCache?.submission_cap ?? 0,
    });
  };

  if (gateState === 'loading') {
    return (
      <ModalOverlay card>
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Connecting…</p>
        </div>
      </ModalOverlay>
    );
  }

  if (gateState === 'error') {
    return (
      <ModalOverlay card>
        <p style={{ marginBottom: '1rem' }}>
          Couldn&apos;t connect to the event. Check your connection and try again.
        </p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={loadProfile}>
          Retry
        </button>
      </ModalOverlay>
    );
  }

  if (gateState === 'nickname_input') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>What&apos;s your nickname?</h2>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="DancingQueen"
            value={nicknameInput}
            onChange={(e) => {
              setNicknameInput(e.target.value);
              setInputError(null);
            }}
            maxLength={30}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nicknameInput.trim()) handleSaveNickname();
            }}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        {savedFlash && (
          <p style={{ color: '#22c55e', marginBottom: '0.5rem' }}>✓ Nickname saved!</p>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={!nicknameInput.trim() || saving}
          onClick={handleSaveNickname}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </ModalOverlay>
    );
  }

  // email_prompt
  return (
    <ModalOverlay card>
      <h2 style={{ marginBottom: '0.5rem' }}>Hi, {savedNickname}! 👋</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Add your email to unlock cross-device access and leaderboards.
      </p>
      <EmailVerification isVerified={false} onVerified={handleVerified} onSkip={handleSkip} />
    </ModalOverlay>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd dashboard && npm test -- --run "components/__tests__/NicknameGate"
```

Expected: all 8 tests PASS.

> **Note on `savedFlash` test:** The "Nickname saved!" test asserts the flash appears immediately after the save call resolves — the 1500ms timeout in the real component is not faked here, so the flash text is visible before the timeout fires. If that test is flaky, add `vi.useFakeTimers()` in the test's `beforeEach`.

- [ ] **Step 5: TypeScript clean**

```bash
cd dashboard && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/NicknameGate.tsx \
        dashboard/components/__tests__/NicknameGate.test.tsx
git commit -m "feat: add NicknameGate component with routing and nickname save flow"
```

---

## Task 3: Create `IdentityBar` component + CSS

**Files:**
- Create: `dashboard/components/IdentityBar.tsx`
- Create: `dashboard/components/__tests__/IdentityBar.test.tsx`
- Modify: `dashboard/app/globals.css`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/components/__tests__/IdentityBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IdentityBar } from '../IdentityBar';

vi.mock('../../lib/api', () => ({
  apiClient: {
    requestVerificationCode: vi.fn(),
    confirmVerificationCode: vi.fn(),
  },
  ApiError: class extends Error { status = 0; },
}));

describe('IdentityBar', () => {
  it('shows nickname', () => {
    render(<IdentityBar nickname="DJ_Foo" emailVerified={false} onVerified={vi.fn()} />);
    expect(screen.getByText(/DJ_Foo/)).toBeInTheDocument();
  });

  it('shows "Add email" button with pulse class when email not verified', () => {
    const { container } = render(
      <IdentityBar nickname="DJ_Foo" emailVerified={false} onVerified={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /add email/i })).toBeInTheDocument();
    expect(container.querySelector('.identity-bar-pulse')).not.toBeNull();
  });

  it('shows verified badge and no Add-email button when email is verified', () => {
    render(<IdentityBar nickname="DJ_Foo" emailVerified={true} onVerified={vi.fn()} />);
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add email/i })).toBeNull();
  });

  it('clicking "Add email" expands EmailVerification inline', () => {
    render(<IdentityBar nickname="DJ_Foo" emailVerified={false} onVerified={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add email/i }));
    // EmailVerification renders an email input when expanded
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd dashboard && npm test -- --run "components/__tests__/IdentityBar"
```

Expected: all 4 fail with "Cannot find module '../IdentityBar'".

- [ ] **Step 3: Create `IdentityBar.tsx`**

Create `dashboard/components/IdentityBar.tsx`:

```typescript
'use client';

import { useState } from 'react';
import EmailVerification from '../app/collect/[code]/components/EmailVerification';

interface Props {
  nickname: string;
  emailVerified: boolean;
  onVerified: () => void;
}

export function IdentityBar({ nickname, emailVerified, onVerified }: Props) {
  const [showEmailForm, setShowEmailForm] = useState(false);

  return (
    <div className="identity-bar">
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
    </div>
  );
}
```

- [ ] **Step 4: Add CSS to `dashboard/app/globals.css`**

Append to `dashboard/app/globals.css`:

```css
/* ── Identity Bar ────────────────────────────────────── */
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
.identity-bar-name {
  color: var(--text-secondary, #a0a0a0);
  font-weight: 500;
}
.identity-bar-verified {
  color: #22c55e;
  font-size: 0.8rem;
}
.identity-bar-add-email {
  background: transparent;
  border: none;
  color: #60a5fa;
  cursor: pointer;
  font-size: 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0;
  line-height: 1.4;
}
.identity-bar-pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #60a5fa;
  animation: identity-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}
.identity-bar-email-form {
  flex: 1 1 100%;
  margin-top: 0.25rem;
}
@keyframes identity-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd dashboard && npm test -- --run "components/__tests__/IdentityBar"
```

Expected: all 4 PASS.

- [ ] **Step 6: TypeScript + lint clean**

```bash
cd dashboard && npx tsc --noEmit && npm run lint
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/components/IdentityBar.tsx \
        dashboard/components/__tests__/IdentityBar.test.tsx \
        dashboard/app/globals.css
git commit -m "feat: add IdentityBar component with email nudge animation"
```

---

## Task 4: Wire gate into collect page

**Files:**
- Modify: `dashboard/app/collect/[code]/page.tsx`

The collect page currently has:
- A `getCollectProfile` `useEffect` (lines ~62-72) that loads nickname + emailVerified
- A `saveProfile` function (lines ~54-60) used by `FeatureOptInPanel`
- `FeatureOptInPanel` rendered at line ~267

The gate replaces all of these. The gate fires the profile GET, and `onComplete` gives us `{ nickname, emailVerified, submissionCount, submissionCap }`.

**Important:** After `onComplete`, the `handleSelectSong` function (line ~108) still calls `getCollectProfile` *after* each submission to refresh `submission_count` — keep that call, it's intentional.

- [ ] **Step 1: Update imports**

At the top of `dashboard/app/collect/[code]/page.tsx`, replace:

```typescript
import FeatureOptInPanel from './components/FeatureOptInPanel';
```

with:

```typescript
import { NicknameGate, GateResult } from '../../../components/NicknameGate';
import { IdentityBar } from '../../../components/IdentityBar';
```

- [ ] **Step 2: Add gate state and handler**

After the existing state declarations (around line 52), add:

```typescript
const [gateComplete, setGateComplete] = useState(false);
const handleGateComplete = (result: GateResult) => {
  setNickname(result.nickname || null);
  setEmailVerified(result.emailVerified);
  setProfile({ submission_count: result.submissionCount, submission_cap: result.submissionCap });
  setGateComplete(true);
};
```

- [ ] **Step 3: Remove the `saveProfile` function and `getCollectProfile` useEffect**

Delete the `saveProfile` function (lines ~54-60):
```typescript
// DELETE this entire function:
const saveProfile = async (data: { nickname?: string }) => {
  const resp = await apiClient.setCollectProfile(code, data);
  setNickname(resp.nickname);
  if (resp.nickname) {
    localStorage.setItem(`wrzdj_collect_nickname_${code}`, resp.nickname);
  }
};
```

Delete the `getCollectProfile` useEffect (lines ~62-72):
```typescript
// DELETE this entire useEffect:
useEffect(() => {
  if (!code) return;
  apiClient.getCollectProfile(code).then((p) => {
    setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
    setEmailVerified(p.email_verified);
    setNickname(p.nickname);
    if (p.nickname) {
      localStorage.setItem(`wrzdj_collect_nickname_${code}`, p.nickname);
    }
  });
}, [code]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Add gate guard before main render**

Find the early-return that handles a null `event` (currently shows a loading spinner or error). After that block, add:

```typescript
if (!gateComplete) {
  return <NicknameGate code={code} onComplete={handleGateComplete} />;
}
```

This should be placed **after** the `if (!event)` loading/error check so the gate doesn't fire if the event data hasn't loaded yet — BUT actually the gate itself calls getCollectProfile which handles 404, so the gate can fire before `event` is loaded. The gate should render before the event data loads. Place it **before** the `if (!event)` guard:

```typescript
// Place BEFORE any if (!event) / loading check:
if (!gateComplete) {
  return <NicknameGate code={code} onComplete={handleGateComplete} />;
}
```

> Read the file to find the exact location of the early returns. The gate guard goes right after state declarations and before the first `if (!event)` check.

- [ ] **Step 5: Remove `FeatureOptInPanel`, add `IdentityBar`, update nickname display**

In the main `return` block, find and make these changes:

**Remove** the `FeatureOptInPanel` usage:
```typescript
// DELETE:
<FeatureOptInPanel
  emailVerified={emailVerified}
  initialNickname={nickname}
  onSave={saveProfile}
  onVerified={() => setEmailVerified(true)}
/>
```

**Remove** the "Voting as" nickname display (it moves to IdentityBar):
```typescript
// DELETE:
{nickname && (
  <p className="collect-countdown" style={{ marginTop: '0.25rem' }}>
    Voting as <strong>@{nickname}</strong>
  </p>
)}
```

**Add `IdentityBar`** immediately inside `<main className="collect-page">`, before `{bannerNode}`:

```typescript
<main className="collect-page">
  <IdentityBar
    nickname={nickname ?? ''}
    emailVerified={emailVerified}
    onVerified={() => setEmailVerified(true)}
  />
  {bannerNode}
  <div className="collect-container">
    ...
```

- [ ] **Step 6: Fix the submit nickname — remove localStorage fallback**

In `handleSelectSong`, the nickname is currently:
```typescript
const submitNickname =
  nickname ?? localStorage.getItem(`wrzdj_collect_nickname_${code}`) ?? undefined;
```

Replace with:
```typescript
const submitNickname = nickname ?? undefined;
```

The localStorage fallback is no longer needed — the gate guarantees `nickname` is set before the user can reach the submit flow.

- [ ] **Step 7: Run full dashboard test suite**

```bash
cd dashboard && npm test -- --run && npx tsc --noEmit
```

Expected: all tests pass. If collect page had specific tests that relied on `FeatureOptInPanel` being rendered, update them.

- [ ] **Step 8: Commit**

```bash
git add "dashboard/app/collect/[code]/page.tsx"
git commit -m "feat: wire NicknameGate and IdentityBar into collect page

Removes FeatureOptInPanel and the initial getCollectProfile useEffect.
The gate owns identity capture; onComplete seeds page state directly."
```

---

## Task 5: Wire gate into join page

**Files:**
- Modify: `dashboard/app/join/[code]/page.tsx`

The join page currently has:
- An optional nickname `<input>` in the song confirm screen (lines ~588-599)
- An `EmailVerification` block shown after submission (lines ~522-527)
- `[emailVerified, setEmailVerified]` state initialized to `false`
- `[nickname, setNickname]` state initialized to `''`

After this task:
- Gate runs before anything else
- `nickname` and `emailVerified` come from the gate
- Confirm screen passes `nickname` automatically (no input field shown)
- `EmailVerification` bottom block replaced by the persistent `IdentityBar`

- [ ] **Step 1: Update imports**

At the top of `dashboard/app/join/[code]/page.tsx`, add:

```typescript
import { NicknameGate, GateResult } from '@/components/NicknameGate';
import { IdentityBar } from '@/components/IdentityBar';
```

Keep the existing `EmailVerification` import — it's no longer needed after this task. Remove it:

```typescript
// DELETE this line:
import EmailVerification from '../../collect/[code]/components/EmailVerification';
```

- [ ] **Step 2: Add gate state and handler**

After the existing state declarations, add:

```typescript
const [gateComplete, setGateComplete] = useState(false);
const handleGateComplete = (result: GateResult) => {
  setNickname(result.nickname);
  setEmailVerified(result.emailVerified);
  setGateComplete(true);
};
```

- [ ] **Step 3: Add gate guard**

Find the `loadEvent` useEffect setup. Before the first render returns (and before the `if (loading)` check), add:

```typescript
if (!gateComplete) {
  return <NicknameGate code={code} onComplete={handleGateComplete} />;
}
```

Place this **before** the `if (loading)` block so the gate shows immediately on mount.

- [ ] **Step 4: Remove the optional nickname field from the confirm screen**

Find the confirm-screen render block (`if (selectedSong) { return ... }`). Remove the nickname `form-group`:

```typescript
// DELETE these lines:
<div className="form-group">
  <label htmlFor="nickname">Your name (optional)</label>
  <input
    id="nickname"
    type="text"
    className="input"
    placeholder="e.g., Sarah"
    value={nickname}
    onChange={(e) => setNickname(e.target.value)}
    maxLength={30}
  />
</div>
```

The `handleSubmit` function already uses `nickname || undefined` — since `nickname` now comes from the gate, this still works correctly without changes.

- [ ] **Step 5: Remove `EmailVerification` block from the request list view**

Find the block (in the `if (showRequestList)` render branch):

```typescript
// DELETE:
{!emailVerified && (
  <div style={{ margin: '1rem 0', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '8px' }}>
    <EmailVerification isVerified={false} onVerified={() => setEmailVerified(true)} />
  </div>
)}
```

- [ ] **Step 6: Add `IdentityBar` to both render branches**

The join page has two major render branches that a guest sees: the request list view (`if (showRequestList)`) and the search form. Add `IdentityBar` at the top of both.

In the **request list view** (`<div className="guest-request-list-container">`), add immediately inside that div:

```typescript
<div className="guest-request-list-container">
  <IdentityBar
    nickname={nickname}
    emailVerified={emailVerified}
    onVerified={() => setEmailVerified(true)}
  />
  {splashVisible && ...}
```

In the **search form view** (the final `return` with `.join-page-wrapper`), add `IdentityBar` inside `.join-page-wrapper` before the `.container`:

```typescript
<div className="join-page-wrapper">
  {event.banner_url && ...}
  <IdentityBar
    nickname={nickname}
    emailVerified={emailVerified}
    onVerified={() => setEmailVerified(true)}
  />
  {splashVisible && ...}
  <div className="container" ...>
```

Also add it to the submitted confirmation screen and the requests-closed screen if you want full coverage — but the two primary views above are the minimum.

- [ ] **Step 7: Run full dashboard test suite**

```bash
cd dashboard && npm test -- --run && npx tsc --noEmit && npm run lint
```

Expected: all tests pass, zero TypeScript errors. The `nickname` state initializer in the join page may need to change from `useState('')` to `useState('')` (no change needed — gate sets it via `setNickname`).

- [ ] **Step 8: Commit**

```bash
git add "dashboard/app/join/[code]/page.tsx"
git commit -m "feat: wire NicknameGate and IdentityBar into join page

Removes optional nickname field from confirm screen and the post-
submission EmailVerification block. Gate guarantees nickname is set
before any interaction; IdentityBar handles ongoing email nudge."
```

---

## Task 6: Full CI verification + PR

**Files:** none

- [ ] **Step 1: Full frontend CI**

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```

Expected: 0 ESLint errors, 0 TypeScript errors, all tests pass.

- [ ] **Step 2: Full backend CI (unchanged, but verify nothing broke)**

```bash
cd server && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest --tb=short -q
```

Expected: all green.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/nickname-gate
gh pr create \
  --title "feat: mandatory nickname gate on join and collect pages" \
  --base fix/guest-auth-hardening \
  --body "$(cat <<'EOF'
## Summary
- New `NicknameGate` component: full-screen overlay requiring a nickname before any page interaction on /join and /collect
- Routing: new guest → nickname input; returning + no email → email prompt with skip; returning + email → bypass gate
- New `IdentityBar` component: persistent post-gate strip showing saved name + animated 'Add email' nudge
- `EmailVerification` gains optional `onSkip` prop rendered as 'Skip for now'
- Kiosk modal completely unchanged
- No new backend endpoints — all calls reuse existing collect profile and verify APIs

## Test plan
- [ ] NicknameGate unit tests: all routing + save + error cases
- [ ] IdentityBar unit tests: verified/unverified states, inline expansion
- [ ] EmailVerification: onSkip renders and fires
- [ ] Manual: new guest flow — gate → save → email prompt → skip → identity bar
- [ ] Manual: returning guest with nickname + no email → email prompt shown
- [ ] Manual: returning guest with nickname + email → gate skipped immediately
- [ ] Manual: network error → blocking error + Retry
- [ ] Manual: kiosk modal unchanged, no gate or email prompt
EOF
)"
```

- [ ] **Step 4: Watch CI**

```bash
gh pr checks --watch
```

Expected: all checks green.

---

## Self-review checklist

**Spec coverage:**
- Gate routing (new / returning + no email / returning + email) → Task 2 ✓
- "What's your nickname?" heading → Task 2 `nickname_input` state ✓
- Save button disabled until input → Task 2 + test ✓
- "Nickname saved!" flash → Task 2 ✓
- Email prompt with "Skip for now" → Tasks 1 + 2 ✓
- `onComplete(nickname, emailVerified)` → Task 2 `GateResult` ✓
- Identity bar with name + pulse + "Add email" → Task 3 ✓
- IdentityBar → "Verified" when email set → Task 3 ✓
- 404 pass-through → Task 2 ✓
- 5xx/network → blocking error + Retry → Task 2 ✓
- Collect page: gate wired, FeatureOptInPanel removed → Task 4 ✓
- Join page: gate wired, optional nickname removed, EmailVerification block removed → Task 5 ✓
- Kiosk modal untouched → explicitly excluded from all tasks ✓
- No new backend endpoints → confirmed, all Tasks use existing APIs ✓

**Placeholder scan:** None found.

**Type consistency:**
- `GateResult` defined in `NicknameGate.tsx`, exported, imported in Tasks 4 + 5 — matches `{ nickname, emailVerified, submissionCount, submissionCap }` throughout
- `onSkip?: () => void` added to `EmailVerification` Props in Task 1, used in Tasks 2 + 3
- `IdentityBar` props: `{ nickname: string, emailVerified: boolean, onVerified: () => void }` — consistent in Tasks 3, 4, 5
