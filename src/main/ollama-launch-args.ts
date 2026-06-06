export interface OllamaLaunchArgvRequest {
  profilePath: string;
}

export class OllamaLaunchArgvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaLaunchArgvError';
  }
}

export function parseOllamaLaunchArgv(argv: readonly string[]): OllamaLaunchArgvRequest | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ollama-launch-profile') {
      const profilePath = argv[index + 1]?.trim();
      if (!profilePath || profilePath.startsWith('--')) {
        throw new OllamaLaunchArgvError('--ollama-launch-profile requires a profile path');
      }
      return { profilePath };
    }

    if (arg.startsWith('--ollama-launch-profile=')) {
      const profilePath = arg.slice('--ollama-launch-profile='.length).trim();
      if (!profilePath) {
        throw new OllamaLaunchArgvError('--ollama-launch-profile requires a profile path');
      }
      return { profilePath };
    }
  }

  return null;
}
