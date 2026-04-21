import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker(_: string, label: string): Worker;
    };
  }
}

function ensureMonacoEnvironment() {
  if (window.MonacoEnvironment) {
    return;
  }

  window.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    }
  };
}

function readCssVar(name: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value;
}

function applyTheme() {
  const dark = document.documentElement.classList.contains('dark');
  monaco.editor.defineTheme('vicode-run-review', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    colors: {
      'editor.background': readCssVar('--ui-code-bg'),
      'editor.foreground': readCssVar('--ui-code-text'),
      'editorLineNumber.foreground': readCssVar('--ui-text-subtle'),
      'editorLineNumber.activeForeground': readCssVar('--ui-text-title'),
      'editorGutter.background': readCssVar('--ui-code-bg'),
      'editor.selectionBackground': readCssVar('--ui-alpha-08'),
      'editor.inactiveSelectionBackground': readCssVar('--ui-alpha-05'),
      'editor.lineHighlightBackground': readCssVar('--ui-alpha-03'),
      'diffEditor.insertedTextBackground': readCssVar('--ui-monaco-diff-inserted-text'),
      'diffEditor.removedTextBackground': readCssVar('--ui-monaco-diff-removed-text'),
      'diffEditor.insertedLineBackground': readCssVar('--ui-monaco-diff-inserted-line'),
      'diffEditor.removedLineBackground': readCssVar('--ui-monaco-diff-removed-line'),
      'scrollbarSlider.background': readCssVar('--ui-alpha-08'),
      'scrollbarSlider.hoverBackground': readCssVar('--ui-alpha-12'),
      'scrollbarSlider.activeBackground': readCssVar('--ui-alpha-16')
    }
  });
  monaco.editor.setTheme('vicode-run-review');
}

function inferLanguage(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'xml':
    case 'svg':
      return 'xml';
    case 'sh':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return 'shell';
    default:
      return 'plaintext';
  }
}

function buildModelUri(path: string, side: 'original' | 'modified') {
  return monaco.Uri.parse(`inmemory://run-review/${encodeURIComponent(path)}?side=${side}&nonce=${crypto.randomUUID()}`);
}

function measureEditorHeight(originalValue: string, modifiedValue: string) {
  const originalLines = originalValue ? originalValue.split(/\r?\n/u).length : 1;
  const modifiedLines = modifiedValue ? modifiedValue.split(/\r?\n/u).length : 1;
  return Math.min(Math.max(Math.max(originalLines, modifiedLines) * 22 + 24, 240), 720);
}

export function MonacoDiffEditor({
  path,
  originalValue,
  modifiedValue
}: {
  path: string;
  originalValue: string;
  modifiedValue: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<{
    original: monaco.editor.ITextModel;
    modified: monaco.editor.ITextModel;
  } | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    ensureMonacoEnvironment();
    applyTheme();

    if (!containerRef.current) {
      return;
    }

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      glyphMargin: false,
      folding: false,
      renderOverviewRuler: false,
      wordWrap: 'off',
      lineDecorationsWidth: 12,
      fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 20,
      smoothScrolling: true,
      domReadOnly: true,
      originalEditable: false
    });

    editorRef.current = editor;
    resizeObserverRef.current = new ResizeObserver(() => editor.layout());
    resizeObserverRef.current.observe(containerRef.current);

    const observer = new MutationObserver(() => applyTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });

    return () => {
      observer.disconnect();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      modelsRef.current?.original.dispose();
      modelsRef.current?.modified.dispose();
      modelsRef.current = null;
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || !containerRef.current) {
      return;
    }

    applyTheme();
    const language = inferLanguage(path);
    const originalModel = monaco.editor.createModel(originalValue, language, buildModelUri(path, 'original'));
    const modifiedModel = monaco.editor.createModel(modifiedValue, language, buildModelUri(path, 'modified'));
    const previousModels = modelsRef.current;
    modelsRef.current = {
      original: originalModel,
      modified: modifiedModel
    };

    editorRef.current.setModel({
      original: originalModel,
      modified: modifiedModel
    });
    containerRef.current.style.height = `${measureEditorHeight(originalValue, modifiedValue)}px`;
    editorRef.current.layout();

    previousModels?.original.dispose();
    previousModels?.modified.dispose();
  }, [modifiedValue, originalValue, path]);

  return <div ref={containerRef} className="run-change-monaco-editor w-full overflow-hidden rounded-[16px]" />;
}
