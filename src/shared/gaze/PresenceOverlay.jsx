import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { createPresenceTracker } from './presence';
import { subscribePresence } from './presenceCamera';

const PAGES = ['/1', '/2', '/3', '/4', '/5'];

const FRAME_STYLE = {
  position: 'fixed',
  top: 16,
  left: 16,
  zIndex: 10000,
  width: 220,
  aspectRatio: '16 / 9',
  overflow: 'hidden',
  borderRadius: 8,
  background: '#000',
  pointerEvents: 'none',
};

const LAYER_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

function drawBoxes(canvas, faces) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const nextW = Math.round(width * ratio);
  const nextH = Math.round(height * ratio);
  if (canvas.width !== nextW) canvas.width = nextW;
  if (canvas.height !== nextH) canvas.height = nextH;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2;
  faces.forEach((face) => {
    ctx.strokeStyle = face.ok ? '#3ddc84' : '#ff5a5a';
    ctx.strokeRect(
      face.minX * width,
      face.minY * height,
      (face.maxX - face.minX) * width,
      (face.maxY - face.minY) * height
    );
  });
}

export default function PresenceOverlay() {
  const router = useRouter();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const active = PAGES.includes(router.pathname);

  useEffect(() => {
    if (!active) return undefined;
    const tracker = createPresenceTracker();
    return subscribePresence(({ result, now, video }) => {
      const preview = videoRef.current;
      if (preview && video?.srcObject && preview.srcObject !== video.srcObject) {
        preview.srcObject = video.srcObject;
        preview.play().catch(() => {});
      }
      if (!result || !canvasRef.current) return;
      const { faces } = tracker.update(result, now);
      drawBoxes(canvasRef.current, faces);
    });
  }, [active]);

  if (!active) return null;

  return (
    <div style={FRAME_STYLE} aria-hidden="true">
      <video ref={videoRef} style={LAYER_STYLE} muted playsInline />
      <canvas ref={canvasRef} style={{ ...LAYER_STYLE, objectFit: 'fill' }} />
    </div>
  );
}
