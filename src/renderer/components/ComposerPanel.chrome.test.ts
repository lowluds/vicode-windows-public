import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImageAttachment, TextAttachment } from '../../shared/domain';
import { nativeComposerCommands } from '../../shared/nativeCommands';
import { ComposerActionMenu } from './ComposerActionMenu';
import { ComposerAttachmentsHeader } from './ComposerAttachmentsHeader';
import { ComposerPlanModePill } from './ComposerPlanModePill';
import { ComposerSubmitControls } from './ComposerSubmitControls';
import { TooltipProvider } from './ui';

const imageAttachment: ImageAttachment = {
  id: 'image-1',
  name: 'screenshot.png',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,AA=='
};

const textAttachment: TextAttachment = {
  id: 'text-1',
  name: 'requirements.txt',
  mimeType: 'text/plain',
  relativePath: 'notes/requirements.txt',
  absolutePath: 'D:/workspace/notes/requirements.txt',
  charCount: 1240
};

describe('Composer chrome components', () => {
  it('renders command and attachment chips without the main composer shell', () => {
    const html = renderToStaticMarkup(
      createElement(ComposerAttachmentsHeader, {
        activityItems: [],
        pendingNativeCommand: nativeComposerCommands.find((command) => command.id === 'review') ?? null,
        clearPendingNativeCommand: () => undefined,
        imageAttachments: [imageAttachment],
        textAttachments: [textAttachment],
        removeImageAttachment: () => undefined,
        removeTextAttachment: async () => undefined
      })
    );

    expect(html).toContain('/review');
    expect(html).toContain('Review');
    expect(html).toContain('screenshot.png');
    expect(html).toContain('requirements.txt');
    expect(html).toContain('1,240 chars');
    expect(html).toContain('notes/requirements.txt');
  });

  it('renders voice recording state and submit state without the main composer shell', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerSubmitControls, {
          voiceState: 'recording',
          voiceAvailable: true,
          voiceElapsedLabel: '00:07',
          voiceLevel: 0.5,
          voiceTooltipLabel: 'Stop voice dictation',
          voiceButtonClassName: 'composer-icon-button composer-voice-button rounded-full is-recording',
          handleComposerVoice: () => undefined,
          submitTooltipLabel: 'Stop response',
          submitButtonClassName: 'composer-send-button is-running',
          handleSubmitButtonClick: () => undefined,
          isRunning: true,
          enhancingPrompt: false,
          isSubmitting: false
        })
      )
    );

    expect(html).toContain('composer-right-controls');
    expect(html).toContain('00:07');
    expect(html).toContain('Stop voice dictation');
    expect(html).toContain('composer-submit-button');
    expect(html).toContain('Stop');
  });

  it('renders the composer action trigger without the main composer shell', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerActionMenu, {
          composerMode: 'chat',
          enhancingPrompt: false,
          canEnhancePrompt: true,
          openImagePicker: () => undefined,
          enhancePrompt: () => undefined,
          toggleComposerMode: () => undefined
        })
      )
    );

    expect(html).toContain('composer-plus-controls');
    expect(html).toContain('Composer actions');
  });

  it('renders the active plan mode pill without the main composer shell', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerPlanModePill, {
          toggleComposerMode: () => undefined
        })
      )
    );

    expect(html).toContain('composer-plan-pill');
    expect(html).toContain('Plan');
  });
});
