import { useEffect, useMemo, useState } from 'react';
import type { McpPermissionMode, McpServerSaveInput, McpServerScope, Project } from '../../shared/domain';
import { ActionButton, ModalDialog, PrimaryButton, SelectField, TextArea, TextInput } from './ui';

type PluginServerDialogProps = {
  open: boolean;
  selectedProject: Project | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: McpServerSaveInput) => Promise<void>;
};

type PluginDraft = {
  name: string;
  scope: McpServerScope;
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
  toolInvocationMode: McpPermissionMode;
  launchApproved: boolean;
};

function createEmptyDraft(selectedProject: Project | null): PluginDraft {
  return {
    name: '',
    scope: selectedProject ? 'project' : 'global',
    command: '',
    argsText: '',
    cwd: '',
    envText: '',
    toolInvocationMode: 'ask',
    launchApproved: false
  };
}

function parseArgs(argsText: string) {
  return argsText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnv(envText: string) {
  const entries = envText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid env line "${entry}". Use KEY=value.`);
    }
    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1);
    if (!key) {
      throw new Error(`Invalid env line "${entry}". Use KEY=value.`);
    }
    env[key] = value;
  }
  return env;
}

export function PluginServerDialog({
  open,
  selectedProject,
  onOpenChange,
  onSave
}: PluginServerDialogProps) {
  const scopeHelpId = 'plugin-dialog-scope-help';
  const modeHelpId = 'plugin-dialog-mode-help';
  const [draft, setDraft] = useState<PluginDraft>(() => createEmptyDraft(selectedProject));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(createEmptyDraft(selectedProject));
    setError(null);
    setSaving(false);
  }, [open, selectedProject]);

  const scopeHelp = useMemo(() => {
    if (draft.scope === 'project') {
      return selectedProject
        ? `Only available in ${selectedProject.name}. Use this for repo-specific MCP servers and local test harnesses.`
        : 'Project-scoped plugins require an active project.';
    }
    return 'Available across all projects on this device. Use this for stable personal plugin connections.';
  }, [draft.scope, selectedProject]);

  function updateDraft(patch: Partial<PluginDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function handleSave() {
    if (!draft.name.trim() || !draft.command.trim()) {
      setError('Plugin name and command are required.');
      return;
    }
    if (draft.scope === 'project' && !selectedProject) {
      setError('Project-scoped plugins require an active project.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({
        name: draft.name.trim(),
        scope: draft.scope,
        projectId: draft.scope === 'project' ? selectedProject?.id ?? null : null,
        command: draft.command.trim(),
        args: parseArgs(draft.argsText),
        cwd: draft.cwd.trim() || null,
        env: parseEnv(draft.envText),
        enabled: true,
        toolInvocationMode: draft.toolInvocationMode,
        launchApproved: draft.launchApproved
      });
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save plugin.');
      setSaving(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      className="skills-plugin-dialog w-[min(760px,calc(100vw-32px))]"
      title="New plugin"
      description="Create a Vicode-managed MCP server connection. New plugins save as stdio servers and can be approved or refreshed from the plugin list."
      actions={
        <>
          <ActionButton tone="quiet" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </ActionButton>
          <PrimaryButton onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save plugin'}
          </PrimaryButton>
        </>
      }
    >
      <div className="skills-editor-form">
        <div className="skills-form-grid" data-testid="plugin-dialog-scope-row">
          <div className="skills-form-group">
            <label className="skills-form-label" htmlFor="plugin-dialog-name">
              Plugin name
            </label>
            <TextInput
              id="plugin-dialog-name"
              data-testid="plugin-dialog-name"
              placeholder="Plugin name"
              value={draft.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
          </div>
          <div className="skills-form-group">
            <label className="skills-form-label" htmlFor="plugin-dialog-scope">
              Scope
            </label>
            <SelectField
              id="plugin-dialog-scope"
              data-testid="plugin-dialog-scope"
              aria-describedby={scopeHelpId}
              value={draft.scope}
              onChange={(event) => updateDraft({ scope: event.target.value as McpServerScope })}
            >
              <option value="project" disabled={!selectedProject}>
                Project
              </option>
              <option value="global">Personal across all projects</option>
            </SelectField>
          </div>
        </div>
        <p id={scopeHelpId} className="skills-form-help skills-form-grid-note">
          {scopeHelp}
        </p>

        <div className="skills-form-group">
          <label className="skills-form-label" htmlFor="plugin-dialog-command">
            Command
          </label>
          <TextInput
            id="plugin-dialog-command"
            data-testid="plugin-dialog-command"
            placeholder="Command, for example npx or node"
            value={draft.command}
            onChange={(event) => updateDraft({ command: event.target.value })}
          />
        </div>

        <div className="skills-form-grid">
          <div className="skills-form-group">
            <label className="skills-form-label" htmlFor="plugin-dialog-args">
              Arguments
            </label>
            <TextArea
              id="plugin-dialog-args"
              data-testid="plugin-dialog-args"
              className="skills-plugin-textarea"
              placeholder="One argument per line"
              value={draft.argsText}
              onChange={(event) => updateDraft({ argsText: event.target.value })}
            />
            <p className="skills-form-help">Use one argument per line to avoid shell parsing issues on Windows.</p>
          </div>
          <div className="skills-form-group">
            <label className="skills-form-label" htmlFor="plugin-dialog-env">
              Environment
            </label>
            <TextArea
              id="plugin-dialog-env"
              data-testid="plugin-dialog-env"
              className="skills-plugin-textarea"
              placeholder="KEY=value"
              value={draft.envText}
              onChange={(event) => updateDraft({ envText: event.target.value })}
            />
            <p className="skills-form-help">Only add keys the server actually needs.</p>
          </div>
        </div>

        <div className="skills-form-grid" data-testid="plugin-dialog-mode-row">
          <div className="skills-form-group">
            <label className="skills-form-label" htmlFor="plugin-dialog-cwd">
              Working directory
            </label>
            <TextInput
              id="plugin-dialog-cwd"
              data-testid="plugin-dialog-cwd"
              placeholder="Working directory (optional)"
              value={draft.cwd}
              onChange={(event) => updateDraft({ cwd: event.target.value })}
            />
          </div>
          <div className="skills-form-group">
            <label className="skills-form-label" htmlFor="plugin-dialog-mode">
              Tool invocation
            </label>
            <SelectField
              id="plugin-dialog-mode"
              data-testid="plugin-dialog-mode"
              aria-describedby={modeHelpId}
              value={draft.toolInvocationMode}
              onChange={(event) =>
                updateDraft({ toolInvocationMode: event.target.value as McpPermissionMode })
              }
            >
              <option value="ask">Ask before each tool call</option>
              <option value="allow">Allow tool calls automatically</option>
              <option value="deny">Expose catalog only</option>
            </SelectField>
          </div>
        </div>
        <p id={modeHelpId} className="skills-form-help skills-form-grid-note">
          `ask` is the safer default for new plugin connections.
        </p>

        <div className="skills-form-group">
          <span className="skills-form-label">Launch behavior</span>
          <div className="skills-toggle-row">
            <ActionButton
              size="compact"
              className={!draft.launchApproved ? 'skills-toggle-button is-active' : 'skills-toggle-button'}
              aria-pressed={!draft.launchApproved}
              onClick={() => updateDraft({ launchApproved: false })}
            >
              Approval required
            </ActionButton>
            <ActionButton
              size="compact"
              className={draft.launchApproved ? 'skills-toggle-button is-active' : 'skills-toggle-button'}
              aria-pressed={draft.launchApproved}
              onClick={() => updateDraft({ launchApproved: true })}
            >
              Start immediately
            </ActionButton>
          </div>
          <p className="skills-form-help">
            Save starts enabled. You can disable or remove the plugin from the connected list after it is added.
          </p>
        </div>

        {error ? <p className="skills-form-error">{error}</p> : null}
      </div>
    </ModalDialog>
  );
}
