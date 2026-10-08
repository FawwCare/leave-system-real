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
    'external_events', 'tripVehicles', 'businessCommunications', 'chatMessages', 'notices'];
// 1:1 채팅방 ID 형식: 작은UID_큰UID (privateChatUtils.js getPrivateChatId 와 동일)
const chatIdOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

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
                [APPROVED]: { displayName: 'A', approved: true, leaveTotal: 15, department: 'team1_member', savedProposals: { old1: { title: '예전 기획서', text: '<p>x</p>', timestamp: 1 } } },
                [PENDING]: { displayName: 'P', approved: false, leaveTotal: 15, department: 'unassigned' },
                [LEGACY]: { displayName: 'L', approved: true, leaveTotal: 15, totalLeave: 20 },
                [OTHER]: { displayName: 'O', approved: true, leaveTotal: 15 },
                [SECOND_ADMIN_IN_CONFIG]: { displayName: 'Admin2', approved: true, leaveTotal: 15 },
                [EMAIL_ADMIN_UID]: { displayName: 'Company', approved: true, leaveTotal: 15 },
            },
            ...Object.fromEntries(BUSINESS_PATHS.map(p => [p, { seed1: { title: 'fixture', status: 'todo' } }])),
            savedProposals: { [OTHER]: { p1: { title: 'O의 기획서', text: '<p>비밀</p>', timestamp: 1 } } },
            privateChats: {
                [chatIdOf(APPROVED, OTHER)]: { m1: { uid: OTHER, sender: 'O', text: '안녕', timestamp: 1, read: false } },
            },
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
// 보안 2차-1: 직원 명단은 승인된 사용자·관리자만, 미승인은 본인 프로필만
await check('[미승인] users 전체 읽기 거부', () => assertFails(get(ref(as(PENDING), 'users'))));
await check('[미승인] 본인 프로필 읽기 허용', () => assertSucceeds(get(ref(as(PENDING), `users/${PENDING}`))));
await check('[미승인] 타인 프로필 읽기 거부', () => assertFails(get(ref(as(PENDING), `users/${APPROVED}`))));
await check('[미승인] 타인 이메일 필드 읽기 거부', () => assertFails(get(ref(as(PENDING), `users/${APPROVED}/displayName`))));
await check('[신규·프로필 없음] 본인 경로 읽기 허용 (null 수신 → 프로필 생성 흐름)', () => assertSucceeds(get(ref(as(NEWBIE), `users/${NEWBIE}`))));
await check('[신규·프로필 없음] users 전체 읽기 거부', () => assertFails(get(ref(as(NEWBIE), 'users'))));
await check('[승인] users 전체 읽기 허용 (조직도·채팅 목록)', () => assertSucceeds(get(ref(as(APPROVED), 'users'))));
await check('[승인] 타인 프로필 읽기 허용', () => assertSucceeds(get(ref(as(APPROVED), `users/${OTHER}`))));

// 3) 승인 사용자
for (const p of BUSINESS_PATHS) {
    await check(`[승인] ${p} 읽기 허용`, () => assertSucceeds(get(ref(as(APPROVED), p))));
    await check(`[승인] ${p} 쓰기 허용`, () => assertSucceeds(set(ref(as(APPROVED), `${p}/x`), { a: 1 })));
}

// 3-b) 보안 2차-2: 1:1 채팅은 당사자만
const CAO = chatIdOf(APPROVED, OTHER);
const msg = (uid, text = 'hi') => ({ uid, sender: 'x', text, timestamp: 2, read: false });
await check('[채팅·당사자] 본인 대화 읽기 허용', () => assertSucceeds(get(ref(as(APPROVED), `privateChats/${CAO}`))));
await check('[채팅·당사자] 상대 당사자도 읽기 허용', () => assertSucceeds(get(ref(as(OTHER), `privateChats/${CAO}`))));
await check('[채팅·제3자] 승인된 직원이라도 남의 대화 읽기 거부', () => assertFails(get(ref(as(LEGACY), `privateChats/${CAO}`))));
await check('[채팅·제3자] 남의 대화에 메시지 쓰기 거부', () => assertFails(set(ref(as(LEGACY), `privateChats/${CAO}/m9`), msg(LEGACY))));
await check('[채팅·제3자] 남의 대화 삭제 거부', () => assertFails(remove(ref(as(LEGACY), `privateChats/${CAO}`))));
await check('[채팅] privateChats 전체 읽기 거부 (관리자 포함)', async () => { await assertFails(get(ref(as(APPROVED), 'privateChats'))); await assertFails(get(ref(as(ADMIN), 'privateChats'))); });
await check('[채팅·미승인 당사자] 본인 대화라도 읽기 거부', () => assertFails(get(ref(as(PENDING), `privateChats/${chatIdOf(PENDING, APPROVED)}`))));
await check('[채팅·비로그인] 읽기 거부', () => assertFails(get(ref(as(null), `privateChats/${CAO}`))));
await check('[채팅·당사자] 본인 명의 새 메시지 쓰기 허용 (앱 push 형태)', () => assertSucceeds(set(ref(as(APPROVED), `privateChats/${CAO}/m2`), msg(APPROVED))));
await check('[채팅·당사자] 상대 명의(사칭) 새 메시지 쓰기 거부', () => assertFails(set(ref(as(APPROVED), `privateChats/${CAO}/m3`), msg(OTHER))));
await check('[채팅·당사자] 받은 메시지 읽음 표시 허용 (앱 update 형태)', () => assertSucceeds(update(ref(as(APPROVED), `privateChats/${CAO}/m1`), { read: true })));
await check('[채팅·당사자] 받은 메시지 내용 변조 거부', () => assertFails(update(ref(as(APPROVED), `privateChats/${CAO}/m1`), { text: '변조' })));
await check('[채팅·당사자] 받은 메시지 작성자 변경 거부', () => assertFails(update(ref(as(APPROVED), `privateChats/${CAO}/m1`), { uid: APPROVED })));
await check('[채팅·우회] 방 ID에 내 UID를 끼운 가짜 방은 상대가 읽을 수 없음', async () => {
    const fake = `${LEGACY}_${OTHER}_x`;
    await assertSucceeds(set(ref(as(LEGACY), `privateChats/${fake}/m1`), msg(LEGACY)));   // 본인 UID로 시작 → 쓰기 자체는 허용
    await assertFails(get(ref(as(APPROVED), `privateChats/${fake}`)));                     // 무관한 제3자는 읽기 불가
});
await check('[채팅·우회] 루트 다중 경로로 남의 대화 쓰기 거부', () => assertFails(update(ref(as(LEGACY)), { [`privateChats/${CAO}/m8`]: msg(LEGACY), 'tasks/z': { a: 1 } })));

// 3-c) 보안 2차-3: 기획서 보관함은 본인만
const prop = { title: 't', text: '<p>b</p>', template: 'business', timestamp: 3 };
await check('[기획서·본인] 본인 보관함 읽기 허용', () => assertSucceeds(get(ref(as(OTHER), `savedProposals/${OTHER}`))));
await check('[기획서·본인] 본인 보관함 저장 허용 (앱 push 형태)', () => assertSucceeds(set(ref(as(APPROVED), `savedProposals/${APPROVED}/n1`), { id: 'n1', ...prop })));
await check('[기획서·본인] 본인 기획서 삭제 허용', () => assertSucceeds(remove(ref(as(OTHER), `savedProposals/${OTHER}/p1`))));
await check('[기획서·타인] 승인된 직원이라도 남의 보관함 읽기 거부', () => assertFails(get(ref(as(APPROVED), `savedProposals/${OTHER}`))));
await check('[기획서·타인] 남의 보관함에 쓰기 거부', () => assertFails(set(ref(as(APPROVED), `savedProposals/${OTHER}/x`), prop)));
await check('[기획서·타인] 남의 기획서 삭제 거부', () => assertFails(remove(ref(as(APPROVED), `savedProposals/${OTHER}/p1`))));
await check('[기획서] 보관함 전체 읽기 거부 (관리자 포함)', async () => { await assertFails(get(ref(as(APPROVED), 'savedProposals'))); await assertFails(get(ref(as(ADMIN), 'savedProposals'))); });
await check('[기획서·미승인] 본인 보관함이라도 거부', () => assertFails(get(ref(as(PENDING), `savedProposals/${PENDING}`))));
await check('[기획서·이전] 예전 위치→새 위치 다중 경로 이전 허용 (앱 migrateLegacyProposals 형태)', async () => {
    await assertSucceeds(update(ref(as(APPROVED)), { [`savedProposals/${APPROVED}/old1`]: { title: '예전 기획서', text: '<p>x</p>', timestamp: 1 }, [`users/${APPROVED}/savedProposals`]: null }));
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const d = c.database();
        if ((await get(ref(d, `users/${APPROVED}/savedProposals`))).exists()) throw new Error('예전 위치가 남아 있음');
        if (!(await get(ref(d, `savedProposals/${APPROVED}/old1`))).exists()) throw new Error('새 위치에 없음');
        if ((await get(ref(d, `users/${APPROVED}/approved`))).val() !== true) throw new Error('프로필 손상');
    });
});
await check('[기획서·이전] 이전 과정에서 남의 보관함 끼워넣기 거부', () => assertFails(update(ref(as(APPROVED)), { [`savedProposals/${OTHER}/z`]: prop, [`users/${APPROVED}/savedProposals`]: null })));

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
await check('[승인 해제된 사용자] users 전체 읽기 거부', async () => {
    await update(ref(as(ADMIN), `users/${APPROVED}`), { approved: false });
    await assertFails(get(ref(as(APPROVED), 'users')));
    await assertSucceeds(get(ref(as(APPROVED), `users/${APPROVED}`)));
});
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
await check('[관리자 이메일·인증됨] users 전체 읽기 허용', () => assertSucceeds(get(ref(as(EMAIL_ADMIN_UID, verified), 'users'))));
await check('[관리자 이메일·미인증] 승인 거부', () => assertFails(update(ref(as('uFake', { email: ADMIN_EMAIL, email_verified: false }), `users/${PENDING}`), { approved: true })));
await check('[관리자 이메일·미인증] 본인 프로필 approved:true 등록 거부', () => assertFails(set(ref(as('uFake2', { email: ADMIN_EMAIL, email_verified: false }), 'users/uFake2'), { ...newProfile, approved: true })));
await check('[다른 인증 이메일] 승인 거부', () => assertFails(update(ref(as('uOtherMail', { email: 'someone@faww.co.kr', email_verified: true }), `users/${PENDING}`), { approved: true })));
await check('[대소문자 다른 관리자 이메일] 승인 거부 (정확히 일치만 허용)', () => assertFails(update(ref(as('uCase', { email: 'Contact@faww.co.kr', email_verified: true }), `users/${PENDING}`), { approved: true })));

await testEnv.cleanup();
const failed = results.filter(r => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과, ${failed.length} 실패`);
console.log(`규칙 파일: ${RULES_PATH}`);
process.exit(failed.length ? 1 : 0);
