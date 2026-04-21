export type VoiceState = 'idle' | 'recording' | 'transcribing';

const RECORDER_MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;
const WHISPER_SAMPLE_RATE = 16_000;

export function isVoiceDictationSupported() {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined');
}

export function resolveVoiceRecorderMimeType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return '';
  }

  for (const mimeType of RECORDER_MIME_TYPE_CANDIDATES) {
    if (window.MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return '';
}

export function normalizeVoiceTranscript(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function appendVoiceTranscript(prompt: string, transcript: string) {
  const normalizedTranscript = normalizeVoiceTranscript(transcript);
  if (!normalizedTranscript) {
    return prompt;
  }

  const trimmedPrompt = prompt.trimEnd();
  if (!trimmedPrompt) {
    return normalizedTranscript;
  }

  const separator = /\s$/.test(prompt) ? '' : ' ';
  return `${prompt}${separator}${normalizedTranscript}`;
}

export async function blobToBase64(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function transcodeVoiceBlobToWav(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = downMixToMono(audioBuffer);
    const resampled = audioBuffer.sampleRate === WHISPER_SAMPLE_RATE
      ? mono
      : resamplePcmLinear(mono, audioBuffer.sampleRate, WHISPER_SAMPLE_RATE);

    return new Blob([encodeWav(resampled, WHISPER_SAMPLE_RATE)], { type: 'audio/wav' });
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function downMixToMono(audioBuffer: AudioBuffer) {
  const mono = new Float32Array(audioBuffer.length);
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < channelData.length; sampleIndex += 1) {
      mono[sampleIndex] += channelData[sampleIndex] / channelCount;
    }
  }

  return mono;
}

function resamplePcmLinear(input: Float32Array, sourceSampleRate: number, targetSampleRate: number) {
  if (input.length === 0 || sourceSampleRate === targetSampleRate) {
    return input;
  }

  const durationSeconds = input.length / sourceSampleRate;
  const targetLength = Math.max(1, Math.round(durationSeconds * targetSampleRate));
  const output = new Float32Array(targetLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < targetLength; index += 1) {
    const sourceIndex = index * ratio;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1);
    const weight = sourceIndex - lowerIndex;
    output[index] = input[lowerIndex] * (1 - weight) + input[upperIndex] * weight;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
