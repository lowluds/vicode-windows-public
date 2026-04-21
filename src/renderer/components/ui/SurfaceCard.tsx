import type { HTMLAttributes } from 'react';
import { cx } from './utils';

export function SurfaceCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cx(
        'ui-surface-card flex flex-col gap-3 rounded-[var(--ui-radius-xl)] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] p-5 text-[color:var(--ui-text-title)] shadow-[var(--ui-shadow-card)]',
        className
      )}
      {...props}
    />
  );
}
