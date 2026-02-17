import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTabTitle } from '../tab-title';

describe('useTabTitle', () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it('sets document.title when rendered with event name and count', () => {
    renderHook(() => useTabTitle('My Event', 3));
    expect(document.title).toBe('(3) My Event - WrzDJ');
  });

  it('sets title without badge when count is 0', () => {
    renderHook(() => useTabTitle('My Event', 0));
    expect(document.title).toBe('My Event - WrzDJ');
  });

  it('updates title when count changes', () => {
    const { rerender } = renderHook(
      ({ name, count }) => useTabTitle(name, count),
      { initialProps: { name: 'My Event', count: 1 } }
    );
    expect(document.title).toBe('(1) My Event - WrzDJ');

    rerender({ name: 'My Event', count: 5 });
    expect(document.title).toBe('(5) My Event - WrzDJ');
  });

  it('resets title on unmount', () => {
    const { unmount } = renderHook(() => useTabTitle('My Event', 2));
    expect(document.title).toBe('(2) My Event - WrzDJ');

    unmount();
    expect(document.title).toBe('WrzDJ Dashboard');
  });

  it('does not set title when eventName is null', () => {
    document.title = 'Original Title';
    renderHook(() => useTabTitle(null, 5));
    expect(document.title).toBe('Original Title');
  });
});
