import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import type {
  ProjectKnowledgeScanDiagnostic,
  ProjectKnowledgeScannedSection,
  ProjectKnowledgeScannedSource
} from './project-knowledge-scanner';

interface MarkdownMetadata {
  content: string;
  title: string;
  aliases: string[];
  tags: string[];
  hasExplicitTitle: boolean;
  hasFirstHeading: boolean;
  frontMatterParseFailed: boolean;
}

interface BaseSection {
  heading: string | null;
  headingDepth: number;
  content: string;
  startLine: number | null;
  endLine: number | null;
}

export function parseProjectKnowledgeMarkdown(
  file: {
    path: string;
    relativePath: string;
    fileName: string;
    fileSize: number;
    modifiedTimeMs: number;
    markdown: string;
    contentHash: string;
  },
  limits: {
    maxSectionChars: number;
    maxChunks: number;
  }
) {
  const metadata = extractMetadata(file.relativePath, file.markdown);
  const baseSections = splitMarkdownIntoBaseSections(metadata.content);
  const headingCount = baseSections.filter((section) => section.heading).length;
  const diagnostics: ProjectKnowledgeScanDiagnostic[] = [];

  if (metadata.frontMatterParseFailed) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter_parse_failure',
      relativePath: file.relativePath,
      message: 'Frontmatter starts but does not have a closing marker.',
      suggestedAction: 'Close the frontmatter block with --- or remove it.'
    });
  }

  if (!metadata.hasExplicitTitle && !metadata.hasFirstHeading) {
    diagnostics.push({
      severity: 'warning',
      code: 'missing_title_or_h1',
      relativePath: file.relativePath,
      message: 'Markdown file has no frontmatter title or top-level heading.',
      suggestedAction: 'Add a clear title or H1 so Project Knowledge can route to it.'
    });
  }

  if (metadata.content.length > 4_000 && headingCount === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'large_file_without_headings',
      relativePath: file.relativePath,
      message: 'Large markdown file has no headings for section-level retrieval.',
      suggestedAction: 'Add descriptive section headings or split the file.'
    });
  }

  if (metadata.aliases.length === 0 && metadata.tags.length === 0 && headingCount <= 1) {
    diagnostics.push({
      severity: 'info',
      code: 'weak_metadata',
      relativePath: file.relativePath,
      message: 'Markdown file has few retrieval cues beyond its title.',
      suggestedAction: 'Add aliases, tags, or specific headings if this page should be easy to find.'
    });
  }

  const source: ProjectKnowledgeScannedSource = {
    path: file.path,
    relativePath: file.relativePath,
    fileName: file.fileName,
    fileSize: file.fileSize,
    modifiedTimeMs: file.modifiedTimeMs,
    contentHash: file.contentHash,
    title: metadata.title,
    aliases: metadata.aliases,
    tags: metadata.tags,
    headingCount,
    skippedReason: null
  };

  const sections: ProjectKnowledgeScannedSection[] = [];
  let ordinal = 0;
  for (const section of baseSections.length > 0
    ? baseSections
    : [{ heading: metadata.title, headingDepth: 1, content: metadata.content.trim(), startLine: null, endLine: null }]) {
    if (section.content.length > limits.maxSectionChars) {
      diagnostics.push({
        severity: 'warning',
        code: 'very_long_section',
        relativePath: file.relativePath,
        message: 'A markdown section was split because it exceeds the Project Knowledge section limit.',
        suggestedAction: 'Break long sections into smaller headed sections.'
      });
    }

    for (const content of splitSectionContent(section.content, limits.maxSectionChars)) {
      ordinal += 1;
      sections.push({
        sourceRelativePath: file.relativePath,
        ordinal,
        title: metadata.title,
        aliases: metadata.aliases,
        tags: metadata.tags,
        fileName: file.fileName,
        path: file.path,
        relativePath: file.relativePath,
        heading: section.heading,
        headingDepth: section.headingDepth,
        startLine: section.startLine,
        endLine: section.endLine,
        content,
        previewText: createPreviewText(content),
        contentHash: createProjectKnowledgeContentHash(content)
      });
    }
  }

  return {
    source,
    sections: sections.slice(0, limits.maxChunks),
    diagnostics
  };
}

export function createProjectKnowledgeContentHash(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

function splitFrontMatter(markdown: string) {
  const normalized = markdown.replace(/\r\n?/gu, '\n');
  if (!normalized.startsWith('---\n')) {
    return {
      frontMatter: '',
      content: normalized,
      parseFailed: false
    };
  }

  const endIndex = normalized.indexOf('\n---', 4);
  if (endIndex < 0) {
    return {
      frontMatter: '',
      content: normalized,
      parseFailed: true
    };
  }

  return {
    frontMatter: normalized.slice(4, endIndex).trim(),
    content: normalized.slice(endIndex + 4).trimStart(),
    parseFailed: false
  };
}

function readFrontMatterScalar(frontMatter: string, key: string) {
  const match = frontMatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'imu'));
  const value = match?.[1]?.trim();
  if (!value || value.startsWith('[')) {
    return null;
  }
  return stripQuotes(value);
}

function splitInlineList(value: string) {
  const trimmed = value.trim();
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner
    .split(',')
    .map(stripQuotes)
    .filter(Boolean);
}

function readFrontMatterList(frontMatter: string, key: string) {
  const inlineMatch = frontMatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'imu'));
  if (inlineMatch?.[1]?.trim()) {
    return splitInlineList(inlineMatch[1]);
  }

  const lines = frontMatter.split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`, 'iu').test(line.trim()));
  if (startIndex < 0) {
    return [];
  }

  const values: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^[A-Za-z][\w-]*:\s*/u.test(line)) {
      break;
    }
    const itemMatch = line.match(/^\s*-\s+(.+)$/u);
    if (itemMatch?.[1]) {
      values.push(stripQuotes(itemMatch[1]));
    }
  }
  return values.filter(Boolean);
}

function extractFirstHeading(markdown: string) {
  return markdown.match(/^#\s+(.+?)\s*#*\s*$/mu)?.[1]?.trim() ?? null;
}

function extractMetadata(relativePath: string, markdown: string): MarkdownMetadata {
  const { frontMatter, content, parseFailed } = splitFrontMatter(markdown);
  const explicitTitle = readFrontMatterScalar(frontMatter, 'title');
  const firstHeading = extractFirstHeading(content);
  const title = explicitTitle ?? firstHeading ?? basename(relativePath, extname(relativePath));

  return {
    content,
    title,
    aliases: readFrontMatterList(frontMatter, 'aliases'),
    tags: readFrontMatterList(frontMatter, 'tags'),
    hasExplicitTitle: Boolean(explicitTitle),
    hasFirstHeading: Boolean(firstHeading),
    frontMatterParseFailed: parseFailed
  };
}

function splitMarkdownIntoBaseSections(content: string) {
  const sections: BaseSection[] = [];
  let currentHeading: string | null = null;
  let currentHeadingDepth = 0;
  let currentStartLine: number | null = 1;
  let currentLines: string[] = [];

  const flush = (endLine: number | null) => {
    const sectionContent = currentLines.join('\n').trim();
    if (sectionContent || currentHeading) {
      sections.push({
        heading: currentHeading,
        headingDepth: currentHeadingDepth,
        content: sectionContent || (currentHeading ? `# ${currentHeading}` : ''),
        startLine: currentStartLine,
        endLine
      });
    }
    currentLines = [];
  };

  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (headingMatch?.[2]) {
      flush(lineNumber - 1);
      currentHeading = headingMatch[2].trim();
      currentHeadingDepth = headingMatch[1]?.length ?? 1;
      currentStartLine = lineNumber;
      return;
    }
    currentLines.push(line);
  });
  flush(lines.length);

  return sections;
}

function splitSectionContent(content: string, maxSectionChars: number) {
  const paragraphs = content
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxSectionChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (paragraph.length <= maxSectionChars) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += maxSectionChars) {
      chunks.push(paragraph.slice(index, index + maxSectionChars).trim());
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks.filter(Boolean);
}

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/gu, '').trim();
}

function createPreviewText(content: string) {
  return content.replace(/\s+/gu, ' ').trim().slice(0, 280);
}
