"use client";

import type { ComponentProps, ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, CloseIcon, CodeIcon, RefreshIcon, TaskIcon } from '../icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, StatusPill } from '../ui';
import { cx } from '../ui/utils';

export type ToolState =
  | 'approval-requested'
  | 'approval-responded'
  | 'input-available'
  | 'input-streaming'
  | 'output-available'
  | 'output-denied'
  | 'output-error';

export type ToolProps = ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <Collapsible
      className={cx(
        'group w-full rounded-[20px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)]',
        className
      )}
      {...props}
    />
  );
}

function toolStateLabel(state: ToolState) {
  switch (state) {
    case 'approval-requested':
      return 'Awaiting Approval';
    case 'approval-responded':
      return 'Responded';
    case 'input-available':
      return 'Running';
    case 'input-streaming':
      return 'Pending';
    case 'output-available':
      return 'Completed';
    case 'output-denied':
      return 'Denied';
    case 'output-error':
      return 'Error';
    default:
      return 'Pending';
  }
}

function toolStateTone(state: ToolState) {
  switch (state) {
    case 'approval-requested':
      return 'default';
    case 'approval-responded':
      return 'checking';
    case 'output-available':
      return 'connected';
    case 'output-denied':
    case 'output-error':
      return 'failed';
    default:
      return 'default';
  }
}

function toolStateIcon(state: ToolState): ReactNode {
  switch (state) {
    case 'approval-requested':
      return <TaskIcon size={14} />;
    case 'approval-responded':
    case 'output-available':
      return <CheckIcon size={14} />;
    case 'output-denied':
    case 'output-error':
      return <CloseIcon size={14} />;
    case 'input-available':
    case 'input-streaming':
    default:
      return <RefreshIcon size={14} />;
  }
}

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, 'children'> & {
  title: string;
  state: ToolState;
};

export function ToolHeader({ className, title, state, ...props }: ToolHeaderProps) {
  return (
    <CollapsibleTrigger
      className={cx(
        'flex w-full items-center justify-between gap-4 px-4 py-3 text-left',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]">
          <CodeIcon size={14} />
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold text-[color:var(--ui-text-title)]">
          {title}
        </span>
        <StatusPill tone={toolStateTone(state)}>
          <span className="inline-flex items-center gap-1.5">
            {toolStateIcon(state)}
            <span>{toolStateLabel(state)}</span>
          </span>
        </StatusPill>
      </div>
      <ChevronDownIcon className="shrink-0 text-[color:var(--ui-text-subtle)] transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, children, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cx(
        'overflow-hidden border-t border-[color:var(--ui-border-soft)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
        className
      )}
      {...props}
    >
      <div className="space-y-4 px-4 py-4">{children}</div>
    </CollapsibleContent>
  );
}

export type ToolSectionProps = ComponentProps<'section'> & {
  title: string;
};

export function ToolSection({ className, title, children, ...props }: ToolSectionProps) {
  return (
    <section
      className={cx(
        'rounded-[16px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] px-4 py-3',
        className
      )}
      {...props}
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
        {title}
      </div>
      {children}
    </section>
  );
}
