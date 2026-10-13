# 모바일 화면 점검 도구

빌드된 `dist`를 **가짜 Firebase(메모리 전용, 네트워크 없음)**로 띄워 탭별 스크린샷을 찍고 화면 문제를 측정합니다. 실제 DB에는 연결하지 않습니다.

준비: `cd tools/mobile-audit && npm install` → 프로젝트 루트에서 `npx vite build`

실행: `node tools/mobile-audit/shoot.mjs` (결과: `/tmp/shots`)

| 환경변수 | 의미 |
|---|---|
| `W`, `H` | 화면 크기 (기본 390×844, 갤럭시는 360×780) |
| `TABS` | 찍을 탭 (예: `tab-tasks,tab-calendar`) |
| `THEME=dark` | 다크 모드로 촬영 |
| `CONTRAST=1` | 글자 대비 측정 → `contrast.json` |
| `NOANIM=1` | 애니메이션 끄기 (전후 픽셀 비교용) |
| `NET=lte` | 느린 모바일 네트워크 흉내 (서버별 연결 비용·대역폭) |
| `SLOW_ICON_MS` | 아이콘 글꼴 응답 지연 (ms) |
| `DIST`, `BASE` | 다른 빌드 폴더 / 배포 하위 경로(예: `/leave-system-real`) |
| `OUT` | 결과 폴더 |

항상 기록되는 것: `overflow.json`(화면 밖으로 넘치는 요소).
