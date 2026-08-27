import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { processFile } from '@pierre/diffs';
import type { FileDiffMetadata } from '@pierre/diffs';
import { useStableCallback } from '@pierre/diffs/react';
import type { CreateEditor } from '@pierre/diffs/react';
import type { DiffAnnotationMetadata } from '@plannotator/ui/types';
import type { DiffFile } from '../types';
import { isContentConsistentWithPatch } from '../utils/patchConsistency';
import { cloneFileDiff } from './cloneDiff';
import type { SuggestionHunk } from './deriveSuggestions';
import { mapEditedRangeToPristine, selectionToLineRange } from './selectionAnchor';
import { buildSelectionActionElement } from './selectionActionPopover';
import {
  recoverDirtySessionHunks,
  type EditSelectionAnnotationRequest,
  type EditSessionDirtyStore,
} from './useEditSession';
import {
  createPierreEditor,
  loadPierreEdit,
  type PierreEditorInstance,
  type PierreEditorOptions,
  type PierreSelectionActionContext,
} from './pierreEditAdapter';

interface ActiveSingleFileSession {
  generation: string;
  filePath: string;
  preEditContent: string;
  latestContents: { contents: string } | null;
  dirty: boolean;
  editor: PierreEditorInstance | null;
}

interface UseSingleFileEditSessionParams {
  enabled: boolean;
  file: Pick<DiffFile, 'oldPath' | 'patch' | 'path' | 'status'>;
  fileDiff: FileDiffMetadata;
  generation: string;
  reviewBase?: string;
  reviewSnapshotId?: string;
  onAddSuggestions?: (filePath: string, hunks: SuggestionHunk[]) => void;
  onSelectionAnnotation?: (request: EditSelectionAnnotationRequest) => void;
}

export interface SingleFileEditSessionApi {
  editing: boolean;
  editableDiff: FileDiffMetadata | null;
  editDisabledReason: string | null;
  renderVersion: number;
  startEdit: () => void;
  completeEdit: () => void;
  cancelEdit: () => void;
  collapseSelection: () => void;
  dirtyStore: EditSessionDirtyStore;
  createEditor: CreateEditor<DiffAnnotationMetadata>;
  editorOptions: PierreEditorOptions;
}

/**
 * FileDiff adapter for edit-to-suggestion. The original implementation is
 * CodeView-item based; a focused file tab renders Pierre's standalone
 * `FileDiff`, whose edit lifecycle is controlled by its `edit` prop instead.
 * Keep the session policy identical while adapting the renderer boundary.
 */
export function useSingleFileEditSession({
  enabled,
  file,
  fileDiff,
  generation,
  reviewBase,
  reviewSnapshotId,
  onAddSuggestions,
  onSelectionAnnotation,
}: UseSingleFileEditSessionParams): SingleFileEditSessionApi {
  const [editing, setEditing] = useState(false);
  const [editableDiff, setEditableDiff] = useState<FileDiffMetadata | null>(null);
  const [editDisabledReason, setEditDisabledReason] = useState<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const sessionRef = useRef<ActiveSingleFileSession | null>(null);
  const mountedRef = useRef(true);
  const fileRef = useRef(file);
  fileRef.current = file;
  const fileDiffRef = useRef(fileDiff);
  fileDiffRef.current = fileDiff;
  const generationRef = useRef(generation);
  generationRef.current = generation;
  const reviewBaseRef = useRef(reviewBase);
  reviewBaseRef.current = reviewBase;
  const reviewSnapshotIdRef = useRef(reviewSnapshotId);
  reviewSnapshotIdRef.current = reviewSnapshotId;
  const onAddSuggestionsRef = useRef(onAddSuggestions);
  onAddSuggestionsRef.current = onAddSuggestions;
  const onSelectionAnnotationRef = useRef(onSelectionAnnotation);
  onSelectionAnnotationRef.current = onSelectionAnnotation;

  const changeCountRef = useRef(0);
  const changeListenersRef = useRef(new Set<() => void>());
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishChangeCount = (count: number) => {
    if (changeCountRef.current === count) return;
    changeCountRef.current = count;
    for (const listener of changeListenersRef.current) listener();
  };

  const resetChangeCount = () => {
    if (changeTimerRef.current != null) {
      clearTimeout(changeTimerRef.current);
      changeTimerRef.current = null;
    }
    publishChangeCount(0);
  };

  const dirtyStore = useMemo<EditSessionDirtyStore>(
    () => ({
      subscribe: (listener) => {
        changeListenersRef.current.add(listener);
        return () => changeListenersRef.current.delete(listener);
      },
      getSnapshot: () => changeCountRef.current,
    }),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (changeTimerRef.current != null) clearTimeout(changeTimerRef.current);
      const session = sessionRef.current;
      sessionRef.current = null;
      if (!session?.dirty) return;
      const hunks = recoverDirtySessionHunks(session);
      if (hunks.length === 0) return;
      const keep = window.confirm(
        `The file view changed and ended your edit session on ${session.filePath}. Keep your changes there as suggestions?`,
      );
      if (keep) onAddSuggestionsRef.current?.(session.filePath, hunks);
    };
  }, []);

  const ensureFullContent = useStableCallback(async (): Promise<FileDiffMetadata | null> => {
    const current = fileDiffRef.current;
    if (current.isPartial !== true) return current;

    const target = fileRef.current;
    const expectedGeneration = generationRef.current;
    const params = new URLSearchParams({ path: target.path });
    if (target.oldPath) params.set('oldPath', target.oldPath);
    if (reviewBaseRef.current) params.set('base', reviewBaseRef.current);
    if (reviewSnapshotIdRef.current) params.set('snapshot', reviewSnapshotIdRef.current);

    let data: { oldContent: string | null; newContent: string | null } | null = null;
    try {
      const response = await fetch(`/api/file-content?${params}`);
      data = response.ok ? await response.json() : null;
    } catch {
      data = null;
    }
    if (generationRef.current !== expectedGeneration || !data || data.newContent == null) return null;
    if (!isContentConsistentWithPatch(target.patch, data.oldContent, data.newContent)) return null;

    try {
      const result = processFile(target.patch, {
        oldFile: data.oldContent != null
          ? { name: target.oldPath || target.path, contents: data.oldContent }
          : undefined,
        newFile: { name: target.path, contents: data.newContent },
      });
      return result && !result.isPartial ? result : null;
    } catch {
      return null;
    }
  });

  const endSession = useStableCallback((discard: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;

    if (!discard && session.dirty) {
      const hunks = recoverDirtySessionHunks(session);
      if (hunks.length > 0) {
        onAddSuggestionsRef.current?.(session.filePath, hunks);
      }
    }

    resetChangeCount();
    setEditing(false);
    setEditableDiff(null);
    // FileDiff does not expose its renderer cache. Remounting after edit teardown
    // guarantees pristine pixels instead of reusing its mutated highlighted AST.
    setRenderVersion((value) => value + 1);
  });

  const completeEdit = useStableCallback(() => endSession(false));
  const cancelEdit = useStableCallback(() => endSession(true));

  const startEdit = useStableCallback(() => {
    if (!enabled || sessionRef.current) return;
    const target = fileRef.current;
    if (target.status === 'deleted') {
      setEditDisabledReason('Deleted files have no content to edit');
      return;
    }

    const expectedGeneration = generationRef.current;
    void (async () => {
      try {
        await loadPierreEdit();
      } catch {
        setEditDisabledReason('Editor failed to load');
        return;
      }
      const hydrated = await ensureFullContent();
      if (!mountedRef.current || generationRef.current !== expectedGeneration) return;
      if (!hydrated) {
        setEditDisabledReason('Full file content unavailable');
        return;
      }

      let pristine: FileDiffMetadata;
      let editable: FileDiffMetadata;
      try {
        pristine = cloneFileDiff(hydrated);
        editable = cloneFileDiff(hydrated);
      } catch {
        setEditDisabledReason('This diff cannot be edited');
        return;
      }
      editable.cacheKey = `${expectedGeneration}#single-edit`;
      sessionRef.current = {
        generation: expectedGeneration,
        filePath: target.path,
        preEditContent: (pristine.additionLines ?? []).join(''),
        latestContents: null,
        dirty: false,
        editor: null,
      };
      setEditDisabledReason(null);
      resetChangeCount();
      setEditableDiff(editable);
      setEditing(true);
    })();
  });

  const handleMakeAnnotation = useStableCallback(
    (context: PierreSelectionActionContext, anchorRect: DOMRect) => {
      const session = sessionRef.current;
      const sink = onSelectionAnnotationRef.current;
      if (!session || !sink) return;
      let selectedText = '';
      try {
        selectedText = context.getSelectionText();
      } catch {
        // The line anchor still carries useful context.
      }
      let edited = session.preEditContent;
      try {
        edited = context.textDocument.getText();
      } catch {
        try {
          if (session.latestContents) edited = String(session.latestContents.contents);
        } catch {
          // Keep the pristine fallback.
        }
      }
      const { lineStart, lineEnd } = selectionToLineRange(context.selection);
      const anchor = mapEditedRangeToPristine(session.preEditContent, edited, lineStart, lineEnd);
      sink({
        filePath: fileRef.current.path,
        lineStart: anchor.lineStart,
        lineEnd: anchor.lineEnd,
        exact: anchor.exact,
        selectedText,
        anchorRect,
      });
      try {
        context.close();
      } catch {
        // Cosmetic popover teardown only.
      }
    },
  );

  const editorOptions = useMemo<PierreEditorOptions>(
    () => ({
      enabledSelectionAction: true,
      renderSelectionAction: (context: PierreSelectionActionContext) =>
        buildSelectionActionElement((anchorRect) => handleMakeAnnotation(context, anchorRect)),
      onAttach: (editor: PierreEditorInstance) => {
        const session = sessionRef.current;
        if (session) session.editor = editor;
      },
      onChange: (contents: { contents: string }) => {
        const session = sessionRef.current;
        if (!session) return;
        session.dirty = true;
        session.latestContents = contents;
        if (changeTimerRef.current != null) clearTimeout(changeTimerRef.current);
        changeTimerRef.current = setTimeout(() => {
          changeTimerRef.current = null;
          const live = sessionRef.current;
          if (!live) return;
          publishChangeCount(recoverDirtySessionHunks(live).length);
        }, 250);
      },
    }),
    // Stable callbacks and refs deliberately keep these options fixed for the
    // lifetime of FileDiff's editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const createEditor = useStableCallback((options: PierreEditorOptions) =>
    createPierreEditor(options),
  ) as unknown as CreateEditor<DiffAnnotationMetadata>;

  const collapseSelection = useStableCallback(() => {
    const editor = sessionRef.current?.editor;
    if (!editor) return;
    try {
      const selection = editor.getState().selections?.at(-1);
      if (!selection) return;
      editor.setSelections([{ start: selection.end, end: selection.end, direction: 'none' }]);
    } catch {
      // Cosmetic cleanup only.
    }
  });

  return {
    editing,
    editableDiff,
    editDisabledReason,
    renderVersion,
    startEdit,
    completeEdit,
    cancelEdit,
    collapseSelection,
    dirtyStore,
    createEditor,
    editorOptions,
  };
}
