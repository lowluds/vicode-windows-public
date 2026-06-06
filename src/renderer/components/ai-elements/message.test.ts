import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageResponse } from './message';

describe('MessageResponse', () => {
  it('renders transcript markdown links through the Vicode link button', () => {
    const html = renderToStaticMarkup(
      createElement(
        MessageResponse,
        null,
        'Open [Preview Beacon](http://127.0.0.1:49189/index.html).'
      )
    );

    expect(html).toContain('turn-link-button');
    expect(html).toContain('turn-reference-link');
    expect(html).toContain('data-reference-kind="web"');
    expect(html).toContain('title="http://127.0.0.1:49189/index.html"');
    expect(html).toContain('data-streamdown="link"');
    expect(html).toContain('Preview Beacon');
    expect(html).not.toContain('link-safety-modal');
  });

  it('renders markdown file links as clickable local path references', () => {
    const html = renderToStaticMarkup(
      createElement(
        MessageResponse,
        null,
        'Updated [message.tsx](D:/Example/VicodeDemo/src/renderer/components/ai-elements/message.tsx:202).'
      )
    );

    expect(html).toContain('turn-reference-link');
    expect(html).toContain('data-reference-kind="file"');
    expect(html).toContain('title="D:/Example/VicodeDemo/src/renderer/components/ai-elements/message.tsx (line 202)"');
    expect(html).toContain('turn-reference-brand-icon');
    expect(html).toContain('data-icon-slug="typescript"');
    expect(html).not.toContain('turn-reference-file-badge');
  });

  it('renders inline code paths as workspace-relative references', () => {
    const html = renderToStaticMarkup(
      createElement(
        MessageResponse,
        { workspaceRoot: 'D:\\Projects\\demo-app' },
        'Open `src/index.html`, `script.js`, and `styles.css`.'
      )
    );

    expect(html).toContain('turn-inline-reference');
    expect(html).toContain('data-reference-kind="file"');
    expect(html).toContain('title="D:\\Projects\\demo-app\\src\\index.html"');
    expect(html).toContain('title="D:\\Projects\\demo-app\\script.js"');
    expect(html).toContain('data-icon-slug="html5"');
    expect(html).toContain('data-icon-slug="javascript"');
    expect(html).toContain('data-icon-slug="css"');
    expect(html).not.toContain('turn-reference-file-badge');
  });

  it('renders context, using, and sources disclosure lines as subdued metadata without raw route brackets', () => {
    const html = renderToStaticMarkup(
      createElement(
        MessageResponse,
        null,
        'Context: [[Runtime Patterns]]\n\nUsing: [[Reviewer Skill]]\n\nSources: [[arXiv 2005.11401]]'
      )
    );

    expect(html).toContain('turn-reference-disclosure');
    expect(html).toContain('data-disclosure-kind="context"');
    expect(html).toContain('data-disclosure-kind="using"');
    expect(html).toContain('data-disclosure-kind="sources"');
    expect(html).toContain('Context:');
    expect(html).toContain('Runtime Patterns');
    expect(html).toContain('Using:');
    expect(html).toContain('Reviewer Skill');
    expect(html).toContain('Sources:');
    expect(html).toContain('arXiv 2005.11401');
    expect(html).not.toContain('[[Runtime Patterns]]');
    expect(html).not.toContain('[[Reviewer Skill]]');
    expect(html).not.toContain('[[arXiv 2005.11401]]');
  });
});
