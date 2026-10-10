import { useEffect, useRef, useState } from 'react';
import { createFaceLandmarker } from '../shared/gaze/faceLandmarker';
import usePresenceLink from '../shared/gaze/usePresenceLink';
import {
  PRESENCE,
  advanceHold,
  createPresenceTracker,
  landmarkerOptions,
  openCamera,
  videoInputs,
} from '../shared/gaze/presence';
import styles from './PresenceTest.module.css';

const SLIDERS = [
  { key: 'minFaceWidth', label: '최소 얼굴 폭 (화면 대비)', min: 0.02, max: 0.3, step: 0.005, digits: 3 },
  { key: 'minRelativeWidth', label: '가장 큰 얼굴 대비 비율', min: 0, max: 1, step: 0.05, digits: 2 },
  { key: 'edgeMargin', label: '좌우 가장자리 여백', min: 0, max: 0.2, step: 0.01, digits: 2 },
  { key: 'maxYawDeg', label: '고개 좌우 허용 (°)', min: 5, max: 60, step: 1, digits: 0 },
  { key: 'pitchCenterDeg', label: '고개 위아래 기준 (°)', min: -45, max: 45, step: 1, digits: 0 },
  { key: 'maxPitchDeg', label: '고개 위아래 허용 (±°)', min: 5, max: 60, step: 1, digits: 0 },
  { key: 'detectionConfidence', label: '얼굴 검출 기준 점수 (모자·그림자면 낮춤)', min: 0.05, max: 0.9, step: 0.05, digits: 2 },
  { key: 'presenceConfidence', label: '얼굴 유지 기준 점수', min: 0.05, max: 0.9, step: 0.05, digits: 2 },
  { key: 'trackingConfidence', label: '추적 기준 점수', min: 0.05, max: 0.9, step: 0.05, digits: 2 },
  { key: 'stickyMs', label: '얼굴 붙잡기 (ms · 모자면 올림)', min: 0, max: 3000, step: 100, digits: 0 },
  { key: 'poseSmooth', label: '고개 각도 흔들림 누르기 (낮을수록 강함)', min: 0.05, max: 1, step: 0.05, digits: 2 },
  { key: 'graceMs', label: '끊김 허용 (ms)', min: 0, max: 3000, step: 100, digits: 0 },
  { key: 'holdMs', label: '유지 시간 (ms)', min: 1000, max: 30000, step: 100, digits: 0 },
];

const TUNABLE = SLIDERS.map((slider) => slider.key);
// 이 페이지가 실제 센서라서, 여기서 맞춘 값이 그대로 /pre_opening 통과 조건이 된다.
// 유지 시간은 저장하지 않고 늘 이 값에서 시작한다(브라우저에 남은 옛 값이 통과 시간을 바꾸지 않게).
const DEFAULT_HOLD_MS = 3200;
const DEFAULT_MIN_FACE_WIDTH = 0.04;
const CONFIG_KEY = 'seoul-presence-config-v4';
const STATE_SEND_MS = 250;
const SENT_BANNER_MS = 2000;
const RECOVERY_RETRY_MS = 2000;
const MAX_DETECT_ERRORS = 10;

function defaultConfig() {
  return {
    ...Object.fromEntries(TUNABLE.map((key) => [key, PRESENCE[key]])),
    minFaceWidth: DEFAULT_MIN_FACE_WIDTH,
    holdMs: DEFAULT_HOLD_MS,
  };
}

// 슬라이더 값은 이 브라우저에 저장해 두고 새로고침해도 유지한다.
function loadConfig() {
  const base = defaultConfig();
  if (typeof window === 'undefined') return base;
  try {
    const saved = JSON.parse(window.localStorage.getItem(CONFIG_KEY) || '{}');
    TUNABLE.forEach((key) => {
      if (key !== 'holdMs' && typeof saved[key] === 'number') base[key] = saved[key];
    });
  } catch {
    // 저장값이 깨졌으면 기본값을 쓴다.
  }
  return base;
}

function drawFaces(canvas, video, faces) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = Math.max(3, width / 300);
  ctx.font = `${Math.round(width / 45)}px monospace`;
  ctx.textBaseline = 'bottom';

  faces.forEach((face, index) => {
    const color = face.ok ? '#3ddc84' : '#ff5a5a';
    const x = face.minX * width;
    const y = face.minY * height;
    ctx.strokeStyle = color;
    // 검출이 끊겨 붙잡아 둔 얼굴은 점선으로 구분한다.
    ctx.setLineDash(face.stale ? [14, 10] : []);
    ctx.strokeRect(x, y, (face.maxX - face.minX) * width, (face.maxY - face.minY) * height);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    const label = face.ok ? '통과' : face.reasons.join('·');
    ctx.fillText(`${index + 1} ${label}${face.stale ? ' (붙잡음)' : ''}`, x, y - 6);
  });
}

export default function PresenceTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // 서버 렌더와 첫 클라이언트 렌더가 같아야 하므로(hydration) 기본값으로 그린 뒤,
  // 마운트 후에 브라우저에 저장된 슬라이더 값을 읽어 적용한다.
  const [config, setConfig] = useState(defaultConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => {
    setConfig(loadConfig());
    setConfigLoaded(true);
  }, []);
  useEffect(() => {
    if (!configLoaded) return;
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // 저장 못 해도 동작에는 지장 없다.
    }
  }, [config, configLoaded]);

  const link = usePresenceLink('sensor');
  const sendRef = useRef(link.send);
  sendRef.current = link.send;
  const [sentCount, setSentCount] = useState(0);
  const [sentAt, setSentAt] = useState(0);

  const [devices, setDevices] = useState([]);
  const [want, setWant] = useState('');
  const [activeId, setActiveId] = useState('');
  const [status, setStatus] = useState('준비 중…');
  const [view, setView] = useState({ faces: [], kept: 0, progress: 0, fps: 0 });
  const [restartToken, setRestartToken] = useState(0);
  const holdRef = useRef({ heldMs: 0, lastOkAt: 0 });
  const trackerRef = useRef(null);
  if (!trackerRef.current) trackerRef.current = createPresenceTracker();
  const landmarkerRef = useRef(null);

  const { detectionConfidence, presenceConfidence, trackingConfidence } = config;
  useEffect(() => {
    landmarkerRef.current
      ?.setOptions({
        minFaceDetectionConfidence: detectionConfidence,
        minFacePresenceConfidence: presenceConfidence,
        minTrackingConfidence: trackingConfidence,
      })
      .catch((err) => setStatus(`옵션 적용 실패: ${err?.message || err}`));
  }, [detectionConfidence, presenceConfidence, trackingConfidence]);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let retryTimer = 0;
    let stream = null;
    let cameraTrack = null;
    let landmarker = null;
    let lastTick = 0;
    let lastStamp = 0;
    let frames = 0;
    let fpsSince = performance.now();
    let fps = 0;
    let lastSentAt = 0;
    let detectErrors = 0;
    const video = videoRef.current;

    const scheduleRecovery = (reason) => {
      if (!alive || retryTimer) return;
      setStatus(`${reason} · ${RECOVERY_RETRY_MS / 1000}초 후 자동 재연결…`);
      retryTimer = window.setTimeout(() => {
        if (alive) setRestartToken((token) => token + 1);
      }, RECOVERY_RETRY_MS);
    };

    const onCameraEnded = () => {
      scheduleRecovery('카메라 연결이 끊겼어요');
    };

    const release = () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      cameraTrack?.removeEventListener('ended', onCameraEnded);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      if (landmarkerRef.current === landmarker) landmarkerRef.current = null;
      landmarker?.close();
      landmarker = null;
    };

    const step = () => {
      if (!alive) return;
      if (!cameraTrack || cameraTrack.readyState === 'ended') {
        scheduleRecovery('카메라 연결이 끊겼어요');
        return;
      }
      const now = performance.now();
      const dt = lastTick ? Math.min(now - lastTick, 250) : 0;
      lastTick = now;

      if (video.readyState >= 2 && video.videoWidth) {
        const stamp = Math.max(now, lastStamp + 1);
        lastStamp = stamp;
        const cfg = { ...PRESENCE, ...configRef.current };
        let result = null;
        try {
          result = landmarker.detectForVideo(video, stamp);
          detectErrors = 0;
        } catch {
          // 슬라이더로 옵션을 바꾸는 동안 그래프가 다시 만들어지면 한두 프레임 실패할 수 있다.
          detectErrors += 1;
          if (detectErrors >= MAX_DETECT_ERRORS) {
            scheduleRecovery('인식 모델이 응답하지 않아요');
            return;
          }
        }
        const { faces, kept } = trackerRef.current.update(result, now, cfg);
        const progress = advanceHold(holdRef.current, kept.length >= cfg.people, now, dt, cfg);
        drawFaces(canvasRef.current, video, faces);

        frames += 1;
        if (now - fpsSince >= 1000) {
          fps = (frames * 1000) / (now - fpsSince);
          frames = 0;
          fpsSince = now;
        }
        setView({ faces, kept: kept.length, progress, fps });

        if (now - lastSentAt >= STATE_SEND_MS) {
          lastSentAt = now;
          sendRef.current({
            type: 'state',
            faces: faces.length,
            near: faces.filter((face) => face.near).length,
            kept: kept.length,
            progress,
          });
        }

        // 통과하면 디스플레이(/pre_opening)에 신호만 보내고, 이 페이지는 계속 인식한다.
        if (progress >= 1) {
          holdRef.current.heldMs = 0;
          sendRef.current({ type: 'pass' });
          setSentCount((count) => count + 1);
          setSentAt(Date.now());
        }
      }
      timer = window.setTimeout(step, PRESENCE.intervalMs);
    };

    (async () => {
      try {
        setStatus('카메라 여는 중…');
        const opened = await openCamera(want);
        if (!alive) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        video.srcObject = stream;
        await video.play();
        cameraTrack = stream.getVideoTracks()[0] || null;
        cameraTrack?.addEventListener('ended', onCameraEnded, { once: true });
        setActiveId(cameraTrack?.getSettings().deviceId || '');
        setDevices(await videoInputs());

        setStatus('모델 불러오는 중…');
        const created = await createFaceLandmarker(
          undefined,
          landmarkerOptions({ ...PRESENCE, ...configRef.current })
        );
        if (!alive) {
          created.close();
          return;
        }
        landmarker = created;
        landmarkerRef.current = created;
        const track = stream.getVideoTracks()[0];
        setStatus(`인식 중 · ${track?.label || '카메라'} · ${video.videoWidth}×${video.videoHeight}`);
        step();
      } catch (err) {
        if (alive) scheduleRecovery(`오류: ${err?.message || err}`);
      }
    })();

    return release;
  }, [want, restartToken]);

  const seconds = (view.progress * config.holdMs) / 1000;
  const snippet = TUNABLE.filter((key) => key !== 'holdMs')
    .map((key) => `  ${key}: ${config[key]},`)
    .join('\n');

  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!sentAt) return undefined;
    setNow(Date.now());
    const id = window.setTimeout(() => setNow(Date.now()), SENT_BANNER_MS);
    return () => window.clearTimeout(id);
  }, [sentAt]);
  const showSent = sentAt > 0 && sentAt + SENT_BANNER_MS > now;

  const linkText = link.connected
    ? `서버 연결됨 · 디스플레이(/pre_opening) ${link.peers.displays}대`
    : '서버 연결 끊김 · 다시 연결 중…';

  return (
    <div className={styles.page}>
      <section className={styles.stage}>
        <div className={styles.frame}>
          <video ref={videoRef} className={styles.video} muted playsInline />
          <canvas ref={canvasRef} className={styles.overlay} />
          {showSent && <div className={styles.banner}>통과 신호 보냄 → /pre_opening 이 /1 로 이동</div>}
        </div>
        <div className={styles.meter}>
          <div className={styles.meterFill} style={{ width: `${view.progress * 100}%` }} />
          <span className={styles.meterText}>
            {seconds.toFixed(1)}s / {(config.holdMs / 1000).toFixed(1)}s
          </span>
        </div>
      </section>

      <aside className={styles.panel}>
        <h1 className={styles.title}>인원 인식 센서</h1>
        <p className={styles.status}>{status}</p>
        <p className={`${styles.status} ${link.connected && link.peers.displays ? styles.good : styles.bad}`}>
          {linkText}
        </p>

        <label className={styles.field}>
          <span>카메라</span>
          <select value={activeId} onChange={(event) => setWant(event.target.value)}>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `카메라 ${index + 1}`}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.summary}>
          <div>
            <b>{view.faces.length}</b>
            <small>감지된 얼굴</small>
          </div>
          <div className={view.kept >= PRESENCE.people ? styles.good : ''}>
            <b>{view.kept}</b>
            <small>통과 인원 (필요 {PRESENCE.people})</small>
          </div>
          <div>
            <b>{sentCount}</b>
            <small>보낸 통과 신호</small>
          </div>
          <div>
            <b>{view.fps.toFixed(1)}</b>
            <small>판정 fps</small>
          </div>
        </div>

        <table className={styles.faces}>
          <thead>
            <tr>
              <th>#</th>
              <th>폭</th>
              <th>좌우°</th>
              <th>위아래°</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {view.faces.map((face, index) => (
              <tr key={index} className={face.ok ? styles.good : styles.bad}>
                <td>{index + 1}</td>
                <td>{face.width.toFixed(3)}</td>
                <td>{face.yaw.toFixed(0)}</td>
                <td>{face.pitch.toFixed(0)}</td>
                <td>
                  {face.ok ? '통과' : face.reasons.join(', ')}
                  {face.stale ? ' (붙잡음)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.sliders}>
          {SLIDERS.map((slider) => (
            <label key={slider.key} className={styles.slider}>
              <span>
                {slider.label} <em>{Number(config[slider.key]).toFixed(slider.digits)}</em>
              </span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={config[slider.key]}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, [slider.key]: Number(event.target.value) }))
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => { holdRef.current.heldMs = 0; }}>
            타이머 리셋
          </button>
          <button type="button" onClick={() => setConfig(defaultConfig())}>
            기본값으로
          </button>
        </div>

        <p className={styles.hint}>
          이 페이지가 카메라를 보고 통과 신호를 보냅니다. 슬라이더 값은 이 브라우저에 저장되어 새로고침해도 그대로
          적용됩니다(유지 시간은 예외로, 새로고침하면 {DEFAULT_HOLD_MS / 1000}초로 돌아옵니다). 아래 값은 체험 중 자리 비움 판정(<code>presence.js</code> 의 <code>PRESENCE</code>)에 옮길 때
          참고용입니다.
        </p>
        <pre className={styles.snippet}>{snippet}</pre>
      </aside>
    </div>
  );
}
