import type { ReactNode } from 'react';
import type {
  ActivityGroupDetailItem,
  ActivityLineItem
} from './RunTranscriptTimeline.model';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import { DisclosureButton } from './ui';

type CommandGroupDetailItem = Extract<ActivityGroupDetailItem, { kind: 'command_group' }>;
type NestedDetailGroupItem = Extract<ActivityGroupDetailItem, { kind: 'detail_group' }>;

export function RunTranscriptCommandGroup({
  detailItem,
  expanded,
  onToggle,
  renderCommand
}: {
  detailItem: CommandGroupDetailItem;
  expanded: boolean;
  onToggle: () => void;
  renderCommand: (item: CommandGroupDetailItem['items'][number]) => ReactNode;
}) {
  return (
    <div className="run-transcript-command-group">
      <DisclosureButton
        className="run-transcript-command-group-trigger run-transcript-detail-trigger"
        align="start"
        trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        onClick={onToggle}
      >
        <span className="run-transcript-command-group-label">{detailItem.label}</span>
      </DisclosureButton>
      {expanded ? (
        <div className="run-transcript-command-group-body">
          {detailItem.items.map((commandItem) => (
            <div key={commandItem.id} className="run-transcript-command-group-entry">
              {renderCommand(commandItem)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RunTranscriptNestedDetailGroup({
  detailItem,
  expanded,
  onToggle,
  renderActivity
}: {
  detailItem: NestedDetailGroupItem;
  expanded: boolean;
  onToggle: () => void;
  renderActivity: (item: ActivityLineItem) => ReactNode;
}) {
  return (
    <div className="run-transcript-command-group run-transcript-detail-group">
      <DisclosureButton
        className="run-transcript-command-group-trigger run-transcript-detail-trigger"
        align="start"
        trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        onClick={onToggle}
      >
        <span className="run-transcript-command-group-label">{detailItem.label}</span>
      </DisclosureButton>
      {expanded ? (
        <div className="run-transcript-command-group-body">
          {detailItem.items.map((activityItem) => (
            <div key={activityItem.id} className="run-transcript-command-group-entry">
              {renderActivity(activityItem)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
