import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComposerTextAttachmentService } from './composer-text-attachments';

describe('ComposerTextAttachmentService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createWorkspace() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-composer-attachments-'));
    tempDirs.push(dir);
    return dir;
  }

  it('writes large pasted text into the trusted workspace and returns a lightweight descriptor', () => {
    const workspace = createWorkspace();
    const service = new ComposerTextAttachmentService();

    const attachment = service.create(
      {
        folderPath: workspace,
        trusted: true
      },
      {
        content: 'const example = 1;\n'.repeat(12),
        fileName: 'Example Payload.txt'
      }
    );

    expect(attachment.relativePath).toMatch(/^\.vicode\/composer-attachments\//u);
    expect(attachment.name).toMatch(/example-payload\.txt$/u);
    expect(existsSync(attachment.absolutePath)).toBe(true);
    expect(readFileSync(attachment.absolutePath, 'utf8')).toContain('const example = 1;');
  });

  it('removes draft attachments inside the trusted workspace', () => {
    const workspace = createWorkspace();
    const service = new ComposerTextAttachmentService();
    const attachment = service.create(
      {
        folderPath: workspace,
        trusted: true
      },
      {
        content: 'alpha\nbeta\ngamma\n'
      }
    );

    service.remove(
      {
        folderPath: workspace,
        trusted: true
      },
      attachment
    );

    expect(existsSync(attachment.absolutePath)).toBe(false);
  });
});
