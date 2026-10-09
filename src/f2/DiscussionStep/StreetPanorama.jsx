import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { clamp, lookFromPointer, screenToWorld, viewFov, worldToScreen } from './streetLook';
import styles from './StreetCanvas.module.css';

const VERTEX = `
attribute vec2 position;
varying vec2 screenUV;
void main() {
  screenUV = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 screenUV;
uniform sampler2D panorama;
uniform sampler2D outlines;
uniform sampler2D glareMask;
uniform vec4 outlineRect;
uniform float outlineActive;
uniform vec2 glareStage;
uniform vec2 viewport;
uniform vec3 view;
uniform float yawSpan;
uniform float time;
const float PI = 3.141592653589793;
float outlineA(vec2 luv) {
  if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 0.0;
  return texture2D(outlines, luv).a;
}
float gaussGlow(vec2 luv, vec2 unit) {
  float acc = 0.0;
  float wacc = 0.0;
  for (int j = -4; j <= 4; j++) {
    for (int i = -4; i <= 4; i++) {
      float x = float(i);
      float y = float(j);
      float w = exp(-(x * x + y * y) / 10.0);
      acc += outlineA(luv + vec2(x, y) * unit) * w;
      wacc += w;
    }
  }
  return acc / max(wacc, 0.001);
}
vec3 strokeTint(vec2 luv) {
  vec2 c = luv - 0.5;
  float along = atan(c.y, c.x) / (2.0 * PI);
  float t = fract(along + time * 0.08);
  vec3 ice = vec3(0.78, 0.97, 1.0);
  vec3 mint = vec3(0.62, 1.0, 0.88);
  vec3 pink = vec3(1.0, 0.82, 0.93);
  float k = t * 3.0;
  if (k < 1.0) return mix(ice, mint, k);
  if (k < 2.0) return mix(mint, pink, k - 1.0);
  return mix(pink, ice, k - 2.0);
}
void main() {
  float a = viewport.x / viewport.y;
  float t = tan(view.z * 0.5);
  vec2 p = screenUV * 2.0 - 1.0;
  vec3 ray = normalize(vec3(p.x * a * t, p.y * t, 1.0));
  float cp = cos(view.y);
  float sp = sin(view.y);
  ray = vec3(ray.x, cp * ray.y + sp * ray.z, -sp * ray.y + cp * ray.z);
  float cy = cos(view.x);
  float sy = sin(view.x);
  ray = vec3(cy * ray.x + sy * ray.z, ray.y, -sy * ray.x + cy * ray.z);
  float span = max(yawSpan, 0.001);
  vec2 uv = vec2(clamp(0.5 + atan(ray.x, ray.z) / span, 0.0, 1.0),
                 0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
  vec3 scene = texture2D(panorama, uv).rgb;
  vec3 color = scene;
  if (outlineActive > 0.5) {
    vec2 localUV = (uv - outlineRect.xy) / outlineRect.zw;
    float core = outlineA(localUV);
    vec2 unit = vec2(1.35 / 3840.0, 1.35 / 1648.0) / max(outlineRect.zw, vec2(0.0002));
    float blur = gaussGlow(localUV, unit);
    float halo = max(0.0, blur - core * 0.72);
    halo = pow(halo, 0.72) * 1.35;
    vec3 tint = strokeTint(localUV);
    if (localUV.x >= 0.0 && localUV.x <= 1.0 && localUV.y >= 0.0 && localUV.y <= 1.0) {
      vec4 mask = texture2D(glareMask, localUV);
      float coverage = mask.a;
      float coord = (localUV.x + 0.24 * (1.0 - localUV.y)) / 1.24;
      float progress = fract(glareStage.y / 3.6) * 1.7 - 0.35;
      float band = exp(-pow((coord - progress) / 0.105, 2.0));
      float beam = exp(-pow((coord - progress) / 0.035, 2.0));
      vec3 glareTint = mix(vec3(0.95, 0.92, 1.0), vec3(0.75, 1.0, 0.89), clamp(coord, 0.0, 1.0));
      float strength = glareStage.x * coverage * (0.055 + 0.34 * band + 0.10 * beam);
      color += (vec3(1.0) - color) * glareTint * strength;
    }
    color = color + tint * halo * 0.9;
    color = mix(color, tint, min(1.0, core * 1.65));
  }
  gl_FragColor = vec4(color, 1.0);
}`;

const GLARE_DELAY_SECONDS = 0.12;

function glareTimeline(elapsed) {
  const t = Math.max(0, elapsed);
  const u = Math.max(0, Math.min(1, (t - GLARE_DELAY_SECONDS) / 0.28));
  return {
    glare: u * u * (3 - 2 * u),
    sweep: Math.max(0, t - GLARE_DELAY_SECONDS),
  };
}

const PANO_W = 3840;
const PANO_H = 1648;
const outlineCache = new Map();

function outlineAssetUrl(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('/street/')) return url;
  const path = (url.startsWith('/') ? url : `/${url}`).replace(/@/g, '%40');
  const href = `/street/outline${path}`;
  return href.includes('?') ? href : `${href}?v=clarity-54-1`;
}

function loadOutlineImage(url) {
  const src = outlineAssetUrl(url);
  if (!outlineCache.has(src)) {
    outlineCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        outlineCache.delete(src);
        reject(new Error('outline'));
      };
      image.src = src;
    }));
  }
  return outlineCache.get(src);
}

export function preloadOutlineAssets() {
  if (typeof window === 'undefined' || window.__streetOutlinesWarm) return;
  window.__streetOutlinesWarm = true;
  fetch('/street/outline/outlines/manifest.json?v=clarity-54-1')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      (data?.objects || []).forEach((obj) => {
        if (!obj?.selectable || !obj.raster?.url) return;
        loadOutlineImage(obj.raster.url);
        if (obj.glare?.url) loadOutlineImage(obj.glare.url);
      });
    })
    .catch(() => {
      window.__streetOutlinesWarm = false;
    });
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function preloadStreetPoster(url = '/street/red/assets/street-panorama.webp') {
  if (typeof window === 'undefined') return null;
  const current = window.__streetPoster;
  if (current && current.dataset.src === url) return current;
  const image = new Image();
  image.dataset.src = url;
  image.decoding = 'sync';
  image.src = url;
  window.__streetPoster = image;
  image.decode?.().catch(() => {});
  return image;
}

export default forwardRef(function StreetPanorama({
  imageUrl,
  lookRef,
  markRefs,
  marks,
  pinRef,
  yawSpan = 360,
  zoom = 1,
}, ref) {
  const canvasRef = useRef(null);
  const viewRef = useRef({ yaw: 0, pitch: 0, fov: viewFov(16 / 9), aspect: 16 / 9 });
  const marksRef = useRef(marks);
  const homeRef = useRef(null);
  const outlineApiRef = useRef({});
  marksRef.current = marks;

  useImperativeHandle(ref, () => ({
    directionAt(nx, ny) {
      const view = viewRef.current;
      return screenToWorld(nx, ny, view.yaw, view.pitch, view.fov, view.aspect);
    },
    viewNow() {
      return viewRef.current;
    },
    recenter(onDone) {
      homeRef.current = typeof onDone === 'function' ? onDone : () => {};
    },
    showOutline(id, outline) {
      return outlineApiRef.current.showOutline?.(id, outline);
    },
    clearOutline() {
      outlineApiRef.current.clearOutline?.();
    },
  }), []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return undefined;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) return undefined;
    gl.clearColor(0, 0, 0, 0);

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return undefined;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const pos = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'panorama'), 0);

    const bindLayer = (unit, name, empty) => {
      const handle = gl.createTexture();
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty);
      gl.uniform1i(gl.getUniformLocation(program, name), unit - gl.TEXTURE0);
      return handle;
    };
    const outlineTexture = bindLayer(gl.TEXTURE1, 'outlines', new Uint8Array([0, 0, 0, 0]));
    const glareTexture = bindLayer(gl.TEXTURE2, 'glareMask', new Uint8Array([0, 0, 0, 0]));
    gl.activeTexture(gl.TEXTURE0);

    const sizeUniform = gl.getUniformLocation(program, 'viewport');
    const viewUniform = gl.getUniformLocation(program, 'view');
    const spanUniform = gl.getUniformLocation(program, 'yawSpan');
    const timeUniform = gl.getUniformLocation(program, 'time');
    const outlineRectUniform = gl.getUniformLocation(program, 'outlineRect');
    const outlineActiveUniform = gl.getUniformLocation(program, 'outlineActive');
    const glareStageUniform = gl.getUniformLocation(program, 'glareStage');
    gl.uniform1f(outlineActiveUniform, 0);
    gl.uniform4f(outlineRectUniform, 0, 0, 1, 1);
    gl.uniform2f(glareStageUniform, 0, 0);
    gl.uniform1f(timeUniform, 0);

    let selectedId = null;
    let highlightRequest = 0;
    let effectStartedAt = 0;
    let ready = false;
    let presented = false;
    let dead = false;
    let frame = 0;
    let last = 0;

    const uploadLayer = (handle, unit, image, dataTexture) => {
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !dataTexture);
      if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL != null) {
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, dataTexture ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    };

    const clearOutline = () => {
      highlightRequest += 1;
      selectedId = null;
      if (dead || gl.isContextLost()) return;
      gl.uniform1f(outlineActiveUniform, 0);
    };

    const showOutline = async (id, outline) => {
      const raster = outline?.raster || outline;
      if (dead || !id || !raster?.url || !raster.viewBox) {
        clearOutline();
        return false;
      }
      if (selectedId === id) return true;
      const request = highlightRequest + 1;
      highlightRequest = request;
      try {
        const [image, glare] = await Promise.all([
          loadOutlineImage(raster.url),
          outline?.glare?.url ? loadOutlineImage(outline.glare.url) : Promise.resolve(null),
        ]);
        if (dead || request !== highlightRequest || gl.isContextLost()) return false;
        gl.useProgram(program);
        uploadLayer(outlineTexture, gl.TEXTURE1, image, false);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, glareTexture);
        if (glare) uploadLayer(glareTexture, gl.TEXTURE2, glare, true);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const [x, y, w, h] = raster.viewBox;
        gl.uniform4f(outlineRectUniform, x / PANO_W, y / PANO_H, w / PANO_W, h / PANO_H);
        gl.uniform1f(outlineActiveUniform, 1);
        selectedId = id;
        effectStartedAt = performance.now();
        return true;
      } catch {
        if (request === highlightRequest) clearOutline();
        return false;
      }
    };

    outlineApiRef.current = { showOutline, clearOutline };

    const current = { yaw: 0, pitch: 0 };
    const target = { yaw: 0, pitch: 0 };
    const stable = { nx: 0.5, ny: 0.5 };

    const aimedLook = (look, dt) => {
      if (look.source !== 'gaze') {
        stable.nx = look.nx;
        stable.ny = look.ny;
        return lookFromPointer(look.nx, look.ny);
      }
      const dx = look.nx - stable.nx;
      const dy = look.ny - stable.ny;
      const dist = Math.hypot(dx, dy);
      if (dist >= 0.05) {
        const pull = (dist - 0.05) / dist;
        const tau = dist > 0.18 ? 180 : 420;
        const gain = 1 - Math.exp(-dt / tau);
        stable.nx += dx * pull * gain;
        stable.ny += dy * pull * gain;
      }
      return lookFromPointer(stable.nx, stable.ny);
    };

    const placeMarks = () => {
      if (pinRef?.current) return;
      const view = viewRef.current;
      marksRef.current.forEach((mark) => {
        const el = markRefs.current?.[mark.id];
        if (!el) return;
        const point = worldToScreen(mark.direction, view.yaw, view.pitch, view.fov, view.aspect);
        const spoken = (mark.lines?.length || 0) > 0;
        if (!point) {
          if (!spoken) {
            el.style.opacity = '0';
            return;
          }
          el.style.opacity = '1';
          if (!el.style.left) {
            el.style.left = `${(mark.nx ?? 0.5) * 100}%`;
            el.style.top = `${(mark.ny ?? 0.42) * 100}%`;
          }
          return;
        }
        const x = spoken ? Math.min(0.72, Math.max(0.22, point.x)) : point.x;
        const y = spoken ? Math.min(0.58, Math.max(0.24, point.y)) : point.y;
        el.style.opacity = '1';
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
      });
    };

    const draw = (time) => {
      frame = 0;
      if (dead || !ready) return;
      const dt = last ? Math.min(50, time - last) : 16.7;
      last = time;
      const homing = Boolean(homeRef.current);
      const look = lookRef.current;
      const gazeDriven = Boolean(look && look.source === 'gaze' && !homing);
      if (homing) {
        target.yaw = 0;
        target.pitch = 0;
        stable.nx = 0.5;
        stable.ny = 0.5;
      } else if (look) {
        const next = aimedLook(look, dt);
        target.yaw = next.yaw;
        target.pitch = next.pitch;
      }
      const follow = 1 - Math.exp(-dt / (homing ? 180 : gazeDriven ? 160 : 110));
      current.yaw += (target.yaw - current.yaw) * follow;
      current.pitch += (target.pitch - current.pitch) * follow;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const aspect = w / h;
      const fov = viewFov(aspect) * zoom;
      const spanRad = (yawSpan * Math.PI) / 180;
      const halfH = Math.atan(Math.max(aspect, 0.2) * Math.tan(fov * 0.5));
      const yawCap = yawSpan < 359 ? Math.max(0, spanRad * 0.5 - halfH - (2 * Math.PI) / 180) : Infinity;
      target.yaw = clamp(target.yaw, -yawCap, yawCap);
      current.yaw = clamp(current.yaw, -yawCap, yawCap);
      if (homeRef.current && Math.abs(current.yaw) < 0.012 && Math.abs(current.pitch) < 0.012) {
        const done = homeRef.current;
        homeRef.current = null;
        current.yaw = 0;
        current.pitch = 0;
        done();
      }
      viewRef.current = { yaw: current.yaw, pitch: current.pitch, fov, aspect };
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, glareTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, outlineTexture);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(sizeUniform, w, h);
      gl.uniform1f(spanUniform, (yawSpan * Math.PI) / 180);
      gl.uniform3f(viewUniform, current.yaw, current.pitch, fov);
      gl.uniform1f(timeUniform, time * 0.001);
      if (selectedId) {
        const stage = glareTimeline((time - effectStartedAt) / 1000);
        gl.uniform2f(glareStageUniform, stage.glare, stage.sweep);
      } else {
        gl.uniform2f(glareStageUniform, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!presented) {
        presented = true;
        canvas.classList.add(styles.panoramaReady);
      }
      placeMarks();
      frame = requestAnimationFrame(draw);
    };

    const image = preloadStreetPoster(imageUrl);
    const onError = () => {
      canvas.dataset.failed = '1';
    };
    const present = () => {
      if (dead || !image?.naturalWidth) return;
      preloadOutlineAssets();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      ready = true;
      draw(performance.now());
    };
    if (image?.complete && image.naturalWidth) present();
    else if (image) {
      image.addEventListener('load', present, { once: true });
      image.addEventListener('error', onError, { once: true });
    }

    return () => {
      dead = true;
      outlineApiRef.current = {};
      cancelAnimationFrame(frame);
      image?.removeEventListener('load', present);
      image?.removeEventListener('error', onError);
      gl.deleteTexture(glareTexture);
      gl.deleteTexture(outlineTexture);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteProgram(program);
    };
  }, [imageUrl, lookRef, markRefs, pinRef, yawSpan, zoom]);

  return <canvas ref={canvasRef} className={styles.panorama} />;
});
