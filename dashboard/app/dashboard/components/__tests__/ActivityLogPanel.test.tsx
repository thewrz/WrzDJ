import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityLogPanel } from '../ActivityLogPanel';
import type { ActivityLogEntry } from '@/lib/api-types';

const sampleEntries: ActivityLogEntry[] = [
  { id: 1, created_at: '2026-02-13T10:00:00Z', level: 'info', source: 'bridge', message: 'Bridge connected', event_code: 'ABC123' },
  { id: 2, created_at: '2026-02-13T10:05:00Z', level: 'warning', source: 'tidal', message: 'Track not found on Tidal', event_code: 'ABC123' },
  { id: 3, created_at: '2026-02-13T10:10:00Z', level: 'error', source: 'beatport', message: 'Beatport sync failed', event_code: 'ABC123' },
];

describe('ActivityLogPanel', () => {
  it('renders with collapsed state by default', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    expect(screen.getByText('Activity Log')).toBeTruthy();
    expect(screen.getByText('Expand')).toBeTruthy();
    expect(screen.queryByText('Bridge connected')).toBeNull();
  });

  it('shows entries when expanded', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('Bridge connected')).toBeTruthy();
    expect(screen.getByText('Track not found on Tidal')).toBeTruthy();
    expect(screen.getByText('Beatport sync failed')).toBeTruthy();
  });

  it('shows empty state when no entries', () => {
    render(<ActivityLogPanel entries={[]} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('No recent activity')).toBeTruthy();
  });

  it('shows warning count badge', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    expect(screen.getByText('2 warnings')).toBeTruthy();
  });

  it('shows level badges when expanded', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('info')).toBeTruthy();
    expect(screen.getByText('warning')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('shows source badges when expanded', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('bridge')).toBeTruthy();
    expect(screen.getByText('tidal')).toBeTruthy();
    expect(screen.getByText('beatport')).toBeTruthy();
  });

  it('toggles collapse on click', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);

    fireEvent.click(screen.getByText('Expand'));
    expect(screen.getByText('Collapse')).toBeTruthy();
    expect(screen.getByText('Bridge connected')).toBeTruthy();

    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.getByText('Expand')).toBeTruthy();
    expect(screen.queryByText('Bridge connected')).toBeNull();
  });
});
