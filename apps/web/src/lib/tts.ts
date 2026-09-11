// PWA German TTS: thin wrapper over window.speechSynthesis (no network, no
// bundled audio files needed — works fully offline once the platform voice
// is installed, which is the common case on iOS/Android/desktop).

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickGermanVoice(): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.lang.toLowerCase() === "de-de") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("de")) ??
    null
  );
}

// Voices load asynchronously on most browsers; cache once available and
// refresh on the voiceschanged event so the first speak() call isn't silent.
export function primeVoices(): void {
  if (!ttsSupported()) return;
  cachedVoice = pickGermanVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = pickGermanVoice();
  };
}

export function hasGermanVoice(): boolean {
  if (cachedVoice === undefined) cachedVoice = pickGermanVoice();
  return cachedVoice !== null;
}

// Speak German text. Cancels any in-flight utterance first so rapid card
// navigation doesn't queue up stale audio. Never throws.
export function speakGerman(text: string, rate = 0.95): void {
  if (!ttsSupported() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "de-DE";
    utter.rate = rate;
    const voice = cachedVoice ?? pickGermanVoice();
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
  } catch {
    /* best-effort — never break the review flow over TTS */
  }
}

export function stopSpeaking(): void {
  if (ttsSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}
