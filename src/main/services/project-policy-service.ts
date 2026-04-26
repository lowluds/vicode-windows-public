import { existsSync } from 'node:fs';
import type { ProviderAdapter } from '../../providers/types';
import type { ProjectRuntimeCommandPolicy, ProviderId } from '../../shared/domain';
import { providerCapabilities, providerDisplayName } from '../../shared/providers';
import { DatabaseService } from '../../storage/database';

export class ProjectPolicyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly adapters: Record<ProviderId, ProviderAdapter>
  ) {}

  assertProviderProjectContext(providerId: ProviderId, folderPath: string | null, trusted: boolean) {
    if (folderPath && providerCapabilities(providerId).requiresTrustedWorkspace && !trusted) {
      throw new Error(`${providerDisplayName(providerId)} cannot run against an untrusted workspace. Trust the project and retry.`);
    }

    if (folderPath && !existsSync(folderPath)) {
      throw new Error(
        `Workspace folder is unavailable: ${folderPath}. Re-open or repair the project path before running ${providerDisplayName(providerId)}.`
      );
    }

    const validation = this.adapters[providerId].validateProjectContext(folderPath, trusted);
    if (!validation.valid) {
      throw new Error(validation.message ?? `${providerDisplayName(providerId)} cannot run against this project.`);
    }
  }

  getRuntimeCommandPolicyForThread(
    threadId: string,
    fallback: ProjectRuntimeCommandPolicy
  ) {
    try {
      const thread = this.db.getThread(threadId);
      const project = this.db.getProject(thread.projectId);
      return project.runtimeCommandPolicy;
    } catch {
      return fallback;
    }
  }
}
