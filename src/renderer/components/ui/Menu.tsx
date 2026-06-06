import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './utils';

export const Menu = RadixDropdownMenu.Root;
export const MenuTrigger = RadixDropdownMenu.Trigger;
export const MenuGroup = RadixDropdownMenu.Group;
export const MenuSub = RadixDropdownMenu.Sub;

export function MenuContent({
  className,
  sideOffset = 10,
  align = 'start',
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          sideOffset={sideOffset}
          align={align}
          collisionPadding={12}
          className={cx(
          'ui-menu-content z-[90] min-w-[220px] max-h-[min(var(--radix-dropdown-menu-content-available-height),24rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--ui-radius-lg)] border p-1 text-[color:var(--ui-text)] shadow-[var(--ui-shadow-apple)] border-[color:var(--ui-border)] bg-[color:var(--ui-menu-bg)]',
          className
        )}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

export function MenuSubContent({
  className,
  sideOffset = 8,
  alignOffset = -6,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubContent>) {
  return (
    <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.SubContent
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={12}
          className={cx(
          'ui-menu-content z-[90] min-w-[220px] max-h-[min(var(--radix-dropdown-menu-content-available-height),24rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--ui-radius-lg)] border p-1 text-[color:var(--ui-text)] shadow-[var(--ui-shadow-apple)] border-[color:var(--ui-border)] bg-[color:var(--ui-menu-bg)]',
          className
        )}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

export function MenuItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>) {
  return (
    <RadixDropdownMenu.Item
      className={cx(
        'ui-menu-item flex min-h-8 cursor-default items-center gap-2 rounded-[var(--ui-radius-sm)] px-2.5 text-[12.5px] font-medium text-[color:var(--ui-text)] outline-none transition-colors data-[highlighted]:bg-[color:var(--ui-hover)] data-[highlighted]:text-[color:var(--ui-text-title)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </RadixDropdownMenu.Item>
  );
}

export function MenuSubTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubTrigger>) {
  return (
    <RadixDropdownMenu.SubTrigger
      className={cx(
        'ui-menu-item flex min-h-8 cursor-default items-center gap-2 rounded-[var(--ui-radius-sm)] px-2.5 text-[12.5px] font-medium text-[color:var(--ui-text)] outline-none transition-colors data-[highlighted]:bg-[color:var(--ui-hover)] data-[highlighted]:text-[color:var(--ui-text-title)] data-[state=open]:bg-[color:var(--ui-hover)]',
        className
      )}
      {...props}
    >
      {children}
    </RadixDropdownMenu.SubTrigger>
  );
}

export function MenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.CheckboxItem>) {
  return (
    <RadixDropdownMenu.CheckboxItem
      className={cx(
        'ui-menu-item relative flex min-h-8 cursor-default items-center gap-2 rounded-[var(--ui-radius-sm)] px-2.5 pr-8 text-[12.5px] font-medium text-[color:var(--ui-text)] outline-none transition-colors data-[highlighted]:bg-[color:var(--ui-hover)] data-[highlighted]:text-[color:var(--ui-text-title)]',
        className
      )}
      {...props}
    >
      {children}
      <RadixDropdownMenu.ItemIndicator className="ui-menu-indicator absolute right-3 text-[color:var(--ui-text-title)]" />
    </RadixDropdownMenu.CheckboxItem>
  );
}

export function MenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>) {
  return <RadixDropdownMenu.Label className={cx('ui-menu-label px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ui-text-subtle)]', className)} {...props} />;
}

export function MenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>) {
  return <RadixDropdownMenu.Separator className={cx('ui-menu-separator my-1 h-px bg-[color:var(--ui-border-soft)]', className)} {...props} />;
}

export function MenuItemLabel({ children }: { children: ReactNode }) {
  return <span className="ui-menu-item-label flex-1">{children}</span>;
}
