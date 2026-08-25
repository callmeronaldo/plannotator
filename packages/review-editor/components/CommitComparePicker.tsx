import React, { useMemo } from 'react';
import type { RecentCommit } from '@plannotator/shared/types';

interface CommitComparePickerProps {
  commits: RecentCommit[];
  leftCommit: string;
  rightCommit: string;
  onSelectLeft: (sha: string) => void;
  onSelectRight: (sha: string) => void;
  disabled?: boolean;
}

/**
 * Two immutable refs for `git diff Commit1..Commit2`. Native selects mirror
 * BranchComparePicker and remain reliable inside dock/shadow-root layouts.
 */
export const CommitComparePicker: React.FC<CommitComparePickerProps> = ({
  commits,
  leftCommit,
  rightCommit,
  onSelectLeft,
  onSelectRight,
  disabled = false,
}) => {
  const options = useMemo(() => {
    const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
    for (const sha of [leftCommit, rightCommit]) {
      if (sha && !bySha.has(sha)) {
        bySha.set(sha, {
          sha,
          shortSha: sha.slice(0, 7),
          subject: 'Selected commit',
          relativeDate: '',
          author: '',
        });
      }
    }
    return [...bySha.values()];
  }, [commits, leftCommit, rightCommit]);

  const select = (label: string, value: string, onChange: (sha: string) => void) => (
    <label className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 appearance-auto rounded border border-border/60 bg-muted px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:cursor-wait disabled:opacity-50"
        aria-label={label}
      >
        {options.map((commit) => (
          <option key={commit.sha} value={commit.sha}>
            {commit.shortSha} · {commit.subject}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex min-w-0 gap-2 border-b border-border/30 px-2 py-1.5">
      {select('Commit 1', leftCommit, onSelectLeft)}
      <span className="self-center text-xs text-muted-foreground">↔</span>
      {select('Commit 2', rightCommit, onSelectRight)}
    </div>
  );
};
