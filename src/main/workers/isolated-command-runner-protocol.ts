import type { RuntimeCommandIsolationMode } from '../../shared/domain';

export interface IsolatedCommandRunnerStartRequest {
  type: 'run';
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface IsolatedCommandRunnerTerminateRequest {
  type: 'terminate';
}

export type IsolatedCommandRunnerRequest =
  | IsolatedCommandRunnerStartRequest
  | IsolatedCommandRunnerTerminateRequest;

export interface IsolatedCommandRunnerSpawnedMessage {
  type: 'spawned';
  pid: number | null;
  isolationMode: RuntimeCommandIsolationMode;
  rootDir: string;
}

export interface IsolatedCommandRunnerStdoutMessage {
  type: 'stdout';
  chunk: string;
}

export interface IsolatedCommandRunnerStderrMessage {
  type: 'stderr';
  chunk: string;
}

export interface IsolatedCommandRunnerRuntimeErrorMessage {
  type: 'runtime_error';
  message: string;
}

export interface IsolatedCommandRunnerSpawnErrorMessage {
  type: 'spawn_error';
  message: string;
}

export interface IsolatedCommandRunnerExitMessage {
  type: 'exit';
  code: number | null;
}

export type IsolatedCommandRunnerResponse =
  | IsolatedCommandRunnerSpawnedMessage
  | IsolatedCommandRunnerStdoutMessage
  | IsolatedCommandRunnerStderrMessage
  | IsolatedCommandRunnerRuntimeErrorMessage
  | IsolatedCommandRunnerSpawnErrorMessage
  | IsolatedCommandRunnerExitMessage;
