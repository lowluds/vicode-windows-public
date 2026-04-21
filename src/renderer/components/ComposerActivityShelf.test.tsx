import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComposerActivityShelf } from './ComposerActivityShelf';

describe('ComposerActivityShelf', () => {
  it('renders planner items as a plain inline shelf when requested', () => {
    const html = renderToStaticMarkup(
      React.createElement(ComposerActivityShelf, {
        items: [
          {
            id: 'planner-plan',
            title: 'Build plan',
            summary: '',
            defaultOpen: true,
            variant: 'plain',
            content: React.createElement('div', null, 'Planner body')
          }
        ]
      })
    );

    expect(html).toContain('composer-activity-card is-plain is-expanded');
    expect(html).toContain('composer-activity-shelf has-plain-only');
    expect(html).toContain('Build plan');
    expect(html).toContain('Planner body');
  });
});
