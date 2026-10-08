# Visual AI Glass — Scene 2–3 Prototype

시선 기반 회의 주제 선택 → 대비 이미지 → 시선+보이스 의견 입력 → 시선 기반 공감(하트) 웹 프로토타입입니다.

## 실행

```bash
yarn install
yarn dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다.

`yarn install` 이 끝나면 MediaPipe wasm 과 얼굴 랜드마크 모델(약 4MB)이 `public/mediapipe/` 로
준비됩니다. 이 폴더는 저장소에 넣지 않으므로 필요하면 `yarn setup:assets` 로 다시 만듭니다.
준비에 실패해도 실행은 되며, 런타임이 CDN 으로 폴백합니다.

### 전시 실행 (모니터 1대, 창 2개)

**상주 직원용:** Finder 에서 프로젝트 폴더를 열고 `전시 시작.command` 를 더블클릭하면 서버를 켜고(꺼져 있을 때만)
전시 창까지 띄웁니다. 터미널 창은 닫아도 됩니다. 끌 때는 `전시 종료.command` 를 더블클릭합니다.
서버 기록은 `~/.seoul-kiosk-chrome/server.log` 에 남습니다.

개발 중에는 `yarn dev` 가 떠 있는 상태에서 아래를 실행하면 전시용 Chrome 이 전용 프로필로 열립니다.

```bash
./scripts/launch-kiosk.sh
```

- `/pre_opening` 은 `--kiosk` 전체화면(탭·주소창 없음, 페이지 이동·오류 복구 중에도 전체화면 유지),
  `/presence_test` 인원 인식 창은 바탕화면 데스크톱의 작은 앱 창으로 뜹니다. 두 창은 별도 Chrome 인스턴스입니다.
- `/pre_opening` 은 기존 3초 영상(`/still/opening-sequence.mp4`) 뒤에 시퀀스 22초 자리를 이어 붙인다.
  0·1명이면 이 25초를 반복하고, 2인 착용(통과)이면 시퀀스가 끝난 뒤 `/1` 로 간다.
  시퀀스 파일은 `public/still/opening-follow.mp4` 에 넣으면 된다.
- `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`
  플래그로 실행되므로, 인원 인식 창이 다른 데스크톱에 있어도 얼굴 인식이 느려지지 않습니다.
- 카메라·마이크 권한은 자동 허용(`--use-fake-ui-for-media-stream`)됩니다.
- 인식 창을 보려면 `Ctrl+←/→`(또는 세 손가락 스와이프)로 데스크톱을 넘깁니다.
- 끄기: `./scripts/launch-kiosk.sh stop` (전시 창에서 `Cmd+Q` 를 누르면 전시 창만 꺼집니다).
- 전시 창 전체화면은 `Fn(지구본)+F` 로만 풀립니다. 다른 방법(`Cmd+Ctrl+F`, 초록 버튼 등)으로 풀리면 감시가 곧바로
  다시 켜고, `Fn+F` 로 끈 경우에는 다시 `Fn+F` 로 켤 때까지 기다립니다. 스크립트를 실행한 터미널에
  **손쉬운 사용** 권한(시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용)이 있어야 하며, 기록은
  `~/.seoul-kiosk-chrome/fullscreen-guard.log` 에 남습니다.
- `KIOSK_DEBUG=1 ./scripts/launch-kiosk.sh` 로 띄우면 전시 창 왼쪽 아래에 `얼굴 N명 · 통과 N명 · N%` 가 떠서,
  안 넘어갈 때 센서가 살아 있는지 / 통과 조건(2명·정면·3.2초) 문제인지 바로 구분할 수 있습니다.
  오른쪽 아래에는 무활동 복귀 상태(마지막 활동 시각과 원인)가 떠서, 30초 복귀가 왜 안 서는지 볼 수 있습니다.
- 다른 주소/크기는 `KIOSK_URL`, `PRESENCE_SIZE`, `PRESENCE_POS` 환경 변수로 바꿉니다. (스크립트 머리말 참고)

## 조작

시선 보정은 쓰지 않는다. 화면의 커서는 마우스를 따라가고, `/2` 보정 안내는 건너뛴 뒤 바로 거리 인터랙션으로 간다.
인원 인식(`/presence_test` → `/pre_opening`)은 그대로다.

## 사용 방법

1. **1단계 [vote]** — 5개 비전 카드 중 하나를 두 사람이 함께 응시하면 선택됩니다.
   사람마다 색이 다른 점선 커서가 실제 시선을 따라갑니다.
2. **2단계 [reveal]** — 선택된 비전 + 현재 서울 거리 대비 이미지 + AI 에이전트 대사
3. **3단계 [discussion]** — 거리 이미지의 지점을 응시하며 말하거나 텍스트 입력 → 의견 핀 생성.
   다른 사람의 핀을 2초간 응시 → ♥ 공감. 이 단계는 1인용이라 1번 참가자의 시선만 씁니다.
4. **4단계 [done]** — 수집된 핀 데이터 확인

## 시선 추적 방식

MediaPipe FaceLandmarker 로 홍채와 머리 자세를 뽑아 특징 벡터를 만들고, 보정 때 모은 샘플로
릿지 회귀를 학습해 화면 좌표로 매핑합니다. 카메라마다 별도의 랜드마커와 모델을 두므로 사람마다
따로 보정하고, 한 명만 다시 보정할 수도 있습니다.

- 홍채 중심은 랜드마크 한 점이 아니라 주변 링 4점까지 평균해 지터를 줄입니다.
- 눈꼬리 두 점을 잇는 축을 기준으로 좌표를 세워 고개 기울임(롤)을 보상합니다.
- 머리 자세(yaw/pitch/roll)와 얼굴 위치·거리를 함께 넣어 회귀가 자세 변화를 흡수합니다.
- 결과 좌표는 1€ 필터로 다듬어, 가만히 볼 때는 흔들리지 않고 크게 움직일 때는 지연이 없습니다.
- 깜빡임 프레임과 잔차가 큰 보정 샘플은 걸러냅니다.

## 기술 스택

- Next.js (Pages Router) + React (JavaScript)
- `@mediapipe/tasks-vision` — FaceLandmarker (홍채 478 랜드마크)
- 자체 구현 릿지 회귀 + 1€ 필터 — 시선 → 화면 좌표 매핑
- Web Speech API — 음성 입력 (실패 시 텍스트 입력 fallback)
- CSS Modules

## 프로젝트 구조

소스는 페이지 단위로 폴더를 나눕니다. 페이지 주소와 폴더 이름이 1:1로 대응하므로,
`/1`을 고칠 때는 `src/f1/`만 보면 됩니다. 여러 페이지가 함께 쓰는 것만 `src/shared/`에 둡니다.

```
scripts/setup-assets.mjs   # MediaPipe wasm·모델을 public/ 으로 준비

src/shared/                # 모든 페이지 공용
  EntryFlowContext.jsx     # 페이지 사이를 잇는 상태 (선택된 카드, 핀, 시선)
  EntryPageShell.jsx       # 배경·로딩·오류·커서·바닥글 공용 셸
  gazeConfig.js            # 상수 (카드 목록, 응시 시간, 투표 설정)
  DreamyBackground.jsx
  GazeReticle.jsx          # 사람별 시선 커서 (ref 로 직접 갱신)
  gaze/                    # 시선 추적 엔진
    useGazeEngine.js       #   웹캠 2대 동시 추적 + 사람별 보정 세션
    faceLandmarker.js      #   MediaPipe 로딩 (로컬 자산 우선, CDN 폴백)
    features.js            #   랜드마크 → 회귀 입력 특징 벡터
    ridge.js               #   릿지 회귀 학습·예측 (이상치 제거 포함)
    oneEuro.js             #   1€ 필터
    calibrationSession.js  #   보정 진행 상태머신 (DOM 비의존)
    participants.js        #   카메라 ↔ 참가자 매핑, 이름, 색

src/calibration/           # /app  카메라 지정 + 보정 + 정확도 측정
  CameraPane.jsx           #       카메라 선택 + 미리보기 + 랜드마크 오버레이
  CalibrationOverlay.jsx   #       단계 대기 화면 + 자동 진행 타깃
src/f1/                    # /1    비전 카드 투표 + 대비 이미지
  VoteStep/                #       두 사람 응시로 카드 선택
  RevealStep/              #       선택된 비전 + 현재 거리 대비
  voteState.js             #       다인 응시 누적 점수 (DOM 비의존)
src/f2/                    # /2    거리뷰 토론
  DiscussionStep/          #       의견 핀 + 공감
  useSpeechInput.js        #       음성 + 텍스트 fallback
  useSpeechOutput.js
  buildFollowUpQuestion.js #       AI 후속 질문 (로컬 대체 로직)
  fetchFollowUpQuestion.js
```
