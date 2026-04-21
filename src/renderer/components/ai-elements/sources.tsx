"use client";

import type { AnchorHTMLAttributes, ComponentProps, HTMLAttributes, MouseEvent } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
import { ChevronDownIcon, GlobeIcon } from '../icons';
import { cx } from '../ui/utils';

export function Sources({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cx('flex flex-col gap-2', className)} {...props} />;
}

export function SourcesTrigger({
  className,
  count,
  ...props
}: Omit<ComponentProps<typeof CollapsibleTrigger>, 'children'> & { count: number }) {
  return (
    <CollapsibleTrigger
      className={cx(
        'group inline-flex w-fit items-center gap-2 rounded-[14px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-input-bg)] px-3.5 py-2 text-[12px] font-medium text-[color:var(--ui-text-muted)] shadow-[var(--ui-field-shadow)] transition-[background-color,color,transform] hover:bg-[color:var(--ui-input-bg-focus)] hover:text-[color:var(--ui-text-title)] focus-visible:border-[color:var(--ui-border-soft)] focus-visible:bg-[color:var(--ui-input-bg-focus)] focus-visible:text-[color:var(--ui-text-title)] focus-visible:outline-none data-[state=open]:bg-[color:var(--ui-input-bg-focus)] data-[state=open]:text-[color:var(--ui-text-title)]',
        className
      )}
      {...props}
    >
      <span>{`Used ${count} source${count === 1 ? '' : 's'}`}</span>
      <span className="transition-transform group-data-[state=open]:rotate-180" aria-hidden="true">
        <ChevronDownIcon size={13} />
      </span>
    </CollapsibleTrigger>
  );
}

export function SourcesContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <CollapsibleContent>
      <div
        className={cx(
          'flex flex-col gap-2 rounded-[18px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-menu-bg)] p-2 shadow-[var(--ui-shadow-menu)] backdrop-blur-[10px]',
          className
        )}
        {...props}
      />
    </CollapsibleContent>
  );
}

export interface SourceProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'title'> {
  title: string;
  snippet?: string | null;
  excerpt?: string | null;
}

export function Source({ className, excerpt, href, onClick, snippet, title, ...props }: SourceProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !href) {
      return;
    }

    if (typeof window !== 'undefined' && window.vicode?.app?.openExternal) {
      event.preventDefault();
      void window.vicode.app.openExternal(href);
    }
  }

  return (
    <a
      className={cx(
        'group flex flex-col gap-1.5 rounded-[14px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface)] px-3 py-2.5 transition-colors hover:bg-[color:var(--ui-input-bg-focus)] focus-visible:border-[color:var(--ui-border-soft)] focus-visible:bg-[color:var(--ui-input-bg-focus)] focus-visible:outline-none',
        className
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      onClick={handleClick}
      {...props}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--ui-text-title)]">
        <GlobeIcon size={13} />
        <span className="truncate">{title}</span>
      </span>
      {snippet ? <span className="text-[12px] leading-5 text-[color:var(--ui-text)]">{snippet}</span> : null}
      {excerpt ? <span className="text-[12px] leading-5 text-[color:var(--ui-text-muted)]">{excerpt}</span> : null}
      {href ? (
        <span className="truncate text-[11px] text-[color:var(--ui-text-subtle)] group-hover:text-[color:var(--ui-text-muted)]">
          {href}
        </span>
      ) : null}
    </a>
  );
}
