import type { IsolatedCommandRunnerRequest, IsolatedCommandRunnerResponse } from './isolated-command-runner-protocol';
import { spawnHostIsolatedCommand, type IsolatedCommandSession } from '../../providers/util';

const parentPort = (process as NodeJS.Process & {
  parentPort?: {
    on: (event: 'message', listener: (event: { data: IsolatedCommandRunnerRequest }) => void) => void;
    postMessage: (message: IsolatedCommandRunnerResponse) => void;
  };
}).parentPort;

let activeSession: IsolatedCommandSession | null = null;

async function finishSession(code: number | null) {
  const session = activeSession;
  activeSession = null;

  try {
    await session?.cleanup();
  } catch {
    // Best-effort cleanup in the worker boundary.
  }

  parentPort?.postMessage({
    type: 'exit',
    code
  });

  process.exit(typeof code === 'number' && code >= 0 ? code : 0);
}

parentPort?.on('message', async (event) => {
  const message = event.data;

  if (message.type === 'terminate') {
    try {
      await activeSession?.terminate();
    } catch {
      // Best-effort termination before worker exit.
    }
    return;
  }

  if (activeSession) {
    parentPort?.postMessage({
      type: 'spawn_error',
      message: 'Utility command runner already has an active command session.'
    });
    process.exit(1);
    return;
  }

  try {
    activeSession = await spawnHostIsolatedCommand(message.executable, message.args, {
      cwd: message.cwd,
      env: message.env
    });

    parentPort?.postMessage({
      type: 'spawned',
      pid: activeSession.child.pid ?? null,
      isolationMode: activeSession.isolationMode,
      rootDir: activeSession.rootDir
    });

    activeSession.child.stdout.on('data', (chunk) => {
      parentPort?.postMessage({
        type: 'stdout',
        chunk: String(chunk)
      });
    });

    activeSession.child.stderr.on('data', (chunk) => {
      parentPort?.postMessage({
        type: 'stderr',
        chunk: String(chunk)
      });
    });

    activeSession.child.on('error', (error) => {
      parentPort?.postMessage({
        type: 'runtime_error',
        message: error instanceof Error ? error.message : 'Utility command runner failed to launch the command.'
      });
    });

    activeSession.child.on('close', (code) => {
      void finishSession(code);
    });
  } catch (error) {
    parentPort?.postMessage({
      type: 'spawn_error',
      message: error instanceof Error ? error.message : 'Utility command runner failed before command launch.'
    });
    process.exit(1);
  }
});
