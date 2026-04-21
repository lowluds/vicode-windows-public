import { ActionButton, SurfaceCard } from './ui';
import { EditIcon, TrashIcon } from './icons';
import type { ThreadFollowUp } from '../../shared/domain';

interface QueuedFollowupsPanelProps {
  followUps: ThreadFollowUp[];
  editingFollowUpId: string | null;
  onEdit: (followUp: ThreadFollowUp) => void;
  onDelete: (followUpId: string) => void;
}

function followUpLabel(followUp: ThreadFollowUp) {
  return followUp.kind === 'steer' ? 'Steer' : 'Follow-up';
}

function readCondensedQueuedCount(followUp: ThreadFollowUp) {
  const value = followUp.metadata?.condensedQueuedCount;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function QueuedFollowupsPanel({
  followUps,
  editingFollowUpId,
  onEdit,
  onDelete
}: QueuedFollowupsPanelProps) {
  if (followUps.length === 0) {
    return null;
  }

  const condensedQueuedCount = followUps.reduce((total, followUp) => total + readCondensedQueuedCount(followUp), 0);

  return (
    <SurfaceCard className="queued-followups-panel">
      <div className="queued-followups-panel-header">
        <div>
          <strong>Queued messages</strong>
          <p>
            These will run one at a time after the active run finishes.
            {condensedQueuedCount > 0
              ? ` ${condensedQueuedCount} earlier steer ${condensedQueuedCount === 1 ? 'message was' : 'messages were'} condensed into the newest queued steer.`
              : ''}
          </p>
        </div>
      </div>
      <div className="queued-followups-list">
        {followUps.map((followUp, index) => (
          <div key={followUp.id} className="queued-followup-item">
            <div className="queued-followup-item-copy">
              <div className="queued-followup-item-meta">
                <span className="queued-followup-item-badge" data-kind={followUp.kind}>
                  {followUpLabel(followUp)}
                </span>
                <span className="queued-followup-item-order">#{index + 1}</span>
                {editingFollowUpId === followUp.id ? <span className="queued-followup-item-editing">Editing</span> : null}
                {readCondensedQueuedCount(followUp) > 0 ? (
                  <span className="queued-followup-item-condensed">
                    Condenses {readCondensedQueuedCount(followUp)} earlier steer {readCondensedQueuedCount(followUp) === 1 ? 'message' : 'messages'}
                  </span>
                ) : null}
              </div>
              <p>{followUp.content}</p>
            </div>
            <div className="queued-followup-item-actions">
              <ActionButton size="compact" tone="quiet" onClick={() => onEdit(followUp)}>
                <EditIcon />
                Edit
              </ActionButton>
              <ActionButton size="compact" tone="quiet" onClick={() => onDelete(followUp.id)}>
                <TrashIcon />
                Delete
              </ActionButton>
            </div>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
