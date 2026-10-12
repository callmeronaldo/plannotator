import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import React, { act, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SelectedLineRange } from '@plannotator/ui/types';
import type { DiffFile } from '../types';

let codeViewMounts = 0;
let codeViewUnmounts = 0;
let scrollTargets: Array<Record<string, unknown>> = [];
let lastCodeViewProps: Record<string, unknown> | null = null;
let toolbarSelections: Array<SelectedLineRange | null> = [];
let workerPoolReady = true;
let overviewRenders = 0;
let overviewDocumentHeight = 200;
let overviewItemTop = 8;

// Captured BEFORE the mocks below replace the specifiers, so this file can put
// the real modules back when it is done. `mock.module` is process global and
// bun does not unwind it at file boundaries: without this, every later file in
// the same run sees this file's stubs — a `getSingularPatch` with no hunks and
// a `processFile` that returns null. That leaked into
// DiffViewer.fullContentSwap.test.tsx on the Linux runner (and not on macOS),
// where it presented as a diff that silently never rendered.
//
// The SPREAD is load-bearing, exactly as configure.test.ts documents. A
// namespace object is a live view of the module record, and `mock.module`
// rewrites that record in place — so holding `await import(...)` and handing it
// back later re-installs the STUBS as themselves and restores nothing. Spread
// snapshots the real export values into a plain object at capture time, before
// any stub exists.
const realPierreDiffs = { ...(await import('@pierre/diffs')) };
const realPierreDiffsReact = { ...(await import('@pierre/diffs/react')) };
const realResolveSyntaxTheme = (await import('@plannotator/ui/utils/syntaxTheme')).resolveSyntaxTheme;
const realOverview = { ...(await import('./DiffOverviewRuler')) };
let processFileImpl: typeof realPierreDiffs.processFile | null = null;
let seedAugmentation = false;
let codeViewUpdates: Array<{ id: string }> = [];

mock.module('./DiffOverviewRuler', () => ({
  ...realOverview,
  DiffOverviewRuler: (props: React.ComponentProps<typeof realOverview.DiffOverviewRuler>) => {
    overviewRenders += 1;
    return <realOverview.DiffOverviewRuler {...props} />;
  },
}));

mock.module('../workerPool', () => ({
  useIsWorkerPoolReadyOrDisabled: () => workerPoolReady,
  useWorkerPoolThemeSync: () => {},
}));

mock.module('../hooks/usePierreTheme', () => ({
  buildLineBgOverrides: () => '',
  resolveSyntaxTheme: realResolveSyntaxTheme,
  usePierreTheme: () => ({ type: 'light', css: '' }),
}));

mock.module('@pierre/diffs', () => ({
  getSingularPatch: (patch: string) => ({
    name: patch.includes('target.ts') ? 'target.ts' : 'file.ts',
    type: 'change',
    hunks: [{
      additionLines: 1,
      deletionLines: 1,
      hunkContent: [],
      splitLineStart: 0,
      unifiedLineStart: 0,
    }],
    splitLineCount: 2,
    unifiedLineCount: 2,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
  }),
  processFile: (...args: Parameters<typeof realPierreDiffs.processFile>) => processFileImpl?.(...args) ?? null,
}));

mock.module('@pierre/diffs/react', () => ({
  CodeView: React.forwardRef(function MockCodeView(
    props: {
      initialItems?: Array<{ id: string }>;
      className?: string;
      containerRef?: React.Ref<HTMLDivElement>;
      options?: { onPostRender?: (...args: unknown[]) => void };
    },
    ref: React.ForwardedRef<unknown>,
  ) {
    const itemsRef = useRef(new Map((props.initialItems ?? []).map((item) => [item.id, item])));
    lastCodeViewProps = props as unknown as Record<string, unknown>;
    useEffect(() => {
      codeViewMounts += 1;
      return () => {
        codeViewUnmounts += 1;
      };
    }, []);
    // Reproduce Pierre's seed wave BEFORE the handle exists. Deferring parsing
    // must not introduce a viewerRef guard that loses this initial fetch.
    useLayoutEffect(() => {
      if (!seedAugmentation) return;
      for (const item of props.initialItems ?? []) {
        props.options?.onPostRender?.(document.createElement('div'), {}, 'mount', { item });
      }
    }, []);
    useImperativeHandle(ref, () => ({
      addItems: () => {},
      getItem: (id: string) => itemsRef.current.get(id),
      updateItem: (item: { id: string }) => {
        itemsRef.current.set(item.id, item);
        codeViewUpdates.push(item);
        return true;
      },
      updateItemId: () => true,
      scrollTo: (target: Record<string, unknown>) => scrollTargets.push(target),
      setSelectedLines: () => {},
      getSelectedLines: () => null,
      clearSelectedLines: () => {},
      getInstance: () => ({
        getRenderedItems: () => [],
        getScrollTop: () => 0,
        getScrollHeight: () => overviewDocumentHeight,
        getHeight: () => 100,
        getTopForItem: () => overviewItemTop,
        scrollTo: (target: Record<string, unknown>) => scrollTargets.push(target),
      }),
    }));
    return <div ref={props.containerRef} className={props.className} />;
  }),
  // AllFilesCodeView imports EditProvider alongside CodeView/useStableCallback.
  // mock.module replaces the whole specifier, so every value export the
  // component reads must be present here or the import throws at load time.
  EditProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useStableCallback: <T extends (...args: never[]) => unknown>(callback: T): T => {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;
    return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, []);
  },
}));

mock.module('./ToolbarHost', () => ({
  ToolbarHost: React.forwardRef(function MockToolbarHost(_props, ref) {
    useImperativeHandle(ref, () => ({
      handleLineSelectionEnd: (range: SelectedLineRange | null) => {
        toolbarSelections.push(range);
      },
      openLineAnnotation: () => {},
      handleTokenClick: () => {},
      startEdit: () => {},
    }));
    return null;
  }),
}));

const { AllFilesCodeView } = await import('./AllFilesCodeView');

const hasDom = typeof document !== 'undefined';
let root: Root | null = null;
let host: HTMLElement | null = null;

const file: DiffFile = {
  path: 'target.ts',
  patch: 'diff --git a/target.ts b/target.ts\n--- a/target.ts\n+++ b/target.ts\n@@ -1 +1 @@\n-old\n+new',
  additions: 1,
  deletions: 1,
  status: 'modified',
};

function view(overrides: Partial<React.ComponentProps<typeof AllFilesCodeView>> = {}) {
  return (
    <AllFilesCodeView
      files={[file]}
      diffStyle="unified"
      annotations={[]}
      selectedAnnotationId={null}
      scrollTargetAnnotation={null}
      pendingSelection={null}
      onLineSelection={() => {}}
      onAddAnnotationForFile={() => {}}
      onEditAnnotation={() => {}}
      onSelectAnnotation={() => {}}
      onDeleteAnnotation={() => {}}
      {...overrides}
    />
  );
}

async function render(overrides: Partial<React.ComponentProps<typeof AllFilesCodeView>> = {}) {
  await act(async () => {
    root!.render(view(overrides));
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  codeViewMounts = 0;
  codeViewUnmounts = 0;
  scrollTargets = [];
  lastCodeViewProps = null;
  toolbarSelections = [];
  workerPoolReady = true;
  overviewRenders = 0;
  overviewDocumentHeight = 200;
  overviewItemTop = 8;
  processFileImpl = null;
  seedAugmentation = false;
  codeViewUpdates = [];
});

// Hand the real @pierre/diffs back to the process. Only the two library
// specifiers are restored. The sibling-module mocks above are NOT scoped to
// this file — `mock.module` resolves a relative specifier to an absolute module
// path, so any later file importing packages/review-editor/workerPool,
// hooks/usePierreTheme or components/ToolbarHost sees these stubs too. They are
// left in place because workerPool cannot be captured here at all: it imports
// the Vite-only `?worker&inline` virtual module, which bun cannot resolve.
// Files that need the real ones must not share this process — that is what the
// isolated "diff-renderer DOM tests" step in .github/workflows/test.yml is for.
afterAll(() => {
  mock.module('@pierre/diffs', () => realPierreDiffs);
  mock.module('@pierre/diffs/react', () => realPierreDiffsReact);
  mock.module('./DiffOverviewRuler', () => realOverview);
});

// Guards the capture idiom itself. If the spreads above are ever reduced back
// to a bare `await import(...)`, the "real" handles become live views of the
// mocked module records and the afterAll restore silently degrades to a no-op —
// which is how discardRestoreRender.test.tsx started seeing `processFile()`
// return null on the runs where the runner walked this file first.
describe('the @pierre/diffs restore handles', () => {
  test('hold the real exports, not the stubs installed over them', async () => {
    const stubbed = await import('@pierre/diffs');
    const stubbedReact = await import('@pierre/diffs/react');

    // The live namespaces are this file's stubs: `processFile: () => null`.
    expect(stubbed.processFile.length).toBe(0);

    // The captured handles must not have followed them.
    expect(realPierreDiffs.processFile).not.toBe(stubbed.processFile);
    expect(realPierreDiffs.processFile.length).toBe(2);
    expect(realPierreDiffsReact.CodeView).not.toBe(stubbedReact.CodeView);
  });
});

describe('AllFilesCodeView change overview', () => {
  async function postRender() {
    const options = lastCodeViewProps!.options as { onPostRender: (...args: unknown[]) => void };
    const item = (lastCodeViewProps!.initialItems as Array<{
      type: 'diff'; id: string; collapsed?: boolean;
      fileDiff: { isPartial: boolean; unifiedLineCount: number; hunks: Array<{ additionLines: number }> };
    }>)[0];
    // Full metadata avoids a content fetch while exercising the live ruler.
    item.fileDiff.isPartial = false;
    await act(async () => {
      options.onPostRender(document.createElement('div'), {}, 'update', { item });
      await new Promise(resolve => setTimeout(resolve, 35));
    });
    return item;
  }

  // Guards the default review landing surface: keeping the ruler only on the
  // single-file panel made it absent from the all-files view users actually see.
  test.skipIf(!hasDom)('renders the change ruler in the all-files surface', async () => {
    host = document.createElement('div');
    host.style.height = '400px';
    document.body.appendChild(host);
    root = createRoot(host);

    await render();

    expect(host.querySelector('[data-diff-overview-ruler]')).not.toBeNull();
    // The marks arrive asynchronously after CodeView's first render. The
    // content gutter must not depend on that arrival or every file reflows once.
    expect(host.querySelector('[data-diff-overview-content]')?.className).toContain('right-3.5');
  });

  // Performance regression: scroll-driven Pierre updates used to redraw the
  // entire all-files shell even when the ruler's values were unchanged.
  test.skipIf(!hasDom)('does not redraw the overview on repeated unchanged item renders', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await render();
    await postRender();
    await postRender();
    const settledRenders = overviewRenders;
    for (let index = 0; index < 5; index += 1) await postRender();
    expect(overviewRenders).toBe(settledRenders);
    expect(host.querySelector('[data-diff-overview-ruler]')).not.toBeNull();
  });

  // Equality must cover both geometry and counts. Pierre mutates edited diff
  // metadata in place, so an identity-only cache can silently strand the ruler.
  test.skipIf(!hasDom)('refreshes marks after layout changes, in-place edits, collapse and file removal', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await render();
    const item = await postRender();
    const marker = () => host!.querySelector<HTMLElement>('[data-diff-overview-ruler] > div[title]')!;
    const originalTop = marker().style.top;
    overviewDocumentHeight = 500;
    overviewItemTop = 28;
    await postRender();
    expect(marker().style.top).not.toBe(originalTop);

    const expandedHeight = marker().style.height;
    item.fileDiff.hunks[0].additionLines = 3;
    item.fileDiff.unifiedLineCount = 4;
    await postRender();
    // The relative height stays identical (2/2 -> 4/4); counts alone must
    // still update, even with the same metadata and hunk-array identities.
    expect(marker().style.height).toBe(expandedHeight);
    expect(marker().title).toContain('+3');
    expect(marker().title).toContain('−1');
    item.collapsed = true;
    await postRender();
    expect(marker().style.height).not.toBe(expandedHeight);
    expect(marker().title).toContain('+3');

    overviewDocumentHeight = 0;
    await postRender();
    expect(host.querySelector('[data-diff-overview-ruler]')).toBeNull();
    overviewDocumentHeight = 500;
    await postRender();
    expect(marker().title).toContain('+3');

    await render({ files: [] });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
    expect(host.querySelector('[data-diff-overview-ruler]')).toBeNull();
  });
});

describe('AllFilesCodeView guide mount state', () => {
  test.skipIf(!hasDom)('does not remount when the live shell collapse value changes', async () => {
    host = document.createElement('div');
    host.style.height = '400px';
    document.body.appendChild(host);
    root = createRoot(host);

    await render({ mountCollapsed: false });
    expect(codeViewMounts).toBe(1);

    await render({ mountCollapsed: true });
    expect(codeViewMounts).toBe(1);
    expect(codeViewUnmounts).toBe(0);
  });

  test.skipIf(!hasDom)('restores the initial scroll position only once per mount', async () => {
    host = document.createElement('div');
    host.style.height = '400px';
    document.body.appendChild(host);
    root = createRoot(host);

    await render({ initialScrollPosition: 120 });
    await render({ initialScrollPosition: 360 });

    expect(scrollTargets.filter((target) => target.type === 'position')).toEqual([
      { type: 'position', position: 120 },
    ]);
  });

});

describe('AllFilesCodeView compact-touch line selection', () => {
  // Stands in for App: a published range comes straight back down as
  // `pendingSelection`. That loop is load-bearing — CodeView's selection is
  // controlled, and the reconcile effect clears the highlight whenever
  // pendingSelection is null, so a statically-null prop would wipe the range
  // the preserve branch just painted.
  function Harness({ compactTouchLayout, onSelection }: {
    compactTouchLayout: boolean;
    onSelection?: (range: SelectedLineRange | null) => void;
  }) {
    const [pendingSelection, setPendingSelection] = useState<SelectedLineRange | null>(null);
    return view({
      compactTouchLayout,
      pendingSelection,
      onLineSelection: (range) => {
        onSelection?.(range);
        setPendingSelection(range);
      },
    });
  }

  async function mount(
    compactTouchLayout: boolean,
    onSelection?: (range: SelectedLineRange | null) => void,
  ) {
    host = document.createElement('div');
    host.style.height = '400px';
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<Harness compactTouchLayout={compactTouchLayout} onSelection={onSelection} />);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }

  function getSelectionCallbacks() {
    const options = lastCodeViewProps?.options as {
      onLineSelectionEnd?: (
        range: SelectedLineRange | null,
        context: { item: { id: string; type: 'diff' } },
      ) => void;
      onGutterUtilityClick?: (
        range: SelectedLineRange,
        context: { item: { id: string; type: 'diff' } },
      ) => void;
    };
    const item = (lastCodeViewProps?.initialItems as Array<{ id: string; type: 'diff' }>)[0];
    return { options, item };
  }

  test.skipIf(!hasDom)('preserves a dragged range, then opens the composer from the gutter action', async () => {
    const observedSelections: Array<SelectedLineRange | null> = [];
    const range: SelectedLineRange = { start: 4, end: 8, side: 'additions' };
    await mount(true, (selection) => observedSelections.push(selection));
    const { options, item } = getSelectionCallbacks();

    await act(async () => {
      options.onLineSelectionEnd?.(range, { item });
    });

    expect(observedSelections.at(-1)).toEqual(range);
    expect(toolbarSelections).toEqual([]);
    // Publishing the range upward is only half of "preserved": CodeView's
    // selection is controlled here, so the highlight only survives if the range
    // is also handed back down. Without this the composer would stay shut on a
    // range nothing paints.
    expect(lastCodeViewProps?.selectedLines).toEqual({ id: item.id, range });

    await act(async () => {
      options.onGutterUtilityClick?.(range, { item });
    });

    expect(toolbarSelections).toEqual([range]);
  });

  test.skipIf(!hasDom)('native text selection in a recycled file surface stays copyable and comments keep the old side', async () => {
    const observed: Array<SelectedLineRange | null> = [];
    const onSelection = (range: SelectedLineRange | null) => observed.push(range);
    // The real worker pool gates CodeView's first mount. Listening only on the
    // initial effect misses its asynchronously-created scroll container.
    workerPoolReady = false;
    await mount(false, onSelection);
    expect(codeViewMounts).toBe(0);
    workerPoolReady = true;
    await act(async () => {
      root!.render(<Harness compactTouchLayout={false} onSelection={onSelection} />);
      await new Promise(resolve => setTimeout(resolve, 25));
    });
    const { options, item } = getSelectionCallbacks();
    const node = document.createElement('diffs-container');
    const shadow = node.shadowRoot ?? node.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<code data-unified><div data-line="40" data-line-type="change-deletion">removed first\n</div><div data-line="42" data-line-type="change-deletion">removed last\n</div></code>';
    host!.querySelector('[data-diff-overview-content] > div')!.appendChild(node);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => Response.json({ oldContent: null, newContent: null }), originalFetch);
    try {
      const callbacks = lastCodeViewProps?.options as {
        onPostRender: (node: HTMLElement, instance: unknown, phase: string, context: { item: typeof item }) => void;
      };
      await act(async () => { callbacks.onPostRender(node, {}, 'mount', { item }); });
      const selection = window.getSelection()!;
      const nativeRange = document.createRange();
      nativeRange.setStart(shadow.querySelector('[data-line="40"]')!.firstChild!, 0);
      const last = shadow.querySelector('[data-line="42"]')!.firstChild!;
      nativeRange.setEnd(last, last.textContent!.length);
      selection.removeAllRanges();
      selection.addRange(nativeRange);
      const copiedText = selection.toString();
      expect(copiedText).toContain('removed first');
      await act(async () => {
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      });
      const range: SelectedLineRange = { start: 40, end: 42, side: 'deletions' };
      expect(toolbarSelections).toEqual([]);
      expect(selection.isCollapsed).toBe(false);
      expect(selection.toString()).toBe(copiedText);
      expect(observed.at(-1)).toEqual(range);
      expect(lastCodeViewProps?.selectedLines).toEqual({ id: item.id, range });

      await act(async () => { options.onGutterUtilityClick?.(range, { item }); });
      expect(toolbarSelections).toEqual([range]);
      selection.removeAllRanges();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.skipIf(!hasDom)('keeps the incumbent desktop gutter-selection-to-composer transition', async () => {
    const range: SelectedLineRange = { start: 4, end: 8, side: 'additions' };
    await mount(false);
    const { options, item } = getSelectionCallbacks();

    await act(async () => {
      options.onLineSelectionEnd?.(range, { item });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toolbarSelections).toEqual([range]);
  });
});

describe('AllFilesCodeView full-content preparation', () => {
  type Item = { id: string; type: 'diff'; version?: number; fileDiff: ReturnType<typeof realPierreDiffs.getSingularPatch> };
  const contents = { oldContent: 'old\nunchanged\n', newContent: 'new\nunchanged\n' };

  async function mount(files = [file], snapshot = 'first') {
    if (!host) {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
    }
    await render({ files, reviewSnapshotId: snapshot });
    return lastCodeViewProps!.initialItems as Item[];
  }

  async function postRender(items: Item[]) {
    await act(async () => {
      const options = lastCodeViewProps!.options as { onPostRender: (...args: unknown[]) => void };
      for (const item of items) options.onPostRender(document.createElement('div'), {}, 'update', { item });
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }

  async function pause(ms = 225) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  }

  async function withContents(
    body: (requests: AbortSignal[]) => Promise<void>,
    response = contents,
  ) {
    const originalFetch = globalThis.fetch;
    const requests: AbortSignal[] = [];
    globalThis.fetch = Object.assign(async (_input: unknown, init?: RequestInit) => {
      requests.push(init!.signal!);
      return Response.json(response);
    }, originalFetch);
    try { await body(requests); } finally { globalThis.fetch = originalFetch; }
  }

  test.skipIf(!hasDom)('does not parse during scrolling; full source and expansion metadata arrive after idle', async () => {
    let parsed = 0;
    processFileImpl = (...args) => { parsed++; return realPierreDiffs.processFile(...args); };
    await withContents(async requests => {
      const items = await mount();
      const scroll = lastCodeViewProps!.onScroll as (position: number) => void;
      await act(async () => scroll(10));
      await postRender(items);
      expect(requests).toHaveLength(1);
      expect(parsed).toBe(0);
      expect(items[0].fileDiff.isPartial).toBe(true);
      await pause(90);
      await act(async () => scroll(20));
      await pause(90);
      expect(parsed).toBe(0);
      expect(codeViewUpdates).toHaveLength(0);

      await pause();
      expect(parsed).toBe(1);
      expect(items[0].fileDiff.isPartial).toBe(false);
      expect(items[0].fileDiff.additionLines).toEqual(['new\n', 'unchanged\n']);
      expect(items[0].fileDiff.deletionLines).toEqual(['old\n', 'unchanged\n']);
      expect(items[0].fileDiff.hunks[0].additionStart).toBe(1);
      expect(items[0].fileDiff.cacheKey).toContain('#full');
      await postRender(items);
      expect(requests).toHaveLength(1);
      expect(parsed).toBe(1);
    });
  });

  test.skipIf(!hasDom)('yields to resumed scrolling between ready files and waits for idle again', async () => {
    const updatesBetweenJobs: number[] = [];
    let first = true;
    processFileImpl = (...args) => {
      if (first) {
        first = false;
        setTimeout(() => {
          updatesBetweenJobs.push(codeViewUpdates.length);
          (lastCodeViewProps!.onScroll as (position: number) => void)(20);
        }, 0);
      }
      return realPierreDiffs.processFile(...args);
    };
    await withContents(async () => {
      const other = { ...file, path: 'other.ts', patch: file.patch.replaceAll('target.ts', 'other.ts') };
      const items = await mount([file, other]);
      await postRender(items);
      await pause();
      expect(updatesBetweenJobs).toEqual([1]);
      expect(items.filter(item => !item.fileDiff.isPartial)).toHaveLength(1);
      await pause();
      expect(items.every(item => !item.fileDiff.isPartial)).toBe(true);
    });
  });

  test.skipIf(!hasDom)('starts the initial fetch before the CodeView handle is assigned', async () => {
    let parsed = 0;
    processFileImpl = (...args) => { parsed++; return realPierreDiffs.processFile(...args); };
    seedAugmentation = true;
    await withContents(async requests => {
      const items = await mount();
      expect(requests).toHaveLength(1);
      await pause();
      expect(parsed).toBe(1);
      expect(items[0].fileDiff.additionLines).toEqual(['new\n', 'unchanged\n']);
    });
  });

  test.skipIf(!hasDom)('drops ready old-generation data without parsing or updating the replacement item', async () => {
    let parsed = 0;
    processFileImpl = (...args) => { parsed++; return realPierreDiffs.processFile(...args); };
    await withContents(async requests => {
      const oldItems = await mount();
      await postRender(oldItems);
      const newItems = await mount([file], 'second');
      expect(requests[0].aborted).toBe(true);
      await pause();
      expect(parsed).toBe(0);
      expect(newItems[0].fileDiff.isPartial).toBe(true);
      expect(codeViewUpdates).toHaveLength(0);

      await postRender(newItems);
      await pause();
      expect(requests).toHaveLength(2);
      expect(parsed).toBe(1);
      expect(newItems[0].fileDiff.additionLines).toEqual(['new\n', 'unchanged\n']);
    });
  });

  test.skipIf(!hasDom)('preserves fresh seed-wave data when replacing an old queued job for the same id', async () => {
    let parsed = 0;
    processFileImpl = (...args) => { parsed++; return realPierreDiffs.processFile(...args); };
    seedAugmentation = true;
    await withContents(async requests => {
      const oldItems = await mount();
      const newItems = await mount([file], 'second');
      expect(requests).toHaveLength(2);
      expect(requests[0].aborted).toBe(true);
      expect(requests[1].aborted).toBe(false);
      await pause();
      expect(parsed).toBe(1);
      expect(oldItems[0].fileDiff.isPartial).toBe(true);
      expect(newItems[0].fileDiff.additionLines).toEqual(['new\n', 'unchanged\n']);
      expect(codeViewUpdates).toHaveLength(1);
    });
  });

  test.skipIf(!hasDom)('cancels ready preparation on unmount, not only its eventual item update', async () => {
    let parsed = 0;
    processFileImpl = (...args) => { parsed++; return realPierreDiffs.processFile(...args); };
    await withContents(async requests => {
      const items = await mount();
      await postRender(items);
      await act(async () => root!.unmount());
      root = null;
      await pause();
      expect(requests[0].aborted).toBe(true);
      expect(parsed).toBe(0);
      expect(codeViewUpdates).toHaveLength(0);
    });
  });

  test.skipIf(!hasDom)('keeps the raw patch for inconsistent contents without repeated fetches', async () => {
    let parsed = 0;
    processFileImpl = (...args) => { parsed++; return realPierreDiffs.processFile(...args); };
    await withContents(async requests => {
      const items = await mount();
      await postRender(items);
      await pause();
      expect(items[0].fileDiff.isPartial).toBe(true);
      expect(parsed).toBe(0);
      await postRender(items);
      expect(requests).toHaveLength(1);
    }, { oldContent: 'old\n', newContent: 'new\nextra\n' });
  });

  test.skipIf(!hasDom)('a failed parse retains that raw patch while another ready file still completes', async () => {
    processFileImpl = (patch, options) => {
      if (patch.includes('target.ts')) throw new Error('simulated parser failure');
      return realPierreDiffs.processFile(patch, options);
    };
    await withContents(async requests => {
      const other = { ...file, path: 'other.ts', patch: file.patch.replaceAll('target.ts', 'other.ts') };
      const items = await mount([file, other]);
      await postRender(items);
      await pause();
      expect(items.find(item => item.id === 'target.ts')!.fileDiff.isPartial).toBe(true);
      expect(items.find(item => item.id === 'other.ts')!.fileDiff.additionLines).toEqual(['new\n', 'unchanged\n']);
      await postRender(items);
      expect(requests).toHaveLength(2);
    });
  });
});

describe('AllFilesCodeView readOnly (portable guide host)', () => {
  // The portable Guided Review viewer renders this component with no server
  // and no review state behind it (decision record D2/D4). These guard the
  // three things read-only must switch off without changing what the diff
  // LOOKS like: selection affordances, the window keydown handler, and the
  // /api/file-content augmentation fetch.
  async function mount(overrides: Partial<React.ComponentProps<typeof AllFilesCodeView>>) {
    // A second mount inside one test replaces the previous tree instead of leaking it.
    if (root) await act(async () => root?.unmount());
    host?.remove();
    host = document.createElement('div');
    host.style.height = '400px';
    document.body.appendChild(host);
    root = createRoot(host);
    await render(overrides);
  }

  test.skipIf(!hasDom)('turns off line and gutter selection only in read-only mode', async () => {
    await mount({ readOnly: true });
    let options = lastCodeViewProps?.options as Record<string, unknown>;
    expect(options.enableLineSelection).toBe(false);
    expect(options.enableGutterUtility).toBe(false);

    // The default-on half catches an inverted `!readOnly` breaking the in-app reviewer.
    await mount({});
    options = lastCodeViewProps?.options as Record<string, unknown>;
    expect(options.enableLineSelection).toBe(true);
    expect(options.enableGutterUtility).toBe(true);
  });

  test.skipIf(!hasDom)('never fetches file content when an item mounts', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ oldContent: 'a', newContent: 'b' }), { status: 200 }));
    }) as typeof fetch;
    try {
      await mount({ readOnly: true, isActive: true });
      const options = lastCodeViewProps?.options as { onPostRender?: (...args: unknown[]) => void };
      const item = { id: 'target.ts', type: 'diff' };
      await act(async () => {
        options.onPostRender?.(document.createElement('div'), {}, 'mount', { item });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(calls.filter((url) => url.includes('/api/file-content'))).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.skipIf(!hasDom)('control: a live host does fetch file content on item mount', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ oldContent: null, newContent: null }), { status: 200 }));
    }) as typeof fetch;
    try {
      await mount({ isActive: true });
      const options = lastCodeViewProps?.options as { onPostRender?: (...args: unknown[]) => void };
      await act(async () => {
        options.onPostRender?.(document.createElement('div'), {}, 'mount', { item: { id: 'target.ts', type: 'diff' } });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(calls.filter((url) => url.includes('/api/file-content'))).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.skipIf(!hasDom)('does not install the window keydown handler', async () => {
    const originalAdd = window.addEventListener;
    const keydownAdds: number[] = [];
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'keydown') keydownAdds.push(1);
      return (originalAdd as unknown as (...a: unknown[]) => unknown).call(window, type, ...rest);
    }) as typeof window.addEventListener;
    try {
      await mount({ readOnly: true, isActive: true });
      expect(keydownAdds).toHaveLength(0);
    } finally {
      window.addEventListener = originalAdd;
    }
  });
});
