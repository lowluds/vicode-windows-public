import { describe, expect, it } from 'vitest';
import { classifyRunFailureText } from './run-failure-classification';

describe('classifyRunFailureText', () => {
  it('classifies missing file-write failures from visible run cards', () => {
    expect(
      classifyRunFailureText(
        'Run Failed No page files were written. Created only roofing-landing before the provider stopped. No write_file or apply_patch tool calls were recorded.'
      )
    ).toBe('missing_file_write');
  });

  it('classifies missing web research failures from visible run cards', () => {
    expect(
      classifyRunFailureText(
        'Run Failed Natural Builder Test was explicitly asked to research online but kept answering without using the available native web research tools.'
      )
    ).toBe('missing_web_research');
  });

  it('classifies tool availability and provider transport failures', () => {
    expect(classifyRunFailureText('Tool write_file is not available under the active execution constraints.')).toBe('tool_unavailable');
    expect(classifyRunFailureText('Failed to reach the local Ollama runtime. Start Ollama or check that it is reachable, then retry.')).toBe('provider_transport');
  });
});
