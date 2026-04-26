import type { JobDefinition, ReviewItem } from '../../shared/domain';
import { normalizeDisplayText } from '../../shared/display-text';

export type ReviewPresentation = {
  icon: 'note' | 'memory' | 'user' | 'automation';
  kindLabel: string;
  title: string;
  summary: string;
  meta: Array<{ label: string; value: string }>;
  isManualWrite: boolean;
};

export function describeReviewItem(
  reviewItem: ReviewItem,
  job: JobDefinition | null
): ReviewPresentation {
  if (reviewItem.details.actionType === 'daily_note_capture') {
    return {
      icon: 'note',
      kindLabel: 'Daily note draft',
      title: normalizeDisplayText(job?.title ?? 'Review daily note write'),
      summary: normalizeDisplayText(reviewItem.summary),
      meta: [
        { label: 'File', value: String(reviewItem.details.relativePath ?? 'memory') },
        { label: 'Thread', value: normalizeDisplayText(String(reviewItem.details.threadTitle ?? 'thread capture')) }
      ],
      isManualWrite: true
    };
  }

  if (reviewItem.details.actionType === 'memory_promotion') {
    return {
      icon: 'memory',
      kindLabel: 'Durable memory update',
      title: normalizeDisplayText(job?.title ?? 'Review MEMORY.md update'),
      summary: normalizeDisplayText(reviewItem.summary),
      meta: [
        { label: 'File', value: String(reviewItem.details.relativePath ?? 'MEMORY.md') },
        { label: 'Thread', value: normalizeDisplayText(String(reviewItem.details.threadTitle ?? 'memory promotion')) }
      ],
      isManualWrite: true
    };
  }

  if (reviewItem.details.actionType === 'user_preference') {
    return {
      icon: 'user',
      kindLabel: 'USER.md suggestion',
      title: normalizeDisplayText(job?.title ?? 'Review USER.md update'),
      summary: normalizeDisplayText(reviewItem.summary),
      meta: [
        { label: 'File', value: String(reviewItem.details.relativePath ?? 'USER.md') },
        { label: 'Thread', value: normalizeDisplayText(String(reviewItem.details.threadTitle ?? 'user preference')) }
      ],
      isManualWrite: true
    };
  }

  return {
    icon: 'automation',
    kindLabel: 'Automation approval',
    title: normalizeDisplayText(job?.title ?? reviewItem.summary),
    summary: normalizeDisplayText(reviewItem.summary),
    meta: [
      { label: 'Trigger', value: String(reviewItem.details.trigger ?? 'manual') },
      { label: 'Provider', value: String(reviewItem.details.providerId ?? 'unknown') },
      { label: 'Model', value: String(reviewItem.details.modelId ?? 'unknown') }
    ],
    isManualWrite: false
  };
}
