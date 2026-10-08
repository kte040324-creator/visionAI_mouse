import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import { useGazeEngine } from './gaze/useGazeEngine';
import { VIEWER_BY_CAM } from './gaze/participants';
import { saveGazeSession } from './gaze/gazeSession';

const EntryFlowContext = createContext(null);

// 거리뷰 토론(/2)은 한 사람이 조작하는 단계라 1번 참가자의 시선만 쓴다.
const PRIMARY_VIEWER_ID = VIEWER_BY_CAM.A;

// /2 의 StreetView3D 는 prop 으로 받은 좌표를 쓰므로 반응형 값이 필요하다.
// 시선은 초당 60번 갱신되니 30fps 로 줄여서 리렌더 부담을 반으로 낮춘다.
const GAZE_STATE_INTERVAL_MS = 33;

function clampGazeToRect(x, y, rect) {
  if (!rect) return { x, y };
  return {
    x: Math.max(rect.left, Math.min(rect.right, x)),
    y: Math.max(rect.top, Math.min(rect.bottom, y)),
  };
}

export function EntryFlowProvider({ children }) {
  const router = useRouter();
  const [winnerCard, setWinnerCard] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [pins, setPins] = useState([]);
  const [discussionDone, setDiscussionDone] = useState(false);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [gazeClip, setGazeClip] = useState(null);
  const [gazePosition, setGazePosition] = useState(null);
  // /2 거리뷰 블러(veil) 레이어가 다 걷혔는지. 걷히기 전엔 시선 커서를 숨긴다.
  const [streetUnveiled, setStreetUnveiled] = useState(false);

  // /4 거리 파노라마는 서버가 외부에서 받아 오느라 수 초~십수 초 걸린다(강남 약 24MB).
  // 구가 정해지는 /3 에서 미리 받아 브라우저 캐시에 두면 /4 의 QuietStreet 가 바로 그린다.
  // 주소는 QuietStreet 가 요청하는 것과 글자 하나까지 같아야 캐시가 맞는다.
  const streetPreloadRef = useRef(null);
  const districtName = selectedDistrict?.name || '';
  useEffect(() => {
    if (!districtName) return;
    const image = new Image();
    image.src = `/api/district-street?name=${encodeURIComponent(districtName)}&v=2`;
    streetPreloadRef.current = image;
  }, [districtName]);

  // 시선 보정은 쓰지 않는다. 마우스 좌표가 예전 시선 좌표 자리를 대신한다.
  const [setupComplete, setSetupComplete] = useState(true);
  const [mouseDev, setMouseDev] = useState(true);

  const gazeHandlersRef = useRef({});
  const gazeClipRef = useRef(null);
  const activeStepRef = useRef(null);
  const dwellProgressRef = useRef(0);
  const gazeStateAtRef = useRef(0);
  const discussionCamRef = useRef('A');
  const gazeRefHolder = useRef(null);
  const [discussionCam, setDiscussionCam] = useState('A');
  discussionCamRef.current = discussionCam;

  const activeStep = router.pathname === '/2' ? 'discussion' : null;

  activeStepRef.current = activeStep;
  gazeClipRef.current = gazeClip;

  const registerGazeHandler = useCallback((phase, handler) => {
    if (handler) {
      gazeHandlersRef.current[phase] = handler;
    } else {
      delete gazeHandlersRef.current[phase];
    }
  }, []);

  const registerGazeSample = useCallback((viewerId, x, y) => {
    const step = activeStepRef.current;
    const clip = gazeClipRef.current;
    const sample = clip ? clampGazeToRect(x, y, clip) : { x, y };

    // 위치는 GazeReticle 이 따라가게 두고, 여기서는 보이기만 켠다.
    if (typeof window !== 'undefined') {
      const runtime = window.__seoulGazeRuntime;
      const cursorEl = runtime?.cursors?.[viewerId] || (viewerId === PRIMARY_VIEWER_ID ? runtime?.cursorEl : null);
      if (cursorEl) cursorEl.style.opacity = '1';
    }

    const discussionViewerId = VIEWER_BY_CAM[discussionCamRef.current] || PRIMARY_VIEWER_ID;
    const publishesPosition = step === 'discussion'
      ? viewerId === discussionViewerId
      : viewerId === PRIMARY_VIEWER_ID;

    if (publishesPosition) {
      const now = performance.now();
      if (now - gazeStateAtRef.current >= GAZE_STATE_INTERVAL_MS) {
        gazeStateAtRef.current = now;
        setGazePosition({ x: sample.x, y: sample.y });
      }
    }

    // 토론은 지금 말하는 사람의 시선만 심기 판정에 쓴다.
    if (step === 'discussion' && viewerId !== discussionViewerId) {
      return;
    }

    const handler = gazeHandlersRef.current[step];
    if (!handler) return;

    const result = handler(viewerId, sample.x, sample.y);
    if (result?.cursorX != null && result?.cursorY != null) {
      const held = gazeRefHolder.current?.current?.[viewerId];
      if (held) {
        held.x = result.cursorX;
        held.y = result.cursorY;
      }
    }
    if (result?.dwellProgress == null) return;

    // 매 프레임 setState 하면 화면 전체가 다시 그려지므로 눈에 보일 만큼 바뀔 때만 올린다.
    const next = Math.round(result.dwellProgress * 50) / 50;
    if (next !== dwellProgressRef.current) {
      dwellProgressRef.current = next;
      setDwellProgress(next);
    }
  }, []);

  const engine = useGazeEngine({ onSample: registerGazeSample, enabled: false });
  gazeRefHolder.current = engine.gazeRef;

  const handleGazeClipChange = useCallback((clip) => {
    setGazeClip(clip);
  }, []);

  // /2 의 DiscussionStep 이 veil 페이드가 끝나면 호출한다.
  const reportStreetUnveiled = useCallback(() => {
    setStreetUnveiled(true);
  }, []);

  useEffect(() => {
    if (router.pathname !== '/2') {
      setGazeClip(null);
      setStreetUnveiled(false);
    }
  }, [router.pathname]);

  const publishMousePoint = useCallback((x, y) => {
    const gaze = engine.gazeRef.current;
    if (gaze) {
      gaze[VIEWER_BY_CAM.A] = { x, y };
      gaze[VIEWER_BY_CAM.B] = { x, y };
    }
    registerGazeSample(VIEWER_BY_CAM.A, x, y);
    registerGazeSample(VIEWER_BY_CAM.B, x, y);
  }, [engine.gazeRef, registerGazeSample]);

  const enableMouseDev = useCallback((event) => {
    setMouseDev(true);
    setSetupComplete(true);
    if (event?.clientX != null) {
      publishMousePoint(event.clientX, event.clientY);
    }
  }, [publishMousePoint]);

  useEffect(() => {
    if (!mouseDev) return undefined;

    const onMove = (event) => {
      publishMousePoint(event.clientX, event.clientY);
    };

    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [mouseDev, publishMousePoint]);

  const completeSetup = useCallback(() => {
    saveGazeSession({ setupComplete: true });
    setSetupComplete(true);
  }, []);

  const reopenSetup = useCallback(() => {
    saveGazeSession({ setupComplete: false });
    setSetupComplete(false);
  }, []);

  // 친구 프론트가 쓰던 이름. 보정 완료 = 참여 시작과 같다.
  const finishCalibration = completeSetup;

  // 체험 도중 사람이 바뀌어 /pre_opening 으로 돌아갈 때, 앞사람의 선택을 지운다. 보정과 카메라는 그대로 둔다.
  const resetFlow = useCallback(() => {
    setWinnerCard(null);
    setSelectedDistrict(null);
    setPins([]);
    setDiscussionDone(false);
    setDiscussionCam('A');
    setGazeClip(null);
    dwellProgressRef.current = 0;
    setDwellProgress(0);
    try {
      sessionStorage.removeItem('seoul-district');
    } catch {
      // 사생활 보호 모드 등에서 sessionStorage 를 못 쓰면 무시한다.
    }
  }, []);

  const reportDwellProgress = useCallback((progress) => {
    if (progress == null) return;
    const next = Math.round(progress * 50) / 50;
    if (next !== dwellProgressRef.current) {
      dwellProgressRef.current = next;
      setDwellProgress(next);
    }
  }, []);

  const value = useMemo(
    () => ({
      ...engine,
      isReady: engine.ready || mouseDev,
      mouseDev,
      enableMouseDev,
      // 준비가 끝나기 전에는 참여 화면이 보정 화면으로 돌려보낸다.
      isCalibrating: !setupComplete || Boolean(engine.calibUi),
      setupComplete,
      completeSetup,
      finishCalibration,
      reopenSetup,
      primaryViewerId: PRIMARY_VIEWER_ID,

      winnerCard,
      setWinnerCard,
      selectedDistrict,
      setSelectedDistrict,
      discussionCam,
      setDiscussionCam,
      pins,
      setPins,
      discussionDone,
      setDiscussionDone,
      resetFlow,
      dwellProgress,
      reportDwellProgress,
      gazePosition,
      // 친구 GazeReticle / GlobalGazeCursor 가 읽는 이름
      reticlePosition: gazePosition,
      // /2 거리뷰 블러(veil)가 다 걷힌 뒤부터 시선 커서를 보인다.
      streetUnveiled,
      reportStreetUnveiled,
      registerGazeHandler,
      handleGazeClipChange,
    }),
    [
      engine,
      mouseDev,
      enableMouseDev,
      setupComplete,
      completeSetup,
      finishCalibration,
      reopenSetup,
      winnerCard,
      selectedDistrict,
      discussionCam,
      pins,
      discussionDone,
      resetFlow,
      dwellProgress,
      reportDwellProgress,
      gazePosition,
      streetUnveiled,
      reportStreetUnveiled,
      registerGazeHandler,
      handleGazeClipChange,
    ]
  );

  return (
    <EntryFlowContext.Provider value={value}>
      {children}
    </EntryFlowContext.Provider>
  );
}

export function useEntryFlow() {
  const context = useContext(EntryFlowContext);
  if (!context) {
    throw new Error('useEntryFlow must be used inside EntryFlowProvider');
  }
  return context;
}
