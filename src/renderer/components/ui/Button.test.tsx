import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IconButton } from './Button';

describe('IconButton', () => {
  it('uses the accessible label as a visible hover title by default', () => {
    const html = renderToStaticMarkup(<IconButton label="Install skill">+</IconButton>);

    expect(html).toContain('aria-label="Install skill"');
    expect(html).toContain('title="Install skill"');
  });

  it('allows callers to override the hover title when needed', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Install skill" title="Import into Vicode">
        +
      </IconButton>
    );

    expect(html).toContain('aria-label="Install skill"');
    expect(html).toContain('title="Import into Vicode"');
  });
});
