import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

const WHISPER_MODEL = 'base.en';
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin`;

interface VoiceTranscriptionInput {
  audioBase64: string;
  mimeType: string;
  fileName?: string | null;
}

interface VoiceTranscriptionResult {
  text: string;
}

export class VoiceService {
  private readonly rootDir = join(app.getPath('userData'), 'state', 'voice', 'whisper.cpp');
  private readonly tempDir = join(this.rootDir, 'temp');
  private readonly modelsDir = join(this.rootDir, 'models');
  private readonly whisperModelPath = join(this.modelsDir, `ggml-${WHISPER_MODEL}.bin`);
  private ensureInstallPromise: Promise<void> | null = null;

  async transcribeAudio(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
    await this.ensureInstalled();

    const timestamp = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const audioPath = join(this.tempDir, `dictation-${timestamp}.wav`);
    const outputBasePath = join(this.tempDir, `dictation-${timestamp}`);
    const outputTextPath = `${outputBasePath}.txt`;

    try {
      const buffer = Buffer.from(input.audioBase64, 'base64');
      await writeFile(audioPath, buffer);

      await execFileAsync(
        this.resolveWhisperCliPath(),
        ['-m', this.whisperModelPath, '-f', audioPath, '-l', 'en', '-nt', '-otxt', '-of', outputBasePath],
        {
          cwd: resolveVoiceWorkingDirectory(this.tempDir),
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024
        }
      );

      const transcript = (await readFile(outputTextPath, 'utf8')).trim();
      return { text: transcript };
    } catch (error) {
      throw new Error(formatWhisperError(error));
    } finally {
      await Promise.allSettled([
        rm(audioPath, { force: true }),
        rm(outputTextPath, { force: true }),
        rm(`${outputBasePath}.json`, { force: true }),
        rm(`${outputBasePath}.srt`, { force: true }),
        rm(`${outputBasePath}.vtt`, { force: true }),
        rm(`${outputBasePath}.csv`, { force: true }),
        rm(`${outputBasePath}.lrc`, { force: true }),
        rm(`${outputBasePath}.wts`, { force: true })
      ]);
    }
  }

  private async ensureInstalled() {
    if (!this.ensureInstallPromise) {
      this.ensureInstallPromise = this.installRuntime().finally(() => {
        this.ensureInstallPromise = null;
      });
    }

    await this.ensureInstallPromise;
  }

  private async installRuntime() {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.modelsDir, { recursive: true });
    await mkdir(this.tempDir, { recursive: true });

    const whisperCliPath = this.resolveWhisperCliPath();
    if (!(await pathExists(whisperCliPath))) {
      throw new Error('Bundled whisper.cpp runtime is missing. Reinstall Vicode to restore local dictation.');
    }

    if (!(await pathExists(this.whisperModelPath))) {
      await downloadToFile(WHISPER_MODEL_URL, this.whisperModelPath);
    }
  }

  private resolveWhisperCliPath() {
    const packagedCandidate = join(process.resourcesPath, 'whispercpp', 'win-x64', 'runtime', 'Release', 'whisper-cli.exe');
    if (app.isPackaged || existsSync(packagedCandidate)) {
      return packagedCandidate;
    }

    return join(app.getAppPath(), 'resources', 'whispercpp', 'win-x64', 'runtime', 'Release', 'whisper-cli.exe');
  }
}

export function resolveVoiceWorkingDirectory(tempDir: string) {
  return tempDir;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url: string, destinationPath: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url} (${response.status}).`);
  }

  const responseBody = Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>);
  await pipeline(responseBody, createWriteStream(destinationPath));
}

function formatWhisperError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Voice dictation failed locally.';
  }

  const text = [error.message, 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '']
    .join('\n')
    .trim();

  if (/Failed to download/u.test(text)) {
    return 'Voice dictation setup failed while downloading the local Whisper model. Check your connection and try again.';
  }

  if (/Bundled whisper\.cpp runtime is missing/u.test(text) || /The system cannot find the file specified/u.test(text) || /ENOENT/u.test(text)) {
    return 'Voice dictation failed because the local whisper runtime is missing.';
  }

  if (text) {
    return `Voice dictation failed locally: ${text}`;
  }

  return 'Voice dictation failed locally.';
}
