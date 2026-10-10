import { describe, expect, test } from 'bun:test';
import { resolveLineSelectionBehavior } from './lineSelectionBehavior';

describe('resolveLineSelectionBehavior', () => {
  test('preserves a completed range gesture in the compact touch shell', () => {
    expect(resolveLineSelectionBehavior({
      source: 'range-gesture',
      compactTouchLayout: true,
    })).toBe('preserve-selection');
  });

  test('opens the composer from the explicit gutter action on compact touch', () => {
    expect(resolveLineSelectionBehavior({
      source: 'gutter-comment-action',
      compactTouchLayout: true,
    })).toBe('open-composer');
  });

  test('native text selection preserves copy behavior on both desktop and compact touch', () => {
    for (const compactTouchLayout of [false, true]) {
      expect(resolveLineSelectionBehavior({
        source: 'text-selection',
        compactTouchLayout,
      })).toBe('preserve-selection');
    }
  });

  test('preserves the incumbent desktop gutter-selection-to-composer behavior', () => {
    expect(resolveLineSelectionBehavior({
      source: 'range-gesture',
      compactTouchLayout: false,
    })).toBe('open-composer');
  });
});
