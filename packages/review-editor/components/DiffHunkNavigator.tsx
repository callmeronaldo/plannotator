import React, { useEffect, useRef, useState } from 'react';
import type { DiffOverviewMark } from './DiffOverviewRuler';

interface DiffHunkNavigatorProps {
  viewport: HTMLElement | null;
  marks: DiffOverviewMark[];
}

function nearestMarkIndex(viewport: HTMLElement, marks: DiffOverviewMark[]): number {
  if (marks.length === 0) return -1;
  const max = viewport.scrollHeight - viewport.clientHeight;
  if (max <= 0) return 0;
  const position = viewport.scrollTop / max;
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < marks.length; index += 1) {
    const nextDistance = Math.abs(marks[index].top - position);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  }
  return nearest;
}

/** Focused-file previous/next change navigation, matching editor diff tabs. */
export const DiffHunkNavigator: React.FC<DiffHunkNavigatorProps> = ({ viewport, marks }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!viewport || marks.length === 0) {
      setActiveIndex(0);
      return;
    }
    const update = () => {
      rafRef.current = null;
      setActiveIndex(nearestMarkIndex(viewport, marks));
    };
    const schedule = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('scroll', schedule, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', schedule);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [viewport, marks]);

  if (marks.length === 0) return null;

  const canNavigate = viewport != null && marks.length > 1;
  const navigate = (direction: -1 | 1) => {
    if (!canNavigate || !viewport) return;
    const nextIndex = (activeIndex + direction + marks.length) % marks.length;
    setActiveIndex(nextIndex);
    const max = viewport.scrollHeight - viewport.clientHeight;
    viewport.scrollTo({ top: Math.max(0, marks[nextIndex].top * max), behavior: 'auto' });
  };

  return (
    <div
      className="flex h-6 flex-none items-center rounded border border-border/60 bg-background/60"
      data-diff-hunk-navigator
      aria-label="Diff block navigation"
    >
      <button
        type="button"
        className="flex h-full w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        disabled={!canNavigate}
        onClick={(event) => {
          event.stopPropagation();
          navigate(-1);
        }}
        title="Previous diff block"
        aria-label="Previous diff block"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <span className="min-w-9 border-x border-border/60 px-1 text-center font-mono text-[10px] text-muted-foreground">
        {activeIndex + 1}/{marks.length}
      </span>
      <button
        type="button"
        className="flex h-full w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        disabled={!canNavigate}
        onClick={(event) => {
          event.stopPropagation();
          navigate(1);
        }}
        title="Next diff block"
        aria-label="Next diff block"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
};
