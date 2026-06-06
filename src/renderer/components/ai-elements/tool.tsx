"use client";

import type { ComponentProps } from 'react';
import { ChevronDownIcon } from '../icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
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
        'group w-full rounded-[10px] border border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-alpha-025)] shadow-none',
        className
      )}
      {...props}
    />
  );
}

function toolStateLabel(state: ToolState) {
  switch (state) {
    case 'approval-requested':
      return 'Awaiting approval';
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

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, 'children'> & {
  title: string;
  state: ToolState;
};

export function ToolHeader({ className, title, state, ...props }: ToolHeaderProps) {
  return (
    <CollapsibleTrigger
      className={cx(
        'tool-header-trigger flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left',
        className
      )}
      {...props}
    >
      <div className="tool-header-leading flex min-w-0 items-center gap-2">
        <span className="tool-header-title min-w-0 truncate text-[13px] font-medium text-[color:var(--ui-text)]">
          {title}
        </span>
        <span className={cx('tool-header-state', `is-${state}`)}>{toolStateLabel(state)}</span>
      </div>
      <ChevronDownIcon className="tool-header-chevron shrink-0 text-[color:var(--ui-text-subtle)] transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, children, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cx(
        'overflow-hidden border-t border-[color:var(--ui-alpha-06)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
        className
      )}
      {...props}
    >
      <div className="space-y-2 px-3 py-3">{children}</div>
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
        'rounded-[10px] border border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-alpha-03)] px-3 py-2.5',
        className
      )}
      {...props}
    >
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
        {title}
      </div>
      {children}
    </section>
  );
}
