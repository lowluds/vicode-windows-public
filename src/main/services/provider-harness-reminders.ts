function formatRuntimeReminderCount(count: number) {
  return `${count} runtime reminder${count === 1 ? '' : 's'}`;
}

export function formatMissingFileContentMutationDiagnosticMessage(input: {
  parsedFileContentMutationToolCallCount: number;
  requiredMutationReminderCount: number;
}) {
  if (input.parsedFileContentMutationToolCallCount > 0) {
    return `${input.parsedFileContentMutationToolCallCount} write_file or apply_patch tool call${input.parsedFileContentMutationToolCallCount === 1 ? ' was' : 's were'} parsed, but none completed successfully after ${formatRuntimeReminderCount(input.requiredMutationReminderCount)}.`;
  }

  return `No write_file or apply_patch tool calls were recorded after ${formatRuntimeReminderCount(input.requiredMutationReminderCount)}.`;
}

function formatListForDiagnostic(values: string[]) {
  return values.length > 0 ? values.join(', ') : 'none';
}

export function formatMissingFileContentMutationDiagnosticText(input: {
  parsedFileContentMutationToolCallCount: number;
  parsedToolCallNames: string[];
  requiredMutationReminderCount: number;
  createdDirectories: string[];
  writtenFiles: string[];
}) {
  return [
    `parsed write-capable tool calls: ${input.parsedFileContentMutationToolCallCount}`,
    `parsed tool calls: ${formatListForDiagnostic(input.parsedToolCallNames)}`,
    `created directories: ${formatListForDiagnostic(input.createdDirectories)}`,
    `written files: ${formatListForDiagnostic(input.writtenFiles)}`,
    `runtime reminders: ${input.requiredMutationReminderCount}`
  ].join('\n');
}

export function formatMissingFileContentMutationMessage(input: {
  baseMessage: string;
  createdDirectories: string[];
  diagnosticMessage?: string | null;
  writtenFiles: string[];
}) {
  const messageSuffix = [input.diagnosticMessage, input.baseMessage]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ');

  if (input.writtenFiles.length > 0) {
    return messageSuffix;
  }

  if (input.createdDirectories.length === 1) {
    return `No page files were written. Created only ${input.createdDirectories[0]} before the provider stopped. ${messageSuffix}`;
  }

  if (input.createdDirectories.length > 1) {
    return `No page files were written. Created only folders ${input.createdDirectories.join(', ')} before the provider stopped. ${messageSuffix}`;
  }

  return `No page files were written before the provider stopped. ${messageSuffix}`;
}

export function buildMissingWebImageArtifactReminder() {
  return [
    'Internal runtime reminder:',
    'The user asked for an Unsplash image in the generated page.',
    'The written files do not include an Unsplash URL yet.',
    'Call write_file now to update the HTML or CSS so the hero uses a returned Unsplash image URL.'
  ].join('\n');
}

export function buildMissingStaticWebPageFileSetReminder(requiredExtensions: string[], directoryListing: string) {
  const missingFiles = requiredExtensions
    .map((extension) => {
      switch (extension) {
        case '.html':
          return 'index.html';
        case '.css':
          return 'styles.css';
        case '.js':
          return 'main.js';
        default:
          return `a ${extension} file`;
      }
    })
    .join(', ');

  return [
    'Internal runtime reminder:',
    `The user asked for a static web page that requires ${missingFiles}.`,
    'The workspace directory listing does not show all required page files yet.',
    `Current workspace listing:\n${directoryListing}`,
    'Call write_file now to create or update the missing page file contents before answering.'
  ].join('\n');
}

