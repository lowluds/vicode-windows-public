import { describe, expect, it } from 'vitest';

import { settingsSections } from './support';

describe('settings support helpers', () => {
  it('exposes Library as a first-level settings section', () => {
    expect(settingsSections.map((section) => section.value)).toContain('library');
  });
});
