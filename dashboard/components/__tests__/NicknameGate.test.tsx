import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../lib/api', () => ({
  apiClient: {
    getCollectProfile: vi.fn(),
    setCollectProfile: vi.fn(),
    requestVerificationCode: vi.fn(),
    confirmVerificationCode: vi.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../../lib/use-guest-identity', () => ({
  useGuestIdentity: vi.fn(() => ({
    guestId: 1,
    isReturning: false,
    isLoading: false,
    error: null,
  })),
}));

import { NicknameGate } from '../NicknameGate';
import { apiClient, ApiError } from '../../lib/api';
import { useGuestIdentity } from '../../lib/use-guest-identity';

const mockGetProfile = apiClient.getCollectProfile as ReturnType<typeof vi.fn>;
const mockSetProfile = apiClient.setCollectProfile as ReturnType<typeof vi.fn>;
const mockUseGuestIdentity = useGuestIdentity as ReturnType<typeof vi.fn>;

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
    mockUseGuestIdentity.mockReturnValue({
      guestId: 1,
      isReturning: false,
      isLoading: false,
      error: null,
    });
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

  it('shows "Nickname saved!" flash after successful save', async () => {
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

  it('skip from email_prompt calls onComplete with emailVerified=false', async () => {
    const onComplete = vi.fn();
    mockGetProfile.mockResolvedValue(
      baseProfile({ nickname: 'DJ_Foo', email_verified: false, submission_count: 3, submission_cap: 10 })
    );
    render(<NicknameGate code="TEST01" onComplete={onComplete} />);
    await waitFor(() => screen.getByText(/add your email/i));
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onComplete).toHaveBeenCalledWith({
      nickname: 'DJ_Foo',
      emailVerified: false,
      submissionCount: 3,
      submissionCap: 10,
    });
  });

  it('shows validation error for invalid nickname (line 80-81 — validation error path)', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));

    // Type an invalid nickname with special chars not in the allowed set
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Invalid@Name!' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText(/letters, numbers/i)).toBeInTheDocument();
    });
  });

  it('saves nickname via Enter key (line 158 — enter key branch)', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    mockSetProfile.mockResolvedValue(baseProfile({ nickname: 'PressEnter', email_verified: false }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PressEnter' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    await waitFor(() => {
      expect(mockSetProfile).toHaveBeenCalled();
    });
  });

  it('does not save nickname when Enter is pressed with empty input', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'k' });
    expect(mockSetProfile).not.toHaveBeenCalled();
  });

  it('typing clears inputError (line 91-92 — input change clears error)', async () => {
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));
    mockSetProfile.mockRejectedValue(new Error('Server error'));
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('heading', { name: /what.s your nickname/i }));

    // Trigger an error first
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SomeName' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => screen.getByText(/couldn.t save/i));

    // Now type again — error should clear
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SomeName2' } });
    await waitFor(() => {
      expect(screen.queryByText(/couldn.t save/i)).not.toBeInTheDocument();
    });
  });

  it('email verified from email_prompt calls onComplete with emailVerified=true', async () => {
    const onComplete = vi.fn();
    const mockRequestCode = apiClient.requestVerificationCode as ReturnType<typeof vi.fn>;
    const mockConfirmCode = apiClient.confirmVerificationCode as ReturnType<typeof vi.fn>;
    mockGetProfile.mockResolvedValue(
      baseProfile({ nickname: 'DJ_Foo', email_verified: false, submission_count: 2, submission_cap: 5 })
    );
    mockRequestCode.mockResolvedValue({ sent: true });
    mockConfirmCode.mockResolvedValue({ verified: true, guest_id: 1, merged: false });

    render(<NicknameGate code="TEST01" onComplete={onComplete} />);
    await waitFor(() => screen.getByText(/add your email/i));

    // Enter email and send code
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    // Wait for OTP digit inputs to appear
    await waitFor(() => {
      expect(screen.getByText(/code sent to/i)).toBeInTheDocument();
    });

    // Fill each digit individually — EmailVerification auto-submits when all 6 are filled
    const digitInputs = screen.getAllByRole('textbox');
    expect(digitInputs).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      fireEvent.change(digitInputs[i], { target: { value: String(i + 1) } });
    }

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        nickname: 'DJ_Foo',
        emailVerified: true,
        submissionCount: 2,
        submissionCap: 5,
      });
    });
  });

  // Race-condition tests for the IP-identity removal cleanup.
  // See docs/RECOVERY-IP-IDENTITY.md and Phase 2f of the plan:
  // NicknameGate must NOT call getCollectProfile until useGuestIdentity reports
  // the cookie has been issued and the guest_id is known. Otherwise the backend
  // sees no cookie and (pre-cleanup) falls back to IP, leaking another guest's
  // nickname onto a fresh device.

  it('does not call getCollectProfile while useGuestIdentity is loading', async () => {
    mockUseGuestIdentity.mockReturnValue({
      guestId: null,
      isReturning: false,
      isLoading: true,
      error: null,
    });
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: 'someone-else' }));

    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);

    // Give React a tick or two to flush any pending effects.
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it('calls getCollectProfile only after useGuestIdentity finishes loading', async () => {
    mockUseGuestIdentity.mockReturnValue({
      guestId: null,
      isReturning: false,
      isLoading: true,
      error: null,
    });
    mockGetProfile.mockResolvedValue(baseProfile({ nickname: null }));

    const { rerender } = render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);
    expect(mockGetProfile).not.toHaveBeenCalled();

    mockUseGuestIdentity.mockReturnValue({
      guestId: 42,
      isReturning: false,
      isLoading: false,
      error: null,
    });
    rerender(<NicknameGate code="TEST01" onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(mockGetProfile).toHaveBeenCalledWith('TEST01');
    });
  });

  it('shows the connecting spinner while waiting for guest identity', async () => {
    mockUseGuestIdentity.mockReturnValue({
      guestId: null,
      isReturning: false,
      isLoading: true,
      error: null,
    });
    render(<NicknameGate code="TEST01" onComplete={vi.fn()} />);

    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });
});
