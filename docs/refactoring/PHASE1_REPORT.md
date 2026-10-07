# 1차 작업 결과보고서 — 기준 버전 확보 · 코드 분석 · 검증 준비

> 범위: 분석/검증 도구 추가만 수행했습니다. 애플리케이션 소스·운영 설정 변경, 파일 이동·삭제, 패키지 변경, 운영 DB/Storage/Google 쓰기는 하지 않았습니다.
> 근거: 모두 첨부된 실제 코드의 **정적 분석**입니다. 실행(브라우저/운영 서비스)으로 재현한 것이 아니므로 "확정"이 아니라 "코드상 확인됨"으로 표기합니다.

## 1. 추가된 파일 (유일한 변경)

| 파일 | 용도 |
|---|---|
| `tools/refactoring/extract-facts.mjs` | DB 경로·리스너·전역 할당·타이머·스토리지 참조 추출 |
| `tools/refactoring/audit-globals.mjs` | 스크립트 로드 순서, 전역 함수 중복 정의, 인라인 핸들러 → 정의 매핑, 미로드 JS 점검 (읽기 전용) |

실행: `node tools/refactoring/audit-globals.mjs`
`git status` 기준 추적 대상 변경은 `tools/` 추가뿐입니다(`node_modules/`는 원래 untracked).

## 2. 실행 구조 (확인됨)

- 로드 순서(`index.html`): Kakao SDK → `config.js` → `kanban.js` → `map.js` → `services.js` → `main.js` → `mobile-calendar.js`. 모두 전역 스크립트(모듈 아님)이며 **순서가 곧 의존성**입니다.
- 인라인 `onclick` 등이 호출하는 전역 함수 약 100개가 모두 로드 파일에 정의되어 있음(미해결 2건 `scale`, `var`은 CSS 문자열 오탐).
- **런타임에 로드되지 않는 JS**: 루트 `config.js`, `main.js`, `kanban_v2.js`, `index.js`(Functions), `gmail_sync_apps_script.js`, `public/services/surveyService.js`. 루트 중복본은 `public/` 본과 내용이 달라 **어느 쪽이 기준인지 혼동 위험**이 있습니다(이전 보고 참조).
- `database.rules.json` / `firebase.json` / Storage 규칙이 **저장소에 없음** → 보안 규칙과 인덱스(`.indexOn`)를 코드로 검증할 수 없습니다.

## 3. 리팩토링 시 반드시 보존해야 할 동작 (특성화 대상)

### 3.1 전역 함수 중복 정의 — 로드 순서에 따라 동작이 결정됨
| 이름 | 정의 위치 | 실제 유효 |
|---|---|---|
| `allowDrop` | `kanban.js:160`(컬럼 하이라이트), `services.js:1268`(단순 `preventDefault`) | **services.js(나중 로드)**. 칸반 하이라이트(`drag-over`)는 인라인 `ondragover`로는 동작하지 않음 |
| `setCalendarFilter` | `kanban.js:965`, `kanban.js:1249` | 뒤의 정의(1249) |
| `switchTab` | `config.js:441`, `index.html:2329`(래핑) | `index.html` 인라인 재할당 |

→ 모듈화 시 "마지막 정의가 이긴다"를 그대로 재현하거나, 의도 확인 후 별도 단계에서 수정해야 합니다.

### 3.2 데이터 계약
- **`tasks` 노드가 다목적**: 업무(`status: todo|doing|done|archived`), 회의 피드(`status:'feed'`), `tasks/dailyRoutine/{settings,logs}`, `tasks/notifications/{uid}`가 한 노드에 공존. 구독은 `orderByChild('status').equalTo(...)` 4종(todo/doing/done(limit 50)/feed)이며 `done`은 **최근 50건만** 로드됩니다.
- **`files`**: 폴더는 `id == key`, 파일 업로드는 `id: Date.now().toString()`로 **key와 다름**(`services.js:839-840`). 읽을 때 `data[key].id = key`로 덮어써서 동작하므로 이 보정은 유지해야 합니다.
- **`leaves`**: 날짜별 1레코드(`{id,uid,userName,date,type(0.5|1),subType,status,timestamp,rejectReason}`), 상태 `pending|approved|rejected|cancel_requested`(+표시 전용 `canceled`). 승인된 취소요청 → 레코드 **삭제**, 반려된 취소요청 → `approved` 복귀 + `rejectReason` 기록.
- 담당자 `assignee`는 **표시 이름의 쉼표 연결 문자열**(UID 아님). 이름 변경 시 매칭이 깨지는 구조(`mypage`는 부분 문자열 매칭).
- 알림은 클라이언트가 **타인 UID 경로에 직접 write**(`tasks/notifications/{targetUid}`).

## 4. 코드상 확인된 위험 (우선순위 순)

> 수정하지 않았습니다. 각 항목은 후속 단계에서 "동작 보존 vs 버그 수정"을 사용자와 확정해야 합니다.

### A. 데이터 유실/오염 가능성 (높음)
1. **구글 일정 동기화가 `external_events`를 통째로 `set`** (`services.js:2128`).
   - 앱에서 외부 일정의 담당자/상태/유형을 수정해도 **10분마다(또는 연동 시) 초기값(`assignee:'FAWW 연동'`, `status:'todo'`)으로 덮어씀**. 구글로 되돌려 보내는 필드는 title/description/날짜/장소뿐.
   - 조회 구간(-3개월~+6개월) 밖의 일정은 DB에서 삭제됨. `events.list` **페이지네이션 처리 없음**(기본 250건) → 초과분은 누락 후 `set`으로 DB에서 사라짐. `data.items`가 비면 `{}`로 전체 삭제.
2. **앱에서 구글 일정 편집 시 구글 원본 변형** (`services.js:3329-3384`): 가져올 때 제목을 `' [HH:MM] 제목'`으로 만들고, 저장 시 이 문자열을 `summary`로 PUT, 날짜는 **종일 일정으로 변환**. 시간 일정이 종일로 바뀌고 제목에 시간/공백이 누적될 수 있음.
3. **출장 → 구글 → 다시 `external_events`** 순환 (`syncTripToGoogleCalendar` 후 `fetchGoogleCalendarEvents`): 같은 출장이 `trips`와 `external_events` 양쪽에 나타날 수 있음. 설명의 `[FaWW 출장연동 ID]` 태그가 사라지면 다음 동기화 때 중복 생성.
4. **연차 잔여 계산이 최근 300건(`limitToLast(300)`) 기준** (`services.js:532`): 누적 휴가 레코드가 300건을 넘으면 오래된 사용분이 계산에서 빠져 잔여가 부풀려짐. 같은 이유로 관리자 전체내역/CSV도 300건 한정.
5. **연차 총량 기본값 불일치**: `renderLeaveUI`/CSV는 `leaveTotal || 15`(0이면 15로 표시), `renderAdminLeaves`는 `leaveTotal → totalLeave → 15`. 총량을 0으로 설정한 사용자는 화면마다 값이 다름.
6. **일일 루틴 로그 구독이 로드 시점 날짜에 고정** (`kanban.js:2308-2311`): 탭을 켜둔 채 자정이 지나면 읽기는 어제 경로, 쓰기(`toggleDailyTask`)는 오늘 경로 → 체크해도 화면 반영 안 됨.

### B. 보안 (높음~중간)
7. **미이스케이프 HTML 삽입(XSS)**: 업무 제목, 공지 제목/작성자, 알림 title/message, **Gmail 동기화로 들어오는 `summary/title/sender`**(`services.js:693-706`), 휴가 `userName` 등. `escapeHTML`은 채팅에만 적용. 메일 본문 요약이 외부 입력이므로 경로가 실재. `openArchiveModal`은 제목을 인라인 `onclick` 문자열에 직접 삽입(따옴표 처리 불완전).
8. **Google OAuth 액세스 토큰을 `localStorage`에 저장**(`services.js:1942`)하며 `calendar` 전체 범위 → 7번과 결합 시 탈취 영향 큼.
9. **`linkGoogleCalendar`가 `signInWithPopup`** 사용(`services.js:1926`): 현재 로그인 계정이 아닌 다른 계정을 선택하면 **Firebase 로그인 계정이 교체**되고, 계정 불일치 검사는 그 이후에 수행됨(알림 후 return만 함).
10. **`users` 전체 노드 구독**(`services.js:1196`, `main.js:330` — **중복 2개**): `savedProposals` 등 사용자별 하위 데이터까지 모든 클라이언트가 내려받음(규칙이 허용하는 경우).
11. 관리자 함수(`adminResolveLeave`, `adminDeleteLeave`, `submitAdminAddLeave`, `adminEditTotalLeave`)는 함수 내부 권한 검사가 없고 **UI 노출에만 의존**. 실제 방어는 DB 규칙이 담당하나 규칙이 저장소에 없어 확인 불가.
12. 채팅 3일 경과 메시지는 화면에서만 숨기고 **DB에는 영구 보존**(정리 코드/함수 없음).

### C. 신뢰성/성능 (중간)
13. 모든 DB 리스너가 스크립트 최상단에서 인증 전에 등록되고 해제 로직이 없음. `viewNotice`마다 `notices/{id}/likes` 리스너가 추가되고 `off()` 없음.
14. 공지 조회수는 `set(views+1)` 비원자적(동시 조회 시 유실), 조회자 모두가 `notices/*/views`에 쓰기 권한 필요.
15. 날짜 처리: `new Date('YYYY-MM-DD')`(UTC 자정) 후 로컬 `getDay/getDate` 혼용. KST에서는 정상이나 **`toISOString().slice(0,10)`**(`services.js:352, 507`)는 KST 00:00~09:00에 **전날 날짜**를 기본값/CSV 파일명으로 사용.
16. `fetchGoogleCalendarEvents`가 연동 직후 **2회 연속 호출**(`services.js:1945, 1955`). `timeMax`는 말일 0시라 말일 일정 제외 가능.
17. 휴가 신청에 **중복 날짜/주말·공휴일 검증 없음**(주말만 범위 신청에서 제외, 공휴일 미처리). 관리자 직권 등록은 버튼 비활성화도 없음.

## 5. 검증 준비 상태

- 빌드: `vite build` 성공(환경변수 `%VITE_*%` 미설정 경고는 로컬 `.env` 부재 때문, 운영 값은 건드리지 않음).
- 기준 산출물: 베이스라인 `dist`(scratch/dist-baseline) 보존 → 이후 단계에서 산출물 해시/구조 비교 가능.
- 정적 사실표: `scratch/facts.json|txt`, `scratch/audit.txt`.
- **아직 없는 것(2차에서 필요)**: 브라우저 스모크 테스트, Firebase 에뮬레이터(Auth/RTDB/Storage) 기반 특성화 테스트. 운영 DB를 쓰지 않으려면 에뮬레이터와 `firebase.json`/규칙 파일 확보가 선행되어야 합니다.

## 6. 이전 설명과 코드의 차이

- 루트의 `config.js`/`main.js`/`kanban_v2.js`는 배포 경로(`public/`)와 다르며 **로드되지 않는 사본**입니다.
- "채팅 3일 초기화"는 실제 삭제가 아니라 **표시 필터**입니다.
- 휴가 "취소 승인"은 상태 변경이 아니라 **레코드 삭제**이며, `canceled` 상태는 코드가 쓰지 않습니다(표시 분기만 존재).

## 7. 후속 단계 전 확인이 필요한 결정

1. 위 4.A의 항목(구글 동기화 덮어쓰기, 300건 제한, `|| 15`)을 **리팩토링과 분리해 별도 버그 수정 단계**로 둘지.
2. `allowDrop` 중복 처럼 "현재 동작"과 "의도"가 다른 곳을 **현재 동작 그대로** 보존할지.
3. Firebase 보안 규칙·인덱스 파일을 읽기 전용으로 제공받을 수 있는지(Console 내보내기).
4. 에뮬레이터 기반 테스트 환경 구성 허용 여부.
