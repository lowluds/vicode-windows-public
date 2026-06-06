import * as RadixPopover from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;

export function PopoverContent({
  className,
  sideOffset = 10,
  align = 'start',
  ...props
}: ComponentPropsWithoutRef<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cx(
          'ui-popover-content z-50 rounded-[var(--ui-radius-lg)] border border-[color:var(--ui-border)] bg-[color:var(--ui-menu-bg)] p-2 text-[color:var(--ui-text)] shadow-[var(--ui-shadow-apple)] outline-none',
          className
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
