"use client";

import type { ButtonHTMLAttributes, ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { ActionButton, PrimaryButton } from '../ui';
import { cx } from '../ui/utils';
import type { ToolState } from './tool';

type Approval =
  | {
      id: string;
      approved?: boolean;
      reason?: string;
    }
  | undefined;

interface ConfirmationContextValue {
  approval: Approval;
  state: ToolState;
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

function useConfirmation() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation');
  }
  return context;
}

export type ConfirmationProps = HTMLAttributes<HTMLDivElement> & {
  approval?: Approval;
  state: ToolState;
};

export function Confirmation({ className, approval, state, ...props }: ConfirmationProps) {
  const value = useMemo(() => ({ approval, state }), [approval, state]);

  if (!approval || state === 'input-streaming' || state === 'input-available') {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={value}>
      <div
        className={cx(
          'flex flex-col gap-2 rounded-[18px] border border-[color:var(--ui-warning-border)] bg-[color:var(--ui-warning-soft)]/40 px-4 py-4',
          className
        )}
        {...props}
      />
    </ConfirmationContext.Provider>
  );
}

export type ConfirmationTitleProps = ComponentProps<'div'>;

export function ConfirmationTitle({ className, ...props }: ConfirmationTitleProps) {
  return (
    <div
      className={cx('text-[13px] font-semibold text-[color:var(--ui-text-title)]', className)}
      {...props}
    />
  );
}

export type ConfirmationRequestProps = {
  children?: ReactNode;
};

export function ConfirmationRequest({ children }: ConfirmationRequestProps) {
  const { state } = useConfirmation();
  if (state !== 'approval-requested') {
    return null;
  }
  return children;
}

export type ConfirmationAcceptedProps = {
  children?: ReactNode;
};

export function ConfirmationAccepted({ children }: ConfirmationAcceptedProps) {
  const { approval, state } = useConfirmation();
  if (
    !approval?.approved ||
    (state !== 'approval-responded' &&
      state !== 'output-denied' &&
      state !== 'output-available')
  ) {
    return null;
  }
  return children;
}

export type ConfirmationRejectedProps = {
  children?: ReactNode;
};

export function ConfirmationRejected({ children }: ConfirmationRejectedProps) {
  const { approval, state } = useConfirmation();
  if (
    approval?.approved !== false ||
    (state !== 'approval-responded' &&
      state !== 'output-denied' &&
      state !== 'output-available')
  ) {
    return null;
  }
  return children;
}

export type ConfirmationActionsProps = HTMLAttributes<HTMLDivElement>;

export function ConfirmationActions({ className, ...props }: ConfirmationActionsProps) {
  const { state } = useConfirmation();
  if (state !== 'approval-requested') {
    return null;
  }
  return (
    <div
      className={cx('flex items-center justify-end gap-2 self-end', className)}
      {...props}
    />
  );
}

export type ConfirmationActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  emphasis?: 'primary' | 'quiet' | 'danger';
  leadingIcon?: ReactNode;
};

export function ConfirmationAction({
  emphasis = 'quiet',
  className,
  children,
  leadingIcon,
  ...props
}: ConfirmationActionProps) {
  if (emphasis === 'primary') {
    return (
      <PrimaryButton
        size="compact"
        className={className}
        leadingIcon={leadingIcon}
        {...props}
      >
        {children}
      </PrimaryButton>
    );
  }

  return (
    <ActionButton
      size="compact"
      tone={emphasis === 'danger' ? 'danger' : 'quiet'}
      className={className}
      leadingIcon={leadingIcon}
      {...props}
    >
      {children}
    </ActionButton>
  );
}
