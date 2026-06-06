import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './utils';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={250}>{children}</RadixTooltip.Provider>;
}

export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
      className={cx(
        'ui-tooltip-content z-[100] rounded-[var(--ui-radius-sm)] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-menu-bg)] px-2.5 py-1.5 text-[12px] font-medium text-[color:var(--ui-text-title)] shadow-[var(--ui-shadow-apple)]',
        className
      )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
