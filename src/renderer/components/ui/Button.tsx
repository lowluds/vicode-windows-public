import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './utils';

type ButtonTone = 'default' | 'quiet' | 'danger';
type ButtonSize = 'default' | 'compact';
type DisclosureAlign = 'start' | 'between';

interface SharedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

interface ActionButtonProps extends SharedButtonProps {
  tone?: ButtonTone;
  size?: ButtonSize;
}

interface InlineActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

interface DisclosureButtonProps extends SharedButtonProps {
  align?: DisclosureAlign;
}

interface SelectableRowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

interface SelectableSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onKeyDown' | 'role' | 'tabIndex'> {
  disabled?: boolean;
  selected?: boolean;
  onPress?: () => void;
}

function ControlButton({
  children,
  className,
  leadingIcon,
  trailingIcon,
  type = 'button',
  ...props
}: SharedButtonProps & { className: string }) {
  return (
    <button type={type} className={className} {...props}>
      {leadingIcon ? <span className="ui-control-icon flex size-4 shrink-0 items-center justify-center">{leadingIcon}</span> : null}
      <span className="ui-control-label min-w-0 flex-1 truncate">{children}</span>
      {trailingIcon ? <span className="ui-control-icon flex size-4 shrink-0 items-center justify-center">{trailingIcon}</span> : null}
    </button>
  );
}

function controlToneClass(tone: ButtonTone) {
  switch (tone) {
    case 'quiet':
      return 'border-transparent bg-transparent text-[color:var(--ui-text-muted)] hover:bg-[color:var(--ui-hover)] hover:text-[color:var(--ui-text-title)]';
    case 'danger':
      return 'border-[color:var(--ui-danger-border)] bg-[color:var(--ui-danger-soft)] text-[color:var(--ui-danger-text)] hover:border-[color:var(--ui-danger-border)] hover:bg-[color:var(--ui-danger-soft-strong)] hover:text-[color:var(--ui-danger-text-strong)]';
    default:
      return 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-title)] hover:bg-[color:var(--ui-surface-3)] hover:border-[color:var(--ui-border-strong)] hover:text-[color:var(--ui-text-title)]';
  }
}

function controlSizeClass(size: ButtonSize) {
  return size === 'compact' ? 'h-[30px] px-2.5 text-[12px]' : 'h-[36px] px-3 text-[13px]';
}

export function NavButton({ className, ...props }: SharedButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-control-nav inline-flex w-full items-center justify-start gap-2 rounded-[var(--ui-radius-md)] border border-transparent bg-transparent px-3 text-[14px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        'text-[color:var(--ui-text-muted)] hover:bg-[color:var(--ui-hover)] hover:text-[color:var(--ui-text-title)]',
        className
      )}
      {...props}
    />
  );
}

export function ActionButton({
  className,
  tone = 'default',
  size = 'default',
  ...props
}: ActionButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-control-action inline-flex items-center justify-center gap-2 rounded-[var(--ui-radius-md)] border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        controlToneClass(tone),
        controlSizeClass(size),
        className
      )}
      {...props}
    />
  );
}

export function InlineActionButton({ className, type = 'button', ...props }: InlineActionButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ui-inline-action border-0 bg-transparent p-0 font-inherit text-inherit underline underline-offset-4 transition-colors disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function DisclosureButton({
  className,
  align = 'between',
  ...props
}: DisclosureButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-control-disclosure inline-flex h-auto w-full max-w-full items-center gap-2 rounded-none border-0 bg-transparent px-0 py-0 text-left text-[color:var(--ui-text)] transition-colors disabled:pointer-events-none disabled:opacity-50',
        align === 'between' ? 'justify-between' : 'justify-start',
        'hover:bg-transparent hover:text-[color:var(--ui-text-title)]',
        className
      )}
      {...props}
    />
  );
}

export const SelectableRowButton = forwardRef<HTMLButtonElement, SelectableRowButtonProps>(function SelectableRowButton(
  {
    className,
    selected = false,
    type = 'button',
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'ui-selectable-row inline-flex w-full items-center gap-3 rounded-[18px] border text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-06)] text-[color:var(--ui-text-title)]'
          : 'border-transparent bg-transparent text-[color:var(--ui-text-title)] hover:bg-[color:var(--ui-alpha-04)]',
        className
      )}
      {...props}
    />
  );
});

export function SelectableSurface({
  className,
  disabled = false,
  selected = false,
  onPress,
  onKeyDown,
  ...props
}: SelectableSurfaceProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPress?.();
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      className={cx('ui-selectable-surface', selected && 'is-selected', disabled && 'is-disabled', className)}
      onClick={disabled ? undefined : () => onPress?.()}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}

export function MenuButton({ className, ...props }: SharedButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-control-menu inline-flex items-center justify-start gap-2 rounded-[var(--ui-radius-md)] border px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-title)] hover:bg-[color:var(--ui-surface-3)] hover:border-[color:var(--ui-border-strong)]',
        className
      )}
      {...props}
    />
  );
}

export function PrimaryButton({ className, size = 'default', ...props }: ActionButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-control-primary inline-flex items-center justify-center gap-2 rounded-[var(--ui-radius-md)] border text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
        controlSizeClass(size),
        className
      )}
      {...props}
    />
  );
}

export function DangerButton({ className, size = 'default', ...props }: ActionButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-control-danger inline-flex items-center justify-center gap-2 rounded-[var(--ui-radius-md)] border text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
        controlSizeClass(size),
        className
      )}
      {...props}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: ButtonTone;
  size?: 'default' | 'compact';
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  children,
  className,
  label,
  tone = 'quiet',
  size = 'default',
  title,
  type = 'button',
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(
        'ui-icon-button inline-flex shrink-0 items-center justify-center rounded-[var(--ui-radius-md)] border transition-colors disabled:pointer-events-none disabled:opacity-50',
        tone === 'danger'
          ? 'border-[color:var(--ui-danger-border)] bg-[color:var(--ui-danger-soft)] text-[color:var(--ui-danger-text)] hover:border-[color:var(--ui-danger-border)] hover:bg-[color:var(--ui-danger-soft-strong)] hover:text-[color:var(--ui-danger-text-strong)]'
          : tone === 'default'
            ? 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-title)] hover:bg-[color:var(--ui-surface-3)] hover:border-[color:var(--ui-border-strong)]'
            : 'border-transparent bg-transparent text-[color:var(--ui-text-subtle)] hover:bg-[color:var(--ui-hover)] hover:text-[color:var(--ui-text-title)]',
        size === 'compact' ? 'size-[30px]' : 'size-[34px]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function ProjectTreeButton({ className, ...props }: SharedButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-project-button inline-flex w-full items-center justify-start gap-2 rounded-[var(--ui-radius-md)] border border-transparent bg-transparent px-3 text-[14px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        'text-[color:var(--ui-text-title)] hover:bg-[color:var(--ui-hover)] hover:text-[color:var(--ui-text-title)]',
        className
      )}
      {...props}
    />
  );
}

export function ThreadTreeButton({ className, ...props }: SharedButtonProps) {
  return (
    <ControlButton
      className={cx(
        'ui-control-button ui-thread-button inline-flex w-full items-center justify-start gap-2 rounded-[var(--ui-radius-md)] border border-transparent bg-transparent px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        'text-[color:var(--ui-text-muted)] hover:bg-[color:var(--ui-hover)] hover:text-[color:var(--ui-text-title)]',
        className
      )}
      {...props}
    />
  );
}
