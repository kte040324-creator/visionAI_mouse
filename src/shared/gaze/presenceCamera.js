import { createFaceLandmarker } from './faceLandmarker';
import { PRESENCE, landmarkerOptions, openCamera } from './presence';

// 페이지가 바뀌는 사이 구독이 잠깐 비어도 카메라와 모델을 다시 열지 않도록 조금 기다렸다 끈다.
const LINGER_MS = 2000;
const RETRY_MS = 3000;

const listeners = new Set();
let session = null;
let stopTimer = 0;
let lastStatus = 'idle';
let sessionVideo = null;

function emit(frame) {
  if (frame.status) lastStatus = frame.status;
  const payload = sessionVideo ? { ...frame, video: sessionVideo } : frame;
  listeners.forEach((listener) => listener(payload));
}

function emitStatus(status) {
  emit({ status, result: null, now: performance.now() });
}

function startSession(camera) {
  let alive = true;
  let timer = 0;
  let retryTimer = 0;
  let stream = null;
  let landmarker = null;
  let lastStamp = 0;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  sessionVideo = video;

  const handle = {
    stop() {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      if (sessionVideo === video) sessionVideo = null;
      landmarker?.close();
      landmarker = null;
    },
  };

  // 카메라를 못 열었거나 도중에 끊기면, 구독자가 남아 있는 동안 다시 연다.
  const retry = () => {
    if (!alive) return;
    handle.stop();
    retryTimer = window.setTimeout(() => {
      if (session !== handle) return;
      session = listeners.size ? startSession(camera) : null;
    }, RETRY_MS);
  };

  const step = () => {
    if (!alive) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const now = performance.now();
      const stamp = Math.max(now, lastStamp + 1);
      lastStamp = stamp;
      let result = null;
      try {
        result = landmarker.detectForVideo(video, stamp);
      } catch {
        result = null;
      }
      if (result) emit({ status: 'watching', result, now });
    }
    timer = window.setTimeout(step, PRESENCE.intervalMs);
  };

  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
      emitStatus('loading');
      const want = camera || window.localStorage.getItem(PRESENCE.cameraStorageKey) || '';
      const opened = await openCamera(want);
      if (!alive) {
        opened.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = opened;
      stream.getVideoTracks()[0]?.addEventListener('ended', retry);
      video.srcObject = stream;
      await video.play();
      const created = await createFaceLandmarker(undefined, landmarkerOptions());
      if (!alive) {
        created.close();
        return;
      }
      landmarker = created;
      emitStatus('watching');
      step();
    } catch (err) {
      if (!alive) return;
      emitStatus(`error: ${err?.message || err}`);
      retry();
    }
  })();

  return handle;
}

/**
 * 키오스크 내장 카메라 판정 프레임을 구독한다. 첫 구독자가 카메라를 열고, 마지막 구독자가 빠지면 닫는다.
 * listener 는 { status, result, now } 를 받는다. result 가 null 이면 상태만 바뀐 것이다.
 * camera 는 카메라를 새로 열 때만 쓰인다.
 */
export function subscribePresence(listener, { camera = '' } = {}) {
  listeners.add(listener);
  window.clearTimeout(stopTimer);
  if (!session) session = startSession(camera);
  listener({ status: lastStatus, result: null, now: performance.now() });

  return () => {
    if (!listeners.delete(listener) || listeners.size) return;
    stopTimer = window.setTimeout(() => {
      if (listeners.size || !session) return;
      session.stop();
      session = null;
      lastStatus = 'idle';
    }, LINGER_MS);
  };
}
