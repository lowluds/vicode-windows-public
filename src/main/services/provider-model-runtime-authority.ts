import type { ProviderCapabilities, ProviderId } from '../../shared/domain';
import { providerCapabilities } from '../../shared/providers';

export interface ProviderModelRuntimeAuthority {
  executionAuthority: ProviderCapabilities['executionAuthority'];
  approvalAuthority: ProviderCapabilities['approvalAuthority'];
  sandboxAuthority: ProviderCapabilities['sandboxAuthority'];
}

export const APP_RUNTIME_MODEL_AUTHORITY: ProviderModelRuntimeAuthority = {
  executionAuthority: 'app_runtime',
  approvalAuthority: 'app',
  sandboxAuthority: 'app_runtime'
};

export function legacyProviderRuntimeAuthority(providerId: ProviderId): ProviderModelRuntimeAuthority {
  const capabilities = providerCapabilities(providerId);
  return {
    executionAuthority: capabilities.executionAuthority,
    approvalAuthority: capabilities.approvalAuthority,
    sandboxAuthority: capabilities.sandboxAuthority
  };
}

export function usesAppToolApprovalAuthority(authority: ProviderModelRuntimeAuthority) {
  return authority.approvalAuthority === 'app';
}
