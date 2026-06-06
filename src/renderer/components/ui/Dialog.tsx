import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { ActionButton, DangerButton, PrimaryButton } from './Button';
import { cx } from './utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

interface ModalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function ModalDialog({ open, onOpenChange, title, description, children, actions, className }: ModalDialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay fixed inset-0 z-50" />
        <div className="ui-dialog-positioner">
          <RadixDialog.Content
            className={cx(
              'ui-dialog-content relative z-50 flex max-h-[calc(100dvh-32px)] w-[min(640px,calc(100vw-32px))] flex-col gap-4 overflow-x-hidden overflow-y-auto rounded-[var(--ui-radius-lg)] border border-[color:var(--ui-border)] bg-[color:var(--ui-menu-bg)] p-5 text-[color:var(--ui-text)] shadow-[var(--ui-shadow-apple)] outline-none',
              className
            )}
          >
            {title || description ? (
              <div className="ui-dialog-header flex flex-col gap-2">
                {title ? <RadixDialog.Title className="ui-dialog-title text-[18px] font-semibold text-[color:var(--ui-text-title)]">{title}</RadixDialog.Title> : null}
                {description ? <RadixDialog.Description className="ui-dialog-description text-[14px] text-[color:var(--ui-text-muted)]">{description}</RadixDialog.Description> : null}
              </div>
            ) : null}
            {children}
            {actions ? <div className="ui-dialog-actions flex items-center justify-end gap-3">{actions}</div> : null}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'default',
  onConfirm,
  children
}: ConfirmDialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children ? <RadixDialog.Trigger asChild>{children}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay fixed inset-0 z-50" />
        <div className="ui-dialog-positioner">
          <RadixDialog.Content className="ui-dialog-content relative z-50 flex max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] flex-col gap-4 overflow-x-hidden overflow-y-auto rounded-[var(--ui-radius-lg)] border border-[color:var(--ui-border)] bg-[color:var(--ui-menu-bg)] p-5 text-[color:var(--ui-text)] shadow-[var(--ui-shadow-apple)] outline-none">
            <div className="ui-dialog-header flex flex-col gap-2">
              <RadixDialog.Title className="ui-dialog-title text-[18px] font-semibold text-[color:var(--ui-text-title)]">{title}</RadixDialog.Title>
              <RadixDialog.Description className="ui-dialog-description text-[14px] text-[color:var(--ui-text-muted)]">{description}</RadixDialog.Description>
            </div>
            <div className="ui-dialog-actions flex items-center justify-end gap-3">
              <RadixDialog.Close asChild>
                <ActionButton tone="quiet">Cancel</ActionButton>
              </RadixDialog.Close>
              {tone === 'danger' ? (
                <DangerButton
                  onClick={() => {
                    void onConfirm();
                    onOpenChange(false);
                  }}
                >
                  {confirmLabel}
                </DangerButton>
              ) : (
                <PrimaryButton
                  onClick={() => {
                    void onConfirm();
                    onOpenChange(false);
                  }}
                >
                  {confirmLabel}
                </PrimaryButton>
              )}
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
