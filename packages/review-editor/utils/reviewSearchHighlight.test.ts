import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { ReviewSearchMatch, ReviewSearchSide } from './reviewSearch';
import {
  applyItemSearchHighlights,
  applySearchHighlights,
  clearItemSearchHighlights,
  clearSearchHighlights,
  swapActiveSearchHighlight,
} from './reviewSearchHighlight';

const hasDom = typeof document !== 'undefined';
let item: HTMLElement | null = null;

function fixture() {
  item = document.createElement('div');
  document.body.appendChild(item);
  return item.attachShadow({ mode: 'open' });
}

function row(root: ParentNode, line: number, type: string, text = 'needle') {
  const element = document.createElement('div');
  element.dataset.line = String(line);
  element.dataset.lineType = type;
  const token = document.createElement('span');
  token.className = 'syntax-token';
  token.textContent = text;
  element.appendChild(token);
  root.append(element);
  return element;
}

function match(id: string, lineNumber: number, side: ReviewSearchSide = 'addition'): ReviewSearchMatch {
  return { id, filePath: 'sample.ts', side, lineNumber, text: 'needle', matchStart: 0, matchEnd: 6, snippet: 'needle' };
}

function marks(root: ParentNode) {
  return [...root.querySelectorAll<HTMLElement>('mark[data-review-search-match]')];
}

afterEach(() => {
  item?.remove();
  item = null;
});

describe('review search highlighting', () => {
  // Performance regression: one full-root query per matching line makes dense
  // searches quadratic. Guard the lookup budget as well as the visible result,
  // without a machine-dependent wall-clock assertion.
  test.skipIf(!hasDom)('highlights dense results without a root selector scan per line', () => {
    const root = fixture();
    const matches = Array.from({ length: 100 }, (_, index) => {
      row(root, index + 1, 'change-addition');
      return match(`hit-${index}`, index + 1);
    });
    const selector = spyOn(root, 'querySelector');
    try {
      applySearchHighlights(root, 'needle', matches, matches[99].id);
      expect(selector.mock.calls.length).toBeLessThanOrEqual(1);
      expect(marks(root).map(mark => mark.dataset.reviewSearchMatch)).toEqual(matches.map(match => match.id));
      expect(root.querySelector('[data-review-search-active]')?.getAttribute('data-review-search-match')).toBe('hit-99');
    } finally {
      selector.mockRestore();
    }
  });

  // A recycled item's roots used to be cleared once by the item wrapper and
  // again by the root helper. The extra selector scans add cost on every render.
  test.skipIf(!hasDom)('clears each shadow root only once when reapplying item highlights', () => {
    const root = fixture();
    row(root, 40, 'change-deletion');
    applyItemSearchHighlights(item!, 'needle', [match('old', 40, 'deletion')], null);
    const selectors = spyOn(root, 'querySelectorAll');
    try {
      applyItemSearchHighlights(item!, 'needle', [match('replacement', 40, 'deletion')], 'replacement');
      expect(selectors.mock.calls.filter(([selector]) => selector === 'mark[data-review-search-match]')).toHaveLength(1);
      expect(marks(root).map(mark => mark.dataset.reviewSearchMatch)).toEqual(['replacement']);
    } finally {
      selectors.mockRestore();
    }
  });

  test.skipIf(!hasDom)('keeps overlapping source line numbers on their own side and accepts both row naming forms', () => {
    const root = fixture();
    const rows = [
      row(root, 40, 'change-deletion'), row(root, 40, 'change-addition'), row(root, 40, 'context'),
      row(root, 41, 'deletion'), row(root, 41, 'addition'), row(root, 41, 'context-expanded'),
    ];
    const matches = [
      match('old-40', 40, 'deletion'), match('new-40', 40), match('context-40', 40, 'context'),
      match('old-41', 41, 'deletion'), match('new-41', 41), match('context-41', 41, 'context'),
      match('not-rendered', 999),
    ];
    applySearchHighlights(root, 'needle', matches, null);
    expect(rows.map(element => marks(element)[0]?.dataset.reviewSearchMatch)).toEqual(matches.slice(0, 6).map(match => match.id));
    expect(marks(root)).toHaveLength(6);
  });

  test.skipIf(!hasDom)('keeps the first matching row when split context has duplicate coordinates', () => {
    const root = fixture();
    const first = row(root, 5, 'context-expanded');
    const second = row(root, 5, 'context');
    applySearchHighlights(root, 'needle', [match('context', 5, 'context')], null);
    expect(marks(first)).toHaveLength(1);
    expect(marks(second)).toHaveLength(0);
  });

  test.skipIf(!hasDom)('preserves syntax tokens and exact text across multiple literal matches, active navigation and clearing', () => {
    const root = fixture();
    const element = row(root, 1, 'change-addition', 'before Needle. needle. after\n');
    const text = element.textContent;
    const token = element.firstElementChild;
    applyItemSearchHighlights(item!, ' needle. ', [match('first', 1), match('second', 1)], 'first');
    const originalMarks = marks(root);
    expect(originalMarks.map(mark => mark.textContent)).toEqual(['Needle.', 'needle.']);
    expect(element.textContent).toBe(text);
    expect(element.firstElementChild).toBe(token);

    swapActiveSearchHighlight(item!, 'second');
    expect(marks(root)).toEqual(originalMarks);
    expect(root.querySelector('[data-review-search-active]') === originalMarks[1]).toBe(true);
    clearItemSearchHighlights(item!);
    expect(marks(root)).toHaveLength(0);
    expect(element.textContent).toBe(text);
    expect(element.firstElementChild).toBe(token);
  });

  test.skipIf(!hasDom)('reindexes replaced rows and clears stale marks when an element is recycled or search is empty', () => {
    const root = fixture();
    row(root, 1, 'change-addition');
    applyItemSearchHighlights(item!, 'needle', [match('original', 1)], null);
    root.replaceChildren();
    row(root, 40, 'change-deletion', 'needle other');
    const recycled = { ...match('recycled', 40, 'deletion'), filePath: 'another.ts' };
    applyItemSearchHighlights(item!, 'needle', [recycled], null);
    expect(marks(root).map(mark => mark.dataset.reviewSearchMatch)).toEqual(['recycled']);
    applyItemSearchHighlights(item!, 'other', [{ ...recycled, id: 'new-query' }], null);
    expect(marks(root).map(mark => mark.textContent)).toEqual(['other']);
    applyItemSearchHighlights(item!, '', [recycled], null);
    expect(marks(root)).toHaveLength(0);
    applyItemSearchHighlights(item!, 'needle', [recycled], null);
    applyItemSearchHighlights(item!, 'needle', [], null);
    expect(marks(root)).toHaveLength(0);
    expect(root.textContent).toBe('needle other');
  });

  test.skipIf(!hasDom)('prepares matches for nested shadow roots without leaking marks after clearing', () => {
    const root = fixture();
    row(root, 1, 'change-addition');
    const nested = document.createElement('div');
    root.appendChild(nested);
    const inner = nested.attachShadow({ mode: 'open' });
    row(inner, 2, 'change-deletion');
    applyItemSearchHighlights(item!, 'needle', [match('outer', 1), match('inner', 2, 'deletion')], null);
    expect(marks(root).map(mark => mark.dataset.reviewSearchMatch)).toEqual(['outer']);
    expect(marks(inner).map(mark => mark.dataset.reviewSearchMatch)).toEqual(['inner']);
    clearItemSearchHighlights(item!);
    expect(marks(root)).toHaveLength(0);
    expect(marks(inner)).toHaveLength(0);
  });

  test.skipIf(!hasDom)('an empty focused query restores the original text', () => {
    const root = fixture();
    row(root, 1, 'addition');
    applySearchHighlights(root, 'needle', [match('hit', 1)], null);
    applySearchHighlights(root, ' ', [], null);
    expect(marks(root)).toHaveLength(0);
    expect(root.textContent).toBe('needle');
    clearSearchHighlights(root);
    expect(root.textContent).toBe('needle');
  });
});
