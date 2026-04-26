"use client";

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { math } from '@streamdown/math';
import type { ComponentProps, HTMLAttributes } from 'react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { normalizeTranscriptMarkdownSource } from '../../lib/transcript-markdown-normalization';
import { cx } from '../ui/utils';

export interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from: string;
}

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cx(
        'group flex w-full max-w-[95%] flex-col gap-2',
        from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
        className
      )}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ children, className, ...props }: MessageContentProps) {
  return (
    <div
      className={cx(
        'flex w-fit min-w-0 max-w-full flex-col gap-2 text-sm',
        'group-[.is-user]:ml-auto group-[.is-user]:w-full group-[.is-user]:max-w-[min(100%,var(--thread-transcript-item-width))]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

const defaultMessageShikiTheme = ['github-light', 'github-dark'] as const;
const streamdownPlugins = {
  cjk,
  code: createCodePlugin({ themes: defaultMessageShikiTheme }),
  math
};
const defaultMessageControls = {
  code: {
    copy: true,
    download: false
  }
} as const;

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  normalizeSource?: boolean;
};

export const MessageResponse = memo(
  ({ className, controls = defaultMessageControls, normalizeSource = false, children, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cx(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className
      )}
      controls={controls}
      plugins={streamdownPlugins}
      shikiTheme={defaultMessageShikiTheme}
      {...props}
    >
      {typeof children === 'string' && normalizeSource ? normalizeTranscriptMarkdownSource(children) : children}
    </Streamdown>
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children
    && prevProps.isAnimating === nextProps.isAnimating
    && prevProps.normalizeSource === nextProps.normalizeSource
    && prevProps.controls === nextProps.controls
);

MessageResponse.displayName = 'MessageResponse';
