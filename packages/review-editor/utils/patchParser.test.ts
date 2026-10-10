import { describe, expect, test } from 'bun:test';
import { extractLinesFromPatch, isLineRangeInPatch } from './patchParser';

const PATCH = [
  '@@ -10,4 +20,5 @@',
  ' context',
  '-old',
  '+new',
  '+added',
  ' context',
  '@@ -40 +50 @@',
  '-before',
  '+after',
].join('\n');

describe('extractLinesFromPatch', () => {
  test('keeps header-like deleted and added code in the selected source range', () => {
    const patch = [
      '--- a/code.txt',
      '+++ b/code.txt',
      '@@ -40,3 +7,3 @@',
      '--- removed comment',
      '+++ added expression',
      '-old second line',
      '+new second line',
      ' context',
    ].join('\n');
    expect(extractLinesFromPatch(patch, 40, 41, 'old')).toBe('-- removed comment\nold second line');
    expect(extractLinesFromPatch(patch, 7, 8, 'new')).toBe('++ added expression\nnew second line');
    expect(extractLinesFromPatch(patch, 42, 42, 'old')).toBe('context');
    expect(extractLinesFromPatch(patch, 9, 9, 'new')).toBe('context');
  });
});

describe('isLineRangeInPatch', () => {
  test('accepts complete ranges represented by one hunk on the requested side', () => {
    expect(isLineRangeInPatch(PATCH, 20, 24, 'new')).toBe(true);
    expect(isLineRangeInPatch(PATCH, 10, 13, 'old')).toBe(true);
    expect(isLineRangeInPatch(PATCH, 50, 50, 'new')).toBe(true);
  });

  test('rejects out-of-hunk, cross-hunk, and side-mismatched ranges', () => {
    expect(isLineRangeInPatch(PATCH, 19, 20, 'new')).toBe(false);
    expect(isLineRangeInPatch(PATCH, 24, 50, 'new')).toBe(false);
    expect(isLineRangeInPatch(PATCH, 14, 14, 'old')).toBe(false);
  });

  test('rejects empty hunk sides and invalid ranges', () => {
    const addition = '@@ -0,0 +1,2 @@\n+one\n+two';
    expect(isLineRangeInPatch(addition, 1, 1, 'old')).toBe(false);
    expect(isLineRangeInPatch(addition, 1, 2, 'new')).toBe(true);
    expect(isLineRangeInPatch(PATCH, 4, 3, 'new')).toBe(false);
  });
});
