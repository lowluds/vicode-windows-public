import type { ReactElement } from 'react';
import { CloseIcon, TaskIcon } from './icons';
import {
  ActionButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui';

function ComposerTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="composer-tooltip">{label}</TooltipContent>
    </Tooltip>
  );
}

interface ComposerPlanModePillProps {
  toggleComposerMode: () => void;
}

export function ComposerPlanModePill({ toggleComposerMode }: ComposerPlanModePillProps) {
  return (
    <ComposerTooltip label="Toggle Plan mode (Shift+Tab)">
      <ActionButton
        size="compact"
        className="composer-plan-pill is-active h-9 px-3"
        data-testid="composer-plan-mode-pill"
        onClick={toggleComposerMode}
        leadingIcon={
          <span className="composer-plan-pill-icon relative inline-flex size-4 items-center justify-center" aria-hidden="true">
            <span className="composer-plan-pill-icon-default inline-flex items-center justify-center">
              <TaskIcon size={13} />
            </span>
            <span className="composer-plan-pill-icon-dismiss absolute inset-0 inline-flex items-center justify-center opacity-0">
              <CloseIcon size={13} />
            </span>
          </span>
        }
      >
        <span className="composer-plan-pill-text">Plan</span>
      </ActionButton>
    </ComposerTooltip>
  );
}
