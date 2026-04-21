import { memo } from 'react';
import { PrimaryButton } from './ui';
import wolfLogo from '../assets/wolf-logo.png';

export const EmptyThreadHero = memo(
  function EmptyThreadHero({
    showOpenProjectAction,
    onOpenProject
  }: {
    showOpenProjectAction: boolean;
    onOpenProject: () => void;
  }) {
    return (
      <div className="empty-thread-state empty-thread-state-centered" aria-label="Empty thread workspace">
        <div className="empty-thread-prompt">
          <img className="empty-thread-prompt-logo" src={wolfLogo} alt="Vicode logo" />
          <h3 className="empty-thread-prompt-title">Start building</h3>
          {showOpenProjectAction ? (
            <>
              <p className="empty-thread-prompt-note">Open a local project to begin.</p>
              <PrimaryButton className="empty-thread-prompt-action" onClick={onOpenProject}>
                Open project
              </PrimaryButton>
            </>
          ) : null}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.showOpenProjectAction === nextProps.showOpenProjectAction
);
