import type { ReactNode } from 'react';
import { SurfaceCard } from '../ui';

export const SETTINGS_SECTION_CLASS = 'settings-section-stack flex flex-col gap-6';
export const SETTINGS_COMPACT_SECTION_CLASS =
  'settings-section-stack settings-section-stack-compact flex flex-col gap-5';
export const SETTINGS_INLINE_ACTIONS_CLASS = 'settings-inline-actions flex flex-wrap items-center gap-3';

export function SettingsSectionHeader({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="settings-detail-header flex flex-col gap-2 pb-1">
      <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">
        {title}
      </h2>
      <p className="max-w-4xl text-[14px] leading-6 text-[color:var(--ui-text-muted)]">{description}</p>
    </header>
  );
}

export function SettingsPanel({
  title,
  description,
  children,
  className = ''
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-panel ${className}`}>
      <div className="settings-panel-header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <SurfaceCard className="settings-panel-card">
        <div className="settings-panel-body">{children}</div>
      </SurfaceCard>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  className = ''
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-row ${className}`}>
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
