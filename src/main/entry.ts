import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, dialog } from 'electron';

const STARTUP_DEBUG_ENABLED = process.env.VICODE_STARTUP_DEBUG === '1';
const STARTUP_DEBUG_LOG_PATH = process.env.VICODE_STARTUP_DEBUG_LOG_PATH?.trim() || null;
const userDataOverridePath = process.env.VICODE_USER_DATA_PATH?.trim() || null;
const localAppDataPath =
  process.env.LOCALAPPDATA ??
  join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), 'AppData', 'Local');
const sessionDataPath =
  process.env.VICODE_SESSION_DATA_PATH?.trim() ||
  (userDataOverridePath
    ? join(userDataOverridePath, 'session')
    : join(localAppDataPath, 'vicode-windows', 'session'));
const fatalStartupLogPath = join(
  userDataOverridePath ?? join(localAppDataPath, 'vicode-windows'),
  'state',
  'startup-fatal.log'
);

let fatalStartupHandled = false;

function appendLog(path: string, line: string) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${line}\n`, 'utf8');
}

function logStartupStep(step: string) {
  if (!STARTUP_DEBUG_ENABLED || !STARTUP_DEBUG_LOG_PATH) {
    return;
  }

  try {
    appendLog(STARTUP_DEBUG_LOG_PATH, `[startup:entry] ${new Date().toISOString()} ${step}`);
  } catch (error) {
    console.error('[startup] Failed to write entry debug log.', error);
  }
}

function formatStartupError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

function configureAppDataPaths() {
  if (userDataOverridePath) {
    mkdirSync(userDataOverridePath, { recursive: true });
    app.setPath('userData', userDataOverridePath);
    logStartupStep(`user-data-path:${userDataOverridePath}`);
  }

  mkdirSync(sessionDataPath, { recursive: true });
  app.setPath('sessionData', sessionDataPath);
  logStartupStep(`session-data-path:${sessionDataPath}`);
}

async function reportFatalStartupError(error: unknown) {
  if (fatalStartupHandled) {
    return;
  }
  fatalStartupHandled = true;

  const detail = formatStartupError(error);
  const logLine = `[startup:fatal] ${new Date().toISOString()} ${detail}`;

  try {
    appendLog(fatalStartupLogPath, logLine);
  } catch (logError) {
    console.error('[startup] Failed to persist fatal startup log.', logError);
  }

  console.error('[startup] Fatal startup error', error);

  const showFailure = () => {
    dialog.showErrorBox(
      'Vicode could not start',
      `Vicode hit a fatal startup error and could not open its main window.\n\n${detail}\n\nLog: ${fatalStartupLogPath}`
    );
    app.exit(1);
  };

  if (app.isReady()) {
    showFailure();
    return;
  }

  app.whenReady().then(showFailure).catch(() => {
    app.exit(1);
  });
}

process.on('uncaughtException', (error) => {
  void reportFatalStartupError(error);
});

process.on('unhandledRejection', (error) => {
  void reportFatalStartupError(error);
});

logStartupStep('entry-loaded');
configureAppDataPaths();

try {
  logStartupStep('import-main');
  await import('./index');
  logStartupStep('import-main-complete');
} catch (error) {
  await reportFatalStartupError(error);
}
