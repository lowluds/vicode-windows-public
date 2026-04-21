import { ensureBuilt } from '../scripts/ensure-built.mjs';

export default async function globalSetup() {
  ensureBuilt('Playwright E2E');
}
