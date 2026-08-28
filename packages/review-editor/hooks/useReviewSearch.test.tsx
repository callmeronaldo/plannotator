import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  isReviewCurrentFileSearchShortcut,
  isReviewGlobalSearchShortcut,
  shouldFallbackFindToWorkspaceSearch,
  shouldHandleReviewSearchShortcut,
  useReviewSearch,
  type UseReviewSearchResult,
} from './useReviewSearch';

const hasDom = typeof document !== 'undefined';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: UseReviewSearchResult | null = null;

function Harness() {
  const search = useReviewSearch({
    files: [],
    activeFilePath: null,
  });
  latest = search;

  return (
    <input
      ref={search.searchInputRef}
      value={search.searchQuery}
      onChange={event => search.handleSearchInputChange(event.target.value)}
    />
  );
}

async function mountHarness(): Promise<HTMLInputElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<Harness />);
  });

  const input = host.querySelector('input');
  if (!input) throw new Error('search input did not render');
  return input;
}

async function openSearch(): Promise<void> {
  await act(async () => {
    latest!.openSearch();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

function fakeElement(tagName: string, isContentEditable = false): HTMLElement {
  return { tagName, isContentEditable } as HTMLElement;
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  host?.remove();
  host = null;
  root = null;
  latest = null;
});

describe('useReviewSearch', () => {
  test('handles shortcuts outside editable controls and inside the review search input', () => {
    const searchInput = fakeElement('INPUT') as HTMLInputElement;

    expect(shouldHandleReviewSearchShortcut(searchInput, searchInput)).toBe(true);
    expect(shouldHandleReviewSearchShortcut(fakeElement('INPUT'), searchInput)).toBe(false);
    expect(shouldHandleReviewSearchShortcut(fakeElement('TEXTAREA'), searchInput)).toBe(false);
    expect(shouldHandleReviewSearchShortcut(fakeElement('DIV', true), searchInput)).toBe(false);
    expect(shouldHandleReviewSearchShortcut(fakeElement('DIV'), searchInput)).toBe(true);
  });

  test('reserves plain Mod+F for current-document find', () => {
    const chord = (overrides: Partial<Parameters<typeof isReviewGlobalSearchShortcut>[0]> = {}) => ({
      altKey: false,
      ctrlKey: true,
      key: 'f',
      metaKey: false,
      shiftKey: true,
      ...overrides,
    });

    expect(isReviewGlobalSearchShortcut(chord())).toBe(true);
    expect(isReviewGlobalSearchShortcut(chord({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isReviewCurrentFileSearchShortcut(chord())).toBe(false);
    expect(isReviewCurrentFileSearchShortcut(chord({ shiftKey: false }))).toBe(true);
    expect(isReviewGlobalSearchShortcut(chord({ shiftKey: false }))).toBe(false);
    expect(isReviewGlobalSearchShortcut(chord({ altKey: true }))).toBe(false);
    expect(isReviewCurrentFileSearchShortcut(chord({ shiftKey: false, altKey: true }))).toBe(false);
    expect(isReviewGlobalSearchShortcut(chord({ key: 'g' }))).toBe(false);
  });

  test('plain Mod+F falls back to workspace search only outside focused tabs', () => {
    const plainFind = {
      altKey: false,
      ctrlKey: true,
      key: 'f',
      metaKey: false,
      shiftKey: false,
    };
    // No focused file tab active (all-files / semantic / PR views): the
    // workspace search owns plain Mod+F instead of the browser find bar.
    expect(shouldFallbackFindToWorkspaceSearch(plainFind, false)).toBe(true);
    // A visible focused tab owns the chord through its DiffViewer listener.
    expect(shouldFallbackFindToWorkspaceSearch(plainFind, true)).toBe(false);
    // The workspace chord never routes through the fallback.
    expect(shouldFallbackFindToWorkspaceSearch({ ...plainFind, shiftKey: true }, false)).toBe(false);
  });

  test.skipIf(!hasDom)('selects the existing query whenever search is opened again', async () => {
    const input = await mountHarness();

    await act(async () => {
      latest!.handleSearchInputChange('firstFunction');
    });

    input.blur();
    input.setSelectionRange(input.value.length, input.value.length);
    await openSearch();

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    input.setSelectionRange(input.value.length, input.value.length);
    await openSearch();

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
