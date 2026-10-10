import { useCallback, useEffect, useRef, useState } from 'react';

// 임시 진단: 인식 이벤트를 서버 접속 기록(server.log)에 남긴다. 화면에는 아무것도 띄우지 않는다.
function micTrace(event, detail = '') {
  try {
    const query = new URLSearchParams({ ev: event, d: String(detail).slice(0, 80), t: String(Date.now()) });
    fetch(`/__mic-trace?${query.toString()}`, { keepalive: true }).catch(() => {});
  } catch {
    /* 진단 기록 실패는 무시 */
  }
}

export function useSpeechInput({ onFinalTranscript, onTranscriptUpdate } = {}) {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const onFinalRef = useRef(onFinalTranscript);
  const onUpdateRef = useRef(onTranscriptUpdate);
  const transcriptRef = useRef('');
  const interimRef = useRef('');
  const isListeningRef = useRef(false);
  const levelRef = useRef(0);
  const meterRef = useRef(null);
  const meterGenRef = useRef(0);

  const stopMeter = useCallback(() => {
    meterGenRef.current += 1;
    const meter = meterRef.current;
    meterRef.current = null;
    levelRef.current = 0;
    if (!meter) return;
    window.cancelAnimationFrame(meter.frame);
    meter.stream.getTracks().forEach((track) => track.stop());
    meter.ctx.close().catch(() => {});
  }, []);

  const startMeter = useCallback(async () => {
    if (meterRef.current || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    const gen = meterGenRef.current + 1;
    meterGenRef.current = gen;
    try {
      // 음량 표시 전용. 자동 음량 조절을 켜면 Chrome 이 시스템 마이크 음량을 낮춰 음성 인식까지 작게 듣는다.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (meterGenRef.current !== gen || !shouldListenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      void ctx.resume();
      const data = new Uint8Array(analyser.fftSize);
      const meter = { stream, ctx, frame: 0 };
      meterRef.current = meter;
      const tick = () => {
        if (meterRef.current !== meter) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const sample = (data[i] - 128) / 128;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / data.length);
        const next = Math.min(1, Math.max(0, (rms - 0.008) / 0.05));
        const prev = levelRef.current;
        levelRef.current = prev + (next - prev) * (next > prev ? 0.62 : 0.16);
        meter.frame = window.requestAnimationFrame(tick);
      };
      meter.frame = window.requestAnimationFrame(tick);
    } catch {
      levelRef.current = 0;
    }
  }, []);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    onUpdateRef.current = onTranscriptUpdate;
  }, [onTranscriptUpdate]);

  const emitTranscriptUpdate = useCallback(() => {
    const combined = `${transcriptRef.current} ${interimRef.current}`.trim();
    onUpdateRef.current?.(combined, transcriptRef.current, interimRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return undefined;
    }

    setIsSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      micTrace(finalText ? 'final' : 'interim', finalText || interimText);
      if (finalText) {
        transcriptRef.current = `${transcriptRef.current}${finalText}`.trim();
        setTranscript(transcriptRef.current);
        onFinalRef.current?.(transcriptRef.current, finalText.trim());
      }

      interimRef.current = interimText;
      setInterimTranscript(interimText);
      emitTranscriptUpdate();
    };

    recognition.onstart = () => micTrace('start');
    recognition.onaudiostart = () => micTrace('audiostart');
    recognition.onspeechstart = () => micTrace('speechstart');
    recognition.onerror = (event) => {
      micTrace('error', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.error);
      }
    };

    recognition.onend = () => {
      micTrace('end', shouldListenRef.current ? 'restart' : 'stop');
      if (shouldListenRef.current && recognitionRef.current) {
        const restart = (attempt) => {
          window.setTimeout(() => {
            if (!shouldListenRef.current || !recognitionRef.current) return;
            try {
              recognitionRef.current.start();
              isListeningRef.current = true;
              setIsListening(true);
            } catch (error) {
              if (error?.name === 'InvalidStateError') {
                isListeningRef.current = true;
                setIsListening(true);
                return;
              }
              if (attempt < 6) {
                restart(attempt + 1);
                return;
              }
              isListeningRef.current = false;
              setIsListening(false);
            }
          }, 180 * (attempt + 1));
        };
        restart(0);
        return;
      }
      setIsListening(false);
      isListeningRef.current = false;
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      recognition.stop();
      stopMeter();
    };
  }, [emitTranscriptUpdate, stopMeter]);

  const stopListening = useCallback(() => {
    if (shouldListenRef.current) micTrace('stop');
    shouldListenRef.current = false;
    recognitionRef.current?.stop();
    isListeningRef.current = false;
    setIsListening(false);
    stopMeter();
  }, [stopMeter]);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return false;
    setError(null);
    shouldListenRef.current = true;

    micTrace('listen');
    const tryStart = (attempt = 0) => {
      try {
        recognition.start();
        isListeningRef.current = true;
        setIsListening(true);
        return true;
      } catch (error) {
        micTrace('start-fail', `${error?.name} #${attempt}`);
        if (attempt >= 6) {
          isListeningRef.current = false;
          setIsListening(false);
          return false;
        }
        window.setTimeout(() => tryStart(attempt + 1), 200 * (attempt + 1));
        return false;
      }
    };

    startMeter();
    return tryStart();
  }, [startMeter]);

  const getIsListening = useCallback(() => isListeningRef.current, []);

  const clearTranscript = useCallback(() => {
    transcriptRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    emitTranscriptUpdate();
  }, [emitTranscriptUpdate]);

  const setManualText = useCallback(
    (text) => {
      transcriptRef.current = text;
      interimRef.current = '';
      setTranscript(text);
      setInterimTranscript('');
      emitTranscriptUpdate();
    },
    [emitTranscriptUpdate]
  );

  const getCombinedText = useCallback(() => {
    return `${transcriptRef.current} ${interimRef.current}`.trim();
  }, []);

  return {
    transcript,
    interimTranscript,
    isListening,
    isSupported,
    error,
    startListening,
    stopListening,
    clearTranscript,
    setManualText,
    getCombinedText,
    getIsListening,
    levelRef,
  };
}
