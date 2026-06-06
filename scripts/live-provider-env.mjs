import { execFileSync } from 'node:child_process';

const LIVE_PROVIDER_ENV_NAMES = [
  'VICODE_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'VICODE_OPENAI_COMPATIBLE_API_KEY',
  'VICODE_OPENAI_COMPATIBLE_BASE_URL',
  'VICODE_OPENAI_COMPATIBLE_MODEL'
];

function parseRegQueryValue(output, name) {
  const pattern = new RegExp(`^\\s*${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`, 'imu');
  const match = pattern.exec(output);
  return match?.[1]?.trim() || null;
}

function readWindowsRegistryEnv(name, hivePath) {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const output = execFileSync(
      'reg.exe',
      ['query', hivePath, '/v', name],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }
    );
    return parseRegQueryValue(output, name);
  } catch {
    return null;
  }
}

function readPersistedWindowsEnv(name) {
  return (
    readWindowsRegistryEnv(name, 'HKCU\\Environment') ??
    readWindowsRegistryEnv(name, 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
  );
}

export function hydrateLiveProviderEnv(names = LIVE_PROVIDER_ENV_NAMES) {
  const hydrated = [];

  for (const name of names) {
    if (process.env[name]?.trim()) {
      continue;
    }

    const persistedValue = readPersistedWindowsEnv(name);
    if (!persistedValue) {
      continue;
    }

    process.env[name] = persistedValue;
    hydrated.push(name);
  }

  return hydrated;
}

export { LIVE_PROVIDER_ENV_NAMES };
