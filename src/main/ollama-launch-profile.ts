import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { encodeOllamaLocalModelId } from '../shared/provider-model-selection';
import type {
  OllamaTransportMode,
  Preferences,
  ProviderAccount
} from '../shared/domain';

const OLLAMA_LAUNCH_MARKER_DIR = 'ollama-launch';
const OLLAMA_LAUNCH_ACTIVE_MARKER_FILE = 'active-profile.json';
const OLLAMA_LAUNCH_PENDING_MARKER_FILE = 'pending-profile.json';
const credentialKeyPattern = /(?:api[_-]?key|token|secret|authorization|headers?)/iu;

const baseUrlSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}, z.string().url().max(2048).optional());

const profileSchema = z.object({
  version: z.literal(1),
  source: z.literal('ollama-launch'),
  profileId: z.string().trim().min(1).max(120).optional().default('ollama-launch'),
  providerId: z.literal('ollama'),
  modelId: z.string().trim().min(1).max(300),
  modelSource: z.enum(['local', 'cloud', 'unknown']).optional().default('unknown'),
  baseUrl: baseUrlSchema,
  transportMode: z.enum(['chat', 'responses']).optional(),
  configureOnly: z.boolean().optional().default(false),
  restore: z.boolean().optional().default(false),
  createdAt: z.string().trim().min(1).max(80).optional()
}).strict();

export type OllamaLaunchProfile = z.infer<typeof profileSchema>;

export interface OllamaLaunchDb {
  getPreferences(): Preferences;
  savePreferences(input: Partial<Preferences>): Preferences;
  getProviderAccount(providerId: 'ollama'): ProviderAccount | null;
}

export interface OllamaLaunchProfileResult {
  status: 'applied' | 'restored' | 'noop' | 'deferred';
  markerPath: string;
  profile?: OllamaLaunchProfile;
  reason?: 'active-run';
}

export interface OllamaLaunchDiagnostics {
  active: boolean;
  markerStatus: 'missing' | 'active' | 'unreadable';
  appliedAt: string | null;
  profile: {
    profileId: string;
    providerId: 'ollama';
    modelId: string;
    modelSource: OllamaLaunchProfile['modelSource'];
    baseUrlConfigured: boolean;
    transportMode: OllamaTransportMode | null;
    configureOnly: boolean;
    restore: boolean;
    createdAt: string | null;
  } | null;
  pending: {
    status: 'missing' | 'pending' | 'unreadable';
    reason: 'active-run' | null;
    deferredAt: string | null;
    profile: NonNullable<OllamaLaunchDiagnostics['profile']> | null;
  };
}

interface OllamaLaunchStoredProfile {
    profileId: string;
    providerId: 'ollama';
    modelId: string;
    modelSource: OllamaLaunchProfile['modelSource'];
    baseUrl: string | null;
    transportMode: OllamaTransportMode | null;
    configureOnly: boolean;
    restore: boolean;
    createdAt: string | null;
}

interface OllamaLaunchMarker {
  version: 1;
  source: 'ollama-launch';
  appliedAt: string;
  profile: OllamaLaunchStoredProfile;
  backup: {
    defaultProviderId: Preferences['defaultProviderId'];
    ollamaModelId: string;
    ollamaTransportMode: OllamaTransportMode;
  };
}

interface OllamaLaunchPendingMarker {
  version: 1;
  source: 'ollama-launch';
  status: 'pending';
  reason: 'active-run';
  deferredAt: string;
  profile: OllamaLaunchStoredProfile;
}

export function getOllamaLaunchMarkerPath(stateDir: string) {
  return join(stateDir, OLLAMA_LAUNCH_MARKER_DIR, OLLAMA_LAUNCH_ACTIVE_MARKER_FILE);
}

export function getOllamaLaunchPendingMarkerPath(stateDir: string) {
  return join(stateDir, OLLAMA_LAUNCH_MARKER_DIR, OLLAMA_LAUNCH_PENDING_MARKER_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOllamaTransportMode(value: unknown): value is OllamaTransportMode {
  return value === 'chat' || value === 'responses';
}

function isOllamaModelSource(value: unknown): value is OllamaLaunchProfile['modelSource'] {
  return value === 'local' || value === 'cloud' || value === 'unknown';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isOllamaLaunchStoredProfile(value: unknown): value is OllamaLaunchStoredProfile {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.profileId === 'string'
    && value.providerId === 'ollama'
    && typeof value.modelId === 'string'
    && isOllamaModelSource(value.modelSource)
    && (value.baseUrl === null || typeof value.baseUrl === 'string')
    && (value.transportMode === null || isOllamaTransportMode(value.transportMode))
    && typeof value.configureOnly === 'boolean'
    && typeof value.restore === 'boolean'
    && (value.createdAt === null || typeof value.createdAt === 'string');
}

function isOllamaLaunchMarker(value: unknown): value is OllamaLaunchMarker {
  if (!isRecord(value) || !isRecord(value.backup)) {
    return false;
  }

  const { backup } = value;
  return value.version === 1
    && value.source === 'ollama-launch'
    && typeof value.appliedAt === 'string'
    && isOllamaLaunchStoredProfile(value.profile)
    && typeof backup.defaultProviderId === 'string'
    && typeof backup.ollamaModelId === 'string'
    && isOllamaTransportMode(backup.ollamaTransportMode);
}

function isOllamaLaunchPendingMarker(value: unknown): value is OllamaLaunchPendingMarker {
  return isRecord(value)
    && value.version === 1
    && value.source === 'ollama-launch'
    && value.status === 'pending'
    && value.reason === 'active-run'
    && typeof value.deferredAt === 'string'
    && isOllamaLaunchStoredProfile(value.profile);
}

function assertNoCredentialKeys(value: unknown, path: string[] = []) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialKeys(item, [...path, String(index)]));
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (credentialKeyPattern.test(key)) {
      throw new Error(`Ollama launch profile must not include credential field: ${[...path, key].join('.')}`);
    }
    assertNoCredentialKeys(nested, [...path, key]);
  }
}

export function validateOllamaLaunchProfile(input: unknown): OllamaLaunchProfile {
  assertNoCredentialKeys(input);
  return profileSchema.parse(input);
}

export function loadOllamaLaunchProfileFromFile(profilePath: string): OllamaLaunchProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read Ollama launch profile: ${error instanceof Error ? error.message : String(error)}`);
  }

  return validateOllamaLaunchProfile(parsed);
}

function readMarker(markerPath: string): OllamaLaunchMarker | null {
  if (!existsSync(markerPath)) {
    return null;
  }

  try {
    const marker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
    return isOllamaLaunchMarker(marker) ? marker : null;
  } catch {
    return null;
  }
}

function readPendingMarker(markerPath: string): OllamaLaunchPendingMarker | null {
  if (!existsSync(markerPath)) {
    return null;
  }

  try {
    const marker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
    return isOllamaLaunchPendingMarker(marker) ? marker : null;
  } catch {
    return null;
  }
}

function writeMarker(markerPath: string, marker: OllamaLaunchMarker) {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

function writePendingMarker(markerPath: string, marker: OllamaLaunchPendingMarker) {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

function hasHostedOllamaAccount(account: ProviderAccount | null) {
  return account?.providerId === 'ollama'
    && account.authMode === 'api_key'
    && Boolean(account.encryptedApiKey);
}

function normalizeModelIdForProfile(profile: OllamaLaunchProfile, account: ProviderAccount | null) {
  if (profile.modelSource === 'local' && hasHostedOllamaAccount(account)) {
    return encodeOllamaLocalModelId(profile.modelId);
  }

  return profile.modelId;
}

function createStoredProfile(profile: OllamaLaunchProfile): OllamaLaunchStoredProfile {
  return {
    profileId: profile.profileId,
    providerId: 'ollama',
    modelId: profile.modelId,
    modelSource: profile.modelSource,
    baseUrl: profile.baseUrl ?? null,
    transportMode: profile.transportMode ?? null,
    configureOnly: profile.configureOnly,
    restore: profile.restore,
    createdAt: profile.createdAt ?? null
  };
}

function createProfileFromStoredProfile(profile: OllamaLaunchStoredProfile): OllamaLaunchProfile {
  return {
    version: 1,
    source: 'ollama-launch',
    profileId: profile.profileId,
    providerId: 'ollama',
    modelId: profile.modelId,
    modelSource: profile.modelSource,
    ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    ...(profile.transportMode ? { transportMode: profile.transportMode } : {}),
    configureOnly: profile.configureOnly,
    restore: profile.restore,
    ...(profile.createdAt ? { createdAt: profile.createdAt } : {})
  };
}

function createMarker(input: {
  profile: OllamaLaunchProfile;
  backup: OllamaLaunchMarker['backup'];
  appliedAt: string;
}): OllamaLaunchMarker {
  return {
    version: 1,
    source: 'ollama-launch',
    appliedAt: input.appliedAt,
    profile: createStoredProfile(input.profile),
    backup: input.backup
  };
}

function createDiagnosticsProfile(profile: OllamaLaunchStoredProfile): NonNullable<OllamaLaunchDiagnostics['profile']> {
  return {
    profileId: profile.profileId,
    providerId: 'ollama',
    modelId: profile.modelId,
    modelSource: profile.modelSource,
    baseUrlConfigured: Boolean(profile.baseUrl),
    transportMode: profile.transportMode,
    configureOnly: profile.configureOnly,
    restore: profile.restore,
    createdAt: profile.createdAt
  };
}

function readPendingDiagnostics(stateDir: string): OllamaLaunchDiagnostics['pending'] {
  const markerPath = getOllamaLaunchPendingMarkerPath(stateDir);
  if (!existsSync(markerPath)) {
    return {
      status: 'missing',
      reason: null,
      deferredAt: null,
      profile: null
    };
  }

  const pending = readPendingMarker(markerPath);
  if (!pending) {
    return {
      status: 'unreadable',
      reason: null,
      deferredAt: null,
      profile: null
    };
  }

  return {
    status: 'pending',
    reason: pending.reason,
    deferredAt: pending.deferredAt,
    profile: createDiagnosticsProfile(pending.profile)
  };
}

export function readOllamaLaunchDiagnostics(stateDir: string): OllamaLaunchDiagnostics {
  const markerPath = getOllamaLaunchMarkerPath(stateDir);
  const pending = readPendingDiagnostics(stateDir);
  if (!existsSync(markerPath)) {
    return {
      active: false,
      markerStatus: 'missing',
      appliedAt: null,
      profile: null,
      pending
    };
  }

  const marker = readMarker(markerPath);
  if (!marker) {
    return {
      active: false,
      markerStatus: 'unreadable',
      appliedAt: null,
      profile: null,
      pending
    };
  }

  return {
    active: true,
    markerStatus: 'active',
    appliedAt: stringOrNull(marker.appliedAt),
    profile: createDiagnosticsProfile(marker.profile),
    pending
  };
}

export function deferOllamaLaunchProfile(input: {
  stateDir: string;
  profile: OllamaLaunchProfile;
  now?: () => string;
}): OllamaLaunchProfileResult {
  const markerPath = getOllamaLaunchPendingMarkerPath(input.stateDir);
  const deferredAt = input.now?.() ?? new Date().toISOString();
  writePendingMarker(markerPath, {
    version: 1,
    source: 'ollama-launch',
    status: 'pending',
    reason: 'active-run',
    deferredAt,
    profile: createStoredProfile(input.profile)
  });

  return {
    status: 'deferred',
    markerPath,
    profile: input.profile,
    reason: 'active-run'
  };
}

export function applyPendingOllamaLaunchProfile(input: {
  db: OllamaLaunchDb;
  stateDir: string;
  now?: () => string;
}): OllamaLaunchProfileResult {
  const markerPath = getOllamaLaunchPendingMarkerPath(input.stateDir);
  const pending = readPendingMarker(markerPath);
  if (!pending) {
    return {
      status: 'noop',
      markerPath
    };
  }

  return applyOllamaLaunchProfile({
    db: input.db,
    stateDir: input.stateDir,
    profile: createProfileFromStoredProfile(pending.profile),
    now: input.now
  });
}

export function applyOllamaLaunchProfile(input: {
  db: OllamaLaunchDb;
  stateDir: string;
  profile: OllamaLaunchProfile;
  now?: () => string;
}): OllamaLaunchProfileResult {
  const markerPath = getOllamaLaunchMarkerPath(input.stateDir);
  const current = input.db.getPreferences();
  const existingMarker = readMarker(markerPath);
  const backup = existingMarker?.backup ?? {
    defaultProviderId: current.defaultProviderId,
    ollamaModelId: current.defaultModelByProvider.ollama,
    ollamaTransportMode: current.ollamaTransportMode
  };
  const account = input.db.getProviderAccount('ollama');
  const normalizedModelId = normalizeModelIdForProfile(input.profile, account);

  input.db.savePreferences({
    defaultProviderId: 'ollama',
    defaultModelByProvider: {
      ...current.defaultModelByProvider,
      ollama: normalizedModelId
    },
    ...(input.profile.transportMode ? { ollamaTransportMode: input.profile.transportMode } : {})
  });

  writeMarker(markerPath, createMarker({
    profile: input.profile,
    backup,
    appliedAt: input.now?.() ?? new Date().toISOString()
  }));
  rmSync(getOllamaLaunchPendingMarkerPath(input.stateDir), { force: true });

  return {
    status: 'applied',
    markerPath,
    profile: input.profile
  };
}

export function restoreOllamaLaunchProfile(input: {
  db: OllamaLaunchDb;
  stateDir: string;
}): OllamaLaunchProfileResult {
  const markerPath = getOllamaLaunchMarkerPath(input.stateDir);
  const pendingMarkerPath = getOllamaLaunchPendingMarkerPath(input.stateDir);
  const hadPendingMarker = existsSync(pendingMarkerPath);
  const marker = readMarker(markerPath);
  if (!marker) {
    rmSync(pendingMarkerPath, { force: true });
    return {
      status: hadPendingMarker ? 'restored' : 'noop',
      markerPath
    };
  }

  const current = input.db.getPreferences();
  input.db.savePreferences({
    defaultProviderId: marker.backup.defaultProviderId,
    defaultModelByProvider: {
      ...current.defaultModelByProvider,
      ollama: marker.backup.ollamaModelId
    },
    ollamaTransportMode: marker.backup.ollamaTransportMode
  });
  rmSync(markerPath, { force: true });
  rmSync(pendingMarkerPath, { force: true });

  return {
    status: 'restored',
    markerPath
  };
}

export function handleOllamaLaunchProfilePath(input: {
  db: OllamaLaunchDb;
  stateDir: string;
  profilePath: string;
  now?: () => string;
  hasActiveRuns?: () => boolean;
}): OllamaLaunchProfileResult {
  const profile = loadOllamaLaunchProfileFromFile(input.profilePath);
  if (profile.restore) {
    return restoreOllamaLaunchProfile(input);
  }

  if (input.hasActiveRuns?.()) {
    return deferOllamaLaunchProfile({
      stateDir: input.stateDir,
      profile,
      now: input.now
    });
  }

  return applyOllamaLaunchProfile({
    db: input.db,
    stateDir: input.stateDir,
    profile,
    now: input.now
  });
}

export function createOllamaLaunchController(input: {
  db: OllamaLaunchDb;
  stateDir: string;
  now?: () => string;
  hasActiveRuns?: () => boolean;
}) {
  return {
    handleProfilePath(profilePath: string) {
      return handleOllamaLaunchProfilePath({
        ...input,
        profilePath
      });
    },
    applyPendingProfile() {
      return applyPendingOllamaLaunchProfile(input);
    }
  };
}
