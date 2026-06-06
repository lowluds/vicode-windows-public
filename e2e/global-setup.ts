import { ensureBuilt } from '../scripts/ensure-built.mjs';
import { hydrateLiveProviderEnv } from '../scripts/live-provider-env.mjs';

export default async function globalSetup() {
  hydrateLiveProviderEnv();
  ensureBuilt('Playwright E2E');
}
