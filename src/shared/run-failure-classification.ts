export type RunFailureClass =
  | 'missing_file_write'
  | 'missing_web_research'
  | 'tool_unavailable'
  | 'provider_transport'
  | 'unknown';

export function classifyRunFailureText(text: string): RunFailureClass {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  if (
    normalized.includes('no page files were written')
    || normalized.includes('no file-content writes')
    || normalized.includes('write_file or apply_patch')
    || normalized.includes('stopped before writing the required file contents')
  ) {
    return 'missing_file_write';
  }

  if (
    normalized.includes('research online')
    || normalized.includes('native web research')
    || normalized.includes('web_search')
    || normalized.includes('research_topic')
  ) {
    return 'missing_web_research';
  }

  if (
    normalized.includes('tool ') && normalized.includes(' is not available')
    || normalized.includes('not available under the active execution constraints')
  ) {
    return 'tool_unavailable';
  }

  if (
    normalized.includes('failed to reach')
    || normalized.includes('fetch failed')
    || normalized.includes('terminated the response')
    || normalized.includes('did not produce the next response')
    || normalized.includes('returned http')
  ) {
    return 'provider_transport';
  }

  return 'unknown';
}
