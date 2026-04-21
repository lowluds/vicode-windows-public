"use client";

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { IconButton, Tooltip, TooltipContent, TooltipTrigger } from '../ui';
import { cx } from '../ui/utils';

const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

interface ContextSchema {
  usedTokens: number;
  maxTokens: number;
  usagePercent?: number;
  title?: string;
  pressureLabel?: string;
  sourceLabel?: string;
  note?: string;
  severity?: 'normal' | 'warning' | 'danger';
}

const ContextContext = createContext<ContextSchema | null>(null);

function useContextValue() {
  const context = useContext(ContextContext);
  if (!context) {
    throw new Error('Context components must be used within Context');
  }
  return context;
}

function clampPercent(value: number) {
  return Math.min(PERCENT_MAX, Math.max(0, value));
}

function readUsedPercent(context: ContextSchema) {
  if (typeof context.usagePercent === 'number') {
    return clampPercent(context.usagePercent);
  }

  if (context.maxTokens <= 0) {
    return 0;
  }

  return clampPercent((context.usedTokens / context.maxTokens) * 100);
}

function formatPercent(value: number) {
  if (value <= 0) {
    return '0%';
  }
  if (value < 0.1) {
    return '<0.1%';
  }
  if (value < 10) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return value.toLocaleString();
}

export type ContextProps = ContextSchema & {
  children: ReactNode;
};

export function Context({
  children,
  maxTokens,
  note,
  pressureLabel,
  severity = 'normal',
  sourceLabel,
  title = 'Context window',
  usagePercent,
  usedTokens
}: ContextProps) {
  const value = useMemo(
    () => ({
      maxTokens,
      note,
      pressureLabel,
      severity,
      sourceLabel,
      title,
      usagePercent,
      usedTokens
    }),
    [maxTokens, note, pressureLabel, severity, sourceLabel, title, usagePercent, usedTokens]
  );

  return (
    <ContextContext.Provider value={value}>
      <Tooltip>{children}</Tooltip>
    </ContextContext.Provider>
  );
}

function ContextIcon() {
  const context = useContextValue();
  const usedPercent = readUsedPercent(context) / 100;
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const dashOffset = circumference * (1 - usedPercent);

  return (
    <svg
      aria-label="Model context usage"
      height="20"
      role="img"
      style={{ color: 'currentColor' }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.22"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.8"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />
    </svg>
  );
}

export type ContextTriggerProps = ComponentPropsWithoutRef<typeof TooltipTrigger> & {
  className?: string;
};

export function ContextTrigger({ children, className, ...props }: ContextTriggerProps) {
  const context = useContextValue();
  const renderedPercent = formatPercent(readUsedPercent(context));
  const triggerLabel = `Context window ${renderedPercent}`;

  return (
    <TooltipTrigger asChild {...props}>
      {children ?? (
        <IconButton
          tone="quiet"
          size="compact"
          label={triggerLabel}
          className={cx('composer-context-window-button rounded-full', className)}
        >
          <span className="composer-context-window-trigger-icon" aria-hidden="true">
            <ContextIcon />
          </span>
        </IconButton>
      )}
    </TooltipTrigger>
  );
}

export type ContextContentProps = ComponentPropsWithoutRef<typeof TooltipContent>;

export function ContextContent({ className, side = 'top', ...props }: ContextContentProps) {
  return (
    <TooltipContent
      side={side}
      className={cx(
        'w-[min(320px,calc(100vw-32px))] max-w-[calc(100vw-32px)] rounded-[20px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-menu-bg)] p-0',
        className
      )}
      {...props}
    />
  );
}

export type ContextContentHeaderProps = ComponentPropsWithoutRef<'div'>;

export function ContextContentHeader({ children, className, ...props }: ContextContentHeaderProps) {
  const context = useContextValue();
  const usedPercent = readUsedPercent(context);

  return (
    <div className={cx('flex flex-col gap-2 border-b border-[color:var(--ui-border-soft)] px-3 py-3', className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[color:var(--ui-text-title)]">{context.title}</div>
              {context.pressureLabel ? (
                <div
                  className={cx(
                    'mt-1 text-[11px] font-medium',
                    context.severity === 'danger'
                      ? 'text-[color:var(--ui-danger-text)]'
                      : context.severity === 'warning'
                        ? 'text-[color:var(--ui-warning-text)]'
                        : 'text-[color:var(--ui-brand-text)]'
                  )}
                >
                  {context.pressureLabel}
                </div>
              ) : null}
            </div>
          </div>
          <div className="text-[22px] font-semibold leading-none text-[color:var(--ui-text-title)]">{formatPercent(usedPercent)} full</div>
          <div className="font-mono text-[12px] text-[color:var(--ui-text-subtle)]">
            {formatTokenCount(context.usedTokens)} / {formatTokenCount(context.maxTokens)} tokens used
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--ui-alpha-06)]">
            <div
              className={cx(
                'h-full rounded-full transition-[width]',
                context.severity === 'danger'
                  ? 'bg-[color:var(--ui-danger-text)]'
                  : context.severity === 'warning'
                    ? 'bg-[color:var(--ui-warning-text)]'
                    : 'bg-[color:var(--ui-brand-text)]'
              )}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export type ContextContentBodyProps = ComponentPropsWithoutRef<'div'>;

export function ContextContentBody({ children, className, ...props }: ContextContentBodyProps) {
  return (
    <div className={cx('flex flex-col gap-2 px-3 py-3', className)} {...props}>
      {children}
    </div>
  );
}

export type ContextContentFooterProps = ComponentPropsWithoutRef<'div'>;

export function ContextContentFooter({ children, className, ...props }: ContextContentFooterProps) {
  const context = useContextValue();

  return (
    <div className={cx('flex flex-col gap-1 border-t border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] px-3 py-2.5', className)} {...props}>
      {children ?? (
        <>
          {context.sourceLabel ? (
            <div className="text-[11px] text-[color:var(--ui-text-subtle)]">{context.sourceLabel}</div>
          ) : null}
          {context.note ? (
            <div className="text-[11px] leading-5 text-[color:var(--ui-text-muted)]">{context.note}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
