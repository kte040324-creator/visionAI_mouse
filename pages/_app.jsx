import { Component as ReactComponent, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import '../styles/globals.css';
import { EntryFlowProvider, useEntryFlow } from '../src/shared/EntryFlowContext';
import { MobileLinkProvider } from '../src/shared/mobileLink/MobileLinkContext';
import GazeReticle from '../src/shared/GazeReticle';
import FlowIdleGuard from '../src/shared/gaze/FlowIdleGuard';
import { CAM_COLOR, CAM_KEYS, VIEWER_BY_CAM } from '../src/shared/gaze/participants';
import { applyRecoverySwitchFromQuery, armFlowRecovery, reportFlowError } from '../src/shared/flowRecovery';

const STREET_POSTER = '/street/red/assets/street-panorama.webp';

if (typeof window !== 'undefined' && !window.__streetPoster) {
  const image = new Image();
  image.dataset.src = STREET_POSTER;
  image.decoding = 'sync';
  image.src = STREET_POSTER;
  window.__streetPoster = image;
  image.decode?.().catch(() => {});
}

function GlobalGazeCursor() {
  const router = useRouter();
  const { gazeRef, dwellProgress, isReady, isCalibrating, calibrated, discussionCam, streetUnveiled } = useEntryFlow();

  // 보정 화면에서는 점 타깃만 보이게 커서를 숨긴다.
  const visible =
    isReady &&
    !isCalibrating &&
    router.pathname !== '/app' &&
    router.pathname !== '/mobile' &&
    router.pathname !== '/1' &&
    router.pathname !== '/3' &&
    router.pathname !== '/fail' &&
    router.pathname !== '/pre_opening' &&
    router.pathname !== '/5' &&
    router.pathname !== '/6' &&
    // /2 는 거리뷰 블러(veil) 레이어가 다 걷히기 전엔 시선 커서를 숨긴다. (걷힌 뒤로는 정상 표시)
    (router.pathname !== '/2' || streetUnveiled);

  // 토론 중에는 지금 차례인 사람의 커서만 따라다닌다. 심어 둔 자리는 따로 남는다.
  const keys = router.pathname === '/2'
    ? [discussionCam || 'A']
    : calibrated?.length
      ? CAM_KEYS.filter((key) => calibrated.includes(key))
      : ['A'];

  return keys.map((key) => (
    <GazeReticle
      key={key}
      gazeRef={gazeRef}
      viewerId={VIEWER_BY_CAM[key]}
      color={CAM_COLOR[key]}
      dwellProgress={dwellProgress}
      visible={visible}
    />
  ));
}

/**
 * React 렌더 중 난 오류를 받아 전체 복구(/6)로 보낸다.
 * 복구가 시작되면 리로드될 때까지 검은 화면을 보여 깨진 UI 가 보이지 않게 한다.
 * 복구 대상이 아닌 경로(/mobile 등)면 오류를 다시 던져 평소처럼 처리되게 둔다.
 */
class FlowErrorBoundary extends ReactComponent {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (!reportFlowError(error)) throw error;
  }

  render() {
    if (this.state.error) {
      return <div style={{ position: 'fixed', inset: 0, background: '#000' }} aria-hidden="true" />;
    }
    return this.props.children;
  }
}

/** 전역 오류(JS 예외·Promise 거부) 감지를 켠다. ?recover=0/1 로 끄고 켤 수 있다. */
function FlowRecoveryArm() {
  const router = useRouter();
  useEffect(() => armFlowRecovery(), []);
  useEffect(() => {
    if (router.isReady) applyRecoverySwitchFromQuery(router.query);
  }, [router.isReady, router.query]);
  return null;
}

function AppFrame({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="preload" as="image" href="/street/red/assets/street-panorama.webp" />
      </Head>
      <div style={{ position: 'relative', zIndex: 6, minHeight: '100vh' }}>
        <Component {...pageProps} />
      </div>
      <GlobalGazeCursor />
      <FlowIdleGuard />
      <FlowRecoveryArm />
    </>
  );
}

export default function App({ Component, pageProps }) {
  return (
    <FlowErrorBoundary>
      <EntryFlowProvider>
        <MobileLinkProvider>
          <AppFrame Component={Component} pageProps={pageProps} />
        </MobileLinkProvider>
      </EntryFlowProvider>
    </FlowErrorBoundary>
  );
}
