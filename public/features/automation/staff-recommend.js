/**
 * FaWW 자동화 — 확정 피지컬케어 출장의 내부 직원 조합 추천 (순수 함수, 읽기 전용, 저장·배정 변경 없음)
 * 의존: FawwStaffRoster, FawwScheduleParse, FawwTripDates
 *
 * 필수 제외(후보에서 뺌): 같은 날짜의 다른 확정 출장(시간 무관, 여러 날 출장은 모든 날짜), 승인된 종일 휴가,
 *                       캘린더 휴가 일정, 근무 불가 일정(학교 시험·파견·상주), 같은 날 특수 강의
 * 주의만: 조율중 출장, 반차·승인 대기 휴가, 회의·분류 불명 일정, 상태 표기 없는 출장성 일정
 * 필요 인원: 2명 이상 기록만 확정으로 본다. 1명 기록은 메일 자동 등록 기본값일 수 있어 '미확인', 기록 없음도 '미확인'.
 *           미확인이면 조합 크기를 정하지 않고 후보 순위만 보여준다.
 * 추천 순서: ① 필수 조건 충족 ② 전날·다음 날 확정 출장(같은 직원 연속 운영) — 지역은 주소·제목 글자로만 비교, 거리 계산 없음
 *           ③ 주의 항목 적은 순 ④ 출장 횟수 균형(보조)
 * 브라우저: window.FawwStaffRecommend.build(input)
 */
(function (root) {
    'use strict';

    // 지역 판정: 주소 우선, 없으면 제목. 경기도 광주시와 광주광역시를 구분하고, 구분할 수 없으면 미확정(null).
    // 광역·특별시는 시 단위, 도는 '도 + 시·군' 단위로 비교한다. 도만 알면 범위가 넓어 '같은 지역'으로 보지 않는다.
    var METRO = { '서울': ['서울특별시', '서울시', '서울'], '부산': ['부산광역시', '부산'], '대구': ['대구광역시', '대구'], '인천': ['인천광역시', '인천'],
        '광주광역시': ['광주광역시'], '대전': ['대전광역시', '대전'], '울산': ['울산광역시', '울산'], '세종': ['세종특별자치시', '세종시', '세종'] };
    var PROV = { '경기': ['경기도', '경기'], '강원': ['강원특별자치도', '강원도', '강원'], '충북': ['충청북도', '충북'], '충남': ['충청남도', '충남'], '전북': ['전북특별자치도', '전라북도', '전북'],
        '전남': ['전라남도', '전남'], '경북': ['경상북도', '경북'], '경남': ['경상남도', '경남'], '제주': ['제주특별자치도', '제주도', '제주'] };
    // 제목에 자주 나오는 시·군 (도 이름 없이 쓰여도 소속이 하나뿐인 곳만)
    var CITY_PROV = { '수원': '경기', '성남': '경기', '이천': '경기', '용인': '경기', '고양': '경기', '화성': '경기', '평택': '경기', '창원': '경남', '김해': '경남', '거제': '경남', '하동': '경남',
        '포항': '경북', '구미': '경북', '전주': '전북', '정읍': '전북', '청주': '충북', '천안': '충남', '나주': '전남', '여수': '전남', '순천': '전남' };
    var GWANGJU_GU = /^(동구|서구|남구|북구|광산구)$/;
    function aliasKey(map, word) { var k = null; Object.keys(map).forEach(function (key) { if (map[key].indexOf(word) !== -1) k = key; }); return k; }
    function cityName(w) { return /^[가-힣]{1,6}(시|군)$/.test(w) ? w : null; }
    /** 주소 문자열 → { key, coarse } 또는 null(미확정) */
    function regionFromAddress(addr) {
        var t = String(addr || '').replace(/[(),]/g, ' ').trim().split(/\s+/).filter(Boolean);
        if (!t.length) return null;
        var t0 = t[0], t1 = t[1] || '';
        if (t0 === '광주광역시') return { key: '광주광역시', coarse: false };
        if (t0 === '광주시') return { key: '경기 광주시', coarse: false };
        if (t0 === '광주') { if (GWANGJU_GU.test(t1)) return { key: '광주광역시', coarse: false }; if (t1 === '광주시' || /(읍|면)$/.test(t1)) return { key: '경기 광주시', coarse: false }; return null; }
        var m = aliasKey(METRO, t0); if (m) return { key: m, coarse: false };
        var p = aliasKey(PROV, t0);
        if (p) { var c = cityName(t1); return c ? { key: p + ' ' + c, coarse: false } : { key: p, coarse: true }; }
        var c0 = cityName(t0); if (c0) { var base = c0.replace(/(시|군)$/, ''); return { key: (CITY_PROV[base] ? CITY_PROV[base] + ' ' : '') + c0, coarse: false }; }
        return null;
    }
    /** 제목 문자열 → { key, coarse } 또는 null. '광주' 단독은 구분 불가로 null */
    function regionFromTitle(title) {
        var s = String(title || '');
        if (/광주광역시/.test(s)) return { key: '광주광역시', coarse: false };
        if (/경기(도)?\s*광주/.test(s)) return { key: '경기 광주시', coarse: false };
        var keys = Object.keys(METRO).filter(function (k) { return k !== '광주광역시'; });
        for (var i = 0; i < keys.length; i++) if (METRO[keys[i]].some(function (a) { return a.length >= 2 && s.indexOf(a) !== -1; })) return { key: keys[i], coarse: false };
        var cities = Object.keys(CITY_PROV);
        for (var j = 0; j < cities.length; j++) if (s.indexOf(cities[j]) !== -1) return { key: CITY_PROV[cities[j]] + ' ' + cities[j] + (cities[j] === '하동' ? '군' : '시'), coarse: false };
        return null;
    }
    /** 일정의 지역: 주소 우선 → 제목. { key, coarse, source } 또는 null */
    function regionInfo(place, title) {
        var a = regionFromAddress(place); if (a) return Object.assign({ source: '주소' }, a);
        var t = regionFromTitle(title); if (t) return Object.assign({ source: '제목' }, t);
        return null;
    }
    /** 단일 문자열의 지역 키 (주소 형식 우선 해석). 미확정이면 null */
    function regionOf(text) { var r = regionFromAddress(text) || regionFromTitle(text); return r ? r.key : null; }
    var CATEGORY_ORDER = ['serious', 'staffing', 'vehicle', 'ok'];
    var CATEGORY_LABEL = { serious: '심각한 충돌', staffing: '직원 미배정·부분 배정·확인 필요', vehicle: '차량 미배정', ok: '정상 (조회 범위 기준)' };

    function addDays(ymd, n) {
        var p = ymd.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    function coreName(t) { return String(t || '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').toLowerCase(); }
    function list(x) { return Object.keys(x || {}).map(function (k) { return Object.assign({ id: k }, x[k], { id: (x[k] && x[k].id) || k }); }); }
    function combos(arr, k) {
        var out = [];
        (function rec(start, cur) { if (cur.length === k) { out.push(cur.slice()); return; } for (var i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); } })(0, []);
        return out;
    }
    /** 캘린더 동기화 끝 (Apps Script: 이번 달 기준 6개월 뒤 말일) */
    function calendarHorizon(today) { var p = today.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1 + 7, 0)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

    function build(input) {
        var R = root.FawwStaffRoster, P = root.FawwScheduleParse, TD = root.FawwTripDates;
        input = input || {};
        var today = input.today, horizon = input.calendarHorizonEnd || calendarHorizon(today);
        var acc = R.matchAccounts(input.users || {});
        var tripList = list(input.trips), extList = list(input.externalEvents), leaveList = list(input.leaves);
        var tripIds = {}; tripList.forEach(function (t) { tripIds[t.id] = t; });
        var leaveIds = {}; leaveList.forEach(function (l) { leaveIds[l.id] = true; });
        var linked = {};   // tripId → 캘린더 일정
        var items = [];

        // 출장의 직원은 제목의 이름 묶음((동휘,성진), 강현/성진)에서만 읽는다 (설계서 3.1). 묶음이 없으면 '미배정'.
        // 메일 자동 등록의 assignee 는 고객사 담당자일 수 있어 배정으로 보지 않는다(참고 표시만).
        // 휴가·근무 불가·회의·분류 불명 일정만 본문 이름 찾기를 쓴다 (예: '김동휘 학교 시험').
        function resolvePeople(parsed, fallbackText) {
            var keys = [], unknown = [], ambiguous = [];
            var push = function (k) { if (keys.indexOf(k) === -1) keys.push(k); };
            // 괄호·슬래시 묶음 중 직원 별칭이 하나라도 있는 묶음만 '이름 묶음'으로 본다.
            // 별칭이 하나도 없는 묶음: 출장이면 미확인 이름(외부 인력 등)으로 보고, 그 밖의 일정이면 '(사내공지)' 같은 안내 문구로 본다.
            var annotations = [];
            parsed.groups.forEach(function (g) {
                var rs = g.tokens.map(function (tk) { return R.resolveToken(tk); });
                var isNameGroup = rs.some(function (r) { return r.status === 'matched' || r.status === 'ambiguous'; });
                if (!isNameGroup && fallbackText) { annotations.push(g.text); return; }
                rs.forEach(function (r) {
                    if (r.status === 'matched') push(r.key); else if (r.status === 'ambiguous') ambiguous.push(r.token); else if (r.status === 'unknown') unknown.push(r.token);
                });
            });
            var source = keys.length || unknown.length ? 'title' : null;
            // 휴가·근무 불가·회의·분류 불명 일정: 안내 문구를 뺀 본문에서도 직원 이름을 찾는다 (예: '(사내공지) 김동휘 학교 시험')
            if (fallbackText && !parsed.explicitUnassigned) {
                var body = String(fallbackText);
                annotations.forEach(function (a) { body = body.split(a).join(' '); });
                var before = keys.length;
                R.findNamesInText(body).forEach(push);
                if (keys.length > before) source = source ? 'title+text' : 'text';
            }
            return { keys: keys, unknown: unknown, ambiguous: ambiguous, source: source };
        }

        extList.forEach(function (e) {
            var d = String(e.description || ''), tm = /\[FaWW 출장연동 ID:\s*([^\]\s]+)\]/.exec(d), lm = /\[FaWW 휴가연동 ID:\s*([^\]\s]+)\]/.exec(d);
            if (tm && tripIds[tm[1]]) { linked[tm[1]] = e; return; }
            if (lm && leaveIds[lm[1]]) return;
            var parsed = P.parseTitle(e.title), cls = P.classify(parsed, d);
            items.push({ id: 'cal:' + e.id, src: 'calendar', calendarId: e.id, raw: e.title || '', parsed: parsed, kind: cls.kind, half: !!cls.half, reason: cls.reason || '',
                status: parsed.status, period: TD.normalizePair(e.startDate, e.dueDate || e.endDate), place: e.location || '',
                people: resolvePeople(parsed, (cls.kind === 'trip' || cls.kind === 'special_lecture') ? '' : parsed.body) });
        });
        tripList.forEach(function (t) {
            var ev = linked[t.id], title = ev ? ev.title : t.name, parsed = P.parseTitle(title), cls = P.classify(parsed, '');
            items.push({ id: 'trip:' + t.id, src: ev ? 'trip+calendar' : 'trip', tripId: t.id, calendarId: ev ? ev.id : null, raw: title || '', parsed: parsed,
                kind: cls.kind === 'special_lecture' ? 'special_lecture' : 'trip', status: t.status || parsed.status, period: TD.normalizeTripPeriod(t),
                place: t.address || '', requiredPersonnel: t.requiredPersonnel, author: t.author || '', mailAssignee: t.assignee || '', people: resolvePeople(parsed, '') });
        });
        // 연결 ID 없이 같은 날 같은 이름인 출장·캘린더 일정 → 같은 일정일 가능성 (확정하지 않고 표시, 중복 집계 방지)
        items.forEach(function (a) {
            if (a.src !== 'calendar' || a.kind !== 'trip' || a.period.status !== 'ok') return;
            items.forEach(function (b) {
                if (b.src === 'calendar' || b.period.status !== 'ok' || b.period.start !== a.period.start) return;
                var ca = coreName(a.raw), cb = coreName(b.raw);
                if (ca && cb && (ca === cb || ca.indexOf(cb) !== -1 || cb.indexOf(ca) !== -1)) { a.possibleDup = b.id; b.possibleDup = a.id; }
            });
        });
        leaveList.forEach(function (l) {
            var key = null; acc.people.forEach(function (p) { if (p.uid && p.uid === l.uid) key = p.key; });
            items.push({ id: 'leave:' + l.id, src: 'leave', kind: 'dbleave', status: l.status, half: Number(l.type) === 0.5 || /0\.5/.test(String(l.subType || '')), subType: l.subType,
                period: TD.normalizeDay(l.date), people: { keys: key ? [key] : [], unknown: key ? [] : [l.userName || l.uid || '?'], ambiguous: [] }, raw: '휴가 ' + (l.userName || ''), place: '' });
        });

        // 사람별 점유 판단
        function effect(it) {
            if (it.kind === 'trip') {
                if (it.status === '확정') return { level: 'hard', why: '확정 출장' };
                if (it.status === '출장') return { level: 'hard', why: '출장 일정([출장] 표기, 상태 확인 필요)' };
                if (it.status === '조율중') return { level: 'caution', why: '조율 중 출장' };
                if (it.status === '취소') return null;
                return { level: 'caution', why: '상태 표기 없는 출장성 일정' };
            }
            if (it.kind === 'special_lecture') return it.status === '취소' ? null : { level: 'hard', why: '특수 강의' };
            if (it.kind === 'dbleave') {
                if (it.status === 'approved') return it.half ? { level: 'caution', why: '승인된 반차 — 확정 배정 전 검토 필요' } : { level: 'hard', why: '승인된 종일 휴가' };
                if (it.status === 'pending' || it.status === 'cancel_requested') return { level: 'caution', why: (it.status === 'pending' ? '승인 대기 휴가' : '취소 대기 휴가') + ' — 확정 배정 전 검토 필요' };
                return null;
            }
            if (it.kind === 'leave') return it.half ? { level: 'caution', why: '캘린더 반차 일정 — 확정 배정 전 검토 필요' } : { level: 'hard', why: '캘린더 휴가 일정' };
            if (it.kind === 'unavailable') return { level: 'hard', why: '근무 불가 일정(' + (it.reason || '') + ')' };
            if (it.kind === 'meeting') return { level: 'caution', why: '회의 일정(근무 가능 여부 근거 부족)' };
            return { level: 'caution', why: '분류 확인 필요 일정' };
        }
        function blockers(key, period, exclude) {
            var hard = [], caution = [];
            items.forEach(function (it) {
                if (it.id === exclude) return;   // 연동 ID 로 증명된 같은 일정은 이미 하나로 합쳐져 있음. 비슷한 일정은 별개로 검사
                if (it.period.status !== 'ok' || !TD.overlaps(period, it.period) || it.people.keys.indexOf(key) === -1) return;
                var ef = effect(it); if (!ef) return;
                (ef.level === 'hard' ? hard : caution).push({ id: it.id, why: ef.why, title: it.raw, date: it.period.start === it.period.end ? it.period.start : it.period.start + '~' + it.period.end, possibleDup: !!it.possibleDup });
            });
            return { hard: hard, caution: caution };
        }
        var itemsById = {}; items.forEach(function (it) { itemsById[it.id] = it; });
        function hardTripsOn(key, day) {
            return items.filter(function (it) { var ef = effect(it); return it.kind === 'trip' && ef && ef.level === 'hard' && it.period.status === 'ok' && it.people.keys.indexOf(key) !== -1 && it.period.start <= day && day <= it.period.end; });
        }

        var cov = input.coverage || {};
        var sourcesIncomplete = ['trips', 'leaves', 'externalEvents', 'users'].filter(function (k) { return !cov[k] || cov[k].status !== 'complete'; });
        var accountIssues = acc.people.filter(function (p) { return p.status !== 'ok'; });

        var targets = items.filter(function (it) {
            // 연결 ID 없는 중복 가능 일정도 목록에 남기고 확인 필요로 표시 (같은 일정이라고 확정하지 않음)
            return it.kind === 'trip' && it.status === '확정' && it.period.status === 'ok' && it.period.end >= today;
        }).map(function (it) {
            var period = it.period, notes = [], problems = [];
            // 필요 인원
            var req = { known: false, n: null, note: '' };
            var n = parseInt(it.requiredPersonnel, 10);
            if (it.src !== 'calendar' && n >= 2) req = { known: true, n: n, note: '' };
            else if (it.src !== 'calendar' && n === 1) req.note = '1명으로 기록됨 — 메일 자동 등록의 기본값일 수 있어 확인 필요';
            else req.note = '요청 인원 기록 없음';
            // 현재 배정
            var assigned = it.people.keys.slice();
            var assignedOk = assigned.filter(function (k) { return acc.byKey[k] && acc.byKey[k].status === 'ok'; });
            assigned.filter(function (k) { return assignedOk.indexOf(k) === -1; }).forEach(function (k) { problems.push(acc.byKey[k].label + ' 계정 ' + (acc.byKey[k].status === 'ambiguous' ? '여러 개' : '없음/미승인') + ' — 확인 필요'); });
            it.people.unknown.forEach(function (u) { problems.push('"' + u + '" — 내부 직원으로 확인되지 않음 (외부 인력·미등록 가능)'); });
            it.people.ambiguous.forEach(function (u) { problems.push('"' + u + '" — 여러 직원에 해당'); });
            if (!it.parsed.groups.length && !it.parsed.explicitUnassigned) notes.push('제목에 직원 표기 없음 → 직원 미배정으로 봄 (원본 제목 확인 권장)');
            if (it.mailAssignee) notes.push('메일 기록 담당자: ' + it.mailAssignee + ' (고객사 담당자일 수 있어 배정으로 보지 않음)');
            if (it.possibleDup) notes.push('연결 ID 없이 같은 날 같은 이름의 일정이 있음 — 같은 일정일 수 있어 확인 필요');
            // 배정된 직원의 필수 충돌
            var serious = [];
            assignedOk.forEach(function (k) {
                var b = blockers(k, period, it.id);
                b.hard.forEach(function (h) {
                    var dup = it.possibleDup === h.id ? ' — 같은 일정일 수 있음(연결 ID 없음), 확인 필요' : '';
                    serious.push(acc.byKey[k].label + ': ' + h.why + ' — ' + h.title + ' (' + h.date + ')' + dup);
                });
            });
            // 후보
            var rInfo = regionInfo(it.place, it.raw), region = rInfo ? rInfo.key + ' (' + rInfo.source + ' 기준' + (rInfo.coarse ? ', 범위 넓음' : '') + ')' : null;
            var candidates = [], excluded = [];
            acc.people.forEach(function (p) {
                if (p.status !== 'ok' || assigned.indexOf(p.key) !== -1) return;
                var b = blockers(p.key, period, it.id);
                if (b.hard.length) { excluded.push({ key: p.key, label: p.label, reasons: b.hard }); return; }
                // 연속 출장 유지와 이동 동선을 분리해 평가한다 (설계서 4.2, v2 최종 보완).
                //  - 연속 출장: 전날·다음 날 같은 직원의 확정 출장이 있으면 지역과 무관하게 인정 (같은 직원·차량 연속 운영)
                //  - 이동 동선: 두 지역이 주소·제목으로 확인되고 같을 때만 '동선 유리'. 다르거나 불명확하면 '확인 필요', 점수 없음
                //  - 이 평가는 충돌·근무 불가 검사를 통과한 후보에만 적용된다 (위에서 hard 가 있으면 이미 제외)
                var reasons = [], routeScore = 0, continuityScore = 0;
                var adjacent = [];   // 화면 표시용 구조화 근거 (점수·순위 계산에는 쓰지 않음)
                [['전날', addDays(period.start, -1)], ['다음 날', addDays(period.end, 1)]].forEach(function (pair) {
                    hardTripsOn(p.key, pair[1]).forEach(function (t) {
                        continuityScore += 1;
                        var veh = t.parsed && t.parsed.vehicles.length ? ' (그날 ' + t.parsed.vehicles.join('·') + ' 사용 — 같은 차량 연속 사용 검토)' : '';
                        reasons.push('연속 출장: ' + pair[0] + ' 확정 출장 ' + t.raw + ' — 같은 직원 연속 배정 후보 (실제 이동 가능 여부는 별도 확인)' + veh);
                        var other = regionInfo(t.place, t.raw);
                        var adj = { dir: pair[0], tripId: t.id, title: t.raw, date: t.period.start, vehicles: (t.parsed && t.parsed.vehicles) || [], route: { status: 'unknown', from: other ? other.key : null, to: rInfo ? rInfo.key : null } };
                        adjacent.push(adj);
                        if (rInfo && other && !rInfo.coarse && !other.coarse && rInfo.key === other.key) {
                            routeScore += 2;   // 검증된 같은 지역일 때만 동선 점수
                            adj.route.status = 'same';
                            reasons.push('이동 동선: 같은 지역(' + rInfo.key + ', ' + (other.source === rInfo.source ? rInfo.source : other.source + '·' + rInfo.source) + ' 기준) — 동선상 이점 가능 (실제 이동 시간은 미확인)');
                        } else if (rInfo && other && rInfo.key !== other.key && !rInfo.coarse && !other.coarse) {
                            adj.route.status = 'different';
                            reasons.push('이동 동선: ' + other.key + ' → ' + rInfo.key + ' (다른 지역, 거리·시간 미확인) — 동선 확인 필요 (이동 가능성·효율 미검증)');
                        } else {
                            adj.route.status = (!rInfo || !other) ? 'unknown' : 'coarse';
                            reasons.push('이동 동선 확인 필요 (' + (!rInfo || !other ? '지역 정보 부족' : '지역 범위가 넓어 판단 불가') + ')');
                        }
                    });
                });
                var score = routeScore * 10 + continuityScore;
                var load = items.filter(function (x) { var ef = effect(x); return x.kind === 'trip' && ef && ef.level === 'hard' && x.period.status === 'ok' && x.people.keys.indexOf(p.key) !== -1 && x.period.end >= addDays(period.start, -14) && x.period.start <= addDays(period.end, 14); }).length;
                candidates.push({ key: p.key, label: p.label, score: score, routeScore: routeScore, continuityScore: continuityScore, cautions: b.caution, reasons: reasons, load: load, adjacent: adjacent });
            });
            // 순서: 이동 동선 > 연속 출장 > 주의 적음 > 출장 수 균형(보조)
            candidates.sort(function (a, b) { return b.routeScore - a.routeScore || b.continuityScore - a.continuityScore || a.cautions.length - b.cautions.length || a.load - b.load || a.label.localeCompare(b.label); });
            var need = req.known ? Math.max(0, req.n - assignedOk.length) : null, recs = [], shortage = false;
            if (need) {
                var pool = candidates.slice(0, 9), k = Math.min(need, pool.length);
                shortage = pool.length < need;
                recs = k > 0 ? combos(pool, k).map(function (c) {
                    var sum = function (f) { return c.reduce(function (s, x) { return s + f(x); }, 0); };
                    return { members: c, route: sum(function (x) { return x.routeScore; }), continuity: sum(function (x) { return x.continuityScore; }), score: sum(function (x) { return x.score; }), cautions: sum(function (x) { return x.cautions.length; }), load: sum(function (x) { return x.load; }) };
                }).sort(function (a, b) { return b.route - a.route || b.continuity - a.continuity || a.cautions - b.cautions || a.load - b.load; }).slice(0, 3) : [];
            }
            // 범위·식별 한계
            var limits = [];
            if (sourcesIncomplete.length) limits.push('조회 불완전: ' + sourcesIncomplete.join(', '));
            if (period.end > horizon) limits.push('캘린더 동기화 범위(' + horizon + ' 까지) 밖 — 캘린더 일정 미반영');
            var unidentified = items.filter(function (x) { return (x.kind === 'leave' || x.kind === 'unavailable') && x.period.status === 'ok' && TD.overlaps(period, x.period) && !x.people.keys.length; });
            if (unidentified.length) limits.push('같은 기간 근무 불가 일정 ' + unidentified.length + '건의 직원을 식별하지 못함');
            if (accountIssues.length) limits.push('명부 중 계정 확인 필요 ' + accountIssues.map(function (p) { return p.label; }).join(', ') + ' — 후보에서 제외됨');
            var staffingIssue = !req.known || assignedOk.length < (req.n || 0) || problems.length > 0;
            var category = serious.length ? 'serious' : (staffingIssue ? 'staffing' : (!it.parsed.vehicles.length ? 'vehicle' : 'ok'));
            return {
                id: it.id, tripId: it.tripId || null, calendarId: it.calendarId || null, src: it.src, raw: it.raw, period: period, place: it.place, region: region,
                vehicles: it.parsed.vehicles, required: req, mailAssignee: it.mailAssignee || '', assigned: assignedOk.map(function (k) { return acc.byKey[k].label; }), assignedKeys: assignedOk,
                explicitUnassigned: it.parsed.explicitUnassigned, problems: problems, serious: serious, notes: notes, category: category, categoryLabel: CATEGORY_LABEL[category],
                need: need, shortage: shortage, recommendations: recs, candidates: candidates, excluded: excluded, limits: limits, reviewComplete: limits.length === 0
            };
        });
        targets.sort(function (a, b) { return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || (a.period.start < b.period.start ? -1 : a.period.start > b.period.start ? 1 : 0); });
        return { today: today, calendarHorizonEnd: horizon, targets: targets, accounts: acc, accountIssues: accountIssues, unrostered: acc.unrostered,
                 sourcesIncomplete: sourcesIncomplete, excludedSpecial: items.filter(function (x) { return x.kind === 'special_lecture' && x.status === '확정'; }).length };
    }

    root.FawwStaffRecommend = { build: build, regionOf: regionOf, regionInfo: regionInfo, calendarHorizon: calendarHorizon, CATEGORY_LABEL: CATEGORY_LABEL };
})(typeof window !== 'undefined' ? window : this);
