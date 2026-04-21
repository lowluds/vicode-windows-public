import { useEffect, useMemo, useState } from 'react';

const RANDOM_CHARS = '_!X$0-+*#';

function randomChar() {
  return RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)] ?? '_';
}

function buildScrambleFrame(target: string, revealCount: number) {
  let output = '';

  for (let index = 0; index < target.length; index += 1) {
    output += index < revealCount ? target[index] : randomChar();
  }

  return output;
}

export function ScrambleText({
  phrases,
  className = '',
  revealIntervalMs = 28,
  holdIntervalMs = 2200,
  pauseIntervalMs = 280
}: {
  phrases: string[];
  className?: string;
  revealIntervalMs?: number;
  holdIntervalMs?: number;
  pauseIntervalMs?: number;
}) {
  const normalizedPhrases = useMemo(() => phrases.filter((phrase) => phrase.trim().length > 0), [phrases]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayText, setDisplayText] = useState(() => normalizedPhrases[0] ?? '');

  useEffect(() => {
    if (normalizedPhrases.length === 0) {
      setDisplayText('');
      return;
    }

    const phrase = normalizedPhrases[phraseIndex % normalizedPhrases.length] ?? '';
    let revealCount = 0;

    setDisplayText(buildScrambleFrame(phrase, 0));

    const scrambleTimer = window.setInterval(() => {
      revealCount += 1;
      if (revealCount >= phrase.length) {
        setDisplayText(phrase);
        window.clearInterval(scrambleTimer);
      } else {
        setDisplayText(buildScrambleFrame(phrase, revealCount));
      }
    }, revealIntervalMs);

    const nextPhraseTimer = window.setTimeout(() => {
      setPhraseIndex((current) => (current + 1) % normalizedPhrases.length);
    }, Math.max(phrase.length * revealIntervalMs + holdIntervalMs + pauseIntervalMs, holdIntervalMs));

    return () => {
      window.clearInterval(scrambleTimer);
      window.clearTimeout(nextPhraseTimer);
    };
  }, [holdIntervalMs, normalizedPhrases, pauseIntervalMs, phraseIndex, revealIntervalMs]);

  return (
    <span className={className} aria-live="polite">
      {displayText}
    </span>
  );
}
