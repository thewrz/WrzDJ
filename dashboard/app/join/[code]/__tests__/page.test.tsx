import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ code: 'TEST01' })),
}));

vi.mock('@/lib/use-guest-identity', () => ({
  useGuestIdentity: vi.fn(),
}));

vi.mock('@/lib/use-event-stream', () => ({
  useEventStream: vi.fn(),
}));

vi.mock('@/components/NicknameGate', () => ({
  NicknameGate: ({ onComplete }: { onComplete: (r: unknown) => void }) => {
    // Immediately complete the gate with a test nickname
    onComplete({ nickname: 'TestUser', emailVerified: false, submissionCount: 0, submissionCap: 5 });
    return null;
  },
  GateResult: {},
}));

vi.mock('@/components/IdentityBar', () => ({
  IdentityBar: ({ nickname }: { nickname: string }) => (
    <div data-testid="identity-bar">{nickname}</div>
  ),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getEvent: vi.fn().mockResolvedValue({
      id: 1,
      code: 'TEST01',
      name: 'Test Event',
      requests_open: true,
      banner_url: null,
    }),
    checkHasRequested: vi.fn().mockResolvedValue({ has_requested: false }),
    getCollectEvent: vi.fn().mockResolvedValue({
      phase: 'live',
      code: 'TEST01',
      name: 'Test Event',
      banner_filename: null,
      banner_url: null,
      banner_colors: null,
      submission_cap_per_guest: 5,
      registration_enabled: false,
      collection_opens_at: null,
      live_starts_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
    getCollectProfile: vi.fn().mockResolvedValue({
      nickname: 'TestUser',
      email_verified: false,
      submission_count: 0,
      submission_cap: 5,
    }),
    getPublicRequests: vi.fn().mockResolvedValue({ requests: [], now_playing: null }),
    getMyRequests: vi.fn().mockResolvedValue({ requests: [] }),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 0) {
      super(message);
      this.status = status;
    }
  },
}));

// Import after mocks
import JoinEventPage from '../page';

describe('JoinEventPage — NicknameGate wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the gate before any page content loads', async () => {
    // Gate mock calls onComplete immediately — page should proceed to load
    render(<JoinEventPage />);
    // After gate completes, page should show the event name
    await waitFor(() => {
      expect(screen.getByText('Test Event')).toBeInTheDocument();
    });
  });

  it('shows IdentityBar with gate nickname after gate completes', async () => {
    render(<JoinEventPage />);
    await waitFor(() => {
      const bar = screen.getByTestId('identity-bar');
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveTextContent('TestUser');
    });
  });
});
