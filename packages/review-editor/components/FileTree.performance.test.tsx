import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FileTree as FileTreeComponent } from './FileTree';
import type { DiffFile } from '../types';
import type { SinceBaseSections } from '@plannotator/shared/types';

const hasDom = typeof document !== 'undefined';
const realRowBits = { ...(await import('./FileRowBits')) };
const rowRenders = new Map<string, number>();
let FileTree: typeof FileTreeComponent;
let host: HTMLDivElement | null = null;
let root: Root | null = null;

// Count a real descendant of the expensive menu/tooltip row, not the cheap
// list projection. Keep its rendering intact so the same tests check row UI.
beforeAll(async () => {
  if (!hasDom) return;
  mock.module('./FileRowBits', () => ({
    ...realRowBits,
    ChangeTypeLetter: (props: React.ComponentProps<typeof realRowBits.ChangeTypeLetter>) => {
      const key = props.oldPath!;
      rowRenders.set(key, (rowRenders.get(key) ?? 0) + 1);
      return <realRowBits.ChangeTypeLetter {...props} />;
    },
  }));
  ({ FileTree } = await import('./FileTree'));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  rowRenders.clear();
});

afterAll(() => {
  if (hasDom) mock.module('./FileRowBits', () => realRowBits);
});

const files: DiffFile[] = Array.from({ length: 100 }, (_, index) => ({
  path: `src/file${index}.ts`,
  oldPath: `src/previous${index}.ts`,
  status: 'renamed',
  patch: '',
  additions: 2,
  deletions: 1,
}));
const annotations: React.ComponentProps<typeof FileTreeComponent>['annotations'] = [];
type Props = React.ComponentProps<typeof FileTreeComponent>;

async function render(props: Partial<Props> = {}) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(
    <FileTree
      files={files}
      activeFileIndex={0}
      isAllFilesActive
      scrollHighlightIndex={0}
      annotations={annotations}
      viewedFiles={new Set()}
      stagedFiles={new Set()}
      // App currently recreates navigator adapters on each parent render.
      onSelectFile={() => {}}
      onOpenFileToSide={() => {}}
      onDoubleClickFile={() => {}}
      onToggleViewed={() => {}}
      onStageFile={() => {}}
      {...props}
    />,
  ));
}

function row(index: number) {
  return [...host!.querySelectorAll<HTMLButtonElement>('button.file-tree-item')]
    .find(button => button.textContent?.includes(files[index].path))!;
}

function renders(index: number) {
  return rowRenders.get(files[index].oldPath!) ?? 0;
}

function renderTotal() {
  return [...rowRenders.values()].reduce((sum, count) => sum + count, 0);
}

function sections(): SinceBaseSections {
  return {
    base: 'main',
    mergeBase: '1234',
    files: Object.fromEntries(files.map(file => [file.path, { group: 'changes', staged: true }])),
  };
}

describe.if(hasDom)('file tree row update isolation', () => {
  test('scrolling to another file updates only the previous and next row', async () => {
    await render();
    expect(host!.querySelectorAll('button.file-tree-item')).toHaveLength(files.length);
    const before = renderTotal();
    const unaffected = renders(2);

    await render({ scrollHighlightIndex: 1 });
    expect(row(0).classList.contains('scroll-active')).toBe(false);
    expect(row(1).classList.contains('scroll-active')).toBe(true);
    expect(host!.querySelector('button.file-tree-item.active')).toBeNull();
    expect(renderTotal() - before).toBe(2);
    expect(renders(2)).toBe(unaffected);

    const settled = renderTotal();
    await render({ scrollHighlightIndex: 1 });
    expect(renderTotal()).toBe(settled);
  });

  test('focused selection and non-file panels clear the appropriate row markers', async () => {
    await render({ scrollHighlightIndex: 1 });
    const before = renderTotal();
    await render({ isAllFilesActive: false, activeFileIndex: 2 });
    expect(row(1).classList.contains('scroll-active')).toBe(false);
    expect(row(2).classList.contains('active')).toBe(true);
    expect(renderTotal() - before).toBe(2);

    await render({ isAllFilesActive: false, activeFileIndex: 2, isSemanticDiffActive: true });
    expect(host!.querySelector('button.file-tree-item.active')).toBeNull();
    expect(host!.querySelector('button.file-tree-item.scroll-active')).toBeNull();
  });

  test('current viewed, staged, annotation and sidecar values survive memoization', async () => {
    const viewedFiles = new Set<string>();
    const stagedFiles = new Set<string>();
    const sidecar = sections();
    await render({ viewedFiles, stagedFiles, sinceBaseSections: sidecar });
    // A staged snapshot must not override the effective set, even on first paint.
    expect(row(0).querySelector('[aria-label="Stage file"]')).not.toBeNull();

    viewedFiles.add(files[0].path);
    stagedFiles.add(files[1].path);
    sidecar.files[files[3].path].group = 'untracked';
    const annotated: Props['annotations'] = [{
      id: 'comment', type: 'comment', filePath: files[2].path,
      lineStart: 1, lineEnd: 1, side: 'new', text: 'Review this', createdAt: 1,
    }];
    const before = renderTotal();
    await render({ viewedFiles, stagedFiles, sinceBaseSections: sidecar, annotations: annotated });
    expect(row(0).querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(row(1).querySelector('[aria-label="Staged"]')).not.toBeNull();
    expect(row(2).querySelector('[title="1 annotation"]')).not.toBeNull();
    expect(row(3).querySelector('[title="Untracked file"]')).not.toBeNull();
    expect(renderTotal() - before).toBe(4);

    stagedFiles.clear();
    sidecar.files[files[3].path].group = 'committed';
    await render({ viewedFiles, stagedFiles, sinceBaseSections: sidecar, annotations: annotated });
    expect(row(1).querySelector('[aria-label="Staged"]')).toBeNull();
    expect(row(1).querySelector('[aria-label="Stage file"]')).not.toBeNull();
    expect(row(3).querySelector('[aria-label="Committed"]')).not.toBeNull();
  });

  test('hide-viewed keeps the focused exception but does not mistake scroll-active for focused', async () => {
    const viewedFiles = new Set([files[0].path, files[1].path]);
    await render({ viewedFiles, hideViewedFiles: true, isAllFilesActive: false });
    expect(row(0)).toBeDefined();
    expect(row(1)).toBeUndefined();

    await render({ viewedFiles, hideViewedFiles: true, isAllFilesActive: false, activeFileIndex: 1 });
    expect(row(0)).toBeUndefined();
    expect(row(1).classList.contains('active')).toBe(true);

    await render({ viewedFiles, hideViewedFiles: true, scrollHighlightIndex: 1 });
    expect(row(0)).toBeUndefined();
    expect(row(1)).toBeUndefined();
  });

  test('stable row dispatch invokes the latest click, viewed and stage handlers', async () => {
    const sidecar = sections();
    const calls: string[] = [];
    const handlers = (generation: string): Partial<Props> => ({
      onSelectFile: index => calls.push(`${generation}:select:${index}`),
      onOpenFileToSide: path => calls.push(`${generation}:side:${path}`),
      onDoubleClickFile: index => calls.push(`${generation}:double:${index}`),
      onToggleViewed: path => calls.push(`${generation}:view:${path}`),
      onStageFile: path => calls.push(`${generation}:stage:${path}`),
    });
    await render({ sinceBaseSections: sidecar, ...handlers('old') });
    const before = renderTotal();
    await render({ sinceBaseSections: sidecar, ...handlers('current') });
    expect(renderTotal()).toBe(before);

    await act(async () => {
      row(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      row(2).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      row(2).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      row(2).querySelector('[role="checkbox"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      row(2).querySelector('[aria-label="Stage file"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(calls).toEqual([
      'current:select:2', `current:side:${files[2].path}`, 'current:double:2',
      `current:view:${files[2].path}`, `current:stage:${files[2].path}`,
    ]);
  });

  test('optional actions and compact controls remain live', async () => {
    const sidecar = sections();
    await render({ sinceBaseSections: sidecar });
    expect(row(0).title).toContain('open to the side');
    expect(row(0).querySelector('[role="checkbox"]')).not.toBeNull();
    expect(row(0).querySelector('[aria-label="Stage file"]')).not.toBeNull();

    let selected = -1;
    await render({
      sinceBaseSections: sidecar, onOpenFileToSide: undefined,
      onSelectFile: index => { selected = index; },
      showViewedControls: false, showStageControls: false,
    });
    expect(row(0).title).toBe('');
    expect(row(0).querySelector('[role="checkbox"]')).toBeNull();
    expect(row(0).querySelector('[aria-label="Stage file"]')).toBeNull();
    await act(async () => {
      row(0).dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    });
    expect(selected).toBe(0);

    await render({ sinceBaseSections: sidecar });
    expect(row(0).title).toContain('open to the side');
    expect(row(0).querySelector('[role="checkbox"]')).not.toBeNull();
    expect(row(0).querySelector('[aria-label="Stage file"]')).not.toBeNull();
  });

  test('stage-in-progress updates only its row and blocks repeat activation', async () => {
    const sidecar = sections();
    let stages = 0;
    const onStageFile = () => { stages++; };
    await render({ sinceBaseSections: sidecar, onStageFile });
    const before = renderTotal();
    await render({ sinceBaseSections: sidecar, onStageFile, stagingFile: files[2].path });
    expect(renderTotal() - before).toBe(1);
    expect(row(2).querySelector('.animate-spin')).not.toBeNull();
    await act(async () => {
      row(2).querySelector('[aria-label="Stage file"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(stages).toBe(0);

    await render({ sinceBaseSections: sidecar, onStageFile });
    await act(async () => {
      row(2).querySelector('[aria-label="Stage file"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(stages).toBe(1);
  });

  test('keyboard navigation and changed file snapshots use current data', async () => {
    let selected = -1;
    const onSelectFile = (index: number) => { selected = index; };
    const updated = files.map((file, index) => index === 0 ? { ...file, status: 'added' as const, additions: 7, deletions: 0 } : file);
    await render();
    await render({ files: updated, onSelectFile, activeFileIndex: 2 });
    expect(row(0).querySelector('[title="Added file"]')).not.toBeNull();
    expect(row(0).textContent).toContain('+7');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
    expect(selected).toBe(3);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(selected).toBe(files.length - 1);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(selected).toBe(0);
  });
});
