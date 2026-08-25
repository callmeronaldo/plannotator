import React, { useEffect, useRef, useState } from 'react';

/** One change region on the ruler, as 0..1 fractions of the rendered document. */
export interface DiffOverviewMark {
  top: number;
  height: number;
  additions: number;
  deletions: number;
}

/**
 * VS Code-style change overview ruler for the focused-file diff: a narrow
 * strip on the right edge of the diff viewport with green/red marks where
 * the hunks sit (positions are computed from the diff's rendered-line
 * metadata, so they stay correct under virtualization and full-file
 * expansion), a translucent band for the visible region, and click-to-jump.
 *
 * Self-contained on purpose: it subscribes to the viewport's scroll events
 * itself so scrolling never re-renders DiffViewer.
 */
export const DiffOverviewRuler: React.FC<{
  viewport: HTMLElement | null;
  marks: DiffOverviewMark[];
}> = ({ viewport, marks }) => {
  const [visible, setVisible] = useState<{ top: number; height: number } | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!viewport) return;

    const update = () => {
      rafRef.current = 0;
      const scrollable = viewport.scrollHeight - viewport.clientHeight;
      setVisible(scrollable > 0
        ? {
            top: viewport.scrollTop / viewport.scrollHeight,
            height: viewport.clientHeight / viewport.scrollHeight,
          }
        : null);
    };
    const schedule = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(update);
    };

    update();
    viewport.addEventListener('scroll', schedule, { passive: true });
    // Lazy-rendered content and window resizes both change scrollHeight.
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [viewport]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!viewport) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
    const max = viewport.scrollHeight - viewport.clientHeight;
    if (max > 0) viewport.scrollTo({ top: fraction * max });
  };

  if (!marks.length) return null;

  return (
    <div
      className="absolute right-0 inset-y-0 w-3.5 z-20 cursor-pointer group"
      onClick={handleClick}
      title="Change overview — click to jump"
    >
      {/* Faint track, visible on hover so the strip reads as interactive. */}
      <div className="absolute inset-y-2 right-0.5 w-[3px] rounded-full bg-border/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      {/* Visible-region band (like VS Code's overview viewport indicator). */}
      {visible && (
        <div
          className="absolute left-0.5 right-1.5 rounded-sm bg-foreground/10 border border-foreground/15 pointer-events-none"
          style={{ top: `${visible.top * 100}%`, height: `${Math.max(visible.height * 100, 3)}%` }}
        />
      )}
      {/* Change marks: deletions render above additions (unified order). */}
      {marks.map((mark, index) => (
        <div
          key={index}
          className="absolute left-0.5 right-1.5 overflow-hidden rounded-[1px] pointer-events-none"
          style={{ top: `${mark.top * 100}%`, height: `${Math.max(mark.height * 100, 0.6)}%`, minHeight: 3 }}
          title={`+${mark.additions} −${mark.deletions}`}
        >
          {mark.deletions > 0 && (
            <div className={`bg-red-500/80 ${mark.additions > 0 ? 'h-1/2' : 'h-full'}`} />
          )}
          {mark.additions > 0 && (
            <div className={`bg-green-500/80 ${mark.deletions > 0 ? 'h-1/2' : 'h-full'}`} />
          )}
        </div>
      ))}
    </div>
  );
};
