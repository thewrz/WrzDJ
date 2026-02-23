import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { KeyBadge, BpmBadge, GenreBadge } from '../MusicBadges';
import { getCamelotColor } from '@/lib/camelot-colors';
import { getBpmColor } from '@/lib/bpm-color';

describe('KeyBadge', () => {
  it('renders nothing when musicalKey is null', () => {
    const { container } = render(<KeyBadge musicalKey={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when musicalKey is empty', () => {
    const { container } = render(<KeyBadge musicalKey="" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the Camelot code for a named key', () => {
    render(<KeyBadge musicalKey="A minor" />);
    expect(screen.getByText('8A')).toBeDefined();
  });

  it('renders the Camelot code as-is for Camelot input', () => {
    render(<KeyBadge musicalKey="5A" />);
    expect(screen.getByText('5A')).toBeDefined();
  });

  it('has aria-label for accessibility', () => {
    render(<KeyBadge musicalKey="8A" />);
    const badge = screen.getByLabelText(/key.*8A/i);
    expect(badge).toBeDefined();
  });

  it('uses colored background based on Camelot position', () => {
    const { container } = render(<KeyBadge musicalKey="8A" />);
    const badge = container.firstChild as HTMLElement;
    // Position 8 = teal (#32D7A0) — verify component wires the correct color
    const expected = getCamelotColor('8A');
    expect(badge).toHaveStyle({ backgroundColor: expected.bg });
  });

  it('renders fallback style for unparseable keys', () => {
    render(<KeyBadge musicalKey="nonsense" />);
    // Should still render the raw text as fallback
    expect(screen.getByText('nonsense')).toBeDefined();
  });

  it('applies bold font weight for visibility', () => {
    const { container } = render(<KeyBadge musicalKey="8A" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.style.fontWeight).toBe('700');
  });
});

describe('BpmBadge', () => {
  it('renders nothing when bpm is null', () => {
    const { container } = render(<BpmBadge bpm={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders rounded BPM value', () => {
    render(<BpmBadge bpm={128.7} />);
    expect(screen.getByText(/129/)).toBeDefined();
  });

  it('includes BPM label text', () => {
    render(<BpmBadge bpm={128} />);
    expect(screen.getByText(/128/)).toBeDefined();
  });

  it('has aria-label for accessibility', () => {
    render(<BpmBadge bpm={128} />);
    const badge = screen.getByLabelText(/bpm.*128/i);
    expect(badge).toBeDefined();
  });

  it('shows green tier when close to average', () => {
    const { container } = render(<BpmBadge bpm={128} avgBpm={128} />);
    const badge = container.firstChild as HTMLElement;
    const expected = getBpmColor(128, 128);
    expect(expected.tier).toBe('match');
    expect(badge).toHaveStyle({ backgroundColor: expected.bg });
  });

  it('shows amber tier when moderately far from average', () => {
    const { container } = render(<BpmBadge bpm={140} avgBpm={128} />);
    const badge = container.firstChild as HTMLElement;
    const expected = getBpmColor(140, 128);
    expect(expected.tier).toBe('near');
    expect(badge).toHaveStyle({ backgroundColor: expected.bg });
  });

  it('shows neutral tier when no average is provided', () => {
    const { container } = render(<BpmBadge bpm={128} />);
    const badge = container.firstChild as HTMLElement;
    const expected = getBpmColor(128, null);
    expect(expected.tier).toBe('neutral');
    expect(badge).toHaveStyle({ backgroundColor: expected.bg });
  });

  it('applies bold font weight for visibility', () => {
    const { container } = render(<BpmBadge bpm={128} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.style.fontWeight).toBe('700');
  });

  it('shows neutral tier when isOutlier is true', () => {
    const { container } = render(<BpmBadge bpm={68} avgBpm={128} isOutlier={true} />);
    const badge = container.firstChild as HTMLElement;
    const expected = getBpmColor(68, 128, true);
    expect(expected.tier).toBe('neutral');
    expect(badge).toHaveStyle({ backgroundColor: expected.bg });
  });

  it('shows normal color when isOutlier is false', () => {
    const { container } = render(<BpmBadge bpm={128} avgBpm={128} isOutlier={false} />);
    const badge = container.firstChild as HTMLElement;
    const expected = getBpmColor(128, 128, false);
    expect(expected.tier).toBe('match');
    expect(badge).toHaveStyle({ backgroundColor: expected.bg });
  });
});

describe('GenreBadge', () => {
  it('renders nothing when genre is null', () => {
    const { container } = render(<GenreBadge genre={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders genre text', () => {
    render(<GenreBadge genre="House" />);
    expect(screen.getByText('House')).toBeDefined();
  });

  it('has aria-label for accessibility', () => {
    render(<GenreBadge genre="Techno" />);
    const badge = screen.getByLabelText(/genre.*techno/i);
    expect(badge).toBeDefined();
  });
});
