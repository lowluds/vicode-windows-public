import { Children, isValidElement, useMemo, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDownIcon } from '../icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './Menu';
import { cx } from './utils';

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'ui-field ui-input flex h-11 w-full rounded-[var(--ui-radius-lg)] border px-3 text-[14px] outline-none transition-colors',
        className
      )}
      {...props}
    />
  );
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'ui-field ui-textarea flex min-h-[120px] w-full rounded-[var(--ui-radius-lg)] border px-3 py-3 text-[14px] outline-none transition-colors',
        className
      )}
      {...props}
    />
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  menuClassName?: string;
}

export function SelectField({ className, children, menuClassName, ...props }: SelectFieldProps) {
  const nativeFallback = className?.includes('sr-only') || props.multiple || typeof props.size === 'number';
  const options = useMemo(() => collectSelectOptions(children), [children]);
  const initialValue = resolveInitialSelectValue(props.value, props.defaultValue, options);
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const controlledValue = props.value === undefined ? undefined : String(props.value);
  const selectedValue = controlledValue ?? uncontrolledValue;
  const selectedOption = options.find((option) => option.value === selectedValue) ?? options.find((option) => !option.disabled) ?? options[0];

  if (nativeFallback) {
    return (
        <select
          className={cx(
            'ui-field ui-select flex h-11 w-full rounded-[var(--ui-radius-lg)] border px-3 text-[14px] outline-none transition-colors',
            className
          )}
          {...props}
      >
        {children}
      </select>
    );
  }

  const commitValue = (nextValue: string) => {
    if (props.disabled) {
      return;
    }
    if (controlledValue === undefined) {
      setUncontrolledValue(nextValue);
    }
    props.onChange?.({
      target: { value: nextValue, name: props.name } as EventTarget & HTMLSelectElement,
      currentTarget: { value: nextValue, name: props.name } as EventTarget & HTMLSelectElement
    } as ChangeEvent<HTMLSelectElement>);
  };

  return (
    <>
      <select
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        disabled={props.disabled}
        name={props.name}
        value={selectedOption?.value ?? ''}
        onChange={() => undefined}
      >
        {children}
      </select>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            id={props.id}
            data-testid={props['data-testid']}
            aria-label={props['aria-label']}
            aria-labelledby={props['aria-labelledby']}
            aria-describedby={props['aria-describedby']}
            disabled={props.disabled}
            className={cx(
              'ui-field ui-select-trigger flex h-11 w-full items-center justify-between gap-3 rounded-[var(--ui-radius-lg)] border px-3 text-left text-[14px] outline-none transition-colors',
              className
            )}
          >
            <span className={cx('ui-select-value min-w-0 flex-1 truncate', !selectedOption && 'text-[color:var(--ui-text-subtle)]')}>
              {selectedOption?.label ?? props.placeholder ?? 'Select'}
            </span>
            <span className="ui-select-chevron flex h-4 w-4 flex-none items-center justify-center text-[color:var(--ui-text-muted)]">
              <ChevronDownIcon />
            </span>
          </button>
        </MenuTrigger>
        <MenuContent className={cx('ui-select-content min-w-[var(--radix-dropdown-menu-trigger-width)]', menuClassName)}>
          {options.map((option) => (
            <MenuItem
              key={option.value}
              disabled={option.disabled}
              className={cx(option.value === selectedOption?.value && 'is-selected')}
              onSelect={() => commitValue(option.value)}
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </>
  );
}

type SelectOptionRecord = {
  value: string;
  label: string;
  disabled?: boolean;
};

function collectSelectOptions(children: ReactNode): SelectOptionRecord[] {
  const options: SelectOptionRecord[] = [];

  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) {
      continue;
    }
    if (child.type === 'option') {
      const value = child.props.value === undefined ? String(child.props.children ?? '') : String(child.props.value);
      options.push({
        value,
        label: readOptionLabel(child.props.children),
        disabled: Boolean(child.props.disabled)
      });
      continue;
    }
    if (child.type === 'optgroup') {
      options.push(...collectSelectOptions(child.props.children));
    }
  }

  return options;
}

function readOptionLabel(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('')
    .trim();
}

function resolveInitialSelectValue(
  value: SelectHTMLAttributes<HTMLSelectElement>['value'],
  defaultValue: SelectHTMLAttributes<HTMLSelectElement>['defaultValue'],
  options: SelectOptionRecord[]
): string {
  if (value !== undefined) {
    return String(value);
  }
  if (defaultValue !== undefined) {
    return String(defaultValue);
  }
  return options.find((option) => !option.disabled)?.value ?? '';
}
