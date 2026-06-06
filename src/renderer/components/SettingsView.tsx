import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ActionButton, ConfirmDialog, IconButton } from './ui';
import type {
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  ProviderId,
  SettingsSection
} from '../../shared/domain';
import {
  createProviderRecord,
  getProviderMetadata
} from '../../shared/providers';
import {
  ArchiveIcon,
  BookIcon,
  ClipboardIcon,
  CloseIcon,
  CpuIcon,
  FolderIcon,
  SettingsIcon
} from './icons';
import { normalizeHexColor } from '../lib/theme';
import { GeneralSettingsSection } from './settings/GeneralSettingsSection';
import { LibrarySettingsSection } from './settings/LibrarySettingsSection';
import type { OllamaBusyAction } from './settings/OllamaRuntimeSettingsSection';
import { ProviderSettingsSection } from './settings/ProviderSettingsSection';
import {
  AdvancedSettingsSection,
  ArchivedThreadsSection
} from './settings/SecondarySettingsSections';
import { settingsSections } from './settings/support';
import type { SettingsViewProps } from './settings/types';
import { ThemedWolfLogo } from './ThemedWolfLogo';

const settingsSectionIcons: Partial<Record<SettingsSection, ReactNode>> = {
  general: <SettingsIcon />,
  providers: <CpuIcon />,
  library: <BookIcon />,
  diagnostics: <ClipboardIcon />,
  storage: <FolderIcon />,
  archived_threads: <ArchiveIcon />
};


type SettingsWindowFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const SETTINGS_WINDOW_DEFAULT_WIDTH = 760;
const SETTINGS_WINDOW_DEFAULT_HEIGHT = 650;
const SETTINGS_WINDOW_MIN_WIDTH = 560;
const SETTINGS_WINDOW_MIN_HEIGHT = 430;

function clampValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampSettingsWindowFrame(frame: SettingsWindowFrame, bounds: DOMRect | { width: number; height: number }): SettingsWindowFrame {
  const minWidth = Math.min(SETTINGS_WINDOW_MIN_WIDTH, bounds.width);
  const minHeight = Math.min(SETTINGS_WINDOW_MIN_HEIGHT, bounds.height);
  const width = clampValue(Math.round(frame.width), minWidth, Math.max(minWidth, bounds.width));
  const height = clampValue(Math.round(frame.height), minHeight, Math.max(minHeight, bounds.height));
  return {
    left: clampValue(Math.round(frame.left), 0, Math.max(0, bounds.width - width)),
    top: clampValue(Math.round(frame.top), 0, Math.max(0, bounds.height - height)),
    width,
    height
  };
}

export function SettingsView(props: SettingsViewProps) {
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [deleteArchivedThreadId, setDeleteArchivedThreadId] = useState<string | null>(null);
  const [compactRunEventsDialogOpen, setCompactRunEventsDialogOpen] = useState(false);
  const [vacuumStorageDialogOpen, setVacuumStorageDialogOpen] = useState(false);
  const [settingsWindowFrame, setSettingsWindowFrame] = useState<SettingsWindowFrame>({
    left: 0,
    top: 0,
    width: SETTINGS_WINDOW_DEFAULT_WIDTH,
    height: SETTINGS_WINDOW_DEFAULT_HEIGHT
  });
  const [ollamaModelDraft, setOllamaModelDraft] = useState('');
  const [ollamaBusyAction, setOllamaBusyAction] = useState<OllamaBusyAction>(null);
  const [customProviderDraft, setCustomProviderDraft] = useState<CustomProviderSettingsSaveInput>({
    name: '',
    transportKind: 'openai_compatible_chat',
    baseUrl: '',
    apiKey: '',
    defaultModelId: '',
    enabled: true
  });
  const [customProviderBusyId, setCustomProviderBusyId] = useState<string | null>(null);
  const settingsRootRef = useRef<HTMLElement | null>(null);
  const settingsWindowInitializedRef = useRef(false);
  const settingsDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originFrame: SettingsWindowFrame;
  } | null>(null);
  const settingsResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originFrame: SettingsWindowFrame;
  } | null>(null);
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<ProviderId, boolean>>(() =>
    createProviderRecord(() => false)
  );
  useEffect(() => {
    setRevealedApiKeys((current) => {
      let changed = false;
      const next = { ...current };
      for (const provider of props.providers) {
        if (props.apiKeys[provider.id].length === 0 && next[provider.id]) {
          next[provider.id] = false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.apiKeys, props.providers]);

  useLayoutEffect(() => {
    const root = settingsRootRef.current;
    if (!root) {
      return;
    }
    const bounds = root.getBoundingClientRect();
    if (!settingsWindowInitializedRef.current) {
      const width = Math.min(SETTINGS_WINDOW_DEFAULT_WIDTH, bounds.width);
      const height = Math.min(SETTINGS_WINDOW_DEFAULT_HEIGHT, bounds.height);
      settingsWindowInitializedRef.current = true;
      setSettingsWindowFrame(
        clampSettingsWindowFrame(
          {
            left: (bounds.width - width) / 2,
            top: (bounds.height - height) / 2,
            width,
            height
          },
          bounds
        )
      );
      return;
    }
    setSettingsWindowFrame((current) => clampSettingsWindowFrame(current, bounds));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    function clampSettingsWindowToBounds() {
      const root = settingsRootRef.current;
      if (!root) {
        return;
      }
      setSettingsWindowFrame((current) => clampSettingsWindowFrame(current, root.getBoundingClientRect()));
    }

    window.addEventListener('resize', clampSettingsWindowToBounds);
    return () => window.removeEventListener('resize', clampSettingsWindowToBounds);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const drag = settingsDragRef.current;
      if (drag && event.pointerId === drag.pointerId) {
        const root = settingsRootRef.current;
        if (!root) {
          return;
        }
        setSettingsWindowFrame(
          clampSettingsWindowFrame(
            {
              ...drag.originFrame,
              left: drag.originFrame.left + event.clientX - drag.startX,
              top: drag.originFrame.top + event.clientY - drag.startY
            },
            root.getBoundingClientRect()
          )
        );
        return;
      }

      const resize = settingsResizeRef.current;
      if (resize && event.pointerId === resize.pointerId) {
        const root = settingsRootRef.current;
        if (!root) {
          return;
        }
        setSettingsWindowFrame(
          clampSettingsWindowFrame(
            {
              ...resize.originFrame,
              width: resize.originFrame.width + event.clientX - resize.startX,
              height: resize.originFrame.height + event.clientY - resize.startY
            },
            root.getBoundingClientRect()
          )
        );
      }
    }

    function endPointerAction(event: PointerEvent) {
      if (settingsDragRef.current?.pointerId === event.pointerId) {
        settingsDragRef.current = null;
      }
      if (settingsResizeRef.current?.pointerId === event.pointerId) {
        settingsResizeRef.current = null;
      }
    }

    function handleBlur() {
      settingsDragRef.current = null;
      settingsResizeRef.current = null;
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endPointerAction);
    window.addEventListener('pointercancel', endPointerAction);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endPointerAction);
      window.removeEventListener('pointercancel', endPointerAction);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  function startSettingsDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement | null)?.closest('button')) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    settingsDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originFrame: settingsWindowFrame
    };
  }

  function startSettingsResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    settingsResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originFrame: settingsWindowFrame
    };
  }

  useEffect(() => {
    setRevealedApiKeys((current) => {
      let changed = false;
      const next = { ...current };
      for (const provider of props.providers) {
        if (props.apiKeys[provider.id].length === 0 && next[provider.id]) {
          next[provider.id] = false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.apiKeys, props.providers]);

  const settingsRootClass = 'settings-root settings-content settings-content-standalone flex min-h-0 w-full flex-1 flex-col';
  const defaultAccentColor = getComputedStyle(document.documentElement).getPropertyValue('--ui-default-accent').trim();
  const currentAccentColor = normalizeHexColor(props.preferences?.accentColor) ?? defaultAccentColor;
  const activeSettingsSection = props.section === 'storage' ? 'diagnostics' : props.section;
  const resetCustomProviderDraft = () =>
    setCustomProviderDraft({
      name: '',
      transportKind: 'openai_compatible_chat',
      baseUrl: '',
      apiKey: '',
      defaultModelId: '',
      enabled: true
    });
  const editCustomProvider = (provider: CustomProviderSettings) =>
    setCustomProviderDraft({
      id: provider.id,
      name: provider.name,
      transportKind: provider.transportKind,
      baseUrl: provider.baseUrl,
      apiKey: '',
      defaultModelId: provider.defaultModelId,
      enabled: provider.enabled
    });
  const saveCustomProviderDraft = async () => {
    setCustomProviderBusyId(customProviderDraft.id ?? 'new');
    try {
      await props.saveCustomProvider(customProviderDraft);
      resetCustomProviderDraft();
    } finally {
      setCustomProviderBusyId(null);
    }
  };
  const removeCustomProvider = async (providerId: string) => {
    setCustomProviderBusyId(providerId);
    try {
      await props.deleteCustomProvider(providerId);
      if (customProviderDraft.id === providerId) {
        resetCustomProviderDraft();
      }
    } finally {
      setCustomProviderBusyId(null);
    }
  };
  const defaultModelByProvider = props.preferences?.defaultModelByProvider ?? createProviderRecord((providerId) => getProviderMetadata(providerId).defaultModelId);
  const saveDefaultModel = async (providerId: ProviderId, modelId: string) => {
    await props.savePreferences({
      defaultModelByProvider: {
        ...defaultModelByProvider,
        [providerId]: modelId
      }
    });
  };

  return (
    <section ref={settingsRootRef} className={settingsRootClass}>
      <div
        className="settings-floating-window"
        style={
          {
            left: `${settingsWindowFrame.left}px`,
            top: `${settingsWindowFrame.top}px`,
            width: `${settingsWindowFrame.width}px`,
            height: `${settingsWindowFrame.height}px`
          } as CSSProperties
        }
      >
        <div
          className="settings-floating-titlebar"
          onPointerDown={startSettingsDrag}
        >
          <div className="settings-floating-title">
            <ThemedWolfLogo className="settings-floating-app-mark" alt="" />
            <span>Settings</span>
          </div>
          <IconButton className="settings-floating-close" label="Close settings" onClick={props.onBack}>
            <CloseIcon />
          </IconButton>
        </div>
      <div className="settings-shell-layout">
        <aside className="settings-shell-rail">
          <div className="settings-shell-rail-sticky">
            <nav className="settings-inline-shell-tabs settings-nav settings-shell-nav" data-active-section={activeSettingsSection}>
              {settingsSections.map((entry) => (
                <ActionButton
                  key={entry.value}
                  tone={activeSettingsSection === entry.value ? 'default' : 'quiet'}
                  size="compact"
                  className="settings-shell-tab settings-nav-item"
                  leadingIcon={settingsSectionIcons[entry.value]}
                  data-active={activeSettingsSection === entry.value ? 'true' : 'false'}
                  onClick={() => props.setSection(entry.value)}
                >
                  {entry.label}
                </ActionButton>
              ))}
            </nav>
          </div>
        </aside>
        <div className="settings-shell-main">
        {props.section === 'general' ? (
          <GeneralSettingsSection
            settings={props}
            defaultAccentColor={defaultAccentColor}
            currentAccentColor={currentAccentColor}
          />
        ) : null}

        {props.section === 'library' ? (
          <LibrarySettingsSection
            preferences={props.preferences}
            librarySources={props.librarySources}
            projectKnowledgeIndexStatus={props.projectKnowledgeIndexStatus}
            savePreferences={props.savePreferences}
            refreshLibrarySources={props.refreshLibrarySources}
            refreshProjectKnowledgeIndex={props.refreshProjectKnowledgeIndex}
            openProjectKnowledgeSuggestedIndexDraft={props.openProjectKnowledgeSuggestedIndexDraft}
            rescanSkillLibrary={props.rescanSkillLibrary}
          />
        ) : null}

        {props.section === 'providers' ? (
          <ProviderSettingsSection
            settings={props}
            defaultModelByProvider={defaultModelByProvider}
            revealedApiKeys={revealedApiKeys}
            setRevealedApiKeys={setRevealedApiKeys}
            customProviderDraft={customProviderDraft}
            setCustomProviderDraft={setCustomProviderDraft}
            customProviderBusyId={customProviderBusyId}
            editCustomProvider={editCustomProvider}
            removeCustomProvider={removeCustomProvider}
            resetCustomProviderDraft={resetCustomProviderDraft}
            saveCustomProviderDraft={saveCustomProviderDraft}
            ollamaModelDraft={ollamaModelDraft}
            setOllamaModelDraft={setOllamaModelDraft}
            ollamaBusyAction={ollamaBusyAction}
            setOllamaBusyAction={setOllamaBusyAction}
            saveDefaultModel={saveDefaultModel}
            onRequestDisconnectAll={() => setLogoutDialogOpen(true)}
          />
        ) : null}
        {props.section === 'diagnostics' || props.section === 'storage' ? (
          <AdvancedSettingsSection
            settings={props}
            onOpenCompactRunEvents={() => setCompactRunEventsDialogOpen(true)}
            onOpenVacuumStorage={() => setVacuumStorageDialogOpen(true)}
          />
        ) : null}

        {props.section === 'archived_threads' ? (
          <ArchivedThreadsSection
            settings={props}
            onRequestDeleteArchivedThread={setDeleteArchivedThreadId}
          />
        ) : null}
        </div>
      </div>
      <div
        className="settings-floating-resize-handle"
        aria-hidden="true"
        onPointerDown={startSettingsResize}
      />
      </div>

      <ConfirmDialog
        open={compactRunEventsDialogOpen}
        onOpenChange={setCompactRunEventsDialogOpen}
        title="Compact old run events?"
        description={`This only removes delta events from archived terminal runs older than ${props.storageDiagnostics?.compactionCutoffDays ?? 30} days when planner state is idle and no review items are pending. Turns, final outcomes, and archived threads stay intact. Event counts drop immediately, but file size can lag while SQLite checkpoints its WAL.`}
        confirmLabel="Compact + checkpoint"
        onConfirm={() => {
          setCompactRunEventsDialogOpen(false);
          void props.compactRunEvents();
        }}
      />
      <ConfirmDialog
        open={vacuumStorageDialogOpen}
        onOpenChange={setVacuumStorageDialogOpen}
        title="Run deep SQLite cleanup?"
        description="This runs the normal archived-run compaction, checkpoints the WAL, and then VACUUMs the local SQLite store to reclaim free pages. It can take longer than normal compaction, but it does not delete canonical threads, turns, jobs, or reviews."
        confirmLabel="Run deep cleanup"
        onConfirm={() => {
          setVacuumStorageDialogOpen(false);
          void props.maintainStorage({ vacuum: true });
        }}
      />
      <ConfirmDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}
        title="Disconnect providers?"
        description="This only disconnects providers inside Vicode. It does not log you out of provider CLIs or other apps on this machine."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => void props.clearAllProviderAuth()}
      />
      <ConfirmDialog
        open={Boolean(deleteArchivedThreadId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteArchivedThreadId(null);
          }
        }}
        title="Delete archived thread permanently?"
        description="Archive keeps history and hides it from active lists. Delete permanently removes this archived thread from Vicode's local app store and cannot be undone."
        confirmLabel="Delete permanently"
        tone="danger"
        onConfirm={() => {
          if (!deleteArchivedThreadId) {
            return;
          }
          void props.deleteArchivedThread(deleteArchivedThreadId);
          setDeleteArchivedThreadId(null);
        }}
      />
    </section>
  );
}
