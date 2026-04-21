"use client";

import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { ActionButton } from '../ui';
import { cx } from '../ui/utils';

export type SuggestionsProps = HTMLAttributes<HTMLDivElement>;

export function Suggestions({ className, children, ...props }: SuggestionsProps) {
  return (
    <div className="w-full overflow-x-auto" {...props}>
      <div className={cx('flex w-max min-w-full flex-nowrap items-center gap-2 pb-1', className)}>
        {children}
      </div>
    </div>
  );
}

export type SuggestionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export function Suggestion({
  suggestion,
  onClick,
  className,
  children,
  ...props
}: SuggestionProps) {
  return (
    <ActionButton
      tone="quiet"
      size="compact"
      className={cx(
        'cursor-pointer rounded-full border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] px-4 text-[12px] text-[color:var(--ui-text)] hover:bg-[color:var(--ui-alpha-06)]',
        className
      )}
      onClick={() => onClick?.(suggestion)}
      {...props}
    >
      {children ?? suggestion}
    </ActionButton>
  );
}
