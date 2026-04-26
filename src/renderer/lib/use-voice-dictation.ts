import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../../shared/domain';
import type { MicrophoneAccessStatus } from '../../shared/ipc';
import {
  blobToBase64,
  isVoiceDictationSupported,
  normalizeVoiceTranscript,
  resolveVoiceRecorderMimeType,
  transcodeVoiceBlobToWav,
  type VoiceState
} from './voice-dictation';

type ToastLevel = 'info' | 'warning' | 'error';

type UseVoiceDictationInput = {
  preferences: Preferences | null;
  appendTranscript(transcript: string): boolean;
  savePreferences(input: Partial<Preferences>): Promise<Preferences>;
  setPreferences(preferences: Preferences): void;
  showToast(level: ToastLevel, message: string): void;
  formatMicrophoneAccessMessage(status: MicrophoneAccessStatus): string;
  isMicrophoneAccessBlocked(status: MicrophoneAccessStatus): boolean;
  formatUserErrorMessage(error: unknown, fallback: string): string;
};

export function useVoiceDictation(input: UseVoiceDictationInput) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [microphoneConsentOpen, setMicrophoneConsentOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);

  function stopVoiceVisualization() {
    if (analyserFrameRef.current !== null) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    voiceRecordingStartedAtRef.current = null;
    setVoiceElapsedMs(0);
    setVoiceLevel(0);
  }

  async function startVoiceVisualization(stream: MediaStream) {
    stopVoiceVisualization();

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    voiceRecordingStartedAtRef.current = Date.now();
    setVoiceElapsedMs(0);

    const updateLevel = () => {
      const activeAnalyser = analyserRef.current;
      if (!activeAnalyser) {
        return;
      }

      activeAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      setVoiceLevel(Math.min(1, rms * 4.5));
      analyserFrameRef.current = window.requestAnimationFrame(updateLevel);
    };

    voiceTimerRef.current = window.setInterval(() => {
      const startedAt = voiceRecordingStartedAtRef.current;
      if (!startedAt) {
        return;
      }
      setVoiceElapsedMs(Date.now() - startedAt);
    }, 250);

    analyserFrameRef.current = window.requestAnimationFrame(updateLevel);
  }

  function startVoiceRecording() {
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        voiceChunksRef.current = [];

        const preferredMimeType = resolveVoiceRecorderMimeType();
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        await startVoiceVisualization(stream);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            voiceChunksRef.current.push(event.data);
          }
        };

        recorder.onerror = () => {
          mediaRecorderRef.current = null;
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
          voiceChunksRef.current = [];
          stopVoiceVisualization();
          setVoiceState('idle');
          input.showToast('error', 'Voice recording failed. Check your microphone and try again.');
        };

        recorder.onstart = () => {
          setVoiceState('recording');
        };

        recorder.onstop = async () => {
          const chunks = [...voiceChunksRef.current];
          voiceChunksRef.current = [];
          mediaRecorderRef.current = null;
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
          stopVoiceVisualization();

          if (chunks.length === 0) {
            setVoiceState('idle');
            input.showToast('info', 'No speech detected. Try again.');
            return;
          }

          try {
            const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
            const blob = new Blob(chunks, { type: mimeType });
            const wavBlob = await transcodeVoiceBlobToWav(blob);
            const audioBase64 = await blobToBase64(wavBlob);
            const result = await window.vicode.voice.transcribe({
              audioBase64,
              mimeType: 'audio/wav',
              fileName: 'dictation.wav'
            });
            setVoiceState('idle');
            const appended = input.appendTranscript(normalizeVoiceTranscript(result.text));
            if (!appended) {
              input.showToast('info', 'No speech detected. Try again.');
            }
          } catch (error) {
            setVoiceState('idle');
            input.showToast('error', input.formatUserErrorMessage(error, 'Voice dictation failed. Try again.'));
          }
        };

        recorder.start();
      } catch (error) {
        mediaRecorderRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        voiceChunksRef.current = [];
        stopVoiceVisualization();
        setVoiceState('idle');
        input.showToast(
          'error',
          input.formatUserErrorMessage(
            error,
            'Voice recording could not start. Check microphone permissions and try again.'
          )
        );
      }
    })();
  }

  async function syncMicrophoneConsentPreference() {
    if (input.preferences?.microphoneAllowed) {
      return;
    }

    try {
      const nextPreferences = await input.savePreferences({ microphoneAllowed: true });
      input.setPreferences(nextPreferences);
    } catch {
      // Keep dictation usable even if the local preference write fails.
    }
  }

  async function handleComposerVoice() {
    if (!isVoiceDictationSupported()) {
      input.showToast('warning', 'Voice dictation is not available in this app runtime.');
      return;
    }

    if (voiceState === 'transcribing') {
      return;
    }

    if (voiceState === 'recording') {
      setVoiceState('transcribing');
      mediaRecorderRef.current?.stop();
      return;
    }

    const microphoneAccessStatus = await window.vicode.voice.getMicrophoneAccessStatus();
    if (input.isMicrophoneAccessBlocked(microphoneAccessStatus)) {
      setMicrophoneConsentOpen(false);
      input.showToast('error', input.formatMicrophoneAccessMessage(microphoneAccessStatus));
      return;
    }

    if (!input.preferences?.microphoneAllowed) {
      if (microphoneAccessStatus === 'granted') {
        void syncMicrophoneConsentPreference();
        startVoiceRecording();
        return;
      }

      setMicrophoneConsentOpen(true);
      return;
    }

    startVoiceRecording();
  }

  async function allowMicrophoneForApp() {
    const microphoneAccessStatus = await window.vicode.voice.getMicrophoneAccessStatus();
    if (input.isMicrophoneAccessBlocked(microphoneAccessStatus)) {
      setMicrophoneConsentOpen(false);
      input.showToast('error', input.formatMicrophoneAccessMessage(microphoneAccessStatus));
      return;
    }

    try {
      const nextPreferences = await input.savePreferences({ microphoneAllowed: true });
      input.setPreferences(nextPreferences);
      setMicrophoneConsentOpen(false);
      startVoiceRecording();
    } catch (error) {
      input.showToast('error', input.formatUserErrorMessage(error, 'Unable to save microphone permission.'));
    }
  }

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            // Ignore teardown failures from the media recorder.
          }
        }
        mediaRecorderRef.current = null;
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      voiceChunksRef.current = [];
      stopVoiceVisualization();
    };
  }, []);

  return {
    voiceAvailable: isVoiceDictationSupported(),
    voiceState,
    voiceElapsedMs,
    voiceLevel,
    microphoneConsentOpen,
    setMicrophoneConsentOpen,
    handleComposerVoice,
    allowMicrophoneForApp
  };
}
