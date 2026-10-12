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
import type { ReviewSearchableDiffFile } from '../utils/reviewSearch';

const hasDom = typeof document !== 'undefined';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: UseReviewSearchResult | null = null;

const EMPTY_FILES: ReviewSearchableDiffFile[] = [];
type HarnessProps = Partial<Parameters<typeof useReviewSearch>[0]>;

function Harness({ files = EMPTY_FILES, activeFilePath = null, onRevealMatch }: HarnessProps) {
  const search = useReviewSearch({ files, activeFilePath, onRevealMatch });
  latest = search;

  return (
    <input
      ref={search.searchInputRef}
      value={search.searchQuery}
      onChange={event => search.handleSearchInputChange(event.target.value)}
    />
  );
}

async function renderHarness(props: HarnessProps = {}): Promise<HTMLInputElement> {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }

  await act(async () => {
    root!.render(<Harness {...props} />);
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

async function searchFor(query: string): Promise<void> {
  await act(async () => latest!.handleSearchInputChange(query));
  // The hook's user-visible debounce is 200ms; let its effect commit first.
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 225));
  });
}

function trackedFile(path: string, patch: string) {
  let reads = 0;
  const file: ReviewSearchableDiffFile = {
    path,
    patch: '',
    additions: 1,
    deletions: 1,
  };
  // Witness real indexing without mocking matches. Non-enumerable so React's
  // development-mode props-diff profiler does not read the patch as well.
  Object.defineProperty(file, 'patch', {
    enumerable: false,
    get() { reads++; return patch; },
  });
  return { file, reads: () => reads };
}

const SEARCH_PATCH = [
  'diff --git a/example.ts b/example.ts',
  '--- a/example.ts',
  '+++ b/example.ts',
  '@@ -40,2 +7,2 @@',
  '-alpha alpha',
  '+beta alpha',
  ' shared alpha beta',
].join('\n');

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

  test.skipIf(!hasDom)('does not index unopened, blank, or replaced snapshots before a search', async () => {
    const first = trackedFile('first.ts', SEARCH_PATCH);
    const second = trackedFile('second.ts', SEARCH_PATCH);
    await renderHarness({ files: [first.file] });
    expect(first.reads()).toBe(0);

    await openSearch();
    await act(async () => latest!.handleSearchInputChange('alpha'));
    expect(latest!.isSearchPending).toBe(true);
    await act(async () => latest!.clearSearch());
    // Canceling before the debounce must not trigger background indexing.
    await searchFor('   ');
    await act(async () => latest!.closeSearch());
    await renderHarness({ files: [second.file], activeFilePath: second.file.path });
    expect(first.reads()).toBe(0);
    expect(second.reads()).toBe(0);
    expect(latest!.searchMatches).toHaveLength(0);
    expect(latest!.searchGroups).toHaveLength(0);
    expect(latest!.activeSearchMatch).toBeNull();

    await searchFor('beta');
    expect(first.reads()).toBe(0);
    expect(second.reads()).toBe(1);
    expect(latest!.searchMatches).toHaveLength(2);
  });

  test.skipIf(!hasDom)('reuses the current snapshot index through edits, misses, closing, and clearing', async () => {
    const source = trackedFile('example.ts', SEARCH_PATCH);
    const files = [source.file];
    await renderHarness({ files });
    await searchFor('alpha');
    expect(source.reads()).toBe(1);
    expect(latest!.searchMatches).toHaveLength(4);

    await searchFor(' ALPHA ');
    expect(latest!.searchMatches).toHaveLength(4);
    await searchFor('absent');
    expect(latest!.searchMatches).toHaveLength(0);
    expect(latest!.activeSearchMatch).toBeNull();
    await searchFor('beta');
    expect(latest!.searchMatches).toHaveLength(2);
    await act(async () => latest!.closeSearch());
    // Closing the input has never cleared a live query or its highlights.
    expect(latest!.searchMatches).toHaveLength(2);
    await openSearch();
    await renderHarness({ files, activeFilePath: source.file.path });
    expect(latest!.activeFileSearchMatches).toHaveLength(2);

    await act(async () => latest!.clearSearch());
    expect(latest!.searchMatches).toHaveLength(0);
    expect(latest!.searchGroups).toHaveLength(0);
    expect(latest!.activeSearchMatch).toBeNull();
    expect(latest!.isSearchPending).toBe(false);
    await searchFor('alpha');
    expect(latest!.searchMatches).toHaveLength(4);
    expect(source.reads()).toBe(1);
  });

  test.skipIf(!hasDom)('preserves source coordinates, grouping, reveal, and wrapped navigation', async () => {
    const first = trackedFile('repo-a/example.ts', SEARCH_PATCH);
    const second = trackedFile('repo-b/example.ts', '@@ -0,0 +1 @@\n+alpha beta\n');
    const files = [first.file, second.file];
    const revealed: string[] = [];
    const onRevealMatch: NonNullable<HarnessProps['onRevealMatch']> = match => {
      revealed.push(`${match.filePath}:${match.side}:${match.lineNumber}:${match.matchStart}`);
    };
    await renderHarness({ files, activeFilePath: second.file.path, onRevealMatch });
    await searchFor('alpha');
    expect(latest!.searchMatches.map(match => [match.filePath, match.side, match.lineNumber, match.matchStart])).toEqual([
      [first.file.path, 'deletion', 40, 0],
      [first.file.path, 'deletion', 40, 6],
      [first.file.path, 'addition', 7, 5],
      [first.file.path, 'context', 8, 7],
      [second.file.path, 'addition', 1, 0],
    ]);
    expect(latest!.searchGroups.map(group => [group.filePath, group.fileIndex, group.matches.length])).toEqual([
      [first.file.path, 0, 4], [second.file.path, 1, 1],
    ]);
    expect(latest!.activeFileSearchMatches).toHaveLength(1);
    expect(revealed).toEqual([`${first.file.path}:deletion:40:0`]);

    await act(async () => latest!.stepSearchMatch(-1));
    expect(latest!.activeSearchMatch?.filePath).toBe(second.file.path);
    await act(async () => latest!.stepSearchMatch(1));
    expect(latest!.activeSearchMatch?.side).toBe('deletion');
    const additionId = latest!.searchMatches[2].id;
    await act(async () => latest!.handleSelectSearchMatch(additionId));
    expect(latest!.activeSearchMatch?.lineNumber).toBe(7);
    expect(latest!.activeSearchMatch?.side).toBe('addition');
    await searchFor('ALPHA');
    expect(latest!.activeSearchMatchId).toBe(additionId);
    expect(first.reads()).toBe(1);
    expect(second.reads()).toBe(1);
  });

  test.skipIf(!hasDom)('replaces the index and selected match when the same path has a new diff', async () => {
    const first = trackedFile('example.ts', SEARCH_PATCH);
    const replacement = trackedFile('example.ts', '@@ -100 +50 @@\n-old constant\n+alpha target\n');
    const removed = trackedFile('example.ts', '@@ -100 +50 @@\n-old constant\n+beta target\n');
    await renderHarness({ files: [first.file] });
    await searchFor('alpha');
    expect(latest!.activeSearchMatch?.lineNumber).toBe(40);

    await renderHarness({ files: [replacement.file] });
    expect(latest!.searchMatches).toHaveLength(1);
    expect(latest!.activeSearchMatch?.lineNumber).toBe(50);
    expect(latest!.activeSearchMatch?.side).toBe('addition');
    expect(first.reads()).toBe(1);
    expect(replacement.reads()).toBe(1);

    await renderHarness({ files: [removed.file] });
    expect(latest!.searchMatches).toHaveLength(0);
    expect(latest!.searchGroups).toHaveLength(0);
    expect(latest!.activeSearchMatchId).toBeNull();
    await searchFor('beta');
    expect(latest!.activeSearchMatch?.text).toBe('beta target');
    expect(removed.reads()).toBe(1);
  });

  test.skipIf(!hasDom)('a pending query searches the replacement snapshot, never the old patch', async () => {
    const first = trackedFile('first.ts', SEARCH_PATCH);
    const replacement = trackedFile('second.ts', '@@ -0,0 +70 @@\n+beta target\n');
    const files = [replacement.file];
    await renderHarness({ files: [first.file] });
    await searchFor('alpha');
    await act(async () => latest!.handleSearchInputChange('beta'));
    expect(latest!.isSearchPending).toBe(true);
    await renderHarness({ files });
    expect(latest!.searchMatches).toHaveLength(0);
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 225)); });
    expect(latest!.isSearchPending).toBe(false);
    expect(latest!.searchMatches).toHaveLength(1);
    expect(latest!.activeSearchMatch?.filePath).toBe(replacement.file.path);
    expect(latest!.activeSearchMatch?.lineNumber).toBe(70);
    expect(first.reads()).toBe(1);
    expect(replacement.reads()).toBe(1);
  });

  test.skipIf(!hasDom)('clearing the input during a diff switch does not index the stale debounced query', async () => {
    const first = trackedFile('first.ts', SEARCH_PATCH);
    const replacement = trackedFile('second.ts', '@@ -0,0 +70 @@\n+beta target\n');
    await renderHarness({ files: [first.file] });
    await searchFor('alpha');

    await act(async () => {
      latest!.handleSearchInputChange('');
      root!.render(<Harness files={[replacement.file]} />);
    });
    expect(latest!.searchMatches).toHaveLength(0);
    expect(latest!.activeSearchMatch).toBeNull();
    expect(replacement.reads()).toBe(0);

    await searchFor('beta');
    expect(latest!.activeSearchMatch?.lineNumber).toBe(70);
    expect(replacement.reads()).toBe(1);
  });

  test.skipIf(!hasDom)('caches an empty searchable index without treating binary headers as code', async () => {
    const source = trackedFile('image.png', 'Binary files a/image.png and b/image.png differ\n');
    const files = [source.file];
    await renderHarness({ files });
    await searchFor('image');
    await searchFor('binary');
    expect(latest!.searchMatches).toHaveLength(0);
    expect(latest!.activeSearchMatch).toBeNull();
    expect(source.reads()).toBe(1);
  });

  test.skipIf(!hasDom)('selects the existing query whenever search is opened again', async () => {
    const input = await renderHarness();

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
