import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const transientReleaseFiles = ['builder-debug.yml', 'builder-effective-config.yaml'];
const legacyInstallerPrefixes = ['Vicode Setup '];

for (const fileName of transientReleaseFiles) {
  const targetPath = path.join(releaseDir, fileName);
  if (!existsSync(targetPath)) {
    continue;
  }
  rmSync(targetPath, { force: true });
}

if (existsSync(releaseDir)) {
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const isLegacyInstaller = legacyInstallerPrefixes.some((prefix) =>
      entry.name.startsWith(prefix) &&
      (entry.name.endsWith('.exe') || entry.name.endsWith('.exe.blockmap'))
    );

    if (!isLegacyInstaller) {
      continue;
    }

    rmSync(path.join(releaseDir, entry.name), { force: true });
  }
}
