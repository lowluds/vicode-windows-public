import type { RunChangeArtifact } from '../../shared/domain';
import type {
  RunTranscriptActivityItem,
  RunTranscriptAssistantItem,
  RunTranscriptChangeArtifactItem,
  RunTranscriptItem,
  RunTranscriptResolutionSummaryItem
} from './run-activity';

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function appendIfMissing(target: string[], value: string | null) {
  if (!value) {
    return;
  }
  if (!target.includes(value)) {
    target.push(value);
  }
}

function shouldCompactAssistantPreamble(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 180) {
    return false;
  }

  if (!/[.!?…]\s*$/u.test(normalized)) {
    return false;
  }

  return /^(?:I(?:'|’)?m going to|I will|I(?:'|’)?ll|Let me|Next, I will|Next, I(?:'|’)?ll|First, I will|First, I(?:'|’)?ll)\b/u.test(
    normalized
  );
}

function isOperationalAssistantParagraph(text: string) {
  return /^(?:I(?:'|’)?m going to|I am going to|I will|I(?:'|’)?ll|I will now|I will start by|I(?:'|’)?ll start by|Let me|Next, I will|Next, I(?:'|’)?ll|First, I will|First, I(?:'|’)?ll)\b/u.test(
    text.trim()
  );
}

function isCompletionStyleAssistantParagraph(text: string) {
  const normalized = text.trim();
  if (!normalized || isOperationalAssistantParagraph(normalized)) {
    return false;
  }

  return /\b(?:complete|completed|done|repaired|updated|added|implemented|fixed|built|ready)\b/i.test(
    normalized
  );
}

function isGenericResolutionOutcome(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 120 || normalized.includes('\n')) {
    return false;
  }

  const wordCount = normalized
    .replace(/[.?!]+$/u, '')
    .split(/\s+/u)
    .filter(Boolean).length;

  if (wordCount > 5) {
    return false;
  }

  return /^(?:Feature slice complete\.|Feature slice implemented\.|Refinement complete\.|Repair complete\.|Build complete\.|Implementation complete\.|Update complete\.|Completed\.)$/iu.test(
    normalized
  ) || /^(?:Built|Implemented|Updated|Fixed|Repaired|Completed) [^.?!]{0,36}[.?!]$/iu.test(normalized);
}

function isConciseResolutionOutcome(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 140 || normalized.includes('\n')) {
    return false;
  }

  if (isOperationalAssistantParagraph(normalized)) {
    return false;
  }

  if (/^[#*-]\s/u.test(normalized)) {
    return false;
  }

  return /\b(?:complete|completed|done|repaired|updated|added|implemented|fixed|built|created|wired|verified|scaffolded|shipped|resolved|finished)\b/i.test(
    normalized
  );
}

function shouldPromoteResolutionOutcome(text: string) {
  return isGenericResolutionOutcome(text) || isConciseResolutionOutcome(text);
}

function splitAssistantParagraphs(text: string) {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function collectResolutionFiles(
  items: RunTranscriptItem[],
  changeArtifacts: RunTranscriptChangeArtifactItem[]
) {
  const files: string[] = [];

  for (const artifact of changeArtifacts) {
    for (const file of artifact.artifact.files) {
      appendIfMissing(files, clean(file.path));
    }
  }

  for (const item of items) {
    if (item.kind !== 'activity_line') {
      continue;
    }

    if (
      item.activityKind === 'file_write' ||
      item.activityKind === 'mkdir' ||
      item.activityKind === 'file_edit'
    ) {
      appendIfMissing(files, item.path ?? item.text);
      continue;
    }

    if (item.activityKind === 'write_group') {
      for (const value of item.text.split('\n')) {
        appendIfMissing(files, clean(value));
      }
    }
  }

  return files.filter(Boolean);
}

function collectResolutionVerificationCommands(items: RunTranscriptItem[]) {
  const commands: string[] = [];

  for (const item of items) {
    if (
      item.kind !== 'activity_line' ||
      item.activityKind !== 'terminal_command' ||
      item.status !== 'completed'
    ) {
      continue;
    }

    appendIfMissing(commands, item.command ? clean(item.command) : null);
  }

  return commands.filter(Boolean);
}

function collectResolutionToolsUsed(items: RunTranscriptItem[]) {
  const tools: string[] = [];

  for (const item of items) {
    if (
      item.kind !== 'activity_line' ||
      (item.activityKind !== 'tool_call' && item.activityKind !== 'tool_result')
    ) {
      continue;
    }

    const mcpToolMatch = /^(?:Calling|Completed)\s+MCP tool\s+(.+)$/iu.exec(
      item.label.trim()
    );
    if (!mcpToolMatch) {
      continue;
    }

    appendIfMissing(tools, clean(mcpToolMatch[1] ?? ''));
  }

  return tools.filter(Boolean);
}

function matchesRemainingRiskPattern(text: string) {
  const riskPatterns = [
    /^Remaining risk:[\s\S]*$/iu,
    /^No verification commands were run[\s\S]*$/iu,
    /^I did not run[\s\S]*$/iu,
    /^I didn't run[\s\S]*$/iu,
    /^I have not run[\s\S]*$/iu,
    /^I have not verified[\s\S]*$/iu,
    /^I haven't verified[\s\S]*$/iu,
    /^I was not able to run[\s\S]*$/iu,
    /^I wasn't able to run[\s\S]*$/iu,
    /^Verification was not run[\s\S]*$/iu,
    /^(?:Tests|Checks|Verification|Build) (?:were|was) not run[\s\S]*$/iu,
    /^Not (?:yet )?verified[\s\S]*$/iu,
    /^Manual verification[\s\S]*$/iu,
    /^Needs manual verification[\s\S]*$/iu,
    /^This still needs[\s\S]*$/iu,
    /^Still needs[\s\S]*$/iu,
    /^I wasn't able to verify[\s\S]*$/iu,
    /^You(?:'ll| will) (?:still )?(?:want|need) to[\s\S]*$/iu,
    /^You may still want to[\s\S]*$/iu,
    /^Next step:[\s\S]*$/iu,
    /^The only thing left[\s\S]*$/iu,
    /^Pending verification[\s\S]*$/iu
  ];

  return riskPatterns.some((pattern) => pattern.test(text.trim()));
}

function deriveRemainingRisk(outcome: string) {
  const normalized = outcome.trim();
  if (!normalized) {
    return null;
  }

  const paragraphs = splitAssistantParagraphs(normalized);
  const riskParagraph = paragraphs.find((paragraph) =>
    matchesRemainingRiskPattern(paragraph)
  );
  if (riskParagraph) {
    return riskParagraph.trim();
  }

  const candidateSentences = paragraphs.flatMap((paragraph) =>
    paragraph
      .split(/(?<=[.?!])\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
  );

  for (const candidate of candidateSentences) {
    if (matchesRemainingRiskPattern(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

function isSubstantiveResolutionDetailParagraph(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length < 24) {
    return false;
  }

  return (
    !isGenericResolutionOutcome(normalized) &&
    !isOperationalAssistantParagraph(normalized)
  );
}

function shouldKeepResolutionDetailParagraph(
  text: string,
  resolutionSummary: RunTranscriptResolutionSummaryItem
) {
  const normalized = text.trim();
  if (!isSubstantiveResolutionDetailParagraph(normalized)) {
    return false;
  }

  const normalizedOutcome = resolutionSummary.outcome.trim();
  if (normalized === normalizedOutcome) {
    return false;
  }

  const normalizedRisk = resolutionSummary.remainingRisk?.trim() ?? null;
  if (!normalizedRisk) {
    return true;
  }

  const trimmedWithoutRisk = normalized
    .replace(normalizedRisk, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
  return (
    Boolean(trimmedWithoutRisk) &&
    isSubstantiveResolutionDetailParagraph(trimmedWithoutRisk)
  );
}

export function deriveResolutionSummaryItem(
  items: RunTranscriptItem[],
  changeArtifacts: RunTranscriptChangeArtifactItem[],
  runState: 'completed' | 'failed' | 'aborted' | null
) {
  if (runState !== 'completed') {
    return null;
  }

  const assistantItems = items.filter(
    (item): item is RunTranscriptAssistantItem => item.kind === 'assistant_text'
  );
  const finalAssistant = assistantItems.at(-1)?.text.trim() ?? '';
  const assistantParagraphs = splitAssistantParagraphs(finalAssistant);
  const outcome = assistantParagraphs[0] ?? finalAssistant;
  if (!shouldPromoteResolutionOutcome(outcome)) {
    return null;
  }

  const filesChanged = collectResolutionFiles(items, changeArtifacts);
  const toolsUsed = collectResolutionToolsUsed(items);
  const verificationCommands = collectResolutionVerificationCommands(items);
  const remainingRisk = deriveRemainingRisk(finalAssistant);

  if (
    filesChanged.length === 0 &&
    toolsUsed.length === 0 &&
    verificationCommands.length === 0 &&
    !remainingRisk
  ) {
    return null;
  }

  return {
    id: `resolution-summary:${items.length}`,
    kind: 'resolution_summary' as const,
    outcome,
    filesChanged,
    toolsUsed,
    verificationCommands,
    remainingRisk
  };
}

export function compactAssistantDetailAfterResolutionSummary(
  items: RunTranscriptItem[]
) {
  const resolutionSummary = items.find(
    (item): item is RunTranscriptResolutionSummaryItem =>
      item.kind === 'resolution_summary'
  );
  if (!resolutionSummary) {
    return items;
  }

  const results = [...items];
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const item = results[index];
    if (!item || item.kind !== 'assistant_text') {
      continue;
    }

    const paragraphs = splitAssistantParagraphs(item.text);
    if (
      paragraphs.length === 0 ||
      !shouldPromoteResolutionOutcome(paragraphs[0] ?? '')
    ) {
      break;
    }

    const detailParagraphs = paragraphs
      .slice(1)
      .map((paragraph) => {
        const normalizedRisk = resolutionSummary.remainingRisk?.trim() ?? null;
        if (!normalizedRisk) {
          return paragraph.trim();
        }
        return paragraph
          .replace(normalizedRisk, '')
          .replace(/\s{2,}/gu, ' ')
          .trim();
      })
      .filter((paragraph) =>
        shouldKeepResolutionDetailParagraph(paragraph, resolutionSummary)
      );
    if (detailParagraphs.length === 0) {
      results.splice(index, 1);
      break;
    }

    results[index] = {
      ...item,
      text: detailParagraphs.join('\n\n')
    };
    break;
  }

  return results;
}

export function compactOperationalAssistantNarration(items: RunTranscriptItem[]) {
  return items.map((item, index) => {
    if (item.kind !== 'assistant_text') {
      return item;
    }

    const paragraphs = item.text
      .split(/\n\s*\n/u)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    if (paragraphs.length < 2) {
      return item;
    }

    const completionParagraph = paragraphs.at(-1) ?? '';
    const operationalParagraphs = paragraphs.slice(0, -1);
    if (
      operationalParagraphs.length === 0 ||
      !isCompletionStyleAssistantParagraph(completionParagraph) ||
      !operationalParagraphs.every(isOperationalAssistantParagraph)
    ) {
      return item;
    }

    const hasConcreteWorkBefore = items.slice(0, index).some(
      (candidate) =>
        candidate.kind === 'activity_line' &&
        candidate.activityKind !== 'thinking' &&
        candidate.activityKind !== 'skill'
    );

    if (!hasConcreteWorkBefore) {
      return item;
    }

    return {
      ...item,
      text: completionParagraph
    };
  });
}

export function compactAssistantFollowUps(items: RunTranscriptItem[]) {
  const results = [...items];

  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    if (
      !item ||
      item.kind !== 'assistant_text' ||
      !shouldCompactAssistantPreamble(item.text)
    ) {
      continue;
    }

    let sawWork = false;
    let foundLaterAssistant = false;

    for (let nextIndex = index + 1; nextIndex < results.length; nextIndex += 1) {
      const nextItem = results[nextIndex];
      if (!nextItem) {
        continue;
      }

      if (nextItem.kind === 'assistant_text') {
        foundLaterAssistant = true;
        break;
      }

      if (nextItem.kind === 'change_artifact') {
        continue;
      }

      if (nextItem.kind === 'worked_for' || nextItem.kind === 'activity_line') {
        sawWork = true;
        continue;
      }

      break;
    }

    if (sawWork && foundLaterAssistant) {
      results.splice(index, 1);
      index -= 1;
    }
  }

  return results;
}
