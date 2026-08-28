import { describe, expect, test } from 'bun:test';
import {
  getReviewDiffPanelFilePath,
  isReviewDiffPanelId,
  makeSplitDiffPanelId,
  REVIEW_DIFF_PANEL_ID,
} from './reviewPanelTypes';

describe('review diff panel ids', () => {
  test('recognizes primary and side-by-side diff panels without confusing other panels', () => {
    const sidePanelId = makeSplitDiffPanelId('src/other-file.ts');

    expect(isReviewDiffPanelId(REVIEW_DIFF_PANEL_ID)).toBe(true);
    expect(isReviewDiffPanelId(sidePanelId)).toBe(true);
    expect(isReviewDiffPanelId('review-agent-job:123')).toBe(false);
    expect(getReviewDiffPanelFilePath({ filePath: 'src/other-file.ts' })).toBe('src/other-file.ts');
  });
});
