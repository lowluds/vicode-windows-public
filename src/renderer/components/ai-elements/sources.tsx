"use client";

import type { AnchorHTMLAttributes, ComponentProps, HTMLAttributes, MouseEvent } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
import { ChevronDownIcon } from '../icons';
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
        'ai-sources-trigger group inline-flex w-fit items-center gap-1.5 rounded-[var(--ui-radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-[12px] font-medium text-[color:var(--ui-text-muted)] shadow-none transition-colors hover:bg-[color:var(--ui-alpha-04)] hover:text-[color:var(--ui-text)] focus-visible:border-[color:var(--ui-border-soft)] focus-visible:bg-[color:var(--ui-alpha-04)] focus-visible:text-[color:var(--ui-text)] focus-visible:outline-none data-[state=open]:bg-[color:var(--ui-alpha-04)] data-[state=open]:text-[color:var(--ui-text)]',
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
          'ai-sources-content flex flex-col gap-1.5 rounded-[var(--ui-radius-md)] border border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-alpha-025)] p-1.5 shadow-none',
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
        'ai-source-row group flex flex-col gap-1 rounded-[var(--ui-radius-sm)] border border-transparent bg-transparent px-2.5 py-2 transition-colors hover:bg-[color:var(--ui-alpha-04)] focus-visible:border-[color:var(--ui-border-soft)] focus-visible:bg-[color:var(--ui-alpha-04)] focus-visible:outline-none',
        className
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      onClick={handleClick}
      {...props}
    >
      <span className="flex items-center gap-2 text-[12.5px] font-medium text-[color:var(--ui-text)]">
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
