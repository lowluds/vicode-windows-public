import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyThreadHero } from './EmptyThreadHero';

describe('EmptyThreadHero', () => {
  it('renders the minimal start-building prompt without the legacy hero copy', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmptyThreadHero, {
        showOpenProjectAction: false,
        onOpenProject: () => undefined
      })
    );

    expect(html).toContain('Start building');
    expect(html).not.toContain('Build with Vicode');
    expect(html).not.toContain('Start typing below when you are ready to work in this project.');
    expect(html).not.toContain('ship a focused fix');
  });

  it('keeps the open-project action only for the no-project case', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmptyThreadHero, {
        showOpenProjectAction: true,
        onOpenProject: () => undefined
      })
    );

    expect(html).toContain('Open a local project to begin.');
    expect(html).toContain('Open project');
  });
});
