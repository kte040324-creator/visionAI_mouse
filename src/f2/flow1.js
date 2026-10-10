// 플1. false로 두면 B 의견 수집 뒤 바로 기존 마무리로 돌아간다.
export const FLOW1 = true;

export const FLOW1_CLOSE_LINE = '토론이 종료 되었어요!';

export const FLOW1_ZONES = [
  {
    id: 'building',
    speaker: 0,
    other: 1,
    look: '그렇다면 NABI님, 저 앞에 분홍 지붕 위 회색 건물을 바라봐주세요. 상상한 식물이 저 건물에 자란다면 어떤 모습일까요?',
    askOther: 'SORA님은 NABI님이 말한 건물의 모습에 대해 어떻게 생각하시나요?',
  },
  {
    id: 'window',
    speaker: 1,
    other: 0,
    look: 'SORA님! 이번엔 오른쪽의 금색 건물의 창문을 바라봐 주세요. 이곳에 SORA님의 식물이 자란다면 어떤 풍경이 펼쳐질까요?',
    askOther: 'NABI님은 SORA님의 식물이 주변 사람들에게 어떤 영향을 끼칠거라고 생각하세요?',
  },
];

export function opinionPhrase(text) {
  let value = String(text || '').replace(/\s+/g, ' ').trim();
  value = value.replace(/[.!?…]+$/g, '').trim();
  value = value.replace(/(싶어요|싶습니다|같아요|것 같아요|거예요|는데요|해요|예요|이에요|니다|요)$/g, '').trim();
  if (!value) return '';
  const chars = Array.from(value);
  if (chars.length > 16) return `${chars.slice(0, 15).join('')}…`;
  return value;
}

const SUMMARY_FRAME = '두 분의 의견을 모아봤어요.';
const SUMMARY_PLANTS = [
  '개나리', '장미', '해바라기', '라벤더', '민들레', '벚나무', '소나무', '단풍나무',
  '은행나무', '버드나무', '대나무', '이끼', '선인장', '덩쿨', '덩굴', '가로수', '잔디', '화분', '꽃', '나무', '식물',
];

function withObjectParticle(word) {
  const last = Array.from(word).at(-1);
  const code = last?.charCodeAt(0) || 0;
  const hasFinalConsonant = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${word}${hasFinalConsonant ? '을' : '를'}`;
}

function summaryCore(lines) {
  const text = (lines || []).map((line) => String(line || '')).join(' ').replace(/\s+/g, ' ').trim();
  const plant = SUMMARY_PLANTS.find((name) => text.includes(name)) || '식물';
  const color = text.match(/(빨간|붉은|주황색?|노란|금색|초록색?|연두색?|청록색?|파란|남색|보라색?|분홍색?|하얀|흰|검은)/)?.[0];
  const texture = text.match(/(보슬보슬한|매끈한|까칠한|거친|촉촉한|부드러운|폭신한|단단한|반짝이는)/)?.[0];
  const shape = text.match(/(큰|작은|굵은|가느다란|둥근|뾰족한|길게 뻗는|아래로 늘어지는)/)?.[0];
  const modifier = color || texture || shape || '';
  return `${modifier ? `${modifier} ` : ''}${plant}`;
}

export function summaryLine(aLines, bLines) {
  const a = summaryCore(Array.isArray(aLines) ? aLines : [aLines]);
  const b = summaryCore(Array.isArray(bLines) ? bLines : [bLines]);
  return `${SUMMARY_FRAME} NABI님은 ${withObjectParticle(a)} 떠올리셨고, SORA님은 ${withObjectParticle(b)} 떠올리셨네요. 두 분의 생각을 잘 이해했어요.`;
}

export function remarksFromMarks(marks, cam) {
  return (marks || [])
    .filter((mark) => mark.cam === cam)
    .flatMap((mark) => (mark.lines || []).map((line) => (typeof line === 'string' ? line : line?.text || '')))
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function echoFallback(text) {
  const phrase = opinionPhrase(text);
  if (!phrase) return '그 장면이 거리에 피어난다니, 너무 좋아요!';
  return `${phrase}라니, 너무 좋아요!`;
}

function withoutQuestion(line) {
  const bits = String(line || '')
    .split(/(?<=[.!?…])/)
    .map((bit) => bit.trim())
    .filter(Boolean)
    .filter((bit) => !/[?？]/.test(bit) && !/까요/.test(bit));
  return bits.join(' ').trim();
}

async function postAgent(payload) {
  try {
    const response = await fetch('/api/discussion-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return '';
    const data = await response.json();
    return data?.line || '';
  } catch {
    return '';
  }
}

export async function fetchSummaryLine(marks) {
  const aLines = remarksFromMarks(marks, 'A');
  const bLines = remarksFromMarks(marks, 'B');
  return summaryLine(aLines, bLines);
}

const SKIP_WORD = new Set([
  '그리고', '그래서', '하지만', '근데', '그런데', '그냥', '약간', '너무', '아주', '정말', '진짜',
  '완전', '엄청', '조금', '좀', '여기', '저기', '거기', '이것', '그것', '우리', '저는', '나는',
  '내가', '제가', '있어', '없어', '같아', '싶어', '좋아', '해요', '했어', '하면', '이게', '그게',
]);

const LOOK_WORD = ['보슬보슬', '까슬까슬', '매끈한', '부드러운', '동그란', '빨강', '노란', '파란', '초록', '연두', '분홍', '보라', '하얀', '검은', '금색', '청록', '질감', '형태', '모양', '빛깔', '색깔', '굵은', '가는', '넓은', '뾰족', '두꺼운', '얇은', '촉촉', '거친', '반짝', '투명', '덩쿨', '덩굴', '꽃잎', '줄기', '잎', '꽃', '밝', '색'];
const IMPACT_WORD = ['그늘', '시원', '변화', '미래', '생기', '활기', '발전', '풍경', '휴식', '영향', '성장', '편안', '서울', '나중', '사람', '공기', '거리'];
const POINT_WORD = ['재미', '예쁜', '멋진', '큰', '작은', '긴', '짧은', '밝은', '어두운', '많은', '높은', '낮은'];

function pointWord(answer, followUp) {
  const blob = String(answer || '').replace(/\s+/g, '');
  if (!blob) return '';
  const stage = Number(followUp) > 1 ? IMPACT_WORD : LOOK_WORD;
  const hints = [...stage, ...POINT_WORD].sort((a, b) => Array.from(b).length - Array.from(a).length);
  const tokens = String(answer || '')
    .replace(/[.?!,…"'「」~]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !SKIP_WORD.has(token));
  const ranked = tokens.map((token) => {
    const particle = token.match(/^(.+?)(에서|으로|에게|한테|부터|까지|처럼|이|가|을|를|은|는|도|만|로)$/);
    const stem = particle?.[1] && blob.includes(particle[1]) ? particle[1] : token;
    const shown = Array.from(stem).length <= 8 ? stem : token;
    if (!blob.includes(shown) || Array.from(shown).length > 8) return null;
    const hit = hints.find((hint) => shown.includes(hint));
    const stageHit = stage.some((hint) => shown.includes(hint));
    const score = (stageHit ? 24 : 0) + (hit ? 12 + Array.from(hit).length : 0) + Math.min(Array.from(shown).length, 6);
    return { shown, score, hit: Boolean(hit) };
  }).filter(Boolean);
  ranked.sort((a, b) => b.score - a.score);
  if (ranked[0]?.hit) return ranked[0].shown;
  const direct = hints.find((hint) => blob.includes(hint) && Array.from(hint).length <= 8);
  if (direct) return direct;
  if (ranked[0]) return ranked[0].shown;
  const run = blob.match(/[가-힣]{2,6}/);
  return run ? run[0] : Array.from(blob).slice(0, 4).join('');
}

function acceptKeyword(line, answer) {
  const word = String(line || '').replace(/[.?!,…"'「」\s]/g, '').trim();
  if (!word || Array.from(word).length > 8) return '';
  const blob = String(answer || '').replace(/\s+/g, '');
  return blob.includes(word) ? word : '';
}

function postAgentTimed(payload, ms) {
  return Promise.race([
    postAgent(payload),
    new Promise((resolve) => {
      setTimeout(() => resolve(''), ms);
    }),
  ]);
}

export async function fetchReplyKeyword(answer, question, followUp) {
  const history = [
    { role: 'assistant', text: question || '' },
    { role: 'user', text: answer },
  ];
  const line = await postAgentTimed({ beat: 'reply-keyword', followUp, history }, 2200);
  return acceptKeyword(line, answer) || pointWord(answer, followUp);
}

export async function fetchEchoLine(text, history) {
  const line = withoutQuestion(await postAgentTimed({
    beat: 'flow1-echo',
    history: history || [],
  }, 2500));
  return line || echoFallback(text);
}
