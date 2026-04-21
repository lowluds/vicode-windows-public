function joinStatePath(base: string, ...segments: string[]) {
  const normalizedBase = base.replace(/[\\/]+$/u, '');
  const separator = normalizedBase.includes('\\') ? '\\' : '/';
  return [normalizedBase, ...segments].join(separator);
}

export function getGlobalSkillRoot(statePath: string) {
  return joinStatePath(statePath, 'skills', 'user');
}

export function getProjectSkillRoot(statePath: string, projectId: string) {
  return joinStatePath(statePath, 'skills', 'project', projectId);
}

export function getGlobalPluginRoot(statePath: string) {
  return joinStatePath(statePath, 'plugins', 'user');
}

export function getProjectPluginRoot(statePath: string, projectId: string) {
  return joinStatePath(statePath, 'plugins', 'project', projectId);
}

export function buildSkillCreatorPrompt(input: {
  statePath: string;
  projectName?: string | null;
  projectId?: string | null;
}) {
  const lines = [
    '$skill-creator Help me create a new Vicode skill.',
    '',
    'Write the files directly on disk so Vicode can detect them without any manual form entry.',
    '',
    `Global skill root: \`${getGlobalSkillRoot(input.statePath)}\``
  ];

  if (input.projectId) {
    lines.push(
      `Project skill root${input.projectName ? ` for ${input.projectName}` : ''}: \`${getProjectSkillRoot(input.statePath, input.projectId)}\``
    );
  }

  lines.push(
    '',
    'Requirements:',
    '- create exactly one skill folder',
    '- use the global root unless the skill is clearly project-specific',
    '- the folder location determines whether the skill is global or project-scoped',
    '- inside that folder write `SKILL.md`',
    '- use frontmatter with `name` and `description`, then write the body as concise operational instructions',
    '- if Vicode-specific metadata is needed, add `.vicode-skill.json` beside `SKILL.md`',
    '- `.vicode-skill.json` may include `id`, `slug`, `providerTargets`, `enabled`, `syncTargets`, and `category`',
    '- default to a global skill enabled for all providers unless the request clearly needs something narrower',
    '- do not ask me to copy text into another form',
    '',
    'When you finish, tell me the folder name and what the skill is for.'
  );

  return lines.join('\n');
}

export function buildPluginCreatorPrompt(input: {
  statePath: string;
  projectName?: string | null;
  projectId?: string | null;
}) {
  const lines = [
    '$plugin-creator Help me create a new Vicode plugin.',
    '',
    'Write the files directly on disk so Vicode can detect them without any manual form entry.',
    '',
    `Global plugin root: \`${getGlobalPluginRoot(input.statePath)}\``
  ];

  if (input.projectId) {
    lines.push(
      `Project plugin root${input.projectName ? ` for ${input.projectName}` : ''}: \`${getProjectPluginRoot(input.statePath, input.projectId)}\``
    );
  }

  lines.push(
    '',
    'Requirements:',
    '- create exactly one plugin folder',
    '- the folder location determines whether the plugin is global or project-scoped',
    '- inside that folder write `.codex-plugin/plugin.json` with at least `name` and `description`',
    '- for Vicode right now, include `.mcp.json` beside the manifest so the plugin can be imported as an MCP server',
    '- `.mcp.json` should be a simple stdio config object with `command`, `args`, `cwd`, `env`, `enabled`, `toolInvocationMode`, and `launchApproved`',
    '- default to safe values: `enabled: true`, `toolInvocationMode: "ask"`, `launchApproved: false`',
    '- keep helper scripts or assets inside the plugin folder and use `cwd` plus relative args when that is simpler',
    '- do not ask me to fill a manual form',
    '',
    'When you finish, tell me the folder name and what command the plugin will run.'
  );

  return lines.join('\n');
}
