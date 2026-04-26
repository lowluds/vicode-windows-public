import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import type { Project, TextAttachment } from '../../shared/domain';

const COMPOSER_ATTACHMENT_ROOT = '.vicode/composer-attachments';

function sanitizeFileStem(value: string | null | undefined) {
  const normalized = (value ?? '')
    .replace(/\.[a-z0-9]+$/iu, '')
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  return normalized || 'pasted-context';
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/gu, '/');
}

function assertProjectWorkspace(project: Pick<Project, 'folderPath' | 'trusted'>) {
  if (!project.folderPath) {
    throw new Error('Text attachments require a project folder.');
  }
  return resolve(project.folderPath);
}

function isPathInside(rootPath: string, candidatePath: string) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

export class ComposerTextAttachmentService {
  create(
    project: Pick<Project, 'folderPath' | 'trusted'>,
    input: {
      content: string;
      fileName?: string | null;
    }
  ): TextAttachment {
    const workspaceRoot = assertProjectWorkspace(project);
    const charCount = input.content.length;
    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const extension = extname(input.fileName ?? '').toLowerCase() === '.md' ? '.md' : '.txt';
    const fileName = `${timestamp}-${sanitizeFileStem(input.fileName)}${extension}`;
    const relativePath = normalizeRelativePath(`${COMPOSER_ATTACHMENT_ROOT}/${fileName}`);
    const absolutePath = resolve(workspaceRoot, relativePath);
    if (!isPathInside(workspaceRoot, absolutePath)) {
      throw new Error('Text attachment path escaped the workspace.');
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, input.content, 'utf8');

    return {
      id: randomUUID(),
      name: fileName,
      mimeType: 'text/plain',
      relativePath,
      absolutePath,
      charCount
    };
  }

  remove(
    project: Pick<Project, 'folderPath' | 'trusted'>,
    attachment: Pick<TextAttachment, 'absolutePath' | 'relativePath'>
  ) {
    const workspaceRoot = assertProjectWorkspace(project);
    const absolutePath = resolve(attachment.absolutePath);
    const expectedPrefix = normalizeRelativePath(COMPOSER_ATTACHMENT_ROOT);
    if (!normalizeRelativePath(attachment.relativePath).startsWith(expectedPrefix)) {
      throw new Error('Text attachment path is outside the composer attachment directory.');
    }
    if (!isPathInside(workspaceRoot, absolutePath)) {
      throw new Error('Text attachment path escaped the workspace.');
    }
    if (!existsSync(absolutePath)) {
      return;
    }
    rmSync(absolutePath, { force: true });
  }
}
