import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SkillDefinition, SkillDetail } from '../../shared/domain';
import {
  buildSkillDocument,
  getSkillAttachMode,
  getSkillBrowseUrl,
  getSkillDetailMarkdown,
  getSkillExamplePrompt,
  getSkillIconPath,
  getSkillKind
} from '../../shared/skills';

function splitFrontMatter(markdown: string) {
  if (!markdown.startsWith('---')) {
    return {
      frontMatter: '',
      content: markdown
    };
  }

  const endIndex = markdown.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {
      frontMatter: '',
      content: markdown
    };
  }

  return {
    frontMatter: markdown.slice(3, endIndex).trim(),
    content: markdown.slice(endIndex + 4).trimStart()
  };
}

function stripFrontMatter(markdown: string) {
  return splitFrontMatter(markdown).content;
}

export class SkillCatalogReadService {
  constructor(
    private readonly listRawSkills: () => SkillDefinition[],
    private readonly getRawSkill: (skillId: string) => SkillDefinition,
    private readonly hydrateSkill: (skill: SkillDefinition) => SkillDefinition
  ) {}

  listSkills() {
    return this.listRawSkills().map((skill) => this.hydrateSkill(skill));
  }

  getSkillDetail(skillId: string): SkillDetail {
    const skill = this.hydrateSkill(this.getRawSkill(skillId));
    let markdown = getSkillDetailMarkdown(skill);

    if (!markdown && skill.path && existsSync(skill.path)) {
      markdown = readFileSync(skill.path, 'utf8');
    }

    if (!markdown) {
      markdown = buildSkillDocument(skill);
    }

    markdown = stripFrontMatter(markdown);

    return {
      skillId: skill.id,
      markdown,
      examplePrompt: getSkillExamplePrompt(skill),
      iconPath: getSkillIconPath(skill),
      folderPath: skill.path ? dirname(skill.path) : null,
      browseUrl: getSkillBrowseUrl(skill),
      attachMode: getSkillAttachMode(skill),
      kind: getSkillKind(skill)
    };
  }
}
