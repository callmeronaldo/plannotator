import React from 'react';
import type { FileDiffMetadata } from '@pierre/diffs';

/** One change region on the ruler, as 0..1 fractions of the rendered document. */
export interface DiffOverviewMark {
  top: number;
  height: number;
  additions: number;
  deletions: number;
}

/** Logical scroll model used by Pierre's virtualized all-files CodeView. */
export interface DiffOverviewScrollModel {
  getViewportHeight(): number;
  getScrollHeight(): number;
  scrollTo(top: number): void;
}

/** Build file-relative hunk marks from Pierre's rendered-row metadata. */
export function buildDiffOverviewMarks(
  fileDiff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
): DiffOverviewMark[] {
  const hunks = fileDiff.hunks;
  if (!hunks?.length) return [];
  const total = diffStyle === 'split' ? fileDiff.splitLineCount : fileDiff.unifiedLineCount;
  if (!total) return [];

  const marks: DiffOverviewMark[] = [];
  for (const hunk of hunks) {
    const additions = hunk.additionLines ?? 0;
    const deletions = hunk.deletionLines ?? 0;
    const changed = additions + deletions;
    if (changed <= 0) continue;

    let leading = 0;
    if (Array.isArray(hunk.hunkContent)) {
      for (const segment of hunk.hunkContent) {
        if (segment.type === 'context') leading += segment.lines;
        else break;
      }
    }
    const start = (diffStyle === 'split' ? hunk.splitLineStart : hunk.unifiedLineStart) + leading;
    marks.push({
      top: Math.min(Math.max(start / total, 0), 1),
      height: changed / total,
      additions,
      deletions,
    });
  }
  return marks;
}

/**
 * VS Code-style change overview ruler for single-file and all-files diffs: a
 * narrow strip on the right edge of the viewport with green/red marks where
 * the hunks sit and click-to-jump navigation. The native scrollbar remains the
 * sole visible-position indicator, avoiding a duplicate scrollbar thumb.
 * Callers compute marks from rendered-line metadata; virtualized callers also
 * provide their logical scroll model so Pierre's physical rebasing stays hidden.
 *
 * Self-contained on purpose: it subscribes to the viewport's scroll events
 * itself so scrolling never re-renders DiffViewer.
 */
export const DiffOverviewRuler: React.FC<{
  viewport: HTMLElement | null;
  marks: DiffOverviewMark[];
  scrollModel?: DiffOverviewScrollModel;
}> = ({ viewport, marks, scrollModel }) => {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!viewport) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
    const viewportHeight = scrollModel?.getViewportHeight() ?? viewport.clientHeight;
    const scrollHeight = scrollModel?.getScrollHeight() ?? viewport.scrollHeight;
    const max = scrollHeight - viewportHeight;
    if (max <= 0) return;
    const top = fraction * max;
    if (scrollModel) scrollModel.scrollTo(top);
    else viewport.scrollTo({ top });
  };

  if (!marks.length) return null;

  return (
    <div
      className="absolute right-0 inset-y-0 w-3.5 z-20 cursor-pointer group"
      data-diff-overview-ruler
      onClick={handleClick}
      title="Change overview — click to jump"
    >
      {/* Faint track, visible on hover so the strip reads as interactive. */}
      <div className="absolute inset-y-2 right-0.5 w-[3px] rounded-full bg-border/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      {/* Change marks: deletions render above additions (unified order). */}
      {marks.map((mark, index) => (
        <div
          key={index}
          className="absolute left-0.5 right-1.5 overflow-hidden rounded-[1px] pointer-events-none"
          style={{ top: `${mark.top * 100}%`, height: `${Math.max(mark.height * 100, 0.6)}%`, minHeight: 3 }}
          title={`+${mark.additions} −${mark.deletions}`}
        >
          {mark.deletions > 0 && (
            <div className={`bg-destructive/80 ${mark.additions > 0 ? 'h-1/2' : 'h-full'}`} />
          )}
          {mark.additions > 0 && (
            <div className={`bg-success/80 ${mark.deletions > 0 ? 'h-1/2' : 'h-full'}`} />
          )}
        </div>
      ))}
    </div>
  );
};
