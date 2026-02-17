import { describe, it, expect } from 'vitest';
import { FONT_FAMILIES, getFontClass } from '../fonts';

describe('FONT_FAMILIES', () => {
  it('defines a body font family', () => {
    expect(FONT_FAMILIES.body).toBeDefined();
    expect(typeof FONT_FAMILIES.body).toBe('string');
    expect(FONT_FAMILIES.body.length).toBeGreaterThan(0);
  });

  it('defines a display font family for kiosk headings', () => {
    expect(FONT_FAMILIES.display).toBeDefined();
    expect(typeof FONT_FAMILIES.display).toBe('string');
    expect(FONT_FAMILIES.display.length).toBeGreaterThan(0);
  });

  it('defines a mono font family for numeric badges', () => {
    expect(FONT_FAMILIES.mono).toBeDefined();
    expect(typeof FONT_FAMILIES.mono).toBe('string');
    expect(FONT_FAMILIES.mono.length).toBeGreaterThan(0);
  });

  it('all font families include a fallback', () => {
    expect(FONT_FAMILIES.body).toContain('sans-serif');
    expect(FONT_FAMILIES.display).toContain('sans-serif');
    expect(FONT_FAMILIES.mono).toContain('monospace');
  });
});

describe('getFontClass', () => {
  it('returns body class for body role', () => {
    expect(getFontClass('body')).toBe('font-body');
  });

  it('returns display class for display role', () => {
    expect(getFontClass('display')).toBe('font-display');
  });

  it('returns mono class for mono role', () => {
    expect(getFontClass('mono')).toBe('font-mono');
  });

  it('returns body class for unknown role', () => {
    expect(getFontClass('unknown' as 'body')).toBe('font-body');
  });
});
