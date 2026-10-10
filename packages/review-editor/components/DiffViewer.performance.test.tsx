import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const hasDom = typeof document !== 'undefined';
const realPierreReact = { ...(await import('@pierre/diffs/react')) };
const realTheme = { ...(await import('../hooks/usePierreTheme')) };
let diffRenders = 0;

mock.module('@pierre/diffs/react', () => ({
  ...realPierreReact,
  FileDiff: () => { diffRenders += 1; return null; },
}));
// The transport imports Vite's ?worker&inline module, which Bun cannot load.
mock.module('../workerPool', () => ({
  useIsWorkerPoolReadyOrDisabled: () => true,
  useWorkerPoolThemeSync: () => {},
}));
mock.module('../hooks/usePierreTheme', () => ({
  ...realTheme,
  usePierreTheme: () => ({ type: 'light', css: '' }),
}));

const { DiffViewer } = await import('./DiffViewer');
const PATCH = 'diff --git a/calc.ts b/calc.ts\n--- a/calc.ts\n+++ b/calc.ts\n@@ -1 +1 @@\n-before\n+after\n';
const ANNOTATIONS: React.ComponentProps<typeof DiffViewer>['annotations'] = [];
const noop = () => {};
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let originalFetch: typeof fetch;
let restoreFetch = false;

async function render(props: Partial<React.ComponentProps<typeof DiffViewer>> = {}) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    originalFetch = globalThis.fetch;
    restoreFetch = true;
    globalThis.fetch = Object.assign(async () => Response.json({ oldContent: null, newContent: null }), originalFetch);
  }
  await act(async () => {
    root!.render(
      <DiffViewer
        patch={PATCH}
        filePath="calc.ts"
        isFocused
        diffStyle="unified"
        annotations={ANNOTATIONS}
        selectedAnnotationId={null}
        scrollTargetAnnotation={null}
        pendingSelection={null}
        onLineSelection={noop}
        onAddAnnotation={noop}
        onAddFileComment={noop}
        onEditAnnotation={noop}
        onSelectAnnotation={noop}
        onDeleteAnnotation={noop}
        onToggleViewed={noop}
        {...props}
      />,
    );
  });
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  host = null;
  if (restoreFetch) globalThis.fetch = originalFetch;
  restoreFetch = false;
  diffRenders = 0;
});

afterAll(() => {
  mock.module('@pierre/diffs/react', () => realPierreReact);
  mock.module('../hooks/usePierreTheme', () => realTheme);
});

describe.if(hasDom)('focused diff rendering isolation', () => {
  test('opening Find leaves the expensive diff body untouched', async () => {
    await render();
    const initialRenders = diffRenders;
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    });
    expect(host?.querySelector('[data-file-find-widget]')).not.toBeNull();
    expect(diffRenders).toBe(initialRenders);
  });

  test('header-only updates do not re-render the diff, but a changed patch does', async () => {
    await render();
    const initialRenders = diffRenders;
    await render({ isViewed: true });
    expect(host?.querySelector('button[title*="not viewed"]')).not.toBeNull();
    expect(diffRenders).toBe(initialRenders);

    await render({ isViewed: true, patch: PATCH.replace('+after', '+changed') });
    expect(diffRenders).toBeGreaterThan(initialRenders);
  });
});
