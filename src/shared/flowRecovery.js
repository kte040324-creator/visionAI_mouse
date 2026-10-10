/**
 * 흐름 전체 복구.
 *
 * 체험 흐름(/pre_opening → /1 → … → /5) 도중 오류가 나면 운영자가 새로고침 버튼을 누르는 대신
 * 자동으로 /6 으로 보낸다. /6 은 보이지 않는 페이지로, 저장된 진행 상태를 지우고
 * 전체를 하드 리로드해 /pre_opening 부터 다시 시작한다.
 *
 * 감지하는 오류: 처리되지 않은 JS 예외(window error), 처리되지 않은 Promise 거부, React 렌더 오류(에러 바운더리).
 * 다른 곳에서 "이건 복구가 필요한 오류다" 라고 알리려면 reportFlowError(reason) 를 부르면 된다.
 *
 * 끄기: 주소에 ?recover=0 (브라우저에 기억됨) 또는 콘솔에서 localStorage['seoul-flow-recovery']='off'.
 * 다시 켜기: ?recover=1.
 */

export const RECOVERY_PATH = '/6';
export const RECOVERY_HOME = '/pre_opening';

const SWITCH_KEY = 'seoul-flow-recovery';
const LOG_KEY = 'seoul-flow-recovery-log';

// 이 경로에서 난 오류는 복구하지 않는다.
//   /mobile          관람객 휴대폰 화면. 키오스크 시작 화면으로 보내면 안 된다.
//   /presence_test   인원 인식 센서(별도 창). 흐름의 일부가 아니다.
//   /6               복구 페이지 자신.
const SKIP_PATHS = ['/mobile', '/presence_test', RECOVERY_PATH];

// 짧은 시간에 복구가 반복되면(리로드 루프) 이만큼 기다렸다가 다시 시작한다.
const LOOP_WINDOW_MS = 60 * 1000;
const LOOP_LIMIT = 3;
const LOOP_COOLDOWN_MS = 8 * 1000;

// 이 문구가 들어간 오류는 흐름을 깨지 않는 잡음이라 무시한다.
const IGNORED_MESSAGES = [
  'ResizeObserver loop', // 브라우저가 흔히 내는 무해한 경고
  'AbortError', // video.play() 가 다른 재생 요청에 밀려 중단됨
  'The play() request was interrupted',
  'NotAllowedError', // 자동 재생 차단. 다른 곳에서 사용자 제스처를 기다린다.
  'Transition was aborted', // 화면 전환 애니메이션이 늦어 취소됨. 페이지 이동은 그대로 끝난다.
];

let armed = false;
let firing = false;

function readSwitch() {
  try {
    return localStorage.getItem(SWITCH_KEY);
  } catch {
    return null;
  }
}

export function isRecoveryEnabled() {
  return readSwitch() !== 'off';
}

/** ?recover=0 / ?recover=1 로 스위치를 바꾼다. */
export function applyRecoverySwitchFromQuery(query) {
  const flag = query?.recover;
  if (flag !== '0' && flag !== '1') return;
  try {
    if (flag === '0') localStorage.setItem(SWITCH_KEY, 'off');
    else localStorage.removeItem(SWITCH_KEY);
  } catch {
    /* 저장 불가 환경 */
  }
}

function describe(error) {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error;
  const name = error.name ? `${error.name}: ` : '';
  return `${name}${error.message || String(error)}`.slice(0, 200);
}

function isIgnored(message) {
  return IGNORED_MESSAGES.some((needle) => message.includes(needle));
}

function onSkippedPath() {
  const path = window.location.pathname;
  return SKIP_PATHS.some((skip) => path === skip || path.startsWith(`${skip}/`));
}

/**
 * 복구를 시작한다. /6 으로 하드 이동한다(클라이언트 라우팅이 아니라 전체 페이지 교체).
 * @param {unknown} reason  오류 객체나 설명 문자열
 * @returns {boolean} 복구가 시작됐으면(또는 이미 진행 중이면) true, 무시했으면 false
 */
export function reportFlowError(reason) {
  if (typeof window === 'undefined') return false;
  if (firing) return true;
  if (!isRecoveryEnabled() || onSkippedPath()) return false;
  const message = describe(reason);
  if (isIgnored(message)) return false;
  firing = true;
  // 어떤 오류였는지 콘솔과 /6 주소에 남긴다(운영 중 원인 추적용).
  console.error('[flow-recovery] 오류 감지 → 전체 다시 시작', reason);
  const from = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ from, reason: message });
  window.location.replace(`${RECOVERY_PATH}?${params.toString()}`);
  return true;
}

/** 전역 오류 리스너를 건다. _app 에서 한 번만 부른다. */
export function armFlowRecovery() {
  if (typeof window === 'undefined' || armed) return undefined;
  armed = true;

  const onError = (event) => {
    // 이미지·스크립트 로드 실패(리소스 오류)는 target 이 요소다. 그런 건 여기선 보지 않는다.
    if (event?.target && event.target !== window) return;
    reportFlowError(event?.error || event?.message || 'window error');
  };
  const onRejection = (event) => {
    reportFlowError(event?.reason || 'unhandled rejection');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    armed = false;
  };
}

function readLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((t) => typeof t === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * /6 이 호출한다. 복구 기록을 남기고, 루프면 기다릴 시간을 돌려준다.
 * @returns {number} 다시 시작까지 기다릴 ms
 */
export function noteRecoveryAndGetDelay() {
  const now = Date.now();
  const recent = readLog().filter((t) => now - t < LOOP_WINDOW_MS);
  recent.push(now);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(recent.slice(-10)));
  } catch {
    /* 저장 불가 환경 */
  }
  return recent.length > LOOP_LIMIT ? LOOP_COOLDOWN_MS : 0;
}

/** 이 탭에 남은 진행 상태를 지운다. 전체 리로드 뒤 /pre_opening 이 깨끗하게 시작하도록. */
export function clearFlowState() {
  try {
    sessionStorage.clear();
  } catch {
    /* 저장 불가 환경 */
  }
}
