import type { AppUpdateState, ThreadDetail, ThreadSummary } from '../../shared/domain';
import { isActiveThreadStatus } from './active-run';

export function getDownloadedUpdateKey(state: AppUpdateState | null) {
  if (state?.status !== 'downloaded') {
    return null;
  }
  return state.availableVersion ?? `downloaded:${state.currentVersion}`;
}

export function isQueuedUpdateInstall(
  state: AppUpdateState | null,
  queuedUpdateInstallKey: string | null
) {
  return Boolean(queuedUpdateInstallKey && getDownloadedUpdateKey(state) === queuedUpdateInstallKey);
}

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

export function deriveUpdateInstallActionLabel(input: {
  appUpdateState: AppUpdateState | null;
  hasActiveRun: boolean;
  queuedUpdateInstallKey: string | null;
}) {
  if (isQueuedUpdateInstall(input.appUpdateState, input.queuedUpdateInstallKey)) {
    return 'Update queued';
  }
  if (input.appUpdateState?.status === 'downloaded' && input.hasActiveRun) {
    return 'Install when idle';
  }
  return 'Restart to update';
}

export interface TitleBarUpdateActionState {
  variant: 'available' | 'downloading' | 'downloaded' | 'queued';
  label: string;
  tooltip: string;
}

export function deriveTitleBarUpdateActionState(input: {
  appUpdateState: AppUpdateState | null;
  hasActiveRun: boolean;
  queuedUpdateInstallKey: string | null;
}): TitleBarUpdateActionState | null {
  const state = input.appUpdateState;
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

  const versionLabel = describeVersion(state);
  if (isQueuedUpdateInstall(state, input.queuedUpdateInstallKey)) {
    return {
      variant: 'queued',
      label: 'Update queued',
      tooltip: `${versionLabel} will install when the current run finishes.`
    };
  }

  if (input.hasActiveRun) {
    return {
      variant: 'downloaded',
      label: 'Install update when idle',
      tooltip: `${versionLabel} is ready. Click to install it when the current run finishes.`
    };
  }

  return {
    variant: 'downloaded',
    label: 'Restart to update',
    tooltip: `${versionLabel} is ready. Click to restart and install it.`
  };
}
