"use client";

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { IconButton, Menu, MenuContent } from '../ui';
import { cx } from '../ui/utils';

export type PromptInputProps = ComponentPropsWithoutRef<'footer'>;

export function PromptInput({ children, className, ...props }: PromptInputProps) {
  return (
    <footer
      className={cx(
        'composer-shell flex flex-col gap-3 rounded-[28px] border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-2)] px-4 py-4',
        className
      )}
      {...props}
    >
      {children}
    </footer>
  );
}

export type PromptInputHeaderProps = ComponentPropsWithoutRef<'div'>;

export function PromptInputHeader({ children, className, ...props }: PromptInputHeaderProps) {
  return (
    <div className={cx('prompt-input-header flex flex-col gap-3', className)} {...props}>
      {children}
    </div>
  );
}

export type PromptInputBodyProps = ComponentPropsWithoutRef<'div'>;

export function PromptInputBody({ children, className, ...props }: PromptInputBodyProps) {
  return (
    <div className={cx('prompt-input-body flex flex-col gap-3', className)} {...props}>
      {children}
    </div>
  );
}

export type PromptInputTextareaProps = ComponentPropsWithoutRef<'textarea'>;

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cx(
          'composer-input w-full resize-none bg-transparent text-[color:var(--ui-text-title)] outline-none placeholder:text-[color:var(--ui-text-subtle)]',
          className
        )}
        {...props}
      />
    );
  }
);

export type PromptInputFooterProps = ComponentPropsWithoutRef<'div'>;

export function PromptInputFooter({ children, className, ...props }: PromptInputFooterProps) {
  return (
    <div className={cx('composer-footer flex items-end justify-between gap-4', className)} {...props}>
      {children}
    </div>
  );
}

export type PromptInputToolsProps = ComponentPropsWithoutRef<'div'>;

export function PromptInputTools({ children, className, ...props }: PromptInputToolsProps) {
  return (
    <div className={cx('flex min-w-0 items-center gap-2', className)} {...props}>
      {children}
    </div>
  );
}

export type PromptInputActionMenuProps = ComponentPropsWithoutRef<typeof Menu>;

export function PromptInputActionMenu(props: PromptInputActionMenuProps) {
  return <Menu {...props} />;
}

export type PromptInputActionMenuTriggerProps = ComponentPropsWithoutRef<typeof IconButton>;

export function PromptInputActionMenuTrigger({
  children,
  className,
  label,
  ...props
}: PromptInputActionMenuTriggerProps) {
  return (
    <IconButton
      className={cx('composer-icon-button', className)}
      label={label}
      {...props}
    >
      {children}
    </IconButton>
  );
}

export type PromptInputActionMenuContentProps = ComponentPropsWithoutRef<typeof MenuContent>;

export function PromptInputActionMenuContent({
  children,
  className,
  ...props
}: PromptInputActionMenuContentProps) {
  return (
    <MenuContent className={cx('composer-menu composer-attach-menu', className)} {...props}>
      {children}
    </MenuContent>
  );
}

export type PromptInputSubmitProps = ComponentPropsWithoutRef<typeof IconButton>;

export function PromptInputSubmit({
  children,
  className,
  label,
  ...props
}: PromptInputSubmitProps) {
  return (
    <IconButton
      className={cx('composer-send-button', className)}
      label={label}
      {...props}
    >
      {children}
    </IconButton>
  );
}
