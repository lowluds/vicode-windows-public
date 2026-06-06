"use client";

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { math } from '@streamdown/math';
import { Check, Copy, Database, ExternalLink, File, FileCode2, FileText, Folder, Globe2, X } from 'lucide-react';
import type { AnchorHTMLAttributes, ComponentProps, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  siAstro,
  siC,
  siCplusplus,
  siCss,
  siDart,
  siDocker,
  siDotenv,
  siDotnet,
  siEslint,
  siGnubash,
  siGo,
  siHtml5,
  siJavascript,
  siJson,
  siKotlin,
  siLess,
  siLua,
  siMake,
  siMarkdown,
  siMdx,
  siNodedotjs,
  siOpenjdk,
  siPhp,
  siPrettier,
  siPython,
  siReact,
  siRuby,
  siRust,
  siSass,
  siSvelte,
  siSwift,
  siTailwindcss,
  siToml,
  siTurborepo,
  siTypescript,
  siVite,
  siVitest,
  siVuedotjs,
  siXml,
  siYaml,
  siZig,
  type SimpleIcon
} from 'simple-icons';
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
        'group-[.is-user]:ml-auto group-[.is-user]:max-w-[min(100%,var(--thread-transcript-item-width))]',
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
const defaultMessageLinkSafety = { enabled: false } as const;

type TranscriptLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
  workspaceRoot?: string | null;
};

type TranscriptReferenceKind = 'web' | 'file' | 'folder';

interface TranscriptReference {
  kind: TranscriptReferenceKind;
  href: string;
  target: string;
  title: string;
  extension: string | null;
  line: number | null;
}

const fileExtensionIcons: Record<string, SimpleIcon> = {
  astro: siAstro,
  c: siC,
  cc: siCplusplus,
  cjs: siJavascript,
  cpp: siCplusplus,
  cs: siDotnet,
  css: siCss,
  dart: siDart,
  go: siGo,
  htm: siHtml5,
  html: siHtml5,
  java: siOpenjdk,
  js: siJavascript,
  json: siJson,
  jsonl: siJson,
  jsx: siReact,
  kt: siKotlin,
  kts: siKotlin,
  less: siLess,
  lua: siLua,
  mjs: siJavascript,
  md: siMarkdown,
  mdx: siMdx,
  php: siPhp,
  py: siPython,
  pyw: siPython,
  rb: siRuby,
  rs: siRust,
  sass: siSass,
  scss: siSass,
  sh: siGnubash,
  swift: siSwift,
  toml: siToml,
  ts: siTypescript,
  tsx: siTypescript,
  vue: siVuedotjs,
  xml: siXml,
  yaml: siYaml,
  yml: siYaml,
  zig: siZig
};

const fileNameIcons: Record<string, SimpleIcon> = {
  '.env': siDotenv,
  '.eslintrc': siEslint,
  '.prettierrc': siPrettier,
  'docker-compose.yml': siDocker,
  'docker-compose.yaml': siDocker,
  dockerfile: siDocker,
  makefile: siMake,
  'package-lock.json': siNodedotjs,
  'package.json': siNodedotjs,
  'tailwind.config.cjs': siTailwindcss,
  'tailwind.config.js': siTailwindcss,
  'tailwind.config.mjs': siTailwindcss,
  'tailwind.config.ts': siTailwindcss,
  'turbo.json': siTurborepo,
  'vite.config.js': siVite,
  'vite.config.mjs': siVite,
  'vite.config.ts': siVite,
  'vitest.config.js': siVitest,
  'vitest.config.mjs': siVitest,
  'vitest.config.ts': siVitest
};

const linkableFileExtensions = new Set([
  'csv',
  'env',
  'gitignore',
  'lock',
  'png',
  'svg',
  'txt',
  ...Object.keys(fileExtensionIcons)
]);
const linkableFileNames = new Set(Object.keys(fileNameIcons));
const localReferenceOrigin = 'https://vicode.local';

function textFromChildren(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map((child) => textFromChildren(child)).join('');
  }

  return '';
}

function trimReferenceCandidate(value: string) {
  return value.trim().replace(/^[<("']+/u, '').replace(/[>)"',.;:]+$/u, '');
}

function parseHttpReference(value: string): TranscriptReference | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return {
      kind: 'web',
      href: value,
      target: value,
      title: value,
      extension: null,
      line: null
    };
  } catch {
    return null;
  }
}

function parseEncodedLocalReference(value: string): TranscriptReference | null {
  try {
    const url = new URL(value);
    if (url.origin !== localReferenceOrigin || url.pathname !== '/open-path') {
      return null;
    }

    const target = url.searchParams.get('target');
    if (!target) {
      return null;
    }

    const line = url.searchParams.get('line');
    return buildLocalReference(`${target}${line ? `:${line}` : ''}`, value);
  } catch {
    return null;
  }
}

function splitLineSuffix(value: string) {
  const lineMatch = value.match(/^(.+):(\d+)(?::\d+)?$/u);
  if (!lineMatch) {
    return { path: value, line: null };
  }

  return {
    path: lineMatch[1] ?? value,
    line: Number.parseInt(lineMatch[2] ?? '', 10)
  };
}

function fromFileUrl(value: string) {
  if (!value.toLowerCase().startsWith('file://')) {
    return null;
  }

  try {
    const url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    const windowsPath = decodedPath.replace(/^\/([A-Za-z]:)/u, '$1').replace(/\//gu, '\\');
    return windowsPath || null;
  } catch {
    return null;
  }
}

function isAbsolutePath(value: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/)\S)/u.test(value);
}

function getBasename(value: string) {
  const normalized = value.replace(/\\/gu, '/');
  return normalized.split('/').pop()?.toLowerCase() ?? '';
}

function getExtension(value: string) {
  const basename = getBasename(value);
  const match = basename.match(/[^.]\.([A-Za-z0-9]{1,12})$/u);
  return match?.[1]?.toLowerCase() ?? null;
}

function isKnownFileName(value: string) {
  return linkableFileNames.has(getBasename(value));
}

function looksLikeRelativePath(value: string) {
  if (!value || value.includes('\n') || /^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    return false;
  }

  if (/^(?:\.{1,2}[\\/]|[A-Za-z0-9_. ()-]+[\\/])\S/u.test(value)) {
    return true;
  }

  const extension = getExtension(value);
  return Boolean((extension && linkableFileExtensions.has(extension)) || isKnownFileName(value));
}

function resolveWorkspacePath(workspaceRoot: string | null | undefined, value: string) {
  if (!workspaceRoot || !looksLikeRelativePath(value)) {
    return null;
  }

  const trimmedRoot = workspaceRoot.replace(/[\\/]+$/u, '');
  const separator = trimmedRoot.includes('\\') ? '\\' : '/';
  const relativePath = value
    .replace(/^\.[\\/]+/u, '')
    .replace(/[\\/]+/gu, separator);

  if (!relativePath || relativePath.split(separator).includes('..')) {
    return null;
  }

  return `${trimmedRoot}${separator}${relativePath}`;
}

function buildLocalReference(pathValue: string, href: string) {
  const { path, line } = splitLineSuffix(pathValue);
  const extension = getExtension(path);
  const kind: TranscriptReferenceKind = extension || isKnownFileName(path) ? 'file' : 'folder';
  const lineLabel = line ? ` (line ${line})` : '';

  return {
    kind,
    href,
    target: path,
    title: `${path}${lineLabel}`,
    extension,
    line
  } satisfies TranscriptReference;
}

function resolveTranscriptReference(
  href: string | null | undefined,
  label: string,
  workspaceRoot?: string | null
): TranscriptReference | null {
  const candidate = trimReferenceCandidate(href || label);
  if (!candidate) {
    return null;
  }

  const encodedLocalReference = parseEncodedLocalReference(candidate);
  if (encodedLocalReference) {
    return encodedLocalReference;
  }

  const webReference = parseHttpReference(candidate);
  if (webReference) {
    return webReference;
  }

  const fileUrlPath = fromFileUrl(candidate);
  if (fileUrlPath) {
    return buildLocalReference(fileUrlPath, candidate);
  }

  const { path } = splitLineSuffix(candidate);
  if (isAbsolutePath(path)) {
    return buildLocalReference(candidate, candidate);
  }

  const workspacePath = resolveWorkspacePath(workspaceRoot, path);
  if (workspacePath) {
    return buildLocalReference(workspacePath, candidate);
  }

  return null;
}

function encodeLocalReferenceHref(reference: TranscriptReference) {
  const url = new URL('/open-path', localReferenceOrigin);
  url.searchParams.set('target', reference.target);
  if (reference.line) {
    url.searchParams.set('line', String(reference.line));
  }
  return url.toString();
}

function encodeLocalMarkdownLinks(source: string, workspaceRoot?: string | null) {
  return source
    .split(/(```[\s\S]*?```|`[^`\n]*`)/gu)
    .map((segment) => {
      if (segment.startsWith('`')) {
        return segment;
      }

      return segment.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/gu, (match, label: string, rawHref: string) => {
        const trimmedHref = rawHref.trim();
        const reference = resolveTranscriptReference(trimmedHref, label, workspaceRoot);
        if (!reference || reference.kind === 'web') {
          return match;
        }

        return `[${label}](${encodeLocalReferenceHref(reference)})`;
      });
    })
    .join('');
}

function prepareMessageSource(source: string, normalizeSource: boolean, workspaceRoot?: string | null) {
  const normalized = normalizeSource ? normalizeTranscriptMarkdownSource(source) : source;
  return encodeLocalMarkdownLinks(normalized, workspaceRoot);
}

function getSimpleIconColor(icon: SimpleIcon) {
  const color = icon.hex.trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/u.test(color) || color === '000000' || color === 'FFFFFF') {
    return 'currentColor';
  }

  return `#${color}`;
}

function SimpleIconGlyph({ icon }: { icon: SimpleIcon }) {
  return (
    <svg
      aria-hidden="true"
      className="turn-reference-brand-icon"
      data-icon-slug={icon.slug}
      focusable="false"
      style={{ color: getSimpleIconColor(icon) }}
      viewBox="0 0 24 24"
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

function getReferenceSimpleIcon(reference: TranscriptReference) {
  return fileNameIcons[getBasename(reference.target)] ?? (reference.extension ? fileExtensionIcons[reference.extension] : null);
}

function renderReferenceIcon(reference: TranscriptReference) {
  if (reference.kind === 'web') {
    return <Globe2 size={12} />;
  }

  if (reference.kind === 'folder') {
    return <Folder size={12} />;
  }

  const icon = getReferenceSimpleIcon(reference);

  if (icon) {
    return <SimpleIconGlyph icon={icon} />;
  }

  const extension = reference.extension ?? '';
  if (extension === 'md' || extension === 'txt') {
    return <FileText size={12} />;
  }

  if (extension === 'sql') {
    return <Database size={12} />;
  }

  if (extension) {
    return <FileCode2 size={12} />;
  }

  return <File size={12} />;
}

function TranscriptLink({ children, className, href, node: _node, workspaceRoot, ...props }: TranscriptLinkProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isIncomplete = href === 'streamdown:incomplete-link';
  const childText = textFromChildren(children);
  const reference = isIncomplete ? null : resolveTranscriptReference(href, childText, workspaceRoot);
  const displayTarget = reference?.title ?? href ?? '';

  const closeModal = useCallback(() => {
    setOpen(false);
    setCopied(false);
  }, []);

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!href || isIncomplete) {
      return;
    }

    if (reference?.kind === 'file' || reference?.kind === 'folder') {
      if (window.vicode?.app?.openPath) {
        void window.vicode.app.openPath(reference.target);
        return;
      }

      if (window.vicode?.app?.revealPath) {
        void window.vicode.app.revealPath(reference.target);
      }
      return;
    }

    setOpen(true);
  }, [href, isIncomplete, reference]);

  const copyLink = useCallback(async () => {
    const copyTarget = reference?.target ?? href;
    if (!copyTarget) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyTarget);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [href, reference]);

  const openLink = useCallback(() => {
    const openTarget = reference?.target ?? href;
    if (!openTarget) {
      return;
    }

    closeModal();
    if (window.vicode?.app?.openExternal) {
      void window.vicode.app.openExternal(openTarget);
      return;
    }
    window.open(openTarget, '_blank', 'noopener,noreferrer');
  }, [closeModal, href, reference]);

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <>
      <button
        className={cx('turn-link-button', reference && 'turn-reference-link', className)}
        data-incomplete={isIncomplete}
        data-reference-kind={reference?.kind}
        data-streamdown="link"
        onClick={handleClick}
        title={displayTarget}
        type="button"
      >
        {reference ? (
          <>
            <span className="turn-reference-icon" aria-hidden="true">
              {renderReferenceIcon(reference)}
            </span>
            <span className="turn-reference-label">{children}</span>
          </>
        ) : children}
      </button>
      {open ? (
        <div
          aria-modal="true"
          className="turn-link-safety-overlay"
          data-testid="turn-link-safety-modal"
          onClick={closeModal}
          role="dialog"
        >
          <div
            className="turn-link-safety-dialog"
            onClick={(event) => event.stopPropagation()}
            role="document"
          >
            <button
              aria-label="Close"
              className="turn-link-safety-close"
              onClick={closeModal}
              type="button"
            >
              <X size={15} />
            </button>
            <div className="turn-link-safety-heading">
              <ExternalLink size={18} />
              <span>Open external link?</span>
            </div>
            <p className="turn-link-safety-copy">You're about to visit an external website.</p>
            <div className="turn-link-safety-url">{reference?.target ?? href}</div>
            <div className="turn-link-safety-actions">
              <button className="turn-link-safety-secondary" onClick={copyLink} type="button">
                {copied ? <Check size={15} /> : <Copy size={15} />}
                <span>{copied ? 'Copied' : 'Copy link'}</span>
              </button>
              <button className="turn-link-safety-primary" onClick={openLink} type="button">
                <ExternalLink size={15} />
                <span>Open link</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type TranscriptInlineCodeProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
  workspaceRoot?: string | null;
};

type TranscriptParagraphProps = HTMLAttributes<HTMLParagraphElement> & {
  node?: unknown;
};

interface TranscriptDisclosureLine {
  kind: 'context' | 'referenced' | 'sources' | 'using';
  label: 'Context' | 'Referenced' | 'Sources' | 'Using';
  items: string[];
}

function cleanDisclosureItem(value: string) {
  return value
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[,;:([{"']+/u, '')
    .replace(/[,;:.)\]}"']+$/u, '')
    .trim();
}

function parseTranscriptDisclosureLine(value: string): TranscriptDisclosureLine | null {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const match = normalized.match(/^(Context|Referenced|Sources|Using):\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  const rawLabel = match[1]?.toLowerCase();
  const content = match[2] ?? '';
  const items = content
    .split(/\s*,\s*/u)
    .map(cleanDisclosureItem)
    .filter(Boolean);
  if (items.length === 0) {
    return null;
  }

  if (rawLabel === 'context') {
    return { kind: 'context', label: 'Context', items };
  }

  if (rawLabel === 'referenced') {
    return { kind: 'referenced', label: 'Referenced', items };
  }

  if (rawLabel === 'sources') {
    return { kind: 'sources', label: 'Sources', items };
  }

  return { kind: 'using', label: 'Using', items };
}

function TranscriptParagraph({ children, className, node: _node, ...props }: TranscriptParagraphProps) {
  const disclosure = parseTranscriptDisclosureLine(textFromChildren(children));
  if (!disclosure) {
    return <p className={className} {...props}>{children}</p>;
  }

  return (
    <p
      className={cx('turn-reference-disclosure', className)}
      data-disclosure-kind={disclosure.kind}
      {...props}
    >
      <span className="turn-reference-disclosure-label">{disclosure.label}:</span>
      <span className="turn-reference-disclosure-items">
        {disclosure.items.map((item, index) => (
          <span className="turn-reference-disclosure-item" key={`${disclosure.kind}:${item}:${index}`}>
            {index > 0 ? <span className="turn-reference-disclosure-separator">, </span> : null}
            {item}
          </span>
        ))}
      </span>
    </p>
  );
}

function TranscriptInlineCode({ children, className, node: _node, workspaceRoot, ...props }: TranscriptInlineCodeProps) {
  const text = textFromChildren(children);
  const isCodeBlock = text.includes('\n') || /\blanguage-/u.test(className ?? '');
  const reference = isCodeBlock ? null : resolveTranscriptReference(null, text, workspaceRoot);

  if (reference) {
    return (
      <TranscriptLink className="turn-inline-reference" href={text} workspaceRoot={workspaceRoot}>
        {text}
      </TranscriptLink>
    );
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  normalizeSource?: boolean;
  workspaceRoot?: string | null;
};

export const MessageResponse = memo(
  ({ className, controls = defaultMessageControls, normalizeSource = false, children, components, linkSafety = defaultMessageLinkSafety, workspaceRoot = null, ...props }: MessageResponseProps) => {
    const streamdownComponents = useMemo(
      () => ({
        a: (linkProps: TranscriptLinkProps) => <TranscriptLink {...linkProps} workspaceRoot={workspaceRoot} />,
        code: (codeProps: TranscriptInlineCodeProps) => <TranscriptInlineCode {...codeProps} workspaceRoot={workspaceRoot} />,
        p: (paragraphProps: TranscriptParagraphProps) => <TranscriptParagraph {...paragraphProps} />,
        ...components
      }),
      [components, workspaceRoot]
    );

    return (
      <Streamdown
        className={cx(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
        components={streamdownComponents}
        controls={controls}
        linkSafety={linkSafety}
        plugins={streamdownPlugins}
        shikiTheme={defaultMessageShikiTheme}
        {...props}
      >
        {typeof children === 'string' ? prepareMessageSource(children, normalizeSource, workspaceRoot) : children}
      </Streamdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children
    && prevProps.isAnimating === nextProps.isAnimating
    && prevProps.normalizeSource === nextProps.normalizeSource
    && prevProps.workspaceRoot === nextProps.workspaceRoot
    && prevProps.controls === nextProps.controls
    && prevProps.components === nextProps.components
    && prevProps.linkSafety === nextProps.linkSafety
);

MessageResponse.displayName = 'MessageResponse';
