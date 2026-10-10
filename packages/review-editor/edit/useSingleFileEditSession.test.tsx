import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { processFile } from '@pierre/diffs';
import { loadPierreEdit } from './pierreEditAdapter';
import { useSingleFileEditSession, type SingleFileEditSessionApi } from './useSingleFileEditSession';
import type { SuggestionHunk } from './deriveSuggestions';

const hasDom = typeof document !== 'undefined';
const PATCH = [
  'diff --git a/src/calc.ts b/src/calc.ts',
  '--- a/src/calc.ts',
  '+++ b/src/calc.ts',
  '@@ -2 +2 @@',
  '-two',
  '+TWO',
].join('\n');
const CONTENT = { oldContent: 'one\ntwo\nthree\n', newContent: 'one\nTWO\nthree\n' };
const FILE = { path: 'src/calc.ts', patch: PATCH, status: 'modified' as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let originalFetch: typeof fetch;
let restoreFetch = false;

function replaceFetch(fetchImpl: () => Promise<Response>) {
  originalFetch = globalThis.fetch;
  restoreFetch = true;
  // Preserve runtime-specific helpers such as Bun's fetch.preconnect.
  globalThis.fetch = Object.assign(fetchImpl, originalFetch);
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  host = null;
  if (restoreFetch) globalThis.fetch = originalFetch;
  restoreFetch = false;
});

async function mountSession() {
  // Use the real lazy editor loader and parser, not a process-wide module mock.
  await loadPierreEdit();
  const fileDiff = processFile(PATCH);
  if (!fileDiff?.isPartial) throw new Error('fixture must require full-content hydration');
  let api: SingleFileEditSessionApi | null = null;
  const added: Array<{ filePath: string; hunks: SuggestionHunk[] }> = [];
  function Harness({ generation }: { generation: string }) {
    api = useSingleFileEditSession({
      enabled: true,
      file: FILE,
      fileDiff: fileDiff!,
      generation,
      onAddSuggestions: (filePath, hunks) => { added.push({ filePath, hunks }); },
    });
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = async (generation: string) => {
    await act(async () => { root!.render(<Harness generation={generation} />); });
  };
  await render('snapshot-1');
  return {
    current: () => api!,
    added,
    render,
  };
}

describe.if(hasDom)('focused-file edit session startup', () => {
  test('repeated Edit clicks cannot reset edits when a slower startup finishes', async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    let requests = 0;
    replaceFetch(() => {
      requests += 1;
      return requests === 1 ? firstResponse.promise : secondResponse.promise;
    });
    const session = await mountSession();

    await act(async () => {
      session.current().startEdit();
      session.current().startEdit();
    });
    await act(async () => { firstResponse.resolve(Response.json(CONTENT)); });
    expect(session.current().editing).toBe(true);

    await act(async () => {
      const editedFile = { name: FILE.path, contents: 'one\nedited\nthree\n' };
      session.current().editorOptions.onChange?.(editedFile, undefined, { file: editedFile, changes: [] });
    });
    // Before the fix a second startup was still waiting here and replaced
    // the dirty session with a pristine one as soon as its response arrived.
    await act(async () => { secondResponse.resolve(Response.json(CONTENT)); });
    await act(async () => { session.current().completeEdit(); });

    expect(session.added).toEqual([{
      filePath: FILE.path,
      hunks: [{ lineStart: 2, lineEnd: 2, originalCode: 'TWO', suggestedCode: 'edited' }],
    }]);
    expect(requests).toBe(1);
    expect(session.current().editing).toBe(false);

    // Finishing a session must release startup ownership for the next edit.
    await act(async () => { session.current().startEdit(); });
    expect(session.current().editing).toBe(true);
    await act(async () => { session.current().cancelEdit(); });
    expect(session.added).toHaveLength(1);
  });

  test('a pending startup cannot attach to a different review snapshot', async () => {
    const response = deferred<Response>();
    replaceFetch(() => response.promise);
    const session = await mountSession();

    await act(async () => { session.current().startEdit(); });
    await session.render('snapshot-2');
    await act(async () => { response.resolve(Response.json(CONTENT)); });

    expect(session.current().editing).toBe(false);
    expect(session.current().editableDiff).toBeNull();
    expect(session.added).toEqual([]);
    expect(session.current().editDisabledReason).toBeNull();
  });
});
