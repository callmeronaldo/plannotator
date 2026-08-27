import React, { useEffect, useRef } from 'react';

interface FileFindWidgetProps {
  query: string;
  matchCount: number;
  activeIndex: number;
  onQueryChange: (query: string) => void;
  onStep: (direction: -1 | 1) => void;
  onClose: () => void;
}

/** VS Code-style current-file find control for focused diff tabs. */
export const FileFindWidget: React.FC<FileFindWidgetProps> = ({
  query,
  matchCount,
  activeIndex,
  onQueryChange,
  onStep,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, []);

  const count = matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : '0/0';

  return (
    <div
      className="absolute right-5 top-9 z-50 flex h-8 items-center gap-1 rounded-md border border-border bg-popover px-1.5 shadow-lg"
      data-file-find-widget
      role="search"
      aria-label="Find in current file"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        className="h-6 w-48 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="Find in file"
        aria-label="Find in current file"
      />
      <span className="min-w-9 text-center font-mono text-[10px] text-muted-foreground">
        {count}
      </span>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        disabled={matchCount === 0}
        onClick={() => onStep(-1)}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        disabled={matchCount === 0}
        onClick={() => onStep(1)}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onClose}
        title="Close (Escape)"
        aria-label="Close find"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
