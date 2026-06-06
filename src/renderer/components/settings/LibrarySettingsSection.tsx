import { useState } from 'react';
import type {
  LibrarySourceSummary,
  Preferences,
  ProjectKnowledgeIndexStatus
} from '../../../shared/domain';
import { ActionButton } from '../ui';
import { SETTINGS_SECTION_CLASS, SettingsPanel, SettingsRow } from './shared';

interface LibrarySettingsSectionProps {
  preferences: Preferences | null;
  librarySources: {
    userLibrary: LibrarySourceSummary;
    skills: LibrarySourceSummary;
    llmWiki: LibrarySourceSummary;
  } | null;
  projectKnowledgeIndexStatus: ProjectKnowledgeIndexStatus | null;
  savePreferences: (input: Partial<Preferences>) => Promise<void>;
  refreshLibrarySources: () => Promise<void>;
  refreshProjectKnowledgeIndex: () => Promise<void>;
  openProjectKnowledgeSuggestedIndexDraft: () => Promise<void>;
  rescanSkillLibrary: () => Promise<void>;
}

function sourceValue(path: string | null | undefined) {
  return path?.trim() ? path : 'Not configured';
}

function sourceStatus(source: LibrarySourceSummary | null | undefined) {
  if (!source) {
    return 'Unavailable';
  }
  return source.message;
}

function formatDiagnosticCount(count: number) {
  return `${count} diagnostic${count === 1 ? '' : 's'}`;
}

function formatWarningCount(count: number) {
  return `${count} warning${count === 1 ? '' : 's'}`;
}

function projectKnowledgeDiagnosticsPreview(indexStatus: ProjectKnowledgeIndexStatus) {
  if (indexStatus.diagnostics.length === 0) {
    return null;
  }

  const firstDiagnostic = indexStatus.diagnostics[0];
  const location = firstDiagnostic.relativePath ? `${firstDiagnostic.relativePath}: ` : '';
  const remainingCount = Math.max(0, indexStatus.diagnosticCount - 1);
  const warningText = indexStatus.warningCount > 0 ? `, ${formatWarningCount(indexStatus.warningCount)}` : '';
  return `${formatDiagnosticCount(indexStatus.diagnosticCount)}${warningText}. ${location}${firstDiagnostic.message}${remainingCount > 0 ? ` (+${remainingCount} more)` : ''}`;
}

function showProjectKnowledgeIndexStatus(indexStatus: ProjectKnowledgeIndexStatus | null) {
  return Boolean(indexStatus && indexStatus.status !== 'not_configured');
}

function projectKnowledgeStatusTone(indexStatus: ProjectKnowledgeIndexStatus | null) {
  if (!indexStatus || indexStatus.status === 'not_configured') {
    return 'muted';
  }
  if (indexStatus.status === 'failed' || indexStatus.status === 'missing') {
    return 'danger';
  }
  if (indexStatus.status === 'not_indexed' || indexStatus.status === 'stale' || indexStatus.diagnosticCount > 0) {
    return 'warning';
  }
  return 'ready';
}

export function LibrarySettingsSection({
  preferences,
  librarySources,
  projectKnowledgeIndexStatus,
  savePreferences,
  refreshLibrarySources,
  refreshProjectKnowledgeIndex,
  openProjectKnowledgeSuggestedIndexDraft,
  rescanSkillLibrary
}: LibrarySettingsSectionProps) {
  const [openingSuggestedIndex, setOpeningSuggestedIndex] = useState(false);

  async function browsePath(key: 'skillsLibraryPath' | 'llmWikiLibraryPath') {
    const folderPath = await window.vicode.app.pickFolder();
    if (!folderPath) {
      return;
    }
    await savePreferences({ [key]: folderPath });
    if (key === 'llmWikiLibraryPath') {
      await refreshProjectKnowledgeIndex();
    } else {
      await refreshLibrarySources();
    }
  }

  async function openSuggestedIndexDraft() {
    setOpeningSuggestedIndex(true);
    try {
      await openProjectKnowledgeSuggestedIndexDraft();
    } finally {
      setOpeningSuggestedIndex(false);
    }
  }

  const projectKnowledgeDiagnostics = projectKnowledgeIndexStatus
    ? projectKnowledgeDiagnosticsPreview(projectKnowledgeIndexStatus)
    : null;

  return (
    <div className={`${SETTINGS_SECTION_CLASS} settings-library-section`}>
      <header className="settings-detail-header flex flex-col gap-2 pb-1">
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">
          Library
        </h2>
        <p className="settings-detail-description">
          Choose source folders Vicode can scan for local skills and project knowledge.
        </p>
      </header>

      <SettingsPanel title="Content Locations" description="External folders stay source locations. Vicode imports recognized bundles into app-owned state instead of treating the folder as storage.">
        <SettingsRow label="Skills Folder" description={sourceStatus(librarySources?.skills)}>
          <div className="settings-library-path-control">
            <span className="settings-row-value">{sourceValue(preferences?.skillsLibraryPath)}</span>
            <ActionButton size="compact" onClick={() => void browsePath('skillsLibraryPath')}>
              Browse
            </ActionButton>
            <ActionButton size="compact" tone="quiet" onClick={() => void rescanSkillLibrary()}>
              Rescan
            </ActionButton>
          </div>
        </SettingsRow>
        <div className="settings-library-source" aria-label="Project Knowledge Folder">
          <div className="settings-library-source-header">
            <div className="settings-row-copy">
              <strong>Project Knowledge Folder</strong>
              <span>{sourceStatus(librarySources?.llmWiki)}</span>
            </div>
            <div className="settings-library-source-actions">
              <ActionButton size="compact" onClick={() => void browsePath('llmWikiLibraryPath')}>
                Browse
              </ActionButton>
              <ActionButton
                size="compact"
                tone="quiet"
                disabled={!preferences?.llmWikiLibraryPath}
                onClick={() => void refreshProjectKnowledgeIndex()}
              >
                Refresh Index
              </ActionButton>
              <ActionButton
                size="compact"
                tone="quiet"
                disabled={!preferences?.llmWikiLibraryPath || openingSuggestedIndex}
                onClick={() => void openSuggestedIndexDraft()}
              >
                Open Draft
              </ActionButton>
            </div>
          </div>
          <div className="settings-library-path-line">
            <span>Folder</span>
            <strong title={preferences?.llmWikiLibraryPath ?? undefined}>
              {sourceValue(preferences?.llmWikiLibraryPath)}
            </strong>
          </div>
          {showProjectKnowledgeIndexStatus(projectKnowledgeIndexStatus) ? (
            <div
              className="settings-project-knowledge-index-summary"
              data-tone={projectKnowledgeStatusTone(projectKnowledgeIndexStatus)}
            >
              <div>
                <span>Index</span>
                <strong>{projectKnowledgeIndexStatus?.message}</strong>
              </div>
              {projectKnowledgeDiagnostics ? (
                <div>
                  <span>Diagnostics</span>
                  <strong>{projectKnowledgeDiagnostics}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingsPanel>
    </div>
  );
}
