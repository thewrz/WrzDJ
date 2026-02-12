import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BeatportCallbackPage from '../page';

// Mock next/navigation
const mockSearchParams = new Map<string, string>();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) ?? null,
  }),
}));

describe('BeatportCallbackPage', () => {
  let originalOpener: typeof window.opener;
  let originalClose: typeof window.close;

  beforeEach(() => {
    originalOpener = window.opener;
    originalClose = window.close;
    mockSearchParams.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: originalOpener, writable: true });
    window.close = originalClose;
  });

  it('renders loading state initially', () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');
    Object.defineProperty(window, 'opener', {
      value: { postMessage: vi.fn() },
      writable: true,
    });
    window.close = vi.fn();

    render(<BeatportCallbackPage />);
    // The component should have tried to post and close, but we check it renders
    expect(window.close).toHaveBeenCalled();
  });

  it('posts message to opener with correct origin', () => {
    mockSearchParams.set('code', 'auth-code-abc');
    mockSearchParams.set('state', 'state-xyz');
    const mockPostMessage = vi.fn();
    Object.defineProperty(window, 'opener', {
      value: { postMessage: mockPostMessage },
      writable: true,
    });
    window.close = vi.fn();

    render(<BeatportCallbackPage />);

    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: 'beatport-auth-callback', code: 'auth-code-abc', state: 'state-xyz' },
      window.location.origin
    );
  });

  it('shows error when no code param', () => {
    // No code in search params
    Object.defineProperty(window, 'opener', {
      value: { postMessage: vi.fn() },
      writable: true,
    });

    render(<BeatportCallbackPage />);
    expect(screen.getByText('Missing authorization code')).toBeTruthy();
  });

  it('closes window after posting message', () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');
    Object.defineProperty(window, 'opener', {
      value: { postMessage: vi.fn() },
      writable: true,
    });
    const mockClose = vi.fn();
    window.close = mockClose;

    render(<BeatportCallbackPage />);
    expect(mockClose).toHaveBeenCalled();
  });

  it('shows fallback when no opener', () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');
    Object.defineProperty(window, 'opener', { value: null, writable: true });

    render(<BeatportCallbackPage />);
    expect(screen.getByText(/close this window/i)).toBeTruthy();
  });
});
