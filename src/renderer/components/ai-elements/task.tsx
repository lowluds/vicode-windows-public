"use client";

import type { ComponentProps } from 'react';
import { ChevronDownIcon, TaskIcon } from '../icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
import { cx } from '../ui/utils';

export type TaskItemFileProps = ComponentProps<'div'>;

export function TaskItemFile({ children, className, ...props }: TaskItemFileProps) {
  return (
    <div
      className={cx(
        'inline-flex items-center gap-1 rounded-full border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ui-text)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type TaskItemProps = ComponentProps<'div'>;

export function TaskItem({ children, className, ...props }: TaskItemProps) {
  return (
    <div className={cx('text-[13px] text-[color:var(--ui-text)]', className)} {...props}>
      {children}
    </div>
  );
}

export type TaskProps = ComponentProps<typeof Collapsible>;

export function Task({ defaultOpen = true, className, ...props }: TaskProps) {
  return <Collapsible className={cx('w-full', className)} defaultOpen={defaultOpen} {...props} />;
}

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export function TaskTrigger({ children, className, title, ...props }: TaskTriggerProps) {
  return (
    <CollapsibleTrigger asChild className={cx('group', className)} {...props}>
      {children ?? (
        <div className="flex w-full cursor-pointer items-center gap-2 text-[13px] text-[color:var(--ui-text-muted)] transition-colors hover:text-[color:var(--ui-text-title)]">
          <TaskIcon size={14} />
          <p className="text-[13px]">{title}</p>
          <ChevronDownIcon className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
        </div>
      )}
    </CollapsibleTrigger>
  );
}

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export function TaskContent({ children, className, ...props }: TaskContentProps) {
  return (
    <CollapsibleContent
      className={cx(
        'overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
        className
      )}
      {...props}
    >
      <div className="mt-4 space-y-2 border-l border-[color:var(--ui-border-soft)] pl-4">{children}</div>
    </CollapsibleContent>
  );
}
