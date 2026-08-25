import React, { useMemo } from 'react';
import type { AvailableBranches } from '@plannotator/shared/types';

interface BranchComparePickerProps {
  availableBranches: AvailableBranches;
  leftBranch: string;
  rightBranch: string;
  onSelectLeft: (branch: string) => void;
  onSelectRight: (branch: string) => void;
  disabled?: boolean;
}

/**
 * The local review has two explicit modes, and branch comparison has two
 * explicit refs. Native selects are intentional here: they remain clickable
 * inside the dock/sidebar even when a portal-based popover is covered by a
 * neighboring panel or shadow-root surface.
 */
export const BranchComparePicker: React.FC<BranchComparePickerProps> = ({
  availableBranches,
  leftBranch,
  rightBranch,
  onSelectLeft,
  onSelectRight,
  disabled = false,
}) => {
  const branches = useMemo(() => {
    const refs = [...availableBranches.local, ...availableBranches.remote];
    if (leftBranch && leftBranch !== 'HEAD') refs.push(leftBranch);
    if (rightBranch && rightBranch !== 'HEAD') refs.push(rightBranch);
    return [...new Set(refs)].sort((a, b) => a.localeCompare(b));
  }, [availableBranches, leftBranch, rightBranch]);

  const select = (label: string, value: string, onChange: (value: string) => void) => (
    <label className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 appearance-auto rounded border border-border/60 bg-muted px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:cursor-wait disabled:opacity-50"
        aria-label={label}
      >
        {branches.length === 0 && <option value={value}>{value || 'No branches'}</option>}
        {branches.map((branch) => (
          <option key={branch} value={branch}>{branch}</option>
        ))}
        {value === 'HEAD' && <option value="HEAD">HEAD (detached)</option>}
      </select>
    </label>
  );

  return (
    <div className="flex min-w-0 gap-2 border-b border-border/30 px-2 py-1.5">
      {select('Branch 1', leftBranch, onSelectLeft)}
      <span className="self-center text-xs text-muted-foreground">↔</span>
      {select('Branch 2', rightBranch, onSelectRight)}
    </div>
  );
};
