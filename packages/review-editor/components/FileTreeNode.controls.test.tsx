/** DOM-gated coverage for compact file-row control preferences. */
import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileTreeNodeItem } from './FileTreeNode';
import type { FileTreeNode } from '../utils/buildFileTree';

const hasDom = typeof document !== 'undefined';
let host: HTMLDivElement | null = null;
let root: Root | null = null;

const node: FileTreeNode = {
  type: 'file',
  name: 'example.ts',
  path: 'src/example.ts',
  depth: 0,
  fileIndex: 0,
  additions: 2,
  deletions: 1,
  file: {
    path: 'src/example.ts',
    patch: '',
    additions: 2,
    deletions: 1,
    status: 'modified',
  },
};

function Row({ compact, onOpenFileToSide }: {
  compact: boolean;
  onOpenFileToSide?: (filePath: string) => void;
}) {
  return (
    <FileTreeNodeItem
      node={node}
      expandedFolders={new Set()}
      onToggleFolder={() => {}}
      activeFileIndex={0}
      onSelectFile={() => {}}
      onOpenFileToSide={onOpenFileToSide}
      viewedFiles={new Set()}
      onToggleViewed={() => {}}
      showViewedControls={!compact}
      hideViewedFiles={false}
      getAnnotationCount={() => 0}
      stagedFiles={new Set()}
      getSectionEntry={() => ({ group: 'changes', staged: false })}
      onStageFile={() => {}}
      showStageControls={!compact}
    />
  );
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('FileTreeNodeItem compact controls', () => {
  test.skipIf(!hasDom)('folder expansion and viewed filtering remain live around memoized rows', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const folder: FileTreeNode = {
      type: 'folder', name: 'src', path: 'src', depth: 0,
      children: [{ ...node, depth: 1 }], additions: 2, deletions: 1,
    };
    const expandedFolders = new Set<string>();
    const viewedFiles = new Set<string>();
    const renderFolder = async (activeFileIndex = -1) => act(async () => root!.render(
      <FileTreeNodeItem
        node={folder}
        expandedFolders={expandedFolders}
        onToggleFolder={() => {}}
        activeFileIndex={activeFileIndex}
        onSelectFile={() => {}}
        viewedFiles={viewedFiles}
        hideViewedFiles
        getAnnotationCount={() => 0}
        stagedFiles={new Set()}
      />,
    ));

    await renderFolder();
    expect(host.querySelector('button.file-tree-item')).toBeNull();
    expandedFolders.add(folder.path);
    await renderFolder();
    expect(host.querySelector('button.file-tree-item')).not.toBeNull();

    viewedFiles.add(node.path);
    await renderFolder();
    expect(host.querySelector('button')).toBeNull();
    await renderFolder(0);
    expect(host.querySelector('button.file-tree-item.active')).not.toBeNull();
    expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
  });

  test.skipIf(!hasDom)('opens a file to the side from a modifier click', async () => {
    let openedPath = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => root?.render(<Row compact={false} onOpenFileToSide={(path) => { openedPath = path; }} />));
    const row = host.querySelector<HTMLButtonElement>('button.file-tree-item');
    expect(row).not.toBeNull();
    expect(host.querySelector('[data-open-file-to-side]')).toBeNull();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });

    expect(openedPath).toBe(node.path);
  });

  test.skipIf(!hasDom)('removes viewed and Git add controls without removing the file row', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => root?.render(<Row compact={false} />));
    expect(host.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Stage file"]')).not.toBeNull();

    await act(async () => root?.render(<Row compact />));
    expect(host.querySelector('[role="checkbox"]')).toBeNull();
    expect(host.querySelector('[aria-label="Stage file"]')).toBeNull();
    expect(host.textContent).toContain('example.ts');
  });
});
