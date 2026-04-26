const STANDALONE_LIST_SEPARATOR_LINE_PATTERN = /^\s*(?:[-*+•●▪◦])\s*$/u;

function stripStandaloneListSeparatorLines(source: string) {
  return source
    .split(/(```[\s\S]*?```)/gu)
    .map((segment) => {
      if (segment.startsWith('```')) {
        return segment;
      }

      return segment
        .split('\n')
        .filter((line) => !STANDALONE_LIST_SEPARATOR_LINE_PATTERN.test(line))
        .join('\n');
    })
    .join('')
    .replace(/\n{3,}/gu, '\n\n');
}

function isTopLevelUnorderedListLine(line: string) {
  return /^(?:[-*+•●▪◦])\s+\S/u.test(line);
}

function tightenLooseMarkdownLists(source: string) {
  return source
    .split(/(```[\s\S]*?```)/gu)
    .map((segment) => {
      if (segment.startsWith('```')) {
        return segment;
      }

      const lines = segment.split('\n');
      const tightened: string[] = [];

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.trim()) {
          tightened.push(line);
          continue;
        }

        const previousNonEmpty = [...tightened].reverse().find((value) => value.trim());
        const nextNonEmpty = lines.slice(index + 1).find((value) => value.trim());
        if (
          previousNonEmpty
          && nextNonEmpty
          && isTopLevelUnorderedListLine(nextNonEmpty)
          && (isTopLevelUnorderedListLine(previousNonEmpty) || /[:!?]$/u.test(previousNonEmpty.trim()))
        ) {
          continue;
        }

        tightened.push(line);
      }

      return tightened.join('\n');
    })
    .join('')
    .replace(/\n{3,}/gu, '\n\n');
}

function normalizeListLikeMarkdown(source: string) {
  let text = source;
  const listItemLead = String.raw`(?:\*\*|[A-Z0-9]|\p{Extended_Pictographic})`;

  text = text.replace(/^(#{2,6}\s[^\n]+?)-\s*(?=[A-Z0-9])/gmu, '$1\n- ');
  text = text.replace(new RegExp(`([:!?])[ \\t]*[-•●▪◦][ \\t]+(?=${listItemLead})`, 'gu'), '$1\n- ');
  text = text.replace(new RegExp(`([.])[ \\t]*[-•●▪◦][ \\t]+(?=${listItemLead})`, 'gu'), '$1\n- ');
  text = text.replace(new RegExp(`(?<=\\S)[ \\t]+[-•●▪◦][ \\t]+(?=${listItemLead})`, 'gu'), '\n- ');
  text = normalizeInlineBoldLabelBullets(text);
  text = text.replace(/^- ([^\nA-Za-z0-9]{1,6})\s*\n- (\*\*[^*\n]{2,60}:\*\*)/gmu, '- $1 $2');
  text = text.replace(/^- ([^\nA-Za-z0-9]{1,6})\s{2,}(\*\*[^*\n]{2,60}:\*\*)/gmu, '- $1 $2');
  text = text.replace(/^(\d+)\.\s*\n-\s+(\*\*[^*\n]{2,60}:\*\*)/gmu, '$1. $2');
  text = text.replace(/^(\d+)\.\s*\n(\*\*[^*\n]{2,60}:\*\*)/gmu, '$1. $2');
  text = text.replace(/\n{3,}/gu, '\n\n');

  return text.trim();
}

function normalizeInlineBoldLabelBullets(source: string) {
  return source
    .split('\n')
    .map((line) => {
      if (/^\s*(?:[-*+]\s+|\d+\.\s+)/u.test(line)) {
        return line;
      }

      return line.replace(/(\S)\s+(\*\*[^*\n]{2,60}:\*\*)/gu, '$1\n- $2');
    })
    .join('\n');
}

function normalizeOrderedListLineBreaks(source: string) {
  return source
    .replace(/(^|\n)(\s*(?:\*\*)?\d+\.(?:\*\*)?)\s*\n{1,2}(?=(?:\*\*)?\S)/gmu, '$1$2 ')
    .replace(/^(\s*)\*\*(\d+)\.\s+(.+?)\*\*$/gmu, '$1$2. **$3**');
}

function normalizeMarkdownHeadingBreaks(source: string) {
  return source
    .replace(/([^#\n])(?=#{2,6}\s)/gu, '$1\n\n')
    .replace(
      /(#{2,6}\s[^\n]{2,160}?)(?=(?:bash|sh|shell|cmd|powershell|pwsh|python|json|yaml|yml|ts|tsx|js|jsx|sql|http|diff)#)/giu,
      '$1\n\n'
    )
    .replace(/\b(bash|sh|shell|cmd|powershell|pwsh|python|json|yaml|yml|ts|tsx|js|jsx|sql|http|diff)#/giu, '$1\n#');
}

function shouldRecoverDenseMarkdown(source: string) {
  const listItemLead = String.raw`(?:\*\*|[A-Z0-9]|\p{Extended_Pictographic})`;
  return (
    /(?:^|[^#\n])#{2,6}\s/u.test(source)
    || new RegExp(`(?:[:.!?]|[)\\]}])[ \\t]*[-•●▪◦][ \\t]+(?=${listItemLead})`, 'u').test(source)
    || new RegExp(`(?<=\\S)[ \\t]+[-•●▪◦][ \\t]+(?=${listItemLead})`, 'u').test(source)
  );
}

function normalizeCommandSnippetMarkdown(source: string) {
  const lines = source.split('\n');
  const normalized: string[] = [];
  const shellLanguageMarkers = new Set([
    'bash',
    'sh',
    'shell',
    'zsh',
    'cmd',
    'powershell',
    'pwsh'
  ]);

  function looksLikeCommand(value: string) {
    return /^(?:[A-Za-z0-9_.-]+(?:\s+[^\n]+)?|\.\/[^\s]+|npm\s+\S+|pnpm\s+\S+|yarn\s+\S+|bun\s+\S+)/u.test(
      value.trim()
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index].trim();
    const next = lines[index + 1]?.trim() ?? '';
    const previous = normalized[normalized.length - 1]?.trim() ?? '';

    if (
      shellLanguageMarkers.has(current.toLowerCase())
      && next
      && looksLikeCommand(next)
      && previous !== '```'
      && !previous.startsWith('```')
    ) {
      normalized.push(`\`\`\`${current.toLowerCase()}`);
      normalized.push(lines[index + 1]);
      normalized.push('```');
      index += 1;
      continue;
    }

    normalized.push(lines[index]);
  }

  return normalized.join('\n');
}

function looksLikeJsonBlock(value: string) {
  const candidate = value.trim();
  if (!candidate || !/^[\[{]/u.test(candidate)) {
    return false;
  }

  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHttpBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    lines.length > 0
    && lines.every((line) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/|\S+:\/\/)/u.test(line))
  );
}

function looksLikeDiffBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim());
  return lines.some((line) => /^diff --git\b/u.test(line) || /^@@ /u.test(line) || /^(---|\+\+\+) /u.test(line));
}

function looksLikeYamlBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  const contentLines = lines.filter((line) => line !== '---');
  if (contentLines.length === 0) {
    return false;
  }

  return contentLines.every((line) => /^[-\w"'./]+:\s*(?:.+)?$/u.test(line) || /^-\s+[-\w"'./]+:\s*(?:.+)?$/u.test(line));
}

function looksLikePythonBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  return lines.some((line) =>
    /^(?:from\s+\S+\s+import\s+\S+|import\s+\S+|def\s+\w+\s*\(|class\s+\w+|if\s+__name__\s*==\s*['"]__main__['"]|print\s*\(|return\s+|async\s+def\s+\w+\s*\()/u.test(
      line
    )
  );
}

function looksLikeTsxBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  return lines.some((line) => /^(?:return\s*\(|<[\w.-]+(?:\s|>|\/>))/u.test(line))
    && lines.some((line) => /<\/[\w.-]+>|className=|onClick=|\{\w+/u.test(line));
}

function looksLikeTypescriptBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  return lines.some((line) =>
    /^(?:interface\s+\w+|type\s+\w+\s*=|enum\s+\w+|async\s+function\s+\w+|function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|export\s+(?:type|interface|const|function)|import\s+.+\s+from\s+['"])/u.test(
      line
    )
  ) && lines.some((line) => /:\s*[A-Z_a-z][\w<>\[\]|,& ]*|=>|Promise<|infer\s+\w+|extends\s+|console\.log\(/u.test(line));
}

function looksLikeJavascriptBlock(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  return lines.some((line) =>
    /^(?:async\s+function\s+\w+|function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|export\s+(?:const|function)|import\s+.+\s+from\s+['"])/u.test(
      line
    )
  );
}

function inferCommandFenceLanguage(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const commandish = lines.every((line) =>
    /^(?:npm|pnpm|yarn|bun|npx|node|git|cd|mkdir|rm|cp|mv|curl|wget|ls|cat|echo|python|pip|uv|cargo|go|dotnet|set\b|\$env:|Get-|Set-|Write-|New-|Remove-|Start-|Stop-|Select-|Where-|Invoke-|Test-|[A-Z_][A-Z0-9_]*=|\.\/|\/|[A-Za-z]:\\)/iu.test(
      line
    )
  );

  if (!commandish) {
    return null;
  }

  if (lines.some((line) => /^\$env:|^(Get|Set|Write|New|Remove|Start|Stop|Select|Where|Invoke|Test)-/iu.test(line))) {
    return 'powershell';
  }

  if (lines.some((line) => /^set\s+[A-Z_][A-Z0-9_]*=/iu.test(line))) {
    return 'cmd';
  }

  return 'bash';
}

function inferUnlabeledFenceLanguage(value: string) {
  if (looksLikeDiffBlock(value)) {
    return 'diff';
  }

  if (looksLikeHttpBlock(value)) {
    return 'http';
  }

  if (looksLikeJsonBlock(value)) {
    return 'json';
  }

  if (looksLikeYamlBlock(value)) {
    return 'yaml';
  }

  if (looksLikePythonBlock(value)) {
    return 'python';
  }

  if (looksLikeTsxBlock(value)) {
    return 'tsx';
  }

  if (looksLikeTypescriptBlock(value)) {
    return 'ts';
  }

  if (looksLikeJavascriptBlock(value)) {
    return 'js';
  }

  return inferCommandFenceLanguage(value);
}

function annotateUnlabeledFencedCodeBlocks(source: string) {
  return source.replace(/^```[ \t]*\n([\s\S]*?)^```$/gmu, (block, code) => {
    const language = inferUnlabeledFenceLanguage(code);
    if (!language) {
      return block;
    }

    return `\`\`\`${language}\n${code}\`\`\``;
  });
}

export function normalizeTranscriptMarkdownSource(source: string) {
  let text = source.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return '';
  }

  text = normalizeOrderedListLineBreaks(text);

  if (shouldRecoverDenseMarkdown(text)) {
    text = normalizeMarkdownHeadingBreaks(text);
    text = normalizeListLikeMarkdown(text);
  }

  text = normalizeCommandSnippetMarkdown(text);
  text = annotateUnlabeledFencedCodeBlocks(text);
  text = stripStandaloneListSeparatorLines(text);
  text = tightenLooseMarkdownLists(text);

  return text.trim();
}
