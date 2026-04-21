import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface RepoInspectionResult {
  folderPath: string;
  repoName: string;
  repoPurpose: string;
  repoStack: string;
  packageManager: string;
  installCommand: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  platformFocus: string;
  architectureFacts: string[];
  constraints: string[];
  frameworks: string[];
  languages: string[];
}

interface PackageJsonShape {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readTextIfExists(path: string) {
  if (!existsSync(path)) {
    return null;
  }

  const content = readFileSync(path, 'utf8').trim();
  return content.length > 0 ? content : null;
}

function readJsonIfExists<T>(path: string): T | null {
  const content = readTextIfExists(path);
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeSentence(value: string) {
  const trimmed = collapseWhitespace(value);
  if (!trimmed) {
    return '';
  }

  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function summarizeReadme(readme: string | null) {
  if (!readme) {
    return null;
  }

  const lines = readme
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#') && !line.startsWith('!['));

  const paragraph = lines.find((line) => line.length >= 30);
  return paragraph ? normalizeSentence(paragraph) : null;
}

function detectPackageManager(folderPath: string, packageJson: PackageJsonShape | null) {
  if (existsSync(join(folderPath, 'pnpm-lock.yaml'))) {
    return { label: 'pnpm', installCommand: 'pnpm install' };
  }
  if (existsSync(join(folderPath, 'yarn.lock'))) {
    return { label: 'yarn', installCommand: 'yarn install' };
  }
  if (existsSync(join(folderPath, 'bun.lockb')) || existsSync(join(folderPath, 'bun.lock'))) {
    return { label: 'bun', installCommand: 'bun install' };
  }
  if (existsSync(join(folderPath, 'package-lock.json')) || packageJson) {
    return { label: 'npm', installCommand: 'npm install' };
  }
  if (existsSync(join(folderPath, 'pyproject.toml'))) {
    return { label: 'python', installCommand: 'pip install -r requirements.txt' };
  }
  return { label: 'unknown', installCommand: 'Not yet defined' };
}

function detectLanguages(folderPath: string, packageJson: PackageJsonShape | null) {
  return uniqueNonEmpty([
    packageJson ? 'JavaScript' : null,
    existsSync(join(folderPath, 'tsconfig.json')) ? 'TypeScript' : null,
    existsSync(join(folderPath, 'pyproject.toml')) || existsSync(join(folderPath, 'requirements.txt')) ? 'Python' : null,
    existsSync(join(folderPath, 'Cargo.toml')) ? 'Rust' : null,
    existsSync(join(folderPath, 'go.mod')) ? 'Go' : null
  ]);
}

function detectFrameworks(folderPath: string, packageJson: PackageJsonShape | null) {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };

  return uniqueNonEmpty([
    deps.electron ? 'Electron' : null,
    deps.react ? 'React' : null,
    deps.next ? 'Next.js' : null,
    deps.vue ? 'Vue' : null,
    deps.svelte ? 'Svelte' : null,
    deps.vite || existsSync(join(folderPath, 'vite.config.ts')) || existsSync(join(folderPath, 'vite.config.js')) ? 'Vite' : null,
    deps['better-sqlite3'] ? 'SQLite' : null,
    deps.zod ? 'Zod' : null,
    deps.typescript || existsSync(join(folderPath, 'tsconfig.json')) ? 'TypeScript' : null
  ]);
}

function detectPlatformFocus(folderPath: string, packageJson: PackageJsonShape | null, agents: string | null) {
  const haystack = [packageJson?.description, agents].filter(Boolean).join('\n').toLowerCase();
  if (haystack.includes('windows-first')) {
    return 'Windows-first';
  }
  if (existsSync(join(folderPath, 'electron-builder.yml')) || existsSync(join(folderPath, 'electron.vite.config.ts'))) {
    return 'Desktop';
  }
  return 'Cross-platform';
}

function inferScriptCommand(scripts: Record<string, string> | undefined, preferredNames: string[]) {
  if (!scripts) {
    return null;
  }

  for (const name of preferredNames) {
    if (scripts[name]) {
      return `npm run ${name}`;
    }
  }

  return null;
}

function extractConstraints(agents: string | null, packageJson: PackageJsonShape | null, platformFocus: string) {
  const constraints: string[] = [];
  const agentLines = (agents ?? '')
    .split(/\r?\n/u)
    .map((line) => collapseWhitespace(line.replace(/^[-*]\s*/u, '')))
    .filter(Boolean);

  const keywordPatterns = [
    /windows-first/iu,
    /no new dependenc/iu,
    /renderer .*unprivileged/iu,
    /preload .*typed bridge/iu,
    /contextIsolation/iu,
    /sandbox/iu,
    /small diffs/iu,
    /do not .*plugin/iu
  ];

  for (const line of agentLines) {
    if (keywordPatterns.some((pattern) => pattern.test(line))) {
      constraints.push(normalizeSentence(line));
    }
  }

  if (platformFocus === 'Windows-first') {
    constraints.push('Optimize process spawning, path handling, and native module behavior for Windows first.');
  }

  if (packageJson?.dependencies?.electron || packageJson?.devDependencies?.electron) {
    constraints.push('Keep Electron process boundaries strict: main owns privileged operations, renderer stays unprivileged.');
  }

  return uniqueNonEmpty(constraints).slice(0, 3);
}

function extractArchitectureFacts(
  folderPath: string,
  frameworks: string[],
  languages: string[],
  packageJson: PackageJsonShape | null
) {
  const facts = uniqueNonEmpty([
    frameworks.includes('Electron') && existsSync(join(folderPath, 'src', 'main'))
      ? 'The app is split into main, preload, and renderer process boundaries.'
      : null,
    existsSync(join(folderPath, 'src', 'storage'))
      ? 'Persistence is owned locally by the app rather than delegated to provider-native state.'
      : null,
    packageJson?.dependencies?.['better-sqlite3']
      ? 'SQLite via better-sqlite3 is part of the core application architecture.'
      : null,
    frameworks.includes('React') && frameworks.includes('Vite')
      ? 'The renderer is built with React and Vite.'
      : null,
    languages.includes('TypeScript') ? 'TypeScript is part of the primary implementation stack.' : null
  ]);

  return facts.slice(0, 3);
}

function inferPurpose(folderPath: string, packageJson: PackageJsonShape | null, readme: string | null) {
  const fromReadme = summarizeReadme(readme);
  if (fromReadme) {
    return fromReadme;
  }

  if (packageJson?.description?.trim()) {
    return normalizeSentence(packageJson.description);
  }

  return `${basename(folderPath)} project workspace.`;
}

function formatStack(frameworks: string[], languages: string[]) {
  const values = uniqueNonEmpty([...frameworks, ...languages]);
  return values.length > 0 ? values.join(', ') : 'Not yet identified';
}

export class RepoInspectionService {
  inspect(folderPath: string): RepoInspectionResult {
    const packageJson = readJsonIfExists<PackageJsonShape>(join(folderPath, 'package.json'));
    const readme = readTextIfExists(join(folderPath, 'README.md'));
    const agents = readTextIfExists(join(folderPath, 'AGENTS.md'));
    const packageManager = detectPackageManager(folderPath, packageJson);
    const frameworks = detectFrameworks(folderPath, packageJson);
    const languages = detectLanguages(folderPath, packageJson);
    const platformFocus = detectPlatformFocus(folderPath, packageJson, agents);
    const scripts = packageJson?.scripts;

    return {
      folderPath,
      repoName: packageJson?.name?.trim() || basename(folderPath),
      repoPurpose: inferPurpose(folderPath, packageJson, readme),
      repoStack: formatStack(frameworks, languages),
      packageManager: packageManager.label,
      installCommand: packageManager.installCommand,
      buildCommand: inferScriptCommand(scripts, ['build', 'compile']),
      testCommand: inferScriptCommand(scripts, ['test', 'check']),
      lintCommand: inferScriptCommand(scripts, ['lint', 'typecheck']),
      platformFocus,
      architectureFacts: extractArchitectureFacts(folderPath, frameworks, languages, packageJson),
      constraints: extractConstraints(agents, packageJson, platformFocus),
      frameworks,
      languages
    };
  }

  listRecognizedRoots(folderPath: string) {
    return readdirSync(folderPath, { withFileTypes: true }).map((entry) => entry.name);
  }
}
