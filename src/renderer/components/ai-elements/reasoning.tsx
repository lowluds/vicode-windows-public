"use client";

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import type { ComponentProps, ReactNode } from 'react';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Streamdown } from 'streamdown';
import { ChevronDownIcon, CpuIcon } from '../icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, useControllableState } from '../ui';
import { cx } from '../ui/utils';
import { Shimmer } from './shimmer';

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
}

export interface ReasoningProps extends ComponentProps<typeof Collapsible> {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
}

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export const Reasoning = memo(function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: durationProp,
  children,
  ...props
}: ReasoningProps) {
  const resolvedDefaultOpen = defaultOpen ?? isStreaming;
  const isExplicitlyClosed = defaultOpen === false;

  const [isOpen, setIsOpen] = useControllableState<boolean>({
    defaultProp: resolvedDefaultOpen,
    onChange: onOpenChange,
    prop: open
  });
  const [duration, setDuration] = useControllableState<number | undefined>({
    defaultProp: undefined,
    prop: durationProp
  });

  const hasEverStreamedRef = useRef(isStreaming);
  const [hasAutoClosed, setHasAutoClosed] = useState(false);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      hasEverStreamedRef.current = true;
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
    } else if (startTimeRef.current !== null) {
      setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
      startTimeRef.current = null;
    }
  }, [isStreaming, setDuration]);

  useEffect(() => {
    if (isStreaming && !isOpen && !isExplicitlyClosed) {
      setIsOpen(true);
    }
  }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

  useEffect(() => {
    if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
      const timer = window.setTimeout(() => {
        setIsOpen(false);
        setHasAutoClosed(true);
      }, AUTO_CLOSE_DELAY);

      return () => window.clearTimeout(timer);
    }
  }, [hasAutoClosed, isOpen, isStreaming, setIsOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
    },
    [setIsOpen]
  );

  const contextValue = useMemo(
    () => ({ duration, isOpen, isStreaming, setIsOpen }),
    [duration, isOpen, isStreaming, setIsOpen]
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        className={cx('not-prose mb-4', className)}
        onOpenChange={handleOpenChange}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
});

export interface ReasoningTriggerProps extends ComponentProps<typeof CollapsibleTrigger> {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
}

function defaultGetThinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  if (duration === undefined) {
    return <span>Reasoning</span>;
  }
  return <span>Thought for {duration} seconds</span>;
}

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultGetThinkingMessage,
  ...props
}: ReasoningTriggerProps) {
  const { isStreaming, isOpen, duration } = useReasoning();

  return (
    <CollapsibleTrigger
      className={cx(
        'flex w-full items-center gap-2 text-sm text-[color:var(--ui-text-subtle)] transition-colors hover:text-[color:var(--ui-text)]',
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <CpuIcon size={14} />
          {getThinkingMessage(isStreaming, duration)}
          <ChevronDownIcon
            className={cx(
              'size-4 transition-transform',
              isOpen ? 'rotate-180' : 'rotate-0'
            )}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
});

const streamdownPlugins = { cjk, code, math };

export interface ReasoningContentProps extends ComponentProps<typeof CollapsibleContent> {
  children: string;
}

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      className={cx(
        'mt-3 text-sm text-[color:var(--ui-text-muted)]',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    >
      <Streamdown className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" plugins={streamdownPlugins}>
        {children}
      </Streamdown>
    </CollapsibleContent>
  );
});
