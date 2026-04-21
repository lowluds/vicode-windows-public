import { IconButton, InlineActionButton } from './ui';
import { CloseIcon } from './icons';
import { cx } from './ui/utils';

export interface InlineNoticeAction {
  label: string;
  tone?: 'primary' | 'quiet';
  onAction: () => void;
}

interface InlineNoticeProps {
  level: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  actions?: InlineNoticeAction[];
  onDismiss: () => void;
}

export function InlineNotice({ actions, level, message, onDismiss, title }: InlineNoticeProps) {
  return (
    <div
      data-testid="app-inline-notice"
      data-level={level}
      role={level === 'error' ? 'alert' : 'status'}
      className="mx-7 mt-2 rounded-[16px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-3 py-2"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4">
            {title ? <span className="shrink-0 font-medium text-[color:var(--ui-text-title)]">{title}</span> : null}
            <span className="text-[color:var(--ui-text-muted)]">{message}</span>
            {actions && actions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {actions.map((action) => (
                  <InlineActionButton
                    key={action.label}
                    className={cx(
                      'text-[11px] font-medium no-underline hover:text-[color:var(--ui-text-title)] focus-visible:text-[color:var(--ui-text-title)] focus-visible:underline',
                      action.tone === 'primary'
                        ? 'text-[color:var(--ui-text-title)]'
                        : 'text-[color:var(--ui-text-subtle)]'
                    )}
                    onClick={action.onAction}
                  >
                    {action.label}
                  </InlineActionButton>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <IconButton
          className="mt-[-1px] size-6 rounded-[10px]"
          label="Dismiss notice"
          size="compact"
          onClick={onDismiss}
        >
          <CloseIcon size={12} />
        </IconButton>
      </div>
    </div>
  );
}
