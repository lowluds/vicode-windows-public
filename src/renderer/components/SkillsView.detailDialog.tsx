import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ProviderId, SkillDefinition, SkillDetail } from '../../shared/domain';
import {
  buildSkillDocument,
  getSkillCommandToken
} from '../../shared/skills';
import {
  ActionButton,
  DangerButton,
  IconButton,
  ModalDialog,
  PrimaryButton
} from './ui';
import {
  canInstallSuggestedSkill,
  suggestedSkillAvailabilityLabel,
  type SuggestedSkill
} from './SkillsView.suggested';
import {
  providerLabel,
  resolveSkillCategoryLabel,
  skillCategoryLabel
} from './SkillsView.labels';
import {
  skillOriginLabel,
  skillScopeLabel
} from './SkillsView.activeSkills';
import {
  attachModeFactLabel,
  composerAttachButtonLabel,
  detailCategoryLabel,
  detailCommandLabel,
  detailProvidersLabel,
  detailScopeLabel,
  detailSourceLabel,
  instructionModeLabel,
  providerNativeStatusMessage,
  suggestedSkillAvatarClass,
  suggestedSkillStatusLabel,
  suggestedSkillStatusMessage,
  unavailableSkillFootnote
} from './SkillsView.detail';
import { SkillAvatar } from './SkillsView.avatar';
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FolderIcon,
  GlobeIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon
} from './icons';

function renderSkillMarkdown(markdown: string) {
  return DOMPurify.sanitize(marked.parse(markdown) as string);
}

interface SkillDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detailSkill: SkillDefinition | null;
  detailSuggestedSkill: SuggestedSkill | null;
  detail: SkillDetail | null;
  detailLoading: boolean;
  composerProviderId: ProviderId;
  selectedProjectId: string | null;
  installingSkillId: string | null;
  attached: boolean;
  attachable: boolean;
  onBrowse: (url: string) => void;
  onRevealPath: (path: string) => void;
  onCopyExamplePrompt: () => void;
  onEditSkill: (skill: SkillDefinition) => void;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onRemoveSkill: (skill: SkillDefinition) => void;
  onInstallSuggested: (skill: SuggestedSkill) => void;
  onToggleAttachedSkill: (skillId: string) => void;
}

export function SkillDetailDialog({
  open,
  onOpenChange,
  detailSkill,
  detailSuggestedSkill,
  detail,
  detailLoading,
  composerProviderId,
  selectedProjectId,
  installingSkillId,
  attached,
  attachable,
  onBrowse,
  onRevealPath,
  onCopyExamplePrompt,
  onEditSkill,
  onToggleSkill,
  onRemoveSkill,
  onInstallSuggested,
  onToggleAttachedSkill
}: SkillDetailDialogProps) {
  const detailIsProviderNative = detailSkill?.origin === 'provider_native';
  const detailIsCustom = detailSkill?.origin === 'custom_local';
  const detailIsBuiltIn = detailSkill?.origin === 'built_in_style';

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} className="skills-dialog-content w-[min(1040px,calc(100vw-32px))]">
      {detailSkill || detailSuggestedSkill ? (
        <div className="skills-dialog-body">
          <div className="skills-dialog-top">
            <div className="skills-dialog-heading">
              {detailSkill ? (
                <SkillAvatar skill={detailSkill} size="large" />
              ) : detailSuggestedSkill ? (
                <span
                  className={suggestedSkillAvatarClass(detailSuggestedSkill, 'large')}
                  aria-hidden="true"
                >
                  <detailSuggestedSkill.icon size={24} />
                </span>
              ) : null}
              <div className="skills-dialog-title-group">
                <div className="skills-dialog-title-row">
                  <h3>{detailSkill?.name ?? detailSuggestedSkill?.name}</h3>
                </div>
                <p>{detailSkill?.description ?? detailSuggestedSkill?.description}</p>
                {detailSkill ? (
                  <div className="skills-detail-meta">
                    <span>{skillScopeLabel(detailSkill)}</span>
                    <span>{skillOriginLabel(detailSkill)}</span>
                    <span>{resolveSkillCategoryLabel(detailSkill)}</span>
                    <span>${getSkillCommandToken(detailSkill)}</span>
                    {detailSkill.providerTargets.map((providerId) => (
                      <span key={`${detailSkill.id}-${providerId}`}>{providerLabel(providerId)}</span>
                    ))}
                  </div>
                ) : detailSuggestedSkill ? (
                  <div className="skills-detail-meta">
                    <span>{skillCategoryLabel(detailSuggestedSkill.category)}</span>
                    <span>{suggestedSkillAvailabilityLabel(detailSuggestedSkill)}</span>
                    <span>{suggestedSkillStatusLabel(detailSuggestedSkill)}</span>
                    <span>${detailSuggestedSkill.token}</span>
                    {detailSuggestedSkill.providerTargets.map((providerId) => (
                      <span key={`${detailSuggestedSkill.id}-${providerId}`}>{providerLabel(providerId)}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="skills-dialog-header-actions">
              {detail?.browseUrl ? (
                <ActionButton size="compact" tone="quiet" leadingIcon={<GlobeIcon />} onClick={() => onBrowse(detail.browseUrl!)}>
                  Browse
                </ActionButton>
              ) : null}
              {detail?.folderPath ? (
                <ActionButton size="compact" tone="quiet" leadingIcon={<FolderIcon />} onClick={() => onRevealPath(detail.folderPath!)}>
                  Open folder
                </ActionButton>
              ) : null}
              <IconButton
                className="skills-dialog-close-button"
                label="Close"
                size="compact"
                onClick={() => onOpenChange(false)}
              >
                <CloseIcon />
              </IconButton>
            </div>
          </div>

          {detailLoading ? (
            <div className="skills-dialog-loading">Loading skill details...</div>
          ) : (
            <>
              {detailIsProviderNative ? (
                <div className="skills-status-strip">
                  {providerNativeStatusMessage(detailSkill, composerProviderId)}
                </div>
              ) : null}

              {detailSuggestedSkill ? (
                <div className="skills-status-strip">
                  {suggestedSkillStatusMessage(detailSuggestedSkill)}
                </div>
              ) : null}

              <div className="skills-detail-layout">
                <section className="skills-detail-panel skills-detail-panel-main" aria-label="Skill instructions">
                  <div className="skills-detail-panel-heading">
                    <span>Instructions</span>
                    <strong>{instructionModeLabel(detail?.attachMode)}</strong>
                  </div>
                  <div
                    className="skills-markdown"
                    dangerouslySetInnerHTML={{
                      __html: renderSkillMarkdown(detail?.markdown ?? (detailSkill ? buildSkillDocument(detailSkill) : ''))
                    }}
                  />
                </section>

                <aside className="skills-detail-panel skills-detail-side" aria-label="Skill details">
                  <div className="skills-detail-panel-heading">
                    <span>Source</span>
                    <strong>{detailSourceLabel(detailSkill, detailSuggestedSkill)}</strong>
                  </div>
                  <dl className="skills-facts-list">
                    <div>
                      <dt>Command</dt>
                      <dd>{detailCommandLabel(detailSkill, detailSuggestedSkill)}</dd>
                    </div>
                    <div>
                      <dt>Providers</dt>
                      <dd>{detailProvidersLabel(detailSkill, detailSuggestedSkill)}</dd>
                    </div>
                    <div>
                      <dt>Scope</dt>
                      <dd>{detailScopeLabel(detailSkill)}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{detailCategoryLabel(detailSkill, detailSuggestedSkill)}</dd>
                    </div>
                    <div>
                      <dt>Attach mode</dt>
                      <dd>{attachModeFactLabel(detail?.attachMode)}</dd>
                    </div>
                  </dl>

                  {detail?.examplePrompt ? (
                    <div className="skills-example-card">
                      <div className="skills-example-header">
                        <span>Example prompt</span>
                        <ActionButton size="compact" tone="quiet" leadingIcon={<CopyIcon />} onClick={onCopyExamplePrompt}>
                          Copy
                        </ActionButton>
                      </div>
                      <pre>{detail.examplePrompt}</pre>
                    </div>
                  ) : null}
                </aside>
              </div>
            </>
          )}

          <div className="skills-dialog-actions">
            <div className="skills-dialog-actions-left">
              {detailIsCustom && detailSkill ? (
                <ActionButton size="compact" tone="quiet" leadingIcon={<SaveIcon />} onClick={() => onEditSkill(detailSkill)}>
                  Edit
                </ActionButton>
              ) : null}
              {!detailSuggestedSkill && !detailIsBuiltIn && detailSkill ? (
                <ActionButton
                  size="compact"
                  tone="quiet"
                  leadingIcon={detailSkill.enabled ? <CloseIcon /> : <PlusIcon />}
                  onClick={() => onToggleSkill(detailSkill.id, !detailSkill.enabled)}
                >
                  {detailSkill.enabled ? 'Disable' : 'Enable'}
                </ActionButton>
              ) : null}
              {!detailSuggestedSkill && !detailIsBuiltIn && detailSkill ? (
                <DangerButton size="compact" leadingIcon={<TrashIcon />} onClick={() => onRemoveSkill(detailSkill)}>
                  Delete
                </DangerButton>
              ) : null}
              {detailSuggestedSkill && canInstallSuggestedSkill(detailSuggestedSkill) ? (
                <ActionButton
                  size="compact"
                  tone="quiet"
                  leadingIcon={<PlusIcon />}
                  disabled={installingSkillId === detailSuggestedSkill.id}
                  onClick={() => onInstallSuggested(detailSuggestedSkill)}
                >
                  {installingSkillId === detailSuggestedSkill.id ? 'Installing...' : 'Install'}
                </ActionButton>
              ) : null}
            </div>
            {!detailSuggestedSkill && detailSkill ? (
              <PrimaryButton
                size="compact"
                leadingIcon={attached ? <CheckIcon /> : <PlayIcon />}
                onClick={() => onToggleAttachedSkill(detailSkill.id)}
                disabled={!attachable}
              >
                {composerAttachButtonLabel(attached, detail?.attachMode)}
              </PrimaryButton>
            ) : null}
          </div>

          {!detailSuggestedSkill && !attachable && detailSkill ? (
            <p className="skills-dialog-footnote">
              {unavailableSkillFootnote(detailSkill, selectedProjectId, composerProviderId)}
            </p>
          ) : null}
          {detailIsBuiltIn ? (
            <p className="skills-dialog-footnote">Vicode skills are optional. Install them here, then attach them from the composer when needed.</p>
          ) : null}
        </div>
      ) : null}
    </ModalDialog>
  );
}
