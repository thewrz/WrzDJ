import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NicknameGate } from '../NicknameGate';

vi.mock('../../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  class NicknameConflictError extends Error {
    claimed: boolean;
    constructor(claimed: boolean) {
      super('nickname_taken');
      this.name = 'NicknameConflictError';
      this.claimed = claimed;
    }
  }
  return {
    apiClient: {
      getCollectProfile: vi.fn(),
      setCollectProfile: vi.fn(),
      requestVerificationCode: vi.fn(),
      confirmVerificationCode: vi.fn(),
    },
    ApiError,
    NicknameConflictError,
  };
});

vi.mock('../../lib/use-guest-identity', () => ({
  useGuestIdentity: () => ({
    isLoading: false,
    guestId: 1,
    isReturning: false,
    reconcileHint: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../EmailVerification', () => ({
  default: ({ onVerified, onSkip }: { onVerified: () => void; onSkip: () => void }) => (
    <div>
      <button onClick={onVerified}>Verify Email</button>
      <button onClick={onSkip}>Skip Email</button>
    </div>
  ),
}));

import { apiClient, NicknameConflictError } from '../../lib/api';

const mockGetProfile = vi.mocked(apiClient.getCollectProfile);
const mockSetProfile = vi.mocked(apiClient.setCollectProfile);
const mockRequestCode = vi.mocked(apiClient.requestVerificationCode);
const mockConfirmCode = vi.mocked(apiClient.confirmVerificationCode);

const emptyProfile = {
  nickname: null,
  email_verified: false,
  submission_count: 0,
  submission_cap: 5,
};

describe('NicknameGate', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfile.mockResolvedValue(emptyProfile);
    mockSetProfile.mockResolvedValue({ ...emptyProfile, nickname: 'TestUser' });
    mockRequestCode.mockResolvedValue({ sent: true });
    mockConfirmCode.mockResolvedValue({ verified: true, guest_id: 1, merged: false });
  });

  it('renders track_select when no profile exists', async () => {
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new name/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /have email/i })).toBeInTheDocument();
    });
  });

  it('transitions to nickname_input when "New name" clicked', async () => {
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument();
  });

  it('transitions to email_login when "Have email" clicked', async () => {
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    expect(screen.getByPlaceholderText(/you@example\.com/i)).toBeInTheDocument();
  });

  it('shows collision_unclaimed state on 409 claimed=false', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(false));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument();
      expect(screen.getByText(/original device/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /log in with email/i })).not.toBeInTheDocument();
  });

  it('shows collision_claimed state on 409 claimed=true', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(true));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /log in with email/i })).toBeInTheDocument();
    });
  });

  it('"Try a different nickname" from collision_unclaimed returns to nickname_input', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(false));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByText(/original device/i));
    fireEvent.click(screen.getByRole('button', { name: /try a different/i }));
    expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument();
  });

  it('"Try a different nickname" from collision_claimed returns to nickname_input', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(true));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByRole('button', { name: /log in with email/i }));
    fireEvent.click(screen.getByRole('button', { name: /try a different/i }));
    expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument();
  });

  it('transitions to complete when email verified and profile has nickname', async () => {
    mockGetProfile
      .mockResolvedValueOnce(emptyProfile)
      .mockResolvedValueOnce({
        nickname: 'Alex',
        email_verified: true,
        submission_count: 0,
        submission_cap: 5,
      });
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => screen.getByPlaceholderText(/6.digit/i));
    fireEvent.change(screen.getByPlaceholderText(/6.digit/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: 'Alex', emailVerified: true }),
      ),
    );
  });

  it('transitions to nickname_input when email verified but no nickname on guest', async () => {
    mockGetProfile
      .mockResolvedValueOnce(emptyProfile)
      .mockResolvedValueOnce({
        nickname: null,
        email_verified: true,
        submission_count: 0,
        submission_cap: 5,
      });
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => screen.getByPlaceholderText(/6.digit/i));
    fireEvent.change(screen.getByPlaceholderText(/6.digit/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument());
  });

  it('skips email_prompt when nickname saved while already email-verified', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockGetProfile
        .mockResolvedValueOnce(emptyProfile)
        .mockResolvedValueOnce({
          nickname: null,
          email_verified: true,
          submission_count: 0,
          submission_cap: 5,
        });
      mockSetProfile.mockResolvedValue({
        nickname: 'NewUser',
        email_verified: true,
        submission_count: 0,
        submission_cap: 5,
      });
      render(<NicknameGate code="EVT01" onComplete={onComplete} />);
      await waitFor(() => screen.getByRole('button', { name: /have email/i }));
      fireEvent.click(screen.getByRole('button', { name: /have email/i }));
      fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
        target: { value: 'test@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /send code/i }));
      await waitFor(() => screen.getByPlaceholderText(/6.digit/i));
      fireEvent.change(screen.getByPlaceholderText(/6.digit/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));
      await waitFor(() => screen.getByPlaceholderText(/dancingqueen/i));
      fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), {
        target: { value: 'NewUser' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      // Wait for setCollectProfile to resolve, then advance fake timers past the 1500ms savedFlash delay
      await act(async () => {
        await Promise.resolve(); // let the mock promise resolve
        vi.runAllTimers();
      });
      await waitFor(() =>
        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({ nickname: 'NewUser', emailVerified: true }),
        ),
      );
      expect(screen.queryByText(/add your email/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
