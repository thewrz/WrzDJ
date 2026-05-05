import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeaderboardTabs from './LeaderboardTabs';
import type { CollectLeaderboardRow } from '@/lib/api';

const rows: CollectLeaderboardRow[] = [
  {
    id: 1,
    title: 'A',
    artist: 'X',
    artwork_url: null,
    vote_count: 5,
    nickname: 'alex',
    status: 'new' as const,
    created_at: '2026-04-21',
    bpm: null,
    musical_key: null,
    genre: null,
    requester_verified: true,
  },
  {
    id: 2,
    title: 'B',
    artist: 'Y',
    artwork_url: null,
    vote_count: 1,
    nickname: 'jo',
    status: 'new' as const,
    created_at: '2026-04-21',
    bpm: null,
    musical_key: null,
    genre: null,
  },
];

const mockRow: CollectLeaderboardRow = {
  id: 1,
  title: 'Levels',
  artist: 'Avicii',
  artwork_url: null,
  vote_count: 5,
  nickname: null,
  status: 'new',
  created_at: new Date().toISOString(),
  bpm: null,
  musical_key: null,
  genre: null,
};

describe('LeaderboardTabs', () => {
  it('renders rows and switches tabs', () => {
    const onTabChange = vi.fn();
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={onTabChange}
        onVote={vi.fn()}
        votedIds={new Set()}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    expect(onTabChange).toHaveBeenCalledWith('all');
  });

  it('optimistically updates vote count then rolls back on error', async () => {
    const onVote = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={vi.fn()}
        onVote={onVote}
        votedIds={new Set()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /upvote/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/5/)).toBeInTheDocument();
    });
  });

  it('disables the vote button when votedIds already contains the request id', () => {
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={vi.fn()}
        onVote={vi.fn()}
        votedIds={new Set([1])}
      />,
    );
    const votedButton = screen.getByRole('button', { name: /upvoted/i });
    expect(votedButton).toBeDisabled();
    expect(votedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not call onVote twice for rapid repeated clicks on the same row', async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={vi.fn()}
        onVote={onVote}
        votedIds={new Set()}
      />,
    );
    const upvoteButtons = screen.getAllByRole('button', { name: /upvote/i });
    fireEvent.click(upvoteButtons[0]);
    fireEvent.click(upvoteButtons[0]);
    fireEvent.click(upvoteButtons[0]);
    await waitFor(() => {
      expect(onVote).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <LeaderboardTabs
        rows={[mockRow]}
        tab="all"
        onTabChange={vi.fn()}
        onVote={vi.fn().mockResolvedValue(undefined)}
        votedIds={new Set()}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Levels'));
    expect(onRowClick).toHaveBeenCalledWith(mockRow);
  });

  it('does not call onRowClick when vote button is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <LeaderboardTabs
        rows={[mockRow]}
        tab="all"
        onTabChange={vi.fn()}
        onVote={vi.fn().mockResolvedValue(undefined)}
        votedIds={new Set()}
        onRowClick={onRowClick}
      />,
    );
    const voteBtn = screen.getByRole('button', { name: /upvote/i });
    fireEvent.click(voteBtn);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders verified badge for verified requester', () => {
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={vi.fn()}
        onVote={vi.fn()}
        votedIds={new Set()}
      />,
    );
    const badge = screen.getByText('✓');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ color: '#22c55e' });
  });
});
