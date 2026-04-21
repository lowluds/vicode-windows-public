import type { AppUpdateState } from '../../shared/domain';
import { deriveTitleBarUpdateActionState } from '../lib/app-update';
import { DownloadIcon, LoadingIcon } from './icons';
import { IconButton, Tooltip, TooltipContent, TooltipTrigger } from './ui';
import { cx } from './ui/utils';

interface TitleBarUpdateActionProps {
  appUpdateState: AppUpdateState | null;
  hasActiveRun: boolean;
  queuedUpdateInstallKey: string | null;
  onPress: () => void;
}

export function TitleBarUpdateAction({
  appUpdateState,
  hasActiveRun,
  queuedUpdateInstallKey,
  onPress
}: TitleBarUpdateActionProps) {
  const action = deriveTitleBarUpdateActionState({
    appUpdateState,
    hasActiveRun,
    queuedUpdateInstallKey
  });

  if (!action) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          data-testid="nav-update"
          className={cx(
            'windows-titlebar-action windows-titlebar-update-action',
            (action.variant === 'available' || action.variant === 'downloading') && 'is-progress',
            (action.variant === 'downloaded' || action.variant === 'queued') && 'is-ready'
          )}
          label={action.label}
          onClick={onPress}
          aria-busy={action.variant === 'available' || action.variant === 'downloading' ? true : undefined}
        >
          {action.variant === 'available' || action.variant === 'downloading' ? <LoadingIcon /> : <DownloadIcon />}
        </IconButton>
      </TooltipTrigger>
      <TooltipContent className="windows-titlebar-tooltip">{action.tooltip}</TooltipContent>
    </Tooltip>
  );
}
