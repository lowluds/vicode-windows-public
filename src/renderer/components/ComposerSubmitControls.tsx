import type { ReactElement } from 'react';
import type { VoiceState } from '../lib/voice-dictation';
import { LoadingIcon, MicIcon, SendIcon } from './icons';
import { PromptInputSubmit, PromptInputTools } from './ai-elements/prompt-input';
import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui';

function ComposerTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="composer-tooltip">{label}</TooltipContent>
    </Tooltip>
  );
}

interface ComposerSubmitControlsProps {
  voiceState: VoiceState;
  voiceAvailable: boolean;
  voiceElapsedLabel: string;
  voiceLevel: number;
  voiceTooltipLabel: string;
  voiceButtonClassName: string;
  handleComposerVoice: () => void;
  submitTooltipLabel: string;
  submitButtonClassName: string;
  handleSubmitButtonClick: () => void;
  isRunning: boolean;
  enhancingPrompt: boolean;
  isSubmitting: boolean;
}

export function ComposerSubmitControls({
  voiceState,
  voiceAvailable,
  voiceElapsedLabel,
  voiceLevel,
  voiceTooltipLabel,
  voiceButtonClassName,
  handleComposerVoice,
  submitTooltipLabel,
  submitButtonClassName,
  handleSubmitButtonClick,
  isRunning,
  enhancingPrompt,
  isSubmitting
}: ComposerSubmitControlsProps) {
  return (
    <PromptInputTools className="composer-right-controls shrink-0">
      {voiceState === 'recording' ? (
        <div className="composer-voice-status" aria-live="polite">
          <div className="composer-voice-meter inline-flex items-center gap-1" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => {
              const threshold = (index + 1) / 24;
              const active = voiceLevel >= threshold;
              return (
                <span
                  key={`voice-meter-${index}`}
                  className={active ? 'composer-voice-meter-bar is-active h-3 w-0.5 rounded-full' : 'composer-voice-meter-bar h-3 w-0.5 rounded-full'}
                />
              );
            })}
          </div>
          <span className="composer-voice-timer">{voiceElapsedLabel}</span>
        </div>
      ) : null}
      <ComposerTooltip label={voiceTooltipLabel}>
        <IconButton
          className={voiceButtonClassName}
          data-testid="composer-voice-button"
          onClick={handleComposerVoice}
          label={voiceTooltipLabel}
          disabled={!voiceAvailable || voiceState === 'transcribing'}
          aria-pressed={voiceState === 'recording'}
        >
          <MicIcon />
        </IconButton>
      </ComposerTooltip>
      <ComposerTooltip label={submitTooltipLabel}>
        <PromptInputSubmit
          data-testid="composer-submit-button"
          className={submitButtonClassName}
          onClick={handleSubmitButtonClick}
          label={isRunning ? 'Stop' : enhancingPrompt ? 'Enhancing prompt' : isSubmitting ? 'Sending' : 'Send'}
          disabled={!isRunning && (enhancingPrompt || isSubmitting)}
          aria-busy={enhancingPrompt || isSubmitting || undefined}
        >
          {isRunning ? (
            <span className="composer-stop-glyph inline-block size-3 rounded-[2px] bg-current" aria-hidden="true" />
          ) : enhancingPrompt || isSubmitting ? (
            <span className="composer-send-enhance-indicator relative inline-flex size-4 items-center justify-center" aria-hidden="true">
              <span className="composer-send-enhance-ring absolute inset-0 rounded-full border border-current/30" />
              <LoadingIcon size={14} strokeWidth={2.05} className="composer-send-spinner" />
            </span>
          ) : (
            <SendIcon className="composer-send-glyph" />
          )}
        </PromptInputSubmit>
      </ComposerTooltip>
    </PromptInputTools>
  );
}
