// Firebase RTDB 보안 규칙 테스트 (보안 1차)
// - 로컬 Emulator + demo 프로젝트 전용. 운영 DB에는 절대 연결하지 않는다.
// - 프로젝트 루트의 실제 database.rules.json 을 그대로 로드한다 (복사본·완화본 사용 금지).
// 실행: cd tools/security-rules && npm test
//   (= firebase emulators:exec --only database --project demo-leave-system "node test-security-rules.mjs")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove } from 'firebase/database';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.resolve(__dirname, '../../database.rules.json');
const PROJECT_ID = 'demo-leave-system';

if (!PROJECT_ID.startsWith('demo-')) throw new Error('demo- 프로젝트만 허용');
const hostPort = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!hostPort) {
    console.error('FIREBASE_DATABASE_EMULATOR_HOST 가 없습니다. emulators:exec 로 실행하세요. (운영 DB 연결 방지)');
    process.exit(2);
}
const [host, port] = hostPort.split(':');

const ADMIN = 'jaGugunGReXytCgbqYwQUybxyJL2';
const SECOND_ADMIN_IN_CONFIG = 'hiPMcfj1OvWuq6PjedfPFvOLxlp2'; // config.js ADMIN_UIDS 2번째
const EMAIL_ADMIN_UID = 'uEmailAdmin'; // contact@faww.co.kr 로 로그인한 계정 (UID 는 임의)
const ADMIN_EMAIL = 'contact@faww.co.kr';
const APPROVED = 'uApproved';
const PENDING = 'uPending';
const LEGACY = 'uLegacy';   // totalLeave 필드를 가진 기존 사용자
const NEWBIE = 'uNew';      // 프로필이 아직 없는 사용자
const OTHER = 'uOther';

const BUSINESS_PATHS = ['tasks', 'leaves', 'businessTrips', 'files', 'consumables', 'consumablesLog',
    'external_events', 'tripVehicles', 'businessCommunications', 'chatMessages', 'notices', 'privateChats'];

const rules = fs.readFileSync(RULES_PATH, 'utf8');
const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules, host, port: Number(port) },
});

async function seed() {
    await testEnv.clearDatabase();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.database();
        await set(ref(db), {
            users: {
                [ADMIN]: { displayName: 'Admin', approved: true, leaveTotal: 15 },
                [APPROVED]: { displayName: 'A', approved: true, leaveTotal: 15, department: 'team1_member' },
                [PENDING]: { displayName: 'P', approved: false, leaveTotal: 15, department: 'unassigned' },
                [LEGACY]: { displayName: 'L', approved: true, leaveTotal: 15, totalLeave: 20 },
                [OTHER]: { displayName: 'O', approved: true, leaveTotal: 15 },
                [SECOND_ADMIN_IN_CONFIG]: { displayName: 'Admin2', approved: true, leaveTotal: 15 },
                [EMAIL_ADMIN_UID]: { displayName: 'Company', approved: true, leaveTotal: 15 },
            },
            ...Object.fromEntries(BUSINESS_PATHS.map(p => [p, { seed1: { title: 'fixture', status: 'todo' } }])),
        });
    });
}

const results = [];
async function check(name, fn) {
    await seed();
    try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, ok: false, err: String(e && e.message || e) }); console.log('FAIL ' + name + ' :: ' + (e && e.message)); }
}
const as = (uid, token = {}) => (uid ? testEnv.authenticatedContext(uid, token) : testEnv.unauthenticatedContext()).database();

// 1) 비로그인
for (const p of BUSINESS_PATHS) {
    await check(`[비로그인] ${p} 읽기 거부`, () => assertFails(get(ref(as(null), p))));
    await check(`[비로그인] ${p} 쓰기 거부`, () => assertFails(set(ref(as(null), `${p}/x`), { a: 1 })));
}
await check('[비로그인] users 읽기 거부', () => assertFails(get(ref(as(null), 'users'))));

// 2) 미승인
for (const p of BUSINESS_PATHS) {
    await check(`[미승인] ${p} 읽기 거부`, () => assertFails(get(ref(as(PENDING), p))));
    await check(`[미승인] ${p} 쓰기 거부`, () => assertFails(set(ref(as(PENDING), `${p}/x`), { a: 1 })));
}
await check('[미승인] 쿼리(tasks status=todo) 읽기 거부', async () => {
    const { query, orderByChild, equalTo } = await import('firebase/database');
    await assertFails(get(query(ref(as(PENDING), 'tasks'), orderByChild('status'), equalTo('todo'))));
});
await check('[미승인] users 읽기 허용 (1차 범위의 의도된 예외)', () => assertSucceeds(get(ref(as(PENDING), 'users'))));

// 3) 승인 사용자
for (const p of BUSINESS_PATHS) {
    await check(`[승인] ${p} 읽기 허용`, () => assertSucceeds(get(ref(as(APPROVED), p))));
    await check(`[승인] ${p} 쓰기 허용`, () => assertSucceeds(set(ref(as(APPROVED), `${p}/x`), { a: 1 })));
}

// 4) 신규 프로필 등록 (main.js 의 실제 기본값과 동일한 형태)
const newProfile = { displayName: '신규', email: 'new@example.com', approved: false, leaveTotal: 15, department: 'unassigned' };
await check('[신규] 정상 기본값 프로필 등록 허용', () => assertSucceeds(set(ref(as(NEWBIE), `users/${NEWBIE}`), newProfile)));
await check('[신규] approved:true 로 등록 거부', () => assertFails(set(ref(as(NEWBIE), `users/${NEWBIE}`), { ...newProfile, approved: true })));
await check('[신규] leaveTotal:30 으로 등록 거부', () => assertFails(set(ref(as(NEWBIE), `users/${NEWBIE}`), { ...newProfile, leaveTotal: 30 })));
await check('[신규] totalLeave 포함 등록 거부', () => assertFails(set(ref(as(NEWBIE), `users/${NEWBIE}`), { ...newProfile, totalLeave: 99 })));
await check('[신규] leaveTotal 누락 등록 거부', () => { const { leaveTotal, ...p } = newProfile; return assertFails(set(ref(as(NEWBIE), `users/${NEWBIE}`), p)); });
await check('[신규] approved 누락 등록 거부', () => { const { approved, ...p } = newProfile; return assertFails(set(ref(as(NEWBIE), `users/${NEWBIE}`), p)); });
await check('[신규] approved 필드만 단독 true 기록 거부', () => assertFails(set(ref(as(NEWBIE), `users/${NEWBIE}/approved`), true)));

// 5) 자기 승인 / 연차 총량 변조
await check('[미승인] 본인 approved=true (자식 경로) 거부', () => assertFails(set(ref(as(PENDING), `users/${PENDING}/approved`), true)));
await check('[미승인] 본인 approved=true (update) 거부', () => assertFails(update(ref(as(PENDING), `users/${PENDING}`), { approved: true })));
await check('[미승인] 본인 프로필 통째 덮어쓰기(approved:true) 거부', () => assertFails(set(ref(as(PENDING), `users/${PENDING}`), { displayName: 'P', approved: true, leaveTotal: 15 })));
await check('[승인] 본인 leaveTotal 변경 거부', () => assertFails(update(ref(as(APPROVED), `users/${APPROVED}`), { leaveTotal: 30 })));
await check('[승인] 본인 totalLeave 신규 추가 거부', () => assertFails(update(ref(as(APPROVED), `users/${APPROVED}`), { totalLeave: 30 })));
await check('[기존] 본인 totalLeave 변경 거부', () => assertFails(set(ref(as(LEGACY), `users/${LEGACY}/totalLeave`), 99)));

// 6) 삭제·부모 덮어쓰기·다중 경로 우회
await check('[미승인] approved 필드 삭제 거부', () => assertFails(remove(ref(as(PENDING), `users/${PENDING}/approved`))));
await check('[승인] leaveTotal 필드 삭제 거부', () => assertFails(remove(ref(as(APPROVED), `users/${APPROVED}/leaveTotal`))));
await check('[기존] totalLeave 필드 삭제 거부', () => assertFails(remove(ref(as(LEGACY), `users/${LEGACY}/totalLeave`))));
await check('[승인] 본인 프로필 전체 삭제 거부', () => assertFails(remove(ref(as(APPROVED), `users/${APPROVED}`))));
await check('[미승인] 삭제 후 재등록 우회(update approved:null) 거부', () => assertFails(update(ref(as(PENDING), `users/${PENDING}`), { approved: null })));
await check('[미승인] 부모 덮어쓰기(approved 누락) 거부', () => assertFails(set(ref(as(PENDING), `users/${PENDING}`), { displayName: 'P', leaveTotal: 15 })));
await check('[승인] users 노드 전체 덮어쓰기 거부', () => assertFails(set(ref(as(APPROVED), 'users'), { [APPROVED]: { approved: true, leaveTotal: 99 } })));
await check('[미승인] 루트 다중 경로(approved + 일반필드) 거부', () => assertFails(update(ref(as(PENDING)), { [`users/${PENDING}/approved`]: true, [`users/${PENDING}/displayName`]: 'x' })));
await check('[미승인] 루트 다중 경로(approved 삭제 + 일반필드) 거부', () => assertFails(update(ref(as(PENDING)), { [`users/${PENDING}/approved`]: null, [`users/${PENDING}/displayName`]: 'x' })));
await check('[승인] 루트 다중 경로(본인 leaveTotal + tasks) 거부', () => assertFails(update(ref(as(APPROVED)), { [`users/${APPROVED}/leaveTotal`]: 99, 'tasks/y': { a: 1 } })));

// 7) 본인 일반 수정 / 타인 수정
await check('[승인] 본인 displayName·department 수정 허용 (main.js:update 형태)', () => assertSucceeds(update(ref(as(APPROVED), `users/${APPROVED}`), { displayName: '새이름', department: 'team2_member' })));
await check('[미승인] 본인 displayName 수정 허용', () => assertSucceeds(update(ref(as(PENDING), `users/${PENDING}`), { displayName: '새이름' })));
await check('[승인] 본인 savedProposals 쓰기 허용', () => assertSucceeds(set(ref(as(APPROVED), `users/${APPROVED}/savedProposals/p1`), { title: 't' })));
await check('[기존] totalLeave 동일 값 유지한 일반 수정 허용', () => assertSucceeds(update(ref(as(LEGACY), `users/${LEGACY}`), { displayName: 'L2' })));
await check('[승인] 타인 displayName 수정 거부', () => assertFails(update(ref(as(APPROVED), `users/${OTHER}`), { displayName: 'hack' })));
await check('[승인] 타인 approved 해제 거부', () => assertFails(set(ref(as(APPROVED), `users/${OTHER}/approved`), false)));
await check('[승인] 타인 프로필 삭제 거부', () => assertFails(remove(ref(as(APPROVED), `users/${OTHER}`))));

// 8) 관리자
await check('[관리자] 승인 허용 (main.js update 형태)', () => assertSucceeds(update(ref(as(ADMIN), `users/${PENDING}`), { approved: true })));
await check('[관리자] 승인 해제 허용', () => assertSucceeds(update(ref(as(ADMIN), `users/${APPROVED}`), { approved: false })));
await check('[관리자] 연차 총량 변경 허용 (leaveService update 형태)', () => assertSucceeds(update(ref(as(ADMIN), `users/${APPROVED}`), { leaveTotal: 20, totalLeave: 20 })));
await check('[관리자] 타인 부서 변경 허용', () => assertSucceeds(update(ref(as(ADMIN), `users/${OTHER}`), { department: 'director' })));
await check('[관리자] 사용자 삭제 허용', () => assertSucceeds(remove(ref(as(ADMIN), `users/${OTHER}`))));

// 9) 관리자 3명 정책 (config.js ADMIN_UIDS 2개 + ADMIN_EMAILS 1개와 동일)
const verified = { email: ADMIN_EMAIL, email_verified: true };
await check('[관리자2 UID] 승인 허용', () => assertSucceeds(update(ref(as(SECOND_ADMIN_IN_CONFIG), `users/${PENDING}`), { approved: true })));
await check('[관리자2 UID] 연차 총량 변경 허용', () => assertSucceeds(update(ref(as(SECOND_ADMIN_IN_CONFIG), `users/${APPROVED}`), { leaveTotal: 20, totalLeave: 20 })));
await check('[관리자 이메일·인증됨] 승인 허용', () => assertSucceeds(update(ref(as(EMAIL_ADMIN_UID, verified), `users/${PENDING}`), { approved: true })));
await check('[관리자 이메일·인증됨] 승인 해제 허용', () => assertSucceeds(update(ref(as(EMAIL_ADMIN_UID, verified), `users/${APPROVED}`), { approved: false })));
await check('[관리자 이메일·인증됨] 신규 본인 프로필 approved:true 등록 허용', () => assertSucceeds(set(ref(as('uEmailAdminNew', verified), 'users/uEmailAdminNew'), { ...newProfile, approved: true })));
await check('[관리자 이메일·미인증] 승인 거부', () => assertFails(update(ref(as('uFake', { email: ADMIN_EMAIL, email_verified: false }), `users/${PENDING}`), { approved: true })));
await check('[관리자 이메일·미인증] 본인 프로필 approved:true 등록 거부', () => assertFails(set(ref(as('uFake2', { email: ADMIN_EMAIL, email_verified: false }), 'users/uFake2'), { ...newProfile, approved: true })));
await check('[다른 인증 이메일] 승인 거부', () => assertFails(update(ref(as('uOtherMail', { email: 'someone@faww.co.kr', email_verified: true }), `users/${PENDING}`), { approved: true })));
await check('[대소문자 다른 관리자 이메일] 승인 거부 (정확히 일치만 허용)', () => assertFails(update(ref(as('uCase', { email: 'Contact@faww.co.kr', email_verified: true }), `users/${PENDING}`), { approved: true })));

await testEnv.cleanup();
const failed = results.filter(r => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과, ${failed.length} 실패`);
console.log(`규칙 파일: ${RULES_PATH}`);
process.exit(failed.length ? 1 : 0);
