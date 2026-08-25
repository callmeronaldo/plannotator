import { useEffect, useState } from 'react';
import type {
  SemanticDiffBinaryChange,
  SemanticDiffChange,
  SemanticDiffResponse,
} from '@plannotator/shared/semantic-diff-types';
import { isOrphanChange } from '../dock/panels/semanticDiffShared';

/**
 * Single shared fetch of the semantic diff, cached by the active patch so every
 * file-header badge reuses one request (sem already caches per-patch server-side).
 *
 * Failures are retried with backoff and never memoized — in PR mode the server
 * parks this request while the checkout warms up (a clone that can take
 * minutes), and a connection killed mid-wait must not pin every badge to empty
 * for the rest of the session.
 */
let cacheKey: string | null = null;
let cachePromise: Promise<SemanticDiffResponse> | null = null;

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
// After the in-flight retries are exhausted, the failure stays memoized for
// this long before a fresh attempt is allowed. Badges mount/unmount on every
// scroll in the virtualized all-files view — clearing the cache immediately
// on failure turned scrolling into a refetch (and server-side sem re-run)
// stampede whenever sem was erroring.
const FAILURE_RETRY_COOLDOWN_MS = 60_000;

async function fetchSemanticDiff(): Promise<SemanticDiffResponse> {
  const res = await fetch('/api/semantic-diff');
  if (!res.ok) throw new Error('Semantic diff failed');
  return res.json() as Promise<SemanticDiffResponse>;
}

function loadSemanticDiff(rawPatch: string): Promise<SemanticDiffResponse> {
  if (cacheKey === rawPatch && cachePromise) return cachePromise;
  cacheKey = rawPatch;

  const attempt = async (): Promise<SemanticDiffResponse> => {
    for (let i = 0; ; i++) {
      let result: SemanticDiffResponse;
      try {
        result = await fetchSemanticDiff();
      } catch (error) {
        result = {
          status: 'error',
          reason: 'fetch-failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      // 'unavailable' means sem isn't installed — retrying won't change that.
      if (result.status !== 'error' || i >= RETRY_DELAYS_MS.length) return result;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
      if (cacheKey !== rawPatch) return result; // patch changed mid-retry; let the new fetch win
    }
  };

  const promise = attempt().then((data) => {
    // Logged once per patch (the promise is cached) rather than per badge, so a
    // systemic failure leaves a trace instead of every badge vanishing silently.
    if (data.status !== 'ok') {
      console.error('Failed to load semantic diff for file badges:', data.message ?? data.reason ?? data.status);
    }
    if (data.status === 'error' && cacheKey === rawPatch && cachePromise === promise) {
      setTimeout(() => {
        if (cacheKey === rawPatch && cachePromise === promise) {
          cacheKey = null;
          cachePromise = null;
        }
      }, FAILURE_RETRY_COOLDOWN_MS);
    }
    return data;
  });
  cachePromise = promise;
  return promise;
}

export interface FileSemanticChanges {
  loading: boolean;
  changes: SemanticDiffChange[];
  binaryChanges: SemanticDiffBinaryChange[];
}

// ---- Manual trigger (shared session state) ----
// Semantic analysis never runs when badges mount. It starts only when the user
// explicitly asks: the header run button, a badge hover, or opening the
// semantic panel (which fetches on its own). The first explicit request arms
// every badge for the rest of the session — the module cache below and the
// server's per-patch cache keep later patches cheap.

let analysisRequested = false;
const analysisRequestListeners = new Set<() => void>();

/**
 * Manually start the shared semantic analysis for the current patch.
 * Returns the response (for the caller's pending/count UI) or null when there
 * is no patch to analyze yet.
 */
export function requestSemanticDiffAnalysis(rawPatch: string): Promise<SemanticDiffResponse | null> {
  if (!rawPatch) return Promise.resolve(null);
  analysisRequested = true;
  analysisRequestListeners.forEach((listener) => listener());
  return loadSemanticDiff(rawPatch);
}

/** True once an explicit semantic analysis request has been made this session. */
export function useSemanticDiffAnalysisRequested(): boolean {
  const [requested, setRequested] = useState(analysisRequested);
  useEffect(() => {
    const listener = () => setRequested(analysisRequested);
    analysisRequestListeners.add(listener);
    return () => {
      analysisRequestListeners.delete(listener);
    };
  }, []);
  return requested;
}

const EMPTY: FileSemanticChanges = { loading: false, changes: [], binaryChanges: [] };

/** Named (non-orphan) semantic changes for a single file, or empty when disabled/unavailable. */
export function useFileSemanticChanges(
  filePath: string,
  rawPatch: string,
  enabled: boolean,
): FileSemanticChanges {
  const [state, setState] = useState<FileSemanticChanges>(enabled ? { ...EMPTY, loading: true } : EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));

    loadSemanticDiff(rawPatch).then((data) => {
      if (cancelled) return;
      if (data.status !== 'ok') {
        setState(EMPTY);
        return;
      }
      setState({
        loading: false,
        changes: data.changes.filter((c) => c.filePath === filePath && !isOrphanChange(c)),
        binaryChanges: data.binaryChanges.filter((c) => c.filePath === filePath),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, rawPatch, enabled]);

  return state;
}
