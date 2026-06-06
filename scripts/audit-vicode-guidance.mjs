import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const guidanceRoot = path.join(root, 'resources', 'vicode-guidance');
const textExtensions = new Set(['.json', '.md', '.txt', '.yml', '.yaml']);
const privateName = process.env.VICODE_GUIDANCE_PRIVATE_NAME ?? ['Ky', 'le'].join('');
const privateSlug = process.env.VICODE_GUIDANCE_PRIVATE_SLUG ?? `${privateName.toLowerCase()}-`;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const forbiddenPathParts = [
  '.obsidian',
  'tmp',
  'Log.md',
  `${privateName} Working Preferences.md`,
  'Working Preferences.md'
];

const forbiddenPatterns = [
  {
    label: 'personal name',
    pattern: new RegExp(`\\b${escapeRegex(privateName)}\\b|\\b${escapeRegex(privateSlug)}\\b`, 'iu')
  },
  {
    label: 'Windows user path',
    pattern: /C:\\Users\\|C:\/Users\/|\/Users\//iu
  },
  {
    label: 'local project path',
    pattern: /D:\\Projects\b|D:\/Projects\b|\\\\\?\\D:\\Projects\b|Source - D Projects|D Projects Pattern Sweep/iu
  },
  {
    label: 'private working preferences route',
    pattern: /\[\[[^\]\n]*Working Preferences[^\]\n]*\]\]|private working preferences/iu
  },
  {
    label: 'email address',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu
  },
  {
    label: 'OpenAI-like secret',
    pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{10,}/u
  },
  {
    label: 'GitHub token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{10,}/u
  },
  {
    label: 'AWS access key',
    pattern: /AKIA[0-9A-Z]{16}/u
  },
  {
    label: 'Google API key',
    pattern: /AIza[0-9A-Za-z_-]{10,}/u
  },
  {
    label: 'private key block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
  }
];

function normalizePath(value) {
  return value.replace(/\\/gu, '/');
}

function walkFiles(targetPath, files = []) {
  if (!existsSync(targetPath)) {
    return files;
  }

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    files.push(targetPath);
    return files;
  }

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    walkFiles(path.join(targetPath, entry.name), files);
  }

  return files;
}

function main() {
  const findings = [];

  if (!existsSync(guidanceRoot)) {
    findings.push('Missing resources/vicode-guidance.');
  }

  const files = walkFiles(guidanceRoot);
  const normalizedFiles = files.map((filePath) => normalizePath(path.relative(guidanceRoot, filePath)));
  for (const relativePath of normalizedFiles) {
    for (const forbiddenPart of forbiddenPathParts) {
      if (relativePath.split('/').includes(forbiddenPart)) {
        findings.push(`${relativePath}: forbidden guidance path`);
      }
    }
  }

  const requiredFiles = [
    'VICODE.md',
    'wiki/Task Routing.md',
    'wiki/Source-Backed Workflow.md',
    'wiki/Ollama And Local Models.md',
    'wiki/Retrieval For Coding Projects.md',
    'wiki/Source Quality And Grounding.md',
    'wiki/Tool Use And Trust.md',
    'wiki/Coding Agent Workflows.md',
    'wiki/Structured Outputs And Evals.md',
    'wiki/Frontend Standards.md',
    'wiki/Code Organization Standard.md',
    'wiki/Security And Secrets.md',
    'manifest.json'
  ];

  for (const requiredFile of requiredFiles) {
    if (!existsSync(path.join(guidanceRoot, requiredFile))) {
      findings.push(`Missing required guidance file: ${requiredFile}`);
    }
  }

  const manifestPath = path.join(guidanceRoot, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.routing?.kind !== 'obsidian-wikilinks') {
        findings.push('manifest.json: expected routing.kind to be obsidian-wikilinks');
      }
      if (manifest.vaultRoot !== 'wiki') {
        findings.push('manifest.json: expected vaultRoot to be wiki');
      }
      if (!Array.isArray(manifest.pages)) {
        findings.push('manifest.json: expected pages array');
      } else {
        const routes = new Set();
        const paths = new Set();
        for (const [index, page] of manifest.pages.entries()) {
          if (typeof page.path !== 'string' || !page.path.startsWith('wiki/')) {
            findings.push(`manifest.json: pages[${index}].path must be a packaged wiki path`);
          } else {
            paths.add(page.path);
          }
          if (typeof page.obsidianRoute !== 'string' || !/^\[\[[^\]]+\]\]$/u.test(page.obsidianRoute)) {
            findings.push(`manifest.json: pages[${index}].obsidianRoute must be an Obsidian wikilink`);
          } else {
            routes.add(page.obsidianRoute);
            if (/Working Preferences/iu.test(page.obsidianRoute)) {
              findings.push(`manifest.json: pages[${index}].obsidianRoute references private working preferences`);
            }
          }
          if (Array.isArray(page.aliasRoutes)) {
            for (const aliasRoute of page.aliasRoutes) {
              if (typeof aliasRoute === 'string' && /Working Preferences/iu.test(aliasRoute)) {
                findings.push(`manifest.json: pages[${index}].aliasRoutes references private working preferences`);
              }
            }
          }
        }

        for (const requiredPath of requiredFiles.filter((file) => file.startsWith('wiki/'))) {
          if (!paths.has(requiredPath)) {
            findings.push(`manifest.json: missing page path ${requiredPath}`);
          }
        }
        for (const requiredRoute of ['[[Task Routing]]', '[[Source-Backed Workflow]]']) {
          if (!routes.has(requiredRoute)) {
            findings.push(`manifest.json: missing Obsidian route ${requiredRoute}`);
          }
        }
      }
    } catch (error) {
      findings.push(`manifest.json: failed to parse JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  for (const filePath of files) {
    if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
      continue;
    }

    const relativePath = normalizePath(path.relative(guidanceRoot, filePath));
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/gu);
    for (let index = 0; index < lines.length; index += 1) {
      for (const forbidden of forbiddenPatterns) {
        if (forbidden.pattern.test(lines[index])) {
          findings.push(`${relativePath}:${index + 1}: ${forbidden.label}`);
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error('Vicode guidance audit failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        guidanceRoot: normalizePath(path.relative(root, guidanceRoot)),
        scannedFiles: files.length,
        status: 'ok'
      },
      null,
      2
    )
  );
}

main();
