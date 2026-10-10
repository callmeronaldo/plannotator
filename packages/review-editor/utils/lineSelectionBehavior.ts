export type LineSelectionSource = 'range-gesture' | 'text-selection' | 'gutter-comment-action';

export type LineSelectionBehavior = 'preserve-selection' | 'open-composer';

interface ResolveLineSelectionBehaviorOptions {
  readonly source: LineSelectionSource;
  readonly compactTouchLayout: boolean;
}

/**
 * Keep mobile range acquisition separate from writing, matching DiffsHub.
 * Native code-text selection always remains copyable. Desktop gutter drags
 * keep their selection-to-composer flow; the gutter comment action is explicit
 * writing intent on every surface.
 */
export function resolveLineSelectionBehavior({
  source,
  compactTouchLayout,
}: ResolveLineSelectionBehaviorOptions): LineSelectionBehavior {
  if (source === 'text-selection' || (compactTouchLayout && source === 'range-gesture')) {
    return 'preserve-selection';
  }
  return 'open-composer';
}
