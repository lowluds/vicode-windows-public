import type { ReactNode } from 'react';
import { cx } from './utils';

function toneClass(tone: string) {
  switch (tone) {
    case 'connected':
    case 'success':
      return 'border-[color:var(--ui-success-border)] bg-[color:var(--ui-success-soft)] text-[color:var(--ui-success-text)]';
    case 'failed':
    case 'danger':
      return 'border-[color:var(--ui-danger-border)] bg-[color:var(--ui-danger-soft)] text-[color:var(--ui-danger-text)]';
    case 'checking':
    case 'warning':
      return 'border-[color:var(--ui-warning-border)] bg-[color:var(--ui-warning-soft)] text-[color:var(--ui-warning-text)]';
    default:
      return 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-hover)] text-[color:var(--ui-text-muted)]';
  }
}

export function StatusPill({ className, tone, children }: { className?: string; tone: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'ui-status-pill inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] shadow-[inset_0_1px_0_var(--ui-alpha-04)]',
        `ui-status-${tone}`,
        toneClass(tone),
        className
      )}
    >
      {children}
    </span>
  );
}
