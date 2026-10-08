// 종로구·마포구·강남구 엔딩이 함께 쓰는 멘트. 번호는 피그마 종로구1–17 프레임 번호다.
// 말풍선 박스(2303×1295)를 3881×2183 스테이지로 옮긴 값이고, 오브는 화면 가로 가운데에 고정한다.
// 각 영상(shot)의 story가 어떤 멘트를 띄울지 정하고, hold가 그 구간의 타이밍을 정한다.
//   intro   1~2: 오브만 떠 있다가(1) 2 말풍선이 나타난다.
//   grow    3~7: 멈춘 채 3 → 4, 그다음 슬로모션으로 5 → 7. 이 구간에 시선 링이 뜬다.
//           hold.cue6From 이 있으면(강남구) 링이 다 찬 뒤 5 → 6 → 7.
//   spread  8: 9. hold.cue9At 이 있으면(강남구 7~9) 그 시점까지 8, 그 뒤 9.
//   bloom   9~10: 9, 끝 프레임에서 멈춘 채 10 → 11.
//   rise    11~13(마포구·강남구): 말풍선 없이 오브만(12).
//   finale  14~17: 16, 끝 프레임에서 멈춘 채 17.
// 6·8은 피그마 강남구6·강남구8에만 있는 멘트다(종로구 번호에서 비어 있는 자리를 쓴다).
// 멘트는 TTS로도 읽는다. 위 시간들은 최소 표시 시간이고, 말이 끝나지 않았으면 멘트 경계·영상 끝에서
// 멈춰 기다린다(shot 의 speechStops·freezeStops, BackgroundSequence 의 waitRef).
export const AGENT_BOX = { left: (3881 - 440) / 2, top: 109, size: 440 };

export const CUES = {
  1: {},
  2: {
    lines: [[{ text: '여러분이 상상하는 용산구에 지금부터 직접 식물을 심고 함께 키워볼게요' }]],
    bubble: { left: 1143, top: 374, width: 1595, height: 167 },
  },
  3: {
    lines: [
      [{ text: '두 분이 그린 새싹이 이 거리에 자리를 잡았어요! ' }],
      [{ text: '이제 두 분의 시선이 새싹을 자라게 할 햇빛이 되어줄 거예요' }],
    ],
    bubble: { left: 1266, top: 386, width: 1349, height: 238 },
  },
  4: {
    lines: [
      [{ text: '이제 각자의 새싹을 가만히 바라봐 주세요 ' }],
      [{ text: '꽃이 피어야 이 거리에 온전히 뿌리내릴 수 있어요' }],
    ],
    bubble: { left: 1363, top: 398, width: 1157, height: 238 },
  },
  5: {
    lines: [
      [
        { text: '[애플망고랑 스무디]', bold: true, name: 'A' },
        { text: '과 ' },
        { text: '[카스테라]', bold: true, name: 'B' },
        { text: '의 새싹들이 반응하고 있어요 ' },
      ],
      [{ text: '뿌리가 더 단단하게 자랄 수 있도록 조금만 더 바라봐주세요' }],
    ],
    bubble: { left: 1223, top: 398, width: 1433, height: 238 },
  },
  6: {
    lines: [[{ text: '새싹들이 조금씩 자라나는 모습이 보여서 기뻐요!' }]],
    bubble: { left: 1368, top: 398, width: 1147, height: 167 },
  },
  7: {
    lines: [
      [{ text: '두 분의 시선을 받아 식물들이 한 단계 더 자랐어요' }],
      [{ text: '이제 새싹들이 도시 곳곳으로 뻗어나가기 시작해요!' }],
    ],
    bubble: { left: 1347, top: 398, width: 1189, height: 238 },
  },
  8: {
    lines: [[{ text: '새싹들이 도시 곳곳에서 자라나고 있어요!' }]],
    bubble: { left: 1437, top: 398, width: 1007, height: 167 },
  },
  9: {
    lines: [
      [{ text: '여러분들이 피운 새싹들이 도시와 더 어우러질 수 있도록' }],
      [{ text: '함께 화면을 바라봐주세요' }],
    ],
    bubble: { left: 1298, top: 398, width: 1285, height: 238 },
  },
  10: {
    lines: [
      [{ text: '두 분이 애정으로 키운 식물들이 서울 곳곳으로 퍼져 나가고 있어요' }],
      [{ text: '그 전경을 함께 감상해볼까요?' }],
    ],
    bubble: { left: 1202, top: 398, width: 1477, height: 238 },
  },
  11: {
    lines: [
      [{ text: '마우스를 위로 올려' }],
      [{ text: '새로운 공간으로 이동해보세요' }],
    ],
    bubble: { left: 1421, top: 398, width: 1037, height: 238 },
  },
  12: {},
  16: {
    lines: [
      [{ text: '여러분들이 상상한 식물들로 완성된 서울의 전경이에요!' }],
      [{ text: '도시가 한층 더 푸르고 쾌적해졌어요' }],
    ],
    bubble: { left: 1304, top: 398, width: 1275, height: 238 },
  },
  17: {
    lines: [
      [{ text: '오늘 두 분이 함께 피워낸 초록은 이곳에 남아 계속 자라납니다' }],
      [{ text: '전시장 밖에서도 이 초록을 이어가는 서울을 만들어주세요' }],
    ],
    bubble: { left: 1245, top: 398, width: 1393, height: 238 },
  },
};

// 슬로모션 구간(멈춘 지점~끝) 안에서 지금 몇 % 지났는지.
function growProgress(hold, time, detail) {
  const rest = Math.max((detail?.duration || 1) - hold.at, 0.01);
  return Math.max(0, Math.min(1, (time - hold.at) / rest));
}

// 슬로모션 구간의 멘트 경계(5 → 6 → 7)를 영상 초로 돌려준다. 말이 끝날 때까지 영상이 여기서 멈춰 기다린다.
export function growSpeechStops(hold) {
  return (duration) => [hold.cue6From, hold.ringEnd]
    .filter((value) => value != null)
    .map((fraction) => hold.at + fraction * Math.max(duration - hold.at, 0.01));
}

// 슬로모션 구간의 멘트: 5, (링이 다 찬 뒤 6,) ringEnd 부터 7.
function growCue(hold, progress) {
  if (progress >= hold.ringEnd) return 7;
  if (hold.cue6From != null && progress >= hold.cue6From) return 6;
  return 5;
}

function cueIdFor(shot, time, detail) {
  const hold = shot?.hold;
  switch (shot?.story) {
    case 'intro':
      return time < hold.cue2At ? 1 : 2;
    case 'grow':
      if (detail?.frozen) return detail.freezeElapsed < hold.cue3Ms ? 3 : 4;
      if (time < hold.at) return null;
      return growCue(hold, growProgress(hold, time, detail));
    case 'spread':
      return hold?.cue9At != null && time < hold.cue9At ? 8 : 9;
    case 'bloom':
      if (detail?.frozen) return detail.freezeElapsed < hold.cue10Ms ? 10 : 11;
      return time < hold.at ? 9 : 11;
    case 'rise':
      return 12;
    case 'finale':
      if (detail?.frozen) return detail.freezeElapsed < hold.cue16Ms ? 16 : 17;
      return time < hold.at ? 16 : 17;
    default:
      return null;
  }
}

export function cueForShot(shot, time, detail) {
  const id = cueIdFor(shot, time, detail);
  const cue = id ? CUES[id] || null : null;
  return cue ? { ...cue, id } : null;
}

const RINGS_OFF = { visible: false, progress: 0, labels: false };

export function gazeRingState(shot, time, detail) {
  if (shot?.story !== 'grow') return RINGS_OFF;
  const hold = shot.hold;
  if (detail?.frozen) {
    const labels = detail.freezeElapsed >= hold.cue3Ms;
    return { visible: labels, progress: 0, labels };
  }
  if (time < hold.at) return RINGS_OFF;
  const sourceProgress = growProgress(hold, time, detail);
  // 사라질 때 이름표를 켜 둔 채 레이어째 페이드해야 링과 이름표가 한 번에 사라진다.
  if (sourceProgress >= hold.ringHide) return { visible: false, progress: 1, labels: true };
  const progress = Math.min(1, sourceProgress / hold.ringFill);
  return { visible: true, progress, labels: true };
}

const NAME_FALLBACK = [
  [{ text: '두 분의 새싹들이 반응하고 있어요 ' }],
  [{ text: '뿌리가 더 단단하게 자랄 수 있도록 조금만 더 바라봐주세요' }],
];

export function cueLines(cue, placeName, names) {
  if (!cue?.lines) return [];
  const place = placeName || '종로구';
  const named = cue.lines.some((line) => line.some((part) => part.name));
  if (named && !(names?.A && names?.B)) return NAME_FALLBACK;
  return cue.lines.map((line) => line.map((part) => {
    let text = part.text.replace(/용산구/g, place);
    if (part.name === 'A') text = names.A;
    if (part.name === 'B') text = names.B;
    return { text, bold: part.bold };
  }));
}
