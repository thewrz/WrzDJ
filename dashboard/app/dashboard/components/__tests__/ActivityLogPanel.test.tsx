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
    expect(screen.getByText('Activity Log')).toBeInTheDocument();
    expect(screen.getByText('Expand')).toBeInTheDocument();
    expect(screen.queryByText('Bridge connected')).toBeNull();
  });

  it('shows entries when expanded', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('Bridge connected')).toBeInTheDocument();
    expect(screen.getByText('Track not found on Tidal')).toBeInTheDocument();
    expect(screen.getByText('Beatport sync failed')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    render(<ActivityLogPanel entries={[]} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('No recent activity')).toBeInTheDocument();
  });

  it('shows warning count badge', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    expect(screen.getByText('2 warnings')).toBeInTheDocument();
  });

  it('shows level badges when expanded', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('info')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('shows source badges when expanded', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);
    fireEvent.click(screen.getByText('Expand'));

    expect(screen.getByText('bridge')).toBeInTheDocument();
    expect(screen.getByText('tidal')).toBeInTheDocument();
    expect(screen.getByText('beatport')).toBeInTheDocument();
  });

  it('toggles collapse on click', () => {
    render(<ActivityLogPanel entries={sampleEntries} />);

    fireEvent.click(screen.getByText('Expand'));
    expect(screen.getByText('Collapse')).toBeInTheDocument();
    expect(screen.getByText('Bridge connected')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.getByText('Expand')).toBeInTheDocument();
    expect(screen.queryByText('Bridge connected')).toBeNull();
  });
});
