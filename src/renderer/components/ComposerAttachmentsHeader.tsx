import type { ImageAttachment, TextAttachment } from '../../shared/domain';
import type { NativeComposerCommand } from '../../shared/nativeCommands';
import { CloseIcon, DocumentIcon } from './icons';
import { ComposerActivityShelf, type ComposerActivityItem } from './ComposerActivityShelf';
import { PromptInputHeader } from './ai-elements/prompt-input';
import { IconButton } from './ui';

interface ComposerAttachmentsHeaderProps {
  activityItems: ComposerActivityItem[];
  pendingNativeCommand: NativeComposerCommand | null;
  clearPendingNativeCommand: () => void;
  imageAttachments: ImageAttachment[];
  textAttachments: TextAttachment[];
  removeImageAttachment: (attachmentId: string) => void;
  removeTextAttachment: (attachmentId: string) => Promise<void>;
}

export function ComposerAttachmentsHeader({
  activityItems,
  pendingNativeCommand,
  clearPendingNativeCommand,
  imageAttachments,
  textAttachments,
  removeImageAttachment,
  removeTextAttachment
}: ComposerAttachmentsHeaderProps) {
  return (
    <PromptInputHeader>
      <ComposerActivityShelf items={activityItems} />
      {pendingNativeCommand ? (
        <div className="composer-command-strip flex">
          <div className="composer-command-chip" role="status" aria-live="polite">
            <span className="composer-command-chip-token">/{pendingNativeCommand.token}</span>
            <span className="composer-command-chip-label">{pendingNativeCommand.title}</span>
            <IconButton
              size="compact"
              className="composer-command-chip-remove"
              label={`Clear ${pendingNativeCommand.title}`}
              onClick={clearPendingNativeCommand}
            >
              <CloseIcon size={12} />
            </IconButton>
          </div>
        </div>
      ) : null}
      {imageAttachments.length > 0 ? (
        <div className="composer-image-strip flex flex-wrap gap-2">
          {imageAttachments.map((attachment) => (
            <div key={attachment.id} className="composer-image-chip">
              <img src={attachment.dataUrl} alt={attachment.name} className="composer-image-chip-thumb size-10 rounded-xl object-cover" />
              <span className="composer-image-chip-label max-w-40 truncate text-[12px]">{attachment.name}</span>
              <IconButton
                size="compact"
                className="composer-image-chip-remove"
                label={`Remove ${attachment.name}`}
                onClick={() => removeImageAttachment(attachment.id)}
              >
                <CloseIcon size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}
      {textAttachments.length > 0 ? (
        <div className="composer-text-attachment-strip flex flex-wrap gap-2">
          {textAttachments.map((attachment) => (
            <div key={attachment.id} className="composer-text-attachment-chip flex min-w-0 items-center gap-2 rounded-2xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-3 py-2">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]">
                <DocumentIcon />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="max-w-52 truncate text-[12px] text-[color:var(--ui-text-title)]">{attachment.name}</span>
                <span className="max-w-60 truncate text-[11px] text-[color:var(--ui-text-subtle)]">
                  {attachment.charCount.toLocaleString()} chars - {attachment.relativePath}
                </span>
              </span>
              <IconButton
                size="compact"
                className="composer-image-chip-remove"
                label={`Remove ${attachment.name}`}
                onClick={() => void removeTextAttachment(attachment.id)}
              >
                <CloseIcon size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}
    </PromptInputHeader>
  );
}
