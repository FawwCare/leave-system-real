# 자동화 — 출장 배정 검토 (Phase 1A 엔진 + Phase 1B 화면)

엔진 3개와 모델은 **순수 함수**(DB 접근 없음), 조회 계층은 **읽기만**(`once`) 합니다. 어떤 파일도 DB에 쓰지 않습니다. Phase 1B부터 `index.html`에 연결되며, 화면은 관리자에게만 보입니다.

| 파일 | 전역 객체 | 역할 |
| --- | --- | --- |
| `staff-identity.js` | `FawwStaffIdentity` | 담당자 문자열 → 승인 직원 UID |
| `trip-dates.js` | `FawwTripDates` | 출장·휴가·업무·외부 일정 날짜 → `{start, end}` (`YYYY-MM-DD`, 양 끝 포함) |
| `conflict-engine.js` | `FawwConflictEngine` | 검사 대상 출장 하나에 대한 직원별 판정 |
| `trip-review-data.js` | `FawwTripReviewData` | 읽기 전용 조회 + 출처별 complete / partial / failed 기록 (1B) |
| `trip-review-model.js` | `FawwTripReviewModel` | 조회 결과 → 화면 목록·요약·출장별 검토 상태 (1B, 순수 함수) |
| `trip-review-view.js` | `FawwTripReview` | 관리자 전용 '자동화 관리 › 출장 배정 검토' 화면 (1B) |

로드 순서: `staff-identity.js` → `trip-dates.js` → `conflict-engine.js` (엔진이 앞의 두 객체를 사용).

테스트: `node tools/automation/test-phase1a.mjs` (엔진 56개), `node tools/automation/test-phase1b.mjs` (조회·모델 24개), `node tools/automation/test-phase1b-ui.mjs` (화면 22개, `tools/mobile-audit` 준비 필요)

## 엔진 입력과 출력

```js
FawwConflictEngine.evaluateTripConflicts({
  users,            // { uid: { displayName, approved } } — 승인 직원만 판정 대상
  aliases,          // { uid: ['별칭'] } — 관리자 전용 경로에서 읽은 값만 주입 (users/{uid} 에 저장 금지)
  targetTrip,       // 검사 대상 출장 (businessTrips 레코드 + id)
  trips, leaves, tasks, externalEvents,   // { id: 레코드 } 또는 배열
  coverage: { trips: true, leaves: true, tasks: true, externalEvents: true }  // 출처별 "검사 기간 전체를 읽었다" 선언
})
// → { target, staff: [{ uid, displayName, level, label, reasons[] }], unattributed[], skippedDuplicates[], coverage, summary }
```

등급: `conflict`(충돌 발견) > `caution`(주의·확인 필요) > `info`(참고) > `clear`(확인된 충돌 없음). "배정 가능" 판정은 없습니다.

## 조회 방식과 완전성 (Phase 1B 구현)

`startDate` 색인이 없고 옛 수동 출장은 `date`만 있어 날짜 범위 조회를 쓰지 않습니다. 출장·휴가·캘린더 일정은 **생성 순서 기준 최신 `한도+1`건**을 한 번 읽고, 한도 이하면 `complete`(전체를 읽음), 넘으면 `partial`(오래된 기록이 남음)입니다. 기간 필터는 읽은 뒤 계산으로 하므로 장기 출장·날짜 형식과 무관하게 누락이 없습니다. 업무는 `todo`·`doing` 상태 조회 두 번이 모두 성공하면 `complete`. 실패·시간 초과(20초)는 `failed`. 한도 기본값: 출장 3,000 · 휴가 5,000 · 캘린더 3,000.

판정 규칙: 확인된 충돌·주의는 데이터가 불완전해도 그대로 표시하고, 근거가 없는 직원은 데이터가 모두 `complete`일 때만 "확인된 충돌 없음", 아니면 "검토 불완전"입니다. 조회 상태는 판정과 별개로 화면 상단에 표시합니다.

## (참고) Phase 1A 때 검토했던 범위 조회 설계

현재 앱은 출장·휴가를 "최근 생성 300건"(`orderByKey().limitToLast(300)`)으로 구독하므로, 검토 기능은 이 데이터를 쓰지 않고 검사 기간만 별도로 한 번 읽습니다.

1. **검사 기간 전체 출장**: `businessTrips.orderByChild('startDate').endAt(검사 종료일)` + `startAt(검사 시작일 - 최대 출장 길이)`.
   - 기간에 걸친 과거 시작 출장: 시작일이 검사 시작일보다 앞서도 끝나는 날이 검사 기간 안이면 포함해야 하므로, 시작 하한을 "검사 시작일 - 허용 최대 기간(예: 31일)"으로 넓혀 읽고 엔진이 겹침으로 거릅니다. 31일보다 긴 출장이 있으면 결과에 "조회 범위 불완전"을 표시합니다.
   - 규칙에 `"businessTrips": { ".indexOn": ["startDate"] }`가 필요합니다. 휴가는 `leaves.orderByChild('date')`와 `".indexOn": ["date"]`.
2. **`startDate`가 없는 옛 기록**: `startDate` 범위 조회에 걸리지 않습니다. 두 가지 중 하나가 필요합니다.
   - (권장) 관리자 도구로 옛 기록에 계산된 `startDate`·`endDate`를 채우는 1회성 보정. DB 쓰기이므로 별도 승인과 백업 후 진행.
   - (보정 전 임시) `startDate` 없는 기록이 남아 있는지 확인해, 1건이라도 있으면 엔진에 `coverage.trips: false`를 넘겨 전원 "주의"로 표시. 필드가 없는 기록만 고르는 조회 방식(`equalTo(null)` 등)이 의도대로 동작하는지는 **Phase 1B에서 에뮬레이터로 검증 필요** (미검증).
3. **과도한 다운로드 방지**: 검사 기간을 최대 62일로 제한하고, 버튼을 눌렀을 때만 `once()`로 읽습니다(실시간 구독 아님). 결과는 화면에만 쓰고 저장하지 않습니다.
4. **실패·누락 시 표시 정책**: 출처 하나라도 조회에 실패하거나 위 2번의 미보정 기록이 있으면 그 출처의 `coverage`를 `false`로 넘깁니다. 엔진은 전원을 "주의"로 표시하고, 화면은 어떤 출처가 불완전한지 맨 위에 보여줍니다. "충돌 없음"은 모든 출처가 `true`일 때만 나옵니다.

## Phase 1B 연결 방법

- `index.html`에 위 3개 파일을 `kanban.js` 다음에 추가합니다 (전역 객체만 만들고 아무것도 실행하지 않음).
- 관리자 전용 탭 스크립트가 버튼 클릭 시 위 조회 설계대로 데이터를 읽어 `evaluateTripConflicts`에 넘기고, 결과의 `staff[]`를 표로 그립니다. 사용자 문자열은 기존 `escapeHTML`로 출력합니다.
- 별칭은 관리자 전용 경로(예: `staffDirectory/{uid}/aliases`, 관리자만 쓰기)를 새로 설계·규칙 테스트한 뒤 주입합니다. 그 전까지는 `aliases: {}`로 호출합니다.
