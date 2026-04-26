import type { AppUpdateState, ThreadDetail, ThreadSummary } from '../../shared/domain';
import { isActiveThreadStatus } from './active-run';

export function hasAnyActiveThreadRun(input: {
  activeThread: Pick<ThreadDetail, 'status'> | null;
  threadsByProject: Record<string, Array<Pick<ThreadSummary, 'status'>>>;
}) {
  if (input.activeThread && isActiveThreadStatus(input.activeThread.status)) {
    return true;
  }

  return Object.values(input.threadsByProject).some((threads) =>
    threads.some((thread) => isActiveThreadStatus(thread.status))
  );
}

function describeVersion(state: AppUpdateState) {
  return state.availableVersion ? `Version ${state.availableVersion}` : 'The downloaded update';
}

export function deriveUpdateInstallActionLabel() {
  return 'Restart to update';
}

export interface TitleBarUpdateActionState {
  variant: 'available' | 'downloading' | 'downloaded';
  label: string;
  tooltip: string;
}

export function deriveTitleBarUpdateActionState(appUpdateState: AppUpdateState | null): TitleBarUpdateActionState | null {
  const state = appUpdateState;
  if (!state) {
    return null;
  }

  if (state.status === 'available') {
    return {
      variant: 'available',
      label: 'Update downloading',
      tooltip: state.availableVersion
        ? `Version ${state.availableVersion} is downloading in the background.`
        : 'A desktop update is downloading in the background.'
    };
  }

  if (state.status === 'downloading') {
    const progress = state.downloadPercent !== null ? `${Math.round(state.downloadPercent)}%` : 'in progress';
    return {
      variant: 'downloading',
      label: 'Update downloading',
      tooltip: state.availableVersion
        ? `Downloading version ${state.availableVersion} (${progress}).`
        : `Downloading the latest desktop update (${progress}).`
    };
  }

  if (state.status !== 'downloaded') {
    return null;
  }

  return {
    variant: 'downloaded',
    label: 'Restart to update',
    tooltip: `${describeVersion(state)} is ready. Click to restart and install it now.`
  };
}
