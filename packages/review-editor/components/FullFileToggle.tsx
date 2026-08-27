import React from 'react';

export type FullFileContextState = 'loading' | 'ready' | 'unavailable';

interface FullFileToggleProps {
  state: FullFileContextState;
  expanded: boolean;
  onToggle: () => void;
}

/** Explicit focused-file context control; hydration remains asynchronous. */
export const FullFileToggle: React.FC<FullFileToggleProps> = ({ state, expanded, onToggle }) => {
  const loading = state === 'loading';
  const unavailable = state === 'unavailable';
  const disabled = loading || unavailable;
  const title = loading
    ? 'Loading complete file context…'
    : unavailable
      ? 'Complete file context is unavailable for this diff snapshot'
      : expanded
        ? 'Collapse unchanged regions and show diff hunks only'
        : 'Expand all unchanged regions and show the complete file';

  return (
    <button
      type="button"
      data-full-file-toggle
      disabled={disabled}
      aria-pressed={state === 'ready' ? expanded : undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onToggle();
      }}
      className="flex h-6 flex-none items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      title={title}
    >
      {loading ? (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          {expanded ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="m7 14 5-5 5 5M4 19h16" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M7 10l5 5 5-5M4 19h16" />
          )}
        </svg>
      )}
      <span className="hidden min-[560px]:inline">
        {loading ? 'Loading file' : expanded ? 'Diff only' : 'Full file'}
      </span>
    </button>
  );
};
