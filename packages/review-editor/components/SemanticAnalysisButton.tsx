import React, { useState } from 'react';
import { requestSemanticDiffAnalysis, useSemanticDiffAnalysisRequested } from '../hooks/useFileSemanticChanges';

/**
 * Header button that manually triggers the semantic analysis for the current
 * patch. Until it (or a badge hover, or the semantic panel) fires, sem never
 * runs — a review session pays zero analysis cost until someone asks for it.
 *
 * States: idle ∆ → running (pulsing dot) → done (count bubble, click re-runs —
 * cheap while the patch is unchanged thanks to the shared per-patch caches) /
 * error (warning dot, click retries).
 */
export const SemanticAnalysisButton: React.FC<{ rawPatch: string }> = ({ rawPatch }) => {
  const requested = useSemanticDiffAnalysisRequested();
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (!rawPatch || running) return;
    setRunning(true);
    setError(null);
    requestSemanticDiffAnalysis(rawPatch)
      .then((data) => {
        if (!data) return;
        if (data.status === 'ok') {
          setTotal(data.changes.length + data.binaryChanges.length);
        } else if (data.status === 'error') {
          setError(data.message ?? 'Semantic analysis failed');
        } else {
          // 'unavailable' — sem missing or the view doesn't support it; the
          // sidebar row and badges already reflect that. Keep the button quiet.
          setTotal(null);
        }
      })
      .finally(() => setRunning(false));
  };

  const title = running
    ? 'Analyzing semantic changes…'
    : error
      ? `${error} — click to retry`
      : total !== null
        ? `${total} semantic change${total === 1 ? '' : 's'} — click to re-run`
        : 'Run semantic analysis (runs only when clicked)';

  return (
    <button
      onClick={run}
      disabled={!rawPatch || running}
      className={`relative p-1.5 rounded-md transition-all ${
        requested
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
      title={title}
      aria-label={title}
    >
      <span className="font-mono text-sm leading-none" aria-hidden="true">∆</span>
      {running && (
        <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
      )}
      {!running && error && (
        <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-warning" />
      )}
      {!running && !error && total !== null && total > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground px-0.5">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  );
};
