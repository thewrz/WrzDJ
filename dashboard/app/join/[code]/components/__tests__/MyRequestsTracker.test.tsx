import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MyRequestsTracker from '../MyRequestsTracker';

vi.mock('@/lib/api', () => ({
  api: {
    getMyRequests: vi.fn().mockResolvedValue({
      requests: [
        {
          id: 1,
          title: 'Test Song',
          artist: 'Test Artist',
          status: 'new',
          artwork_url: null,
          created_at: '2026-05-16T00:00:00Z',
          vote_count: 0,
        },
      ],
    }),
  },
}));

describe('MyRequestsTracker', () => {
  it('art placeholder uses theme-safe background', async () => {
    render(
      <MyRequestsTracker
        eventCode="EVT001"
        refreshKey={0}
        onRequestIdsLoaded={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Song')).toBeInTheDocument();
    });

    const placeholder = document.querySelector('div.guest-request-item-art');
    expect(placeholder).not.toBeNull();
    expect(placeholder!).toHaveAttribute('style', expect.stringContaining('var(--card)'));
  });

  it('art placeholder icon uses theme-safe text color', async () => {
    render(
      <MyRequestsTracker
        eventCode="EVT001"
        refreshKey={0}
        onRequestIdsLoaded={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Song')).toBeInTheDocument();
    });

    const placeholder = document.querySelector('div.guest-request-item-art');
    const icon = placeholder!.querySelector('span');
    expect(icon).not.toBeNull();
    expect(icon!).toHaveAttribute('style', expect.stringContaining('var(--text-secondary)'));
  });
});
