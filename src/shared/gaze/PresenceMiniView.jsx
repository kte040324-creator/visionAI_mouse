import { useEffect, useRef } from 'react';
import { createPresenceTracker } from './presence';
import { subscribePresence } from './presenceCamera';
import styles from './PresenceMiniView.module.css';

const PAGES = new Set(['/1', '/2', '/3', '/4', '/5']);

function drawFaces(canvas, video, faces) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = Math.max(4, width / 220);
  ctx.font = `700 ${Math.round(width / 28)}px Pretendard, sans-serif`;
  ctx.textBaseline = 'bottom';

  faces.forEach((face) => {
    const color = face.ok ? '#3ddc84' : '#ff5a5a';
    const x = face.minX * width;
    const y = face.minY * height;
    ctx.strokeStyle = color;
    ctx.setLineDash(face.stale ? [14, 10] : []);
    ctx.strokeRect(x, y, (face.maxX - face.minX) * width, (face.maxY - face.minY) * height);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillText(face.ok ? '통과' : '불통', x, Math.max(22, y - 6));
  });
}

export default function PresenceMiniView({ pathname }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const trackerRef = useRef(null);
  if (!trackerRef.current) trackerRef.current = createPresenceTracker();
  const active = PAGES.has(pathname);

  useEffect(() => {
    if (!active) return undefined;
    return subscribePresence(({ result, now, video }) => {
      const preview = videoRef.current;
      if (preview && video?.srcObject && preview.srcObject !== video.srcObject) {
        preview.srcObject = video.srcObject;
        preview.play().catch(() => {});
      }
      const canvas = canvasRef.current;
      if (!canvas || !video) return;
      if (result) {
        const { faces } = trackerRef.current.update(result, now);
        drawFaces(canvas, video, faces);
        return;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }, [active]);

  if (!active) return null;

  return (
    <div className={styles.pip} aria-hidden="true">
      <video ref={videoRef} className={styles.video} muted playsInline />
      <canvas ref={canvasRef} className={styles.boxes} />
    </div>
  );
}
