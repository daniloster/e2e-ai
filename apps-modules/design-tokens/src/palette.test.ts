import { describe, expect, it } from 'vitest';

import { FONTS, PALETTE, RADIUS, UI_COLORS, contrastRatio, cssVariables } from './index';

const HEX = /^#[0-9A-F]{6}$/;

describe('PALETTE', () => {
  it('bundles the named exports', () => {
    expect(PALETTE.ui).toBe(UI_COLORS);
    expect(PALETTE.fonts).toBe(FONTS);
    expect(PALETTE.radius).toBe(RADIUS);
  });

  it('uses upper-case #RRGGBB everywhere', () => {
    for (const value of Object.values(UI_COLORS)) expect(value).toMatch(HEX);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PALETTE)).toBe(true);
    expect(Object.isFrozen(UI_COLORS)).toBe(true);
    expect(Object.isFrozen(FONTS)).toBe(true);
  });

  it('keeps text readable (WCAG AA 4.5:1)', () => {
    expect(contrastRatio(UI_COLORS.ink, UI_COLORS.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLORS.ink, UI_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLORS.muted, UI_COLORS.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLORS.muted, UI_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLORS.primaryInk, UI_COLORS.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLORS.primary, UI_COLORS.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLORS.danger, UI_COLORS.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps accents and borders visible (WCAG 1.4.11, 3:1 for UI parts)', () => {
    expect(contrastRatio(UI_COLORS.secondary, UI_COLORS.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(UI_COLORS.primary, UI_COLORS.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('cssVariables', () => {
  it('exposes the UI colours, fonts and radius', () => {
    const vars = cssVariables();
    expect(vars['--color-bg']).toBe(UI_COLORS.bg);
    expect(vars['--color-primary-ink']).toBe(UI_COLORS.primaryInk);
    expect(vars['--color-danger']).toBe(UI_COLORS.danger);
    expect(vars['--font-display']?.startsWith(`"${FONTS.display}"`)).toBe(true);
    expect(vars['--font-body']?.startsWith(`"${FONTS.body}"`)).toBe(true);
    expect(vars['--radius']).toBe(`${RADIUS}px`);
    expect(Object.keys(vars)).toHaveLength(12);
    expect(Object.isFrozen(vars)).toBe(true);
  });
});
