import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_REVISION = 'opening-reference-23';
const PITCH_RATE = 1.06;

const AFTER_AUDIO_MS = 80;
const SPEECH_FETCH_MS = 4500;

function loadSpeech(text, cacheRef, inflightRef) {
  const spoken = String(text || '').trim();
  if (!spoken) return Promise.resolve(null);
  const cacheKey = `${SPEECH_REVISION}:${spoken}`;
  const cached = cacheRef.current.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const pending = inflightRef.current.get(cacheKey);
  if (pending) return pending;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPEECH_FETCH_MS);
  const task = fetch('/api/discussion-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: spoken }),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error('speech failed');
    const blob = await response.blob();
    if (!blob.size) throw new Error('empty audio');
    const cache = cacheRef.current;
    cache.set(cacheKey, blob);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return blob;
  }).finally(() => {
    clearTimeout(timer);
    if (inflightRef.current.get(cacheKey) === task) inflightRef.current.delete(cacheKey);
  });
  inflightRef.current.set(cacheKey, task);
  return task;
}

export function useSpeechOutput() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [voiceLive, setVoiceLive] = useState(false);
  const [voiceMark, setVoiceMark] = useState(0);
  const sessionRef = useRef(0);
  const voiceLevelRef = useRef(0);
  const voiceLiveRef = useRef(false);
  const levelLoopRef = useRef(0);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const haltRef = useRef(null);
  const abortRef = useRef(null);
  const unlockRef = useRef(null);
  const cacheRef = useRef(new Map());
  const inflightRef = useRef(new Map());

  const clearUnlock = useCallback(() => {
    if (!unlockRef.current) return;
    window.removeEventListener('pointerdown', unlockRef.current, true);
    window.removeEventListener('keydown', unlockRef.current, true);
    unlockRef.current = null;
  }, []);

  const stopLevel = useCallback(() => {
    window.cancelAnimationFrame(levelLoopRef.current);
    voiceLiveRef.current = false;
    const ease = () => {
      voiceLevelRef.current *= 0.84;
      if (voiceLevelRef.current < 0.012) {
        voiceLevelRef.current = 0;
        return;
      }
      levelLoopRef.current = window.requestAnimationFrame(ease);
    };
    levelLoopRef.current = window.requestAnimationFrame(ease);
  }, []);

  const stopAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    haltRef.current?.();
    haltRef.current = null;
  }, []);

  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtxRef.current) {
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    }
    audioCtxRef.current.resume?.();
    return audioCtxRef.current;
  }, []);

  const stopSpeaking = useCallback(() => {
    sessionRef.current += 1;
    clearUnlock();
    stopAudio();
    stopLevel();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setVoiceLive(false);
  }, [clearUnlock, stopAudio, stopLevel]);

  useEffect(() => {
    setIsSupported(typeof window !== 'undefined' && (typeof Audio !== 'undefined' || 'speechSynthesis' in window));
    const unlock = () => {
      ensureAudio();
      unlockRef.current?.();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      sessionRef.current += 1;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      clearUnlock();
      stopAudio();
      window.cancelAnimationFrame(levelLoopRef.current);
      voiceLiveRef.current = false;
      voiceLevelRef.current = 0;
      audioCtxRef.current?.close?.();
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
  }, [clearUnlock, ensureAudio, stopAudio]);

  const speak = useCallback((text, onEnd, onAudioEnd, onPlaybackStart) => {
    const spoken = String(text || '').trim();
    if (typeof window === 'undefined' || !spoken) {
      onEnd?.();
      return false;
    }

    const session = sessionRef.current + 1;
    sessionRef.current = session;
    clearUnlock();
    stopAudio();
    ensureAudio();
    window.speechSynthesis?.cancel();

    let finished = false;
    const finish = () => {
      if (finished || session !== sessionRef.current) return;
      finished = true;
      stopLevel();
      setIsSpeaking(false);
      setVoiceLive(false);
      onEnd?.();
    };

    const armMeter = () => {
      const samples = new Uint8Array(analyserRef.current?.fftSize || 512);
      let peaked = false;
      voiceLiveRef.current = true;
      setVoiceLive(true);
      const follow = () => {
        if (finished || session !== sessionRef.current || !voiceLiveRef.current) return;
        const analyser = analyserRef.current;
        if (analyser) {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const sample = (samples[i] - 128) / 128;
            sum += sample * sample;
          }
          const rms = Math.sqrt(sum / samples.length);
          const level = Math.min(1, Math.max(0, (rms - 0.012) * 7));
          voiceLevelRef.current = level;
          if (level > 0.42 && !peaked) {
            peaked = true;
            setVoiceMark((mark) => mark + 1);
          } else if (level < 0.16) {
            peaked = false;
          }
        }
        levelLoopRef.current = window.requestAnimationFrame(follow);
      };
      window.cancelAnimationFrame(levelLoopRef.current);
      levelLoopRef.current = window.requestAnimationFrame(follow);
      audioCtxRef.current?.resume?.();
    };

    const playBlob = async (blob) => {
      if (finished || session !== sessionRef.current) return;
      const ctx = ensureAudio();
      if (!ctx) throw new Error('no audio');
      const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
      if (finished || session !== sessionRef.current) return;
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.playbackRate.value = PITCH_RATE;
      source.connect(analyserRef.current);
      let halted = false;
      let started = false;
      haltRef.current = () => {
        halted = true;
        try { source.stop(); } catch { /* already stopped */ }
        try { source.disconnect(); } catch { /* already disconnected */ }
      };
      source.onended = () => {
        if (halted || session !== sessionRef.current) return;
        stopLevel();
        setVoiceLive(false);
        onAudioEnd?.();
        window.setTimeout(finish, AFTER_AUDIO_MS);
      };
      const begin = async () => {
        if (started || halted || finished || session !== sessionRef.current) return;
        await ctx.resume();
        if (ctx.state === 'suspended') return;
        started = true;
        setIsSpeaking(true);
        onPlaybackStart?.();
        armMeter();
        source.start();
      };
      await begin();
      if (started || halted || finished || session !== sessionRef.current) return;
      const unlock = () => {
        clearUnlock();
        begin().catch(() => finish());
      };
      unlockRef.current = unlock;
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    };

    const playElement = async (blob) => {
      if (finished || session !== sessionRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = PITCH_RATE;
      let halted = false;
      haltRef.current = () => {
        halted = true;
        audio.pause();
        URL.revokeObjectURL(url);
      };
      audio.onended = () => {
        if (halted || session !== sessionRef.current) return;
        URL.revokeObjectURL(url);
        onAudioEnd?.();
        window.setTimeout(finish, AFTER_AUDIO_MS);
      };
      await audio.play();
      if (halted || finished || session !== sessionRef.current) return;
      setIsSpeaking(true);
      onPlaybackStart?.();
    };

    loadSpeech(spoken, cacheRef, inflightRef).then(async (blob) => {
      if (finished || session !== sessionRef.current || !blob) return;
      try {
        await playBlob(blob);
      } catch (error) {
        if (finished || session !== sessionRef.current) return;
        if (error?.name === 'AbortError') return;
        await playElement(blob);
      }
    }).catch(() => {
      if (finished || session !== sessionRef.current) return;
      onAudioEnd?.();
      finish();
    });

    return true;
  }, [clearUnlock, ensureAudio, stopAudio, stopLevel]);

  const warm = useCallback((text) => {
    loadSpeech(text, cacheRef, inflightRef).catch(() => {});
  }, []);

  return {
    speak,
    warm,
    stopSpeaking,
    isSpeaking,
    isSupported,
    voiceLive,
    voiceMark,
    voiceLevelRef,
    voiceLiveRef,
  };
};
