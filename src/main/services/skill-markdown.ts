export function parseSkillMarkdown(markdown: string, fallbackName: string, fallbackDescription: string) {
  const frontMatter = markdown.startsWith('---')
    ? (() => {
        const endIndex = markdown.indexOf('\n---', 3);
        return endIndex === -1 ? '' : markdown.slice(3, endIndex).trim();
      })()
    : '';
  const content = markdown.startsWith('---')
    ? (() => {
        const endIndex = markdown.indexOf('\n---', 3);
        return endIndex === -1 ? markdown : markdown.slice(endIndex + 4).trimStart();
      })()
    : markdown;
  const metadata = new Map<string, string>();

  for (const line of frontMatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && value) {
      metadata.set(key, value);
    }
  }

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const paragraphs = content
    .split(/\r?\n\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith('#'));

  return {
    name: metadata.get('name') ?? titleMatch?.[1]?.trim() ?? fallbackName,
    description: metadata.get('description') ?? paragraphs[0] ?? fallbackDescription,
    instructions: content.trim() || markdown.trim()
  };
}
