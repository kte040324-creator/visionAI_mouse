import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useEntryFlow } from '../EntryFlowContext';
import { useMobileLink } from '../mobileLink/MobileLinkContext';
import { PRESENCE } from './presence';
import usePresenceLink from './usePresenceLink';

/**
 * 체험 흐름(/1~/5)에서 아직 2명 통과가 확인되지 않았고, 통과 인원이 2명 아래로 30초 유지되면 /pre_opening 으로 되돌린다.
 * 한 번 2명이 통과하면 이후 얼굴이 잠깐 빠져도 체험을 끊지 않는다.
 * 마우스·시선·가만히 서 있는 것은 복귀 조건이 아니다.
 *
 * 판정 상태를 보려면 주소에 ?idleDebug=1 을 붙인다(브라우저에 기억됨). ?idleDebug=0 으로 끈다.
 */
export const IDLE_RESET = {
  pages: ['/1', '/2', '/3', '/fail', '/4', '/5'],
  home: '/pre_opening',
  awayMs: 30 * 1000,
};

const DEBUG_KEY = 'seoul-idle-debug';

const DEBUG_STYLE = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 9999,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'rgba(0, 0, 0, 0.72)',
  color: '#fff',
  font: '13px/1.5 monospace',
  whiteSpace: 'pre',
  pointerEvents: 'none',
};

function seconds(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export default function FlowIdleGuard() {
  const router = useRouter();
  const { resetFlow } = useEntryFlow();
  const { disconnect } = useMobileLink();
  const active = IDLE_RESET.pages.includes(router.pathname);

  const keptRef = useRef(null);
  const belowSinceRef = useRef(0);
  const firedRef = useRef(false);
  // 한 번이라도 2명이 통과하면, 이후 얼굴이 잠깐 빠져도 체험을 /pre_opening 으로 끊지 않는다.
  const pairedRef = useRef(false);
  const [debug, setDebug] = useState(false);
  const [debugText, setDebugText] = useState('');

  const resetRef = useRef(null);
  resetRef.current = () => {
    resetFlow();
    disconnect();
    router.replace(IDLE_RESET.home);
  };

  const onMessage = useCallback((msg) => {
    if (msg.type === 'pass' || msg.passAt) pairedRef.current = true;
    const state = msg.type === 'state' ? msg : msg.type === 'joined' && msg.state ? msg.state : null;
    if (!state || typeof state.kept !== 'number') return;
    keptRef.current = state.kept;
    if (state.kept >= PRESENCE.people) pairedRef.current = true;
  }, []);

  const link = usePresenceLink('display', onMessage);

  useEffect(() => {
    if (!router.isReady) return;
    const flag = router.query.idleDebug;
    try {
      if (flag === '1') window.localStorage.setItem(DEBUG_KEY, '1');
      if (flag === '0') window.localStorage.removeItem(DEBUG_KEY);
      setDebug(window.localStorage.getItem(DEBUG_KEY) === '1');
    } catch {
      setDebug(flag === '1');
    }
  }, [router.isReady, router.query.idleDebug]);

  useEffect(() => {
    if (!debug) return undefined;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const belowFor = belowSinceRef.current ? now - belowSinceRef.current : 0;
      const count = keptRef.current;
      setDebugText([
        `감시 ${active ? router.pathname : '꺼짐 (' + router.pathname + ')'} · 센서 ${link.connected ? '연결됨' : '끊김'}`,
        count == null ? '통과 인원 신호 없음' : `통과 ${count}명 (필요 ${PRESENCE.people}명)`,
        `2명 미만 ${seconds(belowFor)} (복귀 ${seconds(IDLE_RESET.awayMs)})`,
      ].join('\n'));
    }, 250);
    return () => window.clearInterval(timer);
  }, [debug, active, router.pathname, link.connected]);

  useEffect(() => {
    if (router.pathname !== IDLE_RESET.home) return;
    pairedRef.current = false;
    keptRef.current = null;
    belowSinceRef.current = 0;
    firedRef.current = false;
  }, [router.pathname]);

  useEffect(() => {
    if (!active) return undefined;
    firedRef.current = false;
    belowSinceRef.current = 0;

    const timer = window.setInterval(() => {
      if (firedRef.current) return;
      const count = keptRef.current;
      const now = performance.now();
      if (pairedRef.current || count == null || count >= PRESENCE.people) {
        belowSinceRef.current = 0;
        return;
      }
      if (!belowSinceRef.current) belowSinceRef.current = now;
      if (now - belowSinceRef.current < IDLE_RESET.awayMs) return;
      firedRef.current = true;
      resetRef.current();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [active]);

  if (!debug) return null;
  return <div style={DEBUG_STYLE}>{debugText}</div>;
}
