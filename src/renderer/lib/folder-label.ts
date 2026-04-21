export function folderLabel(folderPath: string) {
  const normalized = folderPath.replace(/[\/]+$/, '');
  const segments = normalized.split(/[\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? folderPath;
}
