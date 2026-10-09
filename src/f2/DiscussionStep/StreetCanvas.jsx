import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useEntryFlow } from '../../shared/EntryFlowContext';
import { VIEWER_BY_CAM } from '../../shared/gaze/participants';
import StreetPanorama, { preloadOutlineAssets } from './StreetPanorama';
import { screenToWorld } from './streetLook';
import styles from './StreetCanvas.module.css';

const STAGE_W = 3881;
const STAGE_H = 2183;
const AGENT_CENTER = { x: 1941, y: 1092 };
const FINALE_ORBS = [
  {
    id: 'purple-left',
    x: 296 + 228.071 / 2,
    y: 716.822 + 228.071 / 2,
    size: 228.071,
    tint: 'b',
    late: false,
    opacity: 1,
    ring: '/2/finale-b-left-ring.svg',
    face: '/2/finale-b-left-face.svg',
    halo: { inset: -7.77, size: 115.54, blur: 8.86 },
    core: { left: 21.8, top: 21.357, width: 57.971, height: 57.971, blur: 1.03 },
    driftX: 8,
    driftY: -16,
    dur: 5.4,
    delay: 0,
  },
  {
    id: 'purple-big',
    x: 3419 + 621.583 / 2,
    y: 119 + 621.583 / 2,
    size: 621.583,
    tint: 'b',
    late: false,
    opacity: 0.77,
    ring: '/2/finale-b-big-ring.svg',
    face: '/2/finale-b-big-face.svg',
    halo: { inset: -5.92, size: 111.84, blur: 18 },
    core: { left: 21.799, top: 21.358, width: 57.971, height: 57.971, blur: 2.807 },
    driftX: -10,
    driftY: -18,
    dur: 6.2,
    delay: 0.4,
  },
  {
    id: 'green-bottom',
    x: 2741 + 240.912 / 2,
    y: 2063 + 240.912 / 2,
    size: 240.912,
    tint: 'a',
    late: false,
    opacity: 1,
    ring: '/2/finale-a-bottom-ring.svg',
    face: '/2/finale-a-bottom-face.svg',
    halo: { inset: -4.98, size: 109.96, blur: 6 },
    core: { left: 4.661, top: 4.446, width: 91.236, height: 91.232, blur: 0 },
    driftX: 7,
    driftY: -12,
    dur: 4.8,
    delay: 0.7,
  },
  {
    id: 'green-low',
    x: 884 + 438.147 / 2,
    y: 1400.406 + 438.147 / 2,
    size: 438.147,
    tint: 'a',
    late: true,
    opacity: 0.81,
    ring: '/2/finale-a-low-ring.svg',
    face: '/2/finale-a-low-face.svg',
    halo: { inset: -11.85, size: 123.7, blur: 26 },
    core: { left: 4.661, top: 4.447, width: 91.236, height: 91.229, blur: 0 },
    driftX: -8,
    driftY: -14,
    dur: 5.6,
    delay: 0.15,
  },
];

function stageToViewPercent(x, y) {
  const scale = Math.max(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const offsetX = (window.innerWidth - STAGE_W * scale) / 2;
  const offsetY = (window.innerHeight - STAGE_H * scale) / 2;
  return {
    left: ((offsetX + x * scale) / window.innerWidth) * 100,
    top: ((offsetY + y * scale) / window.innerHeight) * 100,
  };
}

function slotPoint(slot, spread) {
  return stageToViewPercent(
    AGENT_CENTER.x + (slot.x - AGENT_CENTER.x) * spread,
    AGENT_CENTER.y + (slot.y - AGENT_CENTER.y) * spread,
  );
}

function driftVars(slot) {
  return {
    '--drift-x': `${slot.driftX}px`,
    '--drift-y': `${slot.driftY}px`,
    '--drift-dur': `${slot.dur}s`,
    '--drift-delay': `${slot.delay}s`,
  };
}

function originFor(slot, index, marks) {
  const same = marks.filter((mark) => (slot.tint === 'b' ? mark.cam === 'B' : mark.cam === 'A'));
  const order = FINALE_ORBS.slice(0, index).filter((item) => item.tint === slot.tint).length;
  const mark = same[order];
  if (mark) return { left: (mark.nx ?? 0.5) * 100, top: (mark.ny ?? 0.5) * 100, fromMark: true };
  return { ...slotPoint(slot, 1.65), fromMark: false };
}
const SELECT_URL = '/street/outline/api/segmentation/select';
const SELECT_MS = 100;
const HOLD_PLANT_MS = 3000;
const PANO_W = 3840;
const PANO_H = 1648;

function screenToUv(nx, ny, view) {
  const t = Math.tan(view.fov * 0.5);
  let rx = (2 * nx - 1) * view.aspect * t;
  let ry = (1 - 2 * ny) * t;
  let rz = 1;
  const n = Math.hypot(rx, ry, rz) || 1;
  rx /= n;
  ry /= n;
  rz /= n;
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  [ry, rz] = [cp * ry + sp * rz, -sp * ry + cp * rz];
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  [rx, rz] = [cy * rx + sy * rz, -sy * rx + cy * rz];
  const u = 0.5 + Math.atan2(rx, rz) / (Math.PI * 2);
  return {
    u: ((u % 1) + 1) % 1,
    v: 0.5 - Math.asin(Math.max(-1, Math.min(1, ry))) / Math.PI,
  };
}

function uvToScreen(u, v, view) {
  const lon = (u - 0.5) * Math.PI * 2;
  const lat = (0.5 - v) * Math.PI;
  let x = Math.cos(lat) * Math.sin(lon);
  let y = Math.sin(lat);
  let z = Math.cos(lat) * Math.cos(lon);
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  [x, z] = [cy * x - sy * z, sy * x + cy * z];
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  [y, z] = [cp * y - sp * z, sp * y + cp * z];
  if (z <= 0) return null;
  const t = Math.tan(view.fov * 0.5);
  const ndcX = x / (z * view.aspect * t);
  const ndcY = y / (z * t);
  if (ndcX < -1.08 || ndcX > 1.08 || ndcY < -1.08 || ndcY > 1.08) return null;
  return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 };
}

function pixelToScreen(x, y, view) {
  return uvToScreen(x / PANO_W, y / PANO_H, view);
}

function uvInBbox(uv, obj) {
  const [x, y, w, h] = obj.bbox || [];
  if (!w || !h) return false;
  const px = uv.u * PANO_W;
  const py = uv.v * PANO_H;
  return px >= x && px < x + w && py >= y && py < y + h;
}

function snapFromObject(obj, view) {
  const [x, y, w, h] = obj.bbox || [];
  if (!w || !h) return null;
  const center = pixelToScreen(x + w / 2, y + h / 2, view);
  if (!center) return null;
  return {
    ...obj,
    dir: screenToWorld(center.x, center.y, view.yaw, view.pitch, view.fov, view.aspect),
    sx: center.x,
    sy: center.y,
    dist: 0,
  };
}

function attractToSnap(nx, ny, snap) {
  if (!snap) return null;
  const pull = 0.58;
  return {
    x: nx + (snap.sx - nx) * pull,
    y: ny + (snap.sy - ny) * pull,
    pull,
  };
}

function normToPixels(nx, ny, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + nx * rect.width,
    y: rect.top + ny * rect.height,
  };
}

const INTRO_SWEEP_MS = 12000;
const INTRO_SWEEP_AMP = 0.32;

function introSweepOffset(t) {
  const ease = (u) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
  if (t <= 0.32) return -ease(t / 0.32);
  if (t <= 0.7) return -1 + 2 * ease((t - 0.32) / 0.38);
  return 1 - ease((t - 0.7) / 0.3);
}

function lineText(line) {
  return typeof line === 'string' ? line : line?.text || '';
}

function NabiBadge({ uid }) {
  const ring = `${uid}-ring`;
  const core = `${uid}-core`;
  const gloss = `${uid}-gloss`;
  const pattern = `${uid}-pattern`;
  const image = `${uid}-image`;
  return (
    <svg className={styles.badgeRing} viewBox="0 0 147 147" fill="none" aria-hidden="true">
      <circle cx="73.14" cy="73.14" r="73.14" fill={`url(#${ring})`} fillOpacity="0.5" />
      <circle cx="73.5" cy="73.5" r="58.5" fill={`url(#${core})`} fillOpacity="0.66" />
      <rect width="117.199" height="117.199" rx="58.5993" transform="matrix(-0.994604 -0.103744 -0.103744 0.994604 138.73 23.5918)" fill={`url(#${pattern})`} />
      <circle cx="73" cy="73" r="73" transform="matrix(-1 0 0 1 146 0)" fill={`url(#${gloss})`} fillOpacity="0.2" />
      <defs>
        <pattern id={pattern} patternContentUnits="objectBoundingBox" width="1" height="1">
          <use href={`#${image}`} xlinkHref={`#${image}`} transform="translate(-0.0404461) scale(0.000527779)" />
        </pattern>
        <linearGradient id={ring} x1="23.5" y1="7" x2="113" y2="136" gradientUnits="userSpaceOnUse">
          <stop stopColor="#AAE1AF" />
          <stop offset="0.403846" stopColor="#32D60E" />
          <stop offset="1" stopColor="#1A7007" />
        </linearGradient>
        <radialGradient id={core} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(73.5 73.5) rotate(89.5304) scale(61.0021)">
          <stop offset="0.493562" stopColor="#7AEA6D" />
          <stop offset="1" stopColor="white" />
        </radialGradient>
        <linearGradient id={gloss} x1="73" y1="0" x2="73" y2="146" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.5" />
          <stop offset="1" stopColor="#E5C7FA" stopOpacity="0.5" />
        </linearGradient>
        <image id={image} href="/2/bang.png" xlinkHref="/2/bang.png" width="2048" height="2048" preserveAspectRatio="none" />
      </defs>
    </svg>
  );
}

function SoraBadge({ uid }) {
  const ring = `${uid}-ring`;
  const edge = `${uid}-edge`;
  const core = `${uid}-core`;
  const gloss = `${uid}-gloss`;
  const pattern = `${uid}-pattern`;
  const image = `${uid}-image`;
  return (
    <svg className={styles.badgeRing} viewBox="0 0 157 157" fill="none" aria-hidden="true">
      <circle cx="73.14" cy="73.14" r="72.89" transform="matrix(-1 0 0 1 151.297 0.00195312)" fill={`url(#${ring})`} fillOpacity="0.8" stroke={`url(#${edge})`} strokeWidth="0.5" />
      <circle cx="58.5" cy="58.5" r="58.5" transform="matrix(-1 0 0 1 135.998 15)" fill={`url(#${core})`} fillOpacity="0.8" />
      <rect opacity="0.9" width="118.729" height="118.729" transform="matrix(-0.402246 -0.915532 -0.915532 0.402246 156.457 108.701)" fill={`url(#${pattern})`} />
      <circle cx="73" cy="73" r="73" transform="matrix(-1 0 0 1 150.996 0)" fill={`url(#${gloss})`} fillOpacity="0.2" />
      <defs>
        <pattern id={pattern} patternContentUnits="objectBoundingBox" width="1" height="1">
          <use href={`#${image}`} xlinkHref={`#${image}`} transform="scale(0.000488281)" />
        </pattern>
        <radialGradient id={ring} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(106.295 31.5019) rotate(106.112) scale(119.471 221.851)">
          <stop stopColor="#BCADCC" />
          <stop offset="0.807692" stopColor="#BD51FF" />
        </radialGradient>
        <linearGradient id={edge} x1="131.824" y1="12.4062" x2="9.82423" y2="125.906" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="#D8C9C9" />
        </linearGradient>
        <radialGradient id={core} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(58.5 58.5) rotate(90) scale(58.5)">
          <stop offset="0.533654" stopColor="#BC74E8" />
          <stop offset="1" stopColor="#E5C7FA" />
        </radialGradient>
        <linearGradient id={gloss} x1="73" y1="0" x2="73" y2="146" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.5" />
          <stop offset="1" stopColor="#E5C7FA" stopOpacity="0.5" />
        </linearGradient>
        <image id={image} href="/2/fang.png" xlinkHref="/2/fang.png" width="2048" height="2048" preserveAspectRatio="none" />
      </defs>
    </svg>
  );
}

function NabiFoldedTextFilter() {
  return (
    <svg className={styles.textFilterDefs} width="0" height="0" aria-hidden="true">
      <defs>
        <filter
          id="nabi-folded-text-filter"
          x="-12"
          y="-102.857"
          width="1339.3"
          height="246.714"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dx="-12" dy="-17.1429" />
          <feGaussianBlur stdDeviation="14.8543" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
          <feBlend mode="normal" in2="shape" result="effect1_innerShadow_nabi_text" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="6.85714" />
          <feGaussianBlur stdDeviation="3.42857" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0" />
          <feBlend mode="normal" in2="effect1_innerShadow_nabi_text" result="effect2_innerShadow_nabi_text" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dx="9" dy="6" />
          <feGaussianBlur stdDeviation="4.28571" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.825018 0 0 0 0 1 0 0 0 0 0.689547 0 0 0 0.9 0" />
          <feBlend mode="normal" in2="effect2_innerShadow_nabi_text" result="effect3_innerShadow_nabi_text" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dx="25" />
          <feGaussianBlur stdDeviation="9.15" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.292619 0 0 0 0 0.359206 0 0 0 0 0.0738339 0 0 0 0.41 0" />
          <feBlend mode="normal" in2="effect3_innerShadow_nabi_text" result="effect4_innerShadow_nabi_text" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="-102.857" />
          <feGaussianBlur stdDeviation="58.2857" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.630559 0 0 0 0 1 0 0 0 0 0.717881 0 0 0 0.6 0" />
          <feBlend mode="normal" in2="effect4_innerShadow_nabi_text" result="effect5_innerShadow_nabi_text" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="-17" />
          <feGaussianBlur stdDeviation="12.5" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.19 0" />
          <feBlend mode="normal" in2="effect5_innerShadow_nabi_text" result="effect6_innerShadow_nabi_text" />
        </filter>
      </defs>
    </svg>
  );
}

export const FOLD_MS = 1500;
const FOLD_EASE = 'cubic-bezier(0.4, 0, 0.15, 1)';

function clearFoldStyles(node) {
  [
    'position',
    'left',
    'top',
    'width',
    'height',
    'maxWidth',
    'margin',
    'right',
    'boxSizing',
    'padding',
    'borderRadius',
    'overflow',
    'fontSize',
    'transform',
    'transformOrigin',
  ].forEach((key) => {
    node.style[key] = '';
  });
}

function clearLabelStyles(node) {
  if (!node) return;
  [
    'position',
    'left',
    'right',
    'top',
    'bottom',
    'display',
    'alignItems',
    'justifyContent',
    'overflow',
    'whiteSpace',
    'margin',
    'opacity',
    'transition',
    'fontSize',
    'lineHeight',
    'transform',
    'color',
  ].forEach((key) => {
    node.style[key] = '';
  });
}

function stackLabel(node) {
  node.style.position = 'absolute';
  node.style.left = '0';
  node.style.right = '0';
  node.style.top = '0';
  node.style.bottom = '0';
  node.style.display = 'flex';
  node.style.alignItems = 'center';
  node.style.justifyContent = 'center';
  node.style.overflow = 'hidden';
  node.style.margin = '0';
}

function FoldReplies({ folded, children }) {
  const stackRef = useRef(null);
  const [settled, setSettled] = useState(false);
  const playedRef = useRef(false);

  useLayoutEffect(() => {
    if (!folded || playedRef.current) return undefined;
    const stack = stackRef.current;
    if (!stack) return undefined;
    const nodes = [...stack.querySelectorAll('[data-reply]')];
    if (!nodes.length) {
      playedRef.current = true;
      setSettled(true);
      return undefined;
    }

    playedRef.current = true;
    const openBox = stack.getBoundingClientRect();
    const pinned = getComputedStyle(stack).position === 'absolute';
    if (!pinned) stack.style.position = 'relative';
    stack.style.width = `${openBox.width}px`;
    stack.style.height = `${openBox.height}px`;
    stack.style.flexShrink = '0';
    const origin = stack.getBoundingClientRect();
    const from = nodes.map((node) => {
      const box = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      return {
        box,
        radius: computed.borderRadius,
        padding: computed.padding,
      };
    });
    const alignEnd = getComputedStyle(stack).alignItems === 'flex-end';
    stack.style.alignItems = 'flex-start';
    if (alignEnd) stack.style.justifyContent = 'flex-end';
    stack.classList.add(styles.repliesFolded);
    const to = nodes.map((node) => {
      const computed = getComputedStyle(node);
      const keyword = node.querySelector('[data-reply-keyword]');
      return {
        box: node.getBoundingClientRect(),
        radius: computed.borderRadius,
        padding: computed.padding,
        fontSize: keyword ? getComputedStyle(keyword).fontSize : computed.fontSize,
      };
    });
    stack.classList.remove(styles.repliesFolded);
    stack.style.alignItems = '';
    stack.style.justifyContent = '';

    const place = (box) => ({
      left: box.left - origin.left,
      top: Math.max(0, box.top - origin.top),
      width: box.width,
      height: box.height,
    });

    stack.style.height = `${origin.height}px`;
    const motions = nodes.map((node, index) => {
      const start = from[index];
      const end = to[index];
      if (!start?.box.width || !end?.box.width) return null;
      const here = place(start.box);
      const next = place(end.box);
      node.style.position = 'absolute';
      node.style.boxSizing = 'border-box';
      node.style.margin = '0';
      node.style.right = 'auto';
      node.style.maxWidth = 'none';
      node.style.transition = 'none';
      node.style.left = `${here.left}px`;
      node.style.top = `${here.top}px`;
      node.style.width = `${here.width}px`;
      node.style.height = `${here.height}px`;
      node.style.padding = start.padding;
      node.style.borderRadius = start.radius;
      node.style.overflow = 'hidden';
      const keyword = node.querySelector('[data-reply-keyword]');
      const text = node.querySelector('[data-reply-text]');
      if (text) {
        stackLabel(text);
        text.style.whiteSpace = 'normal';
        text.style.opacity = '1';
      }
      if (keyword?.textContent.trim()) {
        stackLabel(keyword);
        keyword.style.whiteSpace = 'nowrap';
        keyword.style.color = '#fff';
        keyword.style.fontSize = end.fontSize;
        keyword.style.lineHeight = '1.2';
        keyword.style.opacity = '0';
      }
      return {
        node,
        text,
        keyword,
        next,
        radius: end.radius,
        padding: end.padding,
      };
    }).filter(Boolean);

    void stack.offsetWidth;
    const glide = [
      'left',
      'top',
      'width',
      'height',
      'padding',
      'border-radius',
    ].map((prop) => `${prop} ${FOLD_MS}ms ${FOLD_EASE}`).join(', ');
    motions.forEach((item) => {
      item.node.style.transition = glide;
      item.node.style.left = `${item.next.left}px`;
      item.node.style.top = `${item.next.top}px`;
      item.node.style.width = `${item.next.width}px`;
      item.node.style.height = `${item.next.height}px`;
      item.node.style.padding = item.padding;
      item.node.style.borderRadius = item.radius;
      if (item.text) {
        item.text.style.transition = `opacity ${FOLD_MS}ms ${FOLD_EASE}`;
        item.text.style.opacity = '0';
      }
      if (item.keyword?.textContent.trim()) {
        item.keyword.style.transition = `opacity ${FOLD_MS}ms ${FOLD_EASE}`;
        item.keyword.style.opacity = '1';
      }
    });

    let alive = true;
    const settleTimer = window.setTimeout(() => {
      if (!alive) return;
      stack.classList.add(styles.repliesFolded);
      stack.style.height = '';
      stack.style.width = '';
      stack.style.flexShrink = '';
      stack.style.position = '';
      motions.forEach((item) => {
        item.node.style.transition = 'none';
        clearFoldStyles(item.node);
        clearLabelStyles(item.text);
        clearLabelStyles(item.keyword);
      });
      setSettled(true);
    }, FOLD_MS + 40);

    const unlockTimer = window.setTimeout(() => {
      motions.forEach((item) => {
        item.node.style.transition = '';
        clearLabelStyles(item.text);
      });
    }, FOLD_MS + 140);

    return () => {
      alive = false;
      playedRef.current = false;
      window.clearTimeout(settleTimer);
      window.clearTimeout(unlockTimer);
    };
  }, [folded]);

  return (
    <div ref={stackRef} className={`${styles.replies} ${settled ? styles.repliesFolded : ''}`}>
      {children}
    </div>
  );
}

const StreetCanvas = forwardRef(function StreetCanvas({
  imageUrl,
  pendingLabel,
  yawSpan = 360,
  zoom = 1,
  registerGazeHandler,
  phase = 'idle',
  activeViewerId,
  marks = [],
  onPlant,
  onCanvasRect,
  revealed = true,
  repeatDwell = false,
  quiet = false,
  gather = false,
  finaleFull = false,
}, ref) {
  const canvasRef = useRef(null);
  const panoramaRef = useRef(null);
  const markRefs = useRef({});
  const pinRef = useRef(false);
  const [gatherReady, setGatherReady] = useState(false);
  const [lateReady, setLateReady] = useState(false);
  pinRef.current = gather;
  useEffect(() => {
    if (!gather) {
      setGatherReady(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setGatherReady(true));
    return () => cancelAnimationFrame(frame);
  }, [gather]);
  useEffect(() => {
    if (!finaleFull) {
      setLateReady(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setLateReady(true));
    return () => cancelAnimationFrame(frame);
  }, [finaleFull]);
  const lookRef = useRef(null);
  const hoverRef = useRef({ u: null, v: null });
  const selectedRef = useRef(null);
  const introLockRef = useRef(true);
  if (revealed) introLockRef.current = false;
  const holdLookRef = useRef(false);
  const pendingRef = useRef(null);
  const phaseRef = useRef(phase);
  const plantedRef = useRef(false);
  const repeatRef = useRef(repeatDwell);
  const cooldownRef = useRef(0);
  const onPlantRef = useRef(onPlant);
  const marksRef = useRef(marks);
  const viewerRef = useRef(activeViewerId);
  const { gazeRef, reportDwellProgress } = useEntryFlow();
  const reportDwellRef = useRef(reportDwellProgress);
  reportDwellRef.current = reportDwellProgress;
  const buttonDownRef = useRef(false);
  const holdRef = useRef(null);
  const [pendingCircle, setPendingCircle] = useState(null);

  viewerRef.current = activeViewerId;
  const selectKickRef = useRef(() => {});

  useEffect(() => {
    preloadOutlineAssets();
  }, []);

  useEffect(() => {
    if (phase !== 'gaze') {
      selectedRef.current = null;
      selectKickRef.current = () => {};
      panoramaRef.current?.clearOutline();
      return undefined;
    }
    let alive = true;
    let inflight = false;
    let generation = 0;
    let lastKey = '';
    const poll = async () => {
      if (!alive || inflight) return;
      const { u, v } = hoverRef.current;
      if (u == null || v == null) return;
      const key = `${u.toFixed(3)},${v.toFixed(3)}`;
      inflight = true;
      const gen = ++generation;
      lastKey = key;
      try {
        const res = await fetch(`${SELECT_URL}?u=${u.toFixed(4)}&v=${v.toFixed(4)}`);
        const data = res.ok ? await res.json() : null;
        if (!alive || gen !== generation) return;
        const obj = data?.selected?.outline?.selectable ? data.selected : null;
        selectedRef.current = obj;
        if (!obj) panoramaRef.current?.clearOutline();
        else await panoramaRef.current?.showOutline(obj.id, obj.outline);
      } catch {
        if (alive && gen === generation) {
          selectedRef.current = null;
          panoramaRef.current?.clearOutline();
        }
      } finally {
        inflight = false;
        const latest = hoverRef.current;
        if (alive && latest.u != null && `${latest.u.toFixed(3)},${latest.v.toFixed(3)}` !== lastKey) {
          void poll();
        }
      }
    };
    selectKickRef.current = () => {
      void poll();
    };
    const timer = window.setInterval(poll, SELECT_MS);
    poll();
    return () => {
      alive = false;
      selectKickRef.current = () => {};
      window.clearInterval(timer);
      selectedRef.current = null;
      panoramaRef.current?.clearOutline();
    };
  }, [phase]);

  useImperativeHandle(ref, () => ({
    recenter(onDone, { release = true } = {}) {
      holdLookRef.current = true;
      lookRef.current = { nx: 0.5, ny: 0.5 };
      const panorama = panoramaRef.current;
      if (!panorama?.recenter) {
        if (release) holdLookRef.current = false;
        onDone?.();
        return false;
      }
      panorama.recenter(() => {
        lookRef.current = { nx: 0.5, ny: 0.5 };
        if (release) holdLookRef.current = false;
        onDone?.();
      });
      return true;
    },
    releaseLook() {
      holdLookRef.current = false;
    },
  }), []);

  phaseRef.current = phase;
  repeatRef.current = repeatDwell;
  onPlantRef.current = onPlant;
  marksRef.current = marks;

  const screenToNormalized = useCallback((x, y) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return {
      x: (x - rect.left) / rect.width,
      y: (y - rect.top) / rect.height,
    };
  }, []);

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    setPendingCircle(null);
    panoramaRef.current?.clearOutline();
  }, []);

  const hitMark = useCallback((x, y) => {
    for (const mark of marksRef.current) {
      const el = markRefs.current[mark.id];
      if (!el || el.style.opacity === '0') continue;
      const box = el.getBoundingClientRect();
      const pad = 28;
      if (x >= box.left - pad && x <= box.right + pad && y >= box.top - pad && y <= box.bottom + pad) {
        return mark.id;
      }
    }
    return null;
  }, []);

  const finishPlant = useCallback((anchorX, anchorY) => {
    if (phaseRef.current !== 'gaze') return;
    const now = Date.now();
    if (repeatRef.current) {
      if (now < cooldownRef.current) return;
      cooldownRef.current = now + 900;
    } else if (plantedRef.current) {
      return;
    } else {
      plantedRef.current = true;
    }

    const lockedId = pendingRef.current?.markId || null;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const markId = lockedId || (rect
      ? hitMark(rect.left + anchorX * rect.width, rect.top + anchorY * rect.height)
      : null);
    const direction = pendingRef.current?.direction
      || panoramaRef.current?.directionAt(anchorX, anchorY)
      || [0, 0, 1];
    clearPending();
    onPlantRef.current?.({ direction, nx: anchorX, ny: anchorY, markId });
  }, [clearPending, hitMark]);

  const applyPoint = useCallback((x, y, source = 'pointer') => {
      if (introLockRef.current) {
        if (phaseRef.current !== 'gaze') clearPending();
        return { dwellProgress: 0, target: null };
      }
      const norm = screenToNormalized(x, y);
      if (norm && !holdLookRef.current) lookRef.current = { nx: norm.x, ny: norm.y, source };
      const view = panoramaRef.current?.viewNow?.();
      const uv = norm && view ? screenToUv(norm.x, norm.y, view) : null;
      if (uv) hoverRef.current = uv;

      if (!norm || phaseRef.current !== 'gaze' || (!repeatRef.current && plantedRef.current)) {
        if (phaseRef.current !== 'gaze') clearPending();
        return { dwellProgress: 0, target: null };
      }

      const now = Date.now();
      const pending = pendingRef.current;
      if (uv) selectKickRef.current();
      const hit = uv && selectedRef.current && uvInBbox(uv, selectedRef.current)
        ? selectedRef.current
        : null;
      const snap = hit && view ? snapFromObject(hit, view) : null;
      const pulled = snap ? attractToSnap(norm.x, norm.y, snap) : null;
      const canvas = canvasRef.current;
      const cursor = pulled && canvas ? normToPixels(pulled.x, pulled.y, canvas) : null;
      const cursorPos = cursor ? { cursorX: cursor.x, cursorY: cursor.y } : {};

      if (!pulled || !snap) {
        pendingRef.current = null;
        setPendingCircle(null);
        return { dwellProgress: 0, target: 'canvas', ...cursorPos };
      }

      const pointDir = screenToWorld(norm.x, norm.y, view.yaw, view.pitch, view.fov, view.aspect);
      const same = pending && pending.objectId === snap.id;
      if (!same) {
        pendingRef.current = {
          objectId: snap.id,
          direction: pointDir,
          anchorX: norm.x,
          anchorY: norm.y,
          since: now,
          lastInZoneAt: now,
          markId: hitMark(x, y),
        };
        setPendingCircle({ x: snap.sx, y: snap.sy, progress: 0, zone: snap.id });
        return { dwellProgress: 0, target: 'canvas', ...cursorPos };
      }

      pending.direction = pointDir;
      pending.anchorX = norm.x;
      pending.anchorY = norm.y;
      pending.lastInZoneAt = now;
      const hold = holdRef.current;
      const dwellProgress = buttonDownRef.current && hold && hold.objectId === snap.id
        ? Math.min(1, (now - hold.since) / HOLD_PLANT_MS)
        : 0;
      setPendingCircle({ x: snap.sx, y: snap.sy, progress: dwellProgress, zone: snap.id });
      return { dwellProgress, target: 'canvas', ...cursorPos };
  }, [clearPending, hitMark, screenToNormalized]);

  const handleGaze = useCallback(
    (viewerId, x, y) => {
      if (viewerId !== activeViewerId) return { dwellProgress: 0, target: null };
      if (typeof window !== 'undefined' && window.__seoulPointerOwnsGaze > performance.now()) {
        return { dwellProgress: 0, target: null };
      }
      return applyPoint(x, y, 'gaze');
    },
    [activeViewerId, applyPoint]
  );

  useEffect(() => {
    const onMove = (event) => {
      if (event.pointerType === 'touch') return;
      if (introLockRef.current) return;
      if (phaseRef.current === 'gaze' && viewerRef.current === VIEWER_BY_CAM.A) return;
      window.__seoulPointerOwnsGaze = performance.now() + 4500;
      const viewerId = viewerRef.current;
      const result = applyPoint(event.clientX, event.clientY);
      const px = result?.cursorX ?? event.clientX;
      const py = result?.cursorY ?? event.clientY;
      if (gazeRef.current && viewerId) {
        gazeRef.current[viewerId] = { x: px, y: py, at: Date.now() };
      }
    };
    window.addEventListener('pointermove', onMove, true);
    return () => window.removeEventListener('pointermove', onMove, true);
  }, [applyPoint, gazeRef]);

  useEffect(() => {
    if (!introLockRef.current) return undefined;
    const started = performance.now();
    let frame = 0;
    const tick = (now) => {
      if (!introLockRef.current) return;
      const t = Math.min(1, (now - started) / INTRO_SWEEP_MS);
      const offset = t >= 1 ? 0 : introSweepOffset(t);
      lookRef.current = { nx: 0.5 + offset * INTRO_SWEEP_AMP, ny: 0.5, source: 'auto' };
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealed]);

  useEffect(() => {
    plantedRef.current = false;
    if (phase !== 'gaze') {
      clearPending();
      return;
    }
    const sample = gazeRef.current?.[viewerRef.current];
    if (sample) applyPoint(sample.x, sample.y, 'gaze');
  }, [phase, repeatDwell, clearPending, applyPoint, gazeRef]);

  useEffect(() => {
    const stopHold = () => {
      buttonDownRef.current = false;
      holdRef.current = null;
      reportDwellRef.current(0);
    };
    const onDown = (event) => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      if (introLockRef.current || phaseRef.current !== 'gaze') return;
      if (!screenToNormalized(event.clientX, event.clientY)) return;
      buttonDownRef.current = true;
      applyPoint(event.clientX, event.clientY, 'pointer');
    };
    const onUp = () => {
      if (!buttonDownRef.current) return;
      stopHold();
    };
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!buttonDownRef.current || phaseRef.current !== 'gaze') return;
      const pending = pendingRef.current;
      if (!pending || (!repeatRef.current && plantedRef.current)) {
        if (holdRef.current) {
          holdRef.current = null;
          reportDwellRef.current(0);
        }
        return;
      }
      const hold = holdRef.current;
      if (!hold || hold.objectId !== pending.objectId) {
        holdRef.current = { since: Date.now(), objectId: pending.objectId };
        reportDwellRef.current(0);
        return;
      }
      const progress = Math.min(1, (Date.now() - hold.since) / HOLD_PLANT_MS);
      reportDwellRef.current(progress);
      if (progress < 1) return;
      const anchorX = pending.anchorX;
      const anchorY = pending.anchorY;
      stopHold();
      finishPlant(anchorX, anchorY);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      cancelAnimationFrame(frame);
      stopHold();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [applyPoint, finishPlant, screenToNormalized]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onCanvasRect) return undefined;
    const publishRect = () => onCanvasRect(canvas.getBoundingClientRect());
    publishRect();
    const observer = new ResizeObserver(publishRect);
    observer.observe(canvas);
    window.addEventListener('resize', publishRect);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publishRect);
    };
  }, [onCanvasRect]);

  useEffect(() => {
    if (phase === 'idle') {
      registerGazeHandler?.('discussion', null);
      return undefined;
    }
    registerGazeHandler?.('discussion', handleGaze);
    return () => registerGazeHandler?.('discussion', null);
  }, [handleGaze, phase, registerGazeHandler]);

  return (
    <div className={styles.canvasWrapper}>
      <NabiFoldedTextFilter />
      <div className={styles.canvas} ref={canvasRef}>
        <div className={styles.imageFrame}>
          <div className={`${styles.streetBlur} ${revealed ? styles.streetSharp : ''}`}>
          {imageUrl ? (
              <StreetPanorama
                ref={panoramaRef}
                imageUrl={imageUrl}
                yawSpan={yawSpan}
                zoom={zoom}
                lookRef={lookRef}
                markRefs={markRefs}
                marks={marks}
                pinRef={pinRef}
              />
          ) : (
            <div className={styles.pendingScene}>
              <p>{pendingLabel} 거리뷰는 아직 제작 중입니다.</p>
            </div>
          )}
          </div>
        </div>
        {/* 응시 진행 게이지는 시선 커서(GazeReticle)가 dwellProgress 로 직접 그린다. */}
        {gather && FINALE_ORBS.map((slot, index) => {
          if (slot.late && !finaleFull) return null;
          const arrived = slot.late ? lateReady : gatherReady;
          const origin = originFor(slot, index, marks);
          const point = arrived ? stageToViewPercent(slot.x, slot.y) : origin;
          const size = arrived || !origin.fromMark ? slot.size : 146;
          return (
            <div
              key={slot.id}
              className={`${styles.finaleOrb} ${arrived ? styles.markFloat : ''}`}
              style={{
                left: `${point.left}%`,
                top: `${point.top}%`,
                width: `calc(${size}px * var(--street-scale, 0.5))`,
                height: `calc(${size}px * var(--street-scale, 0.5))`,
                opacity: arrived || origin.fromMark ? slot.opacity : 0,
                '--halo-inset': `${slot.halo.inset}%`,
                '--halo-size': `${slot.halo.size}%`,
                '--halo-blur': `${slot.halo.blur}px`,
                '--core-left': `${slot.core.left}%`,
                '--core-top': `${slot.core.top}%`,
                '--core-width': `${slot.core.width}%`,
                '--core-height': `${slot.core.height}%`,
                ...driftVars(slot),
              }}
            >
              <img className={styles.finaleHalo} src={slot.ring} alt="" />
              <img
                className={styles.finaleCore}
                src={slot.face}
                alt=""
                style={slot.core.blur ? { filter: `blur(calc(${slot.core.blur}px * var(--street-scale, 0.5)))` } : undefined}
              />
            </div>
          );
        })}
        {marks.map((mark) => {
          const replies = mark.lines.slice(1);
          return (
            <div
              key={mark.id}
              ref={(el) => {
                markRefs.current[mark.id] = el;
              }}
              className={`${styles.plantMark} ${mark.cam === 'B' ? styles.markB : styles.markA} ${quiet ? styles.markQuiet : ''} ${gather ? styles.markGather : ''} ${mark.tucked ? styles.markTuck : ''}`}
              style={{
                left: `${(mark.nx ?? 0.5) * 100}%`,
                top: `${(mark.ny ?? 0.5) * 100}%`,
                ...(gather ? { opacity: 0 } : {}),
              }}
            >
              <span className={styles.badge}>
                {mark.cam === 'B' ? <SoraBadge uid={`sora-${mark.id}`} /> : <NabiBadge uid={`nabi-${mark.id}`} />}
              </span>
              {mark.lines.length > 0 && (
                <div className={styles.speech}>
                  <div className={styles.bubble}>
                    <p className={styles.mainLine}>{lineText(mark.lines[0])}</p>
                  </div>
                  {replies.length > 0 && (
                    <FoldReplies folded={mark.folded}>
                      {replies.map((line, index) => (
                        <p
                          key={`${mark.id}-reply-${index}`}
                          data-reply=""
                          className={`${styles.reply} ${line.cam === 'B' ? styles.replyB : styles.replyA}`}
                        >
                          <span className={styles.replyText} data-reply-text="">{lineText(line)}</span>
                          <span className={styles.replyKeyword} data-reply-keyword="">{line.keyword || ''}</span>
                        </p>
                      ))}
                    </FoldReplies>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default StreetCanvas;
