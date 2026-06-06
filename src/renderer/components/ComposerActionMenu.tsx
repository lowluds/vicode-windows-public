import type { ComposerMode } from '../../shared/domain';
import { DocumentIcon, MagicPenIcon, PlusIcon, TaskIcon } from './icons';
import { PromptInputTools } from './ai-elements/prompt-input';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuTrigger
} from './ui';
import { cx } from './ui/utils';

interface ComposerActionMenuProps {
  composerMode: ComposerMode;
  enhancingPrompt: boolean;
  canEnhancePrompt: boolean;
  openImagePicker: () => void;
  enhancePrompt: () => void;
  toggleComposerMode: () => void;
}

export function ComposerActionMenu({
  composerMode,
  enhancingPrompt,
  canEnhancePrompt,
  openImagePicker,
  enhancePrompt,
  toggleComposerMode
}: ComposerActionMenuProps) {
  return (
    <PromptInputTools className="composer-plus-controls shrink-0">
      <Menu>
        <MenuTrigger asChild>
          <IconButton
            className="composer-icon-button composer-attach-button"
            data-testid="composer-action-menu-trigger"
            label="Composer actions"
          >
            <PlusIcon />
          </IconButton>
        </MenuTrigger>
        <MenuContent className="composer-menu composer-attach-menu">
          <MenuItem
            data-testid="composer-action-add-images"
            onSelect={(event) => {
              event.preventDefault();
              openImagePicker();
            }}
            className="composer-attach-item rounded-xl"
          >
            <span className="composer-attach-item-icon">
              <DocumentIcon />
            </span>
            <MenuItemLabel>Add images</MenuItemLabel>
          </MenuItem>
          <MenuItem
            data-testid="composer-action-enhance"
            onSelect={enhancePrompt}
            className="composer-attach-item rounded-xl"
            disabled={enhancingPrompt || !canEnhancePrompt}
          >
            <span className="composer-attach-item-icon">
              <MagicPenIcon />
            </span>
              <MenuItemLabel>{enhancingPrompt ? 'Enhancing Prompt…' : 'Enhance Prompt'}</MenuItemLabel>
          </MenuItem>
          <MenuItem
            data-testid="composer-action-plan-mode"
            onSelect={toggleComposerMode}
            className="composer-attach-item composer-attach-item-static rounded-xl"
          >
            <span className="composer-attach-item-icon">
              <TaskIcon />
            </span>
            <MenuItemLabel>Plan mode</MenuItemLabel>
            <span
              className={cx(
                composerMode === 'plan' ? 'composer-inline-switch is-on' : 'composer-inline-switch',
                'relative inline-flex rounded-full transition-colors'
              )}
              aria-hidden="true"
            >
              <span
                className="composer-inline-switch-knob absolute rounded-full transition-transform"
              />
            </span>
          </MenuItem>
        </MenuContent>
      </Menu>
    </PromptInputTools>
  );
}
