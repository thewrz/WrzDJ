import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CollectDetailSheet from './CollectDetailSheet';
import type { CollectLeaderboardRow } from '@/lib/api';

const mockRow: CollectLeaderboardRow = {
  id: 1,
  title: 'Levels',
  artist: 'Avicii',
  artwork_url: null,
  vote_count: 47,
  nickname: null,
  status: 'new',
  created_at: new Date().toISOString(),
  bpm: 128,
  musical_key: '8A',
  genre: 'Progressive House',
};

describe('CollectDetailSheet', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });
  });

  it('renders mobile sheet layout on narrow screens', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={3}
        totalCount={10}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('Levels')).toBeTruthy();
    expect(screen.getByText('PRE-EVENT · #3')).toBeTruthy();
  });

  it('renders desktop dialog layout on wide screens', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('Levels')).toBeTruthy();
    // desktop shows rank in stats row
    expect(screen.getByText('#1')).toBeTruthy();
  });

  it('shows BPM pill when bpm is set', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('128 BPM')).toBeTruthy();
  });

  it('shows key pill when musical_key is set', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('8A')).toBeTruthy();
  });

  it('hides pills when both bpm and musical_key are null', async () => {
    const rowNoPills: CollectLeaderboardRow = { ...mockRow, bpm: null, musical_key: null };
    render(
      <CollectDetailSheet
        row={rowNoPills}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.queryByText(/BPM/)).toBeNull();
    expect(screen.queryByText('8A')).toBeNull();
  });

  it('shows bpm pill but not key pill when only bpm is set', async () => {
    const rowBpmOnly: CollectLeaderboardRow = { ...mockRow, bpm: 140, musical_key: null };
    render(
      <CollectDetailSheet
        row={rowBpmOnly}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('140 BPM')).toBeTruthy();
    expect(screen.queryByText('8A')).toBeNull();
  });

  it('shows key pill but not bpm pill when only musical_key is set', async () => {
    const rowKeyOnly: CollectLeaderboardRow = { ...mockRow, bpm: null, musical_key: '4B' };
    render(
      <CollectDetailSheet
        row={rowKeyOnly}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('4B')).toBeTruthy();
    expect(screen.queryByText(/BPM/)).toBeNull();
  });

  it('shows suggested-by section when nickname is set', async () => {
    const rowWithNickname: CollectLeaderboardRow = { ...mockRow, nickname: 'marco_b' };
    render(
      <CollectDetailSheet
        row={rowWithNickname}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('marco_b')).toBeTruthy();
    expect(screen.getByText('SUGGESTED BY')).toBeTruthy();
  });

  it('hides suggested-by section when nickname is null', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.queryByText('SUGGESTED BY')).toBeNull();
  });

  it('shows UPVOTE THIS TRACK button when not voted', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('UPVOTE THIS TRACK')).toBeTruthy();
  });

  it('shows VOTED label when voted', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={true}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('VOTED')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={onClose}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onVote when upvote button is clicked', async () => {
    const onVote = vi.fn();
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={onVote}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByText('UPVOTE THIS TRACK'));
    expect(onVote).toHaveBeenCalled();
  });

  it('renders artwork image when artwork_url is set', async () => {
    const rowWithArt: CollectLeaderboardRow = {
      ...mockRow,
      artwork_url: 'https://example.com/art.jpg',
    };
    render(
      <CollectDetailSheet
        row={rowWithArt}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    const imgs = screen.getAllByRole('img');
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/art.jpg');
  });

  it('renders initials fallback when artwork_url is null', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    // Initials = first char of title + first char of artist = "LA"
    const initialsEls = screen.getAllByText('LA');
    expect(initialsEls.length).toBeGreaterThan(0);
  });

  it('calls onClose when desktop backdrop is clicked', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    const onClose = vi.fn();
    const { container } = render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={onClose}
      />,
    );
    await act(async () => {});
    // Click the outer fixed backdrop div (first child of the container's root)
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not propagate clicks from inner dialog card to backdrop', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    const onClose = vi.fn();
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={1}
        totalCount={5}
        voted={false}
        onVote={vi.fn()}
        onClose={onClose}
      />,
    );
    await act(async () => {});
    // Click the title inside the card — should NOT trigger onClose
    fireEvent.click(screen.getByText('Levels'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('displays vote count and rank in stats row', async () => {
    render(
      <CollectDetailSheet
        row={mockRow}
        rank={2}
        totalCount={20}
        voted={false}
        onVote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('47')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('of 20')).toBeTruthy();
  });
});
