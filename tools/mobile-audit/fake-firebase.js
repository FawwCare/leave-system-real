// 모바일 화면 점검용 가짜 Firebase (메모리 전용, 네트워크 없음). 관리자(승인됨)로 로그인된 상태 + 예시 데이터.
(function () {
  const ADMIN = 'jaGugunGReXytCgbqYwQUybxyJL2';
  const now = new Date(); const Y = now.getFullYear(), M = now.getMonth();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (off) => { const d = new Date(Y, M, now.getDate() + off); return ymd(d); };
  const ts = (offMin) => Date.now() - offMin * 60000;
  const users = {
    [ADMIN]: { displayName: '대장', email: 'contact@faww.co.kr', approved: true, leaveTotal: 15, department: 'ceo' },
    uSJ: { displayName: '장성진', email: 'sj@faww.co.kr', approved: true, leaveTotal: 15, department: 'team1_leader' },
    uMH: { displayName: '민홍', email: 'mh@faww.co.kr', approved: true, leaveTotal: 15, department: 'team1_member' },
    uHR: { displayName: '김하람', email: 'hr@faww.co.kr', approved: true, leaveTotal: 15, department: 'team2_leader' },
    uJY: { displayName: '박지영', email: 'jy@faww.co.kr', approved: true, leaveTotal: 15, department: 'team2_member' },
    uNEW: { displayName: '신입사원', email: 'new@faww.co.kr', approved: false, leaveTotal: 15, department: 'unassigned' },
  };
  const trip = (id, name, s, e, assignee, status, address) => ({ id, name, date: e && e !== s ? `${s} to ${e}` : s, startDate: s, endDate: e || s, assignee, status, address, author: 'Gmail 자동 등록', requiredPersonnel: 1 });
  const data = {
    users,
    tasks: {
      t1: { id: 't1', title: '텔러스헬스 4분기 강의안 최종 검토 및 자료 송부', status: 'todo', assignee: '장성진, 민홍', dueDate: day(-2), priority: 'high', description: '강의안 v3 피드백 반영' },
      t2: { id: 't2', title: '쿠팡 이천 물류센터 피지컬케어 결과보고서 작성', status: 'todo', assignee: '김하람', dueDate: day(0), priority: 'medium' },
      t3: { id: 't3', title: '자체 워크숍 장소 섭외', status: 'doing', assignee: '민홍', dueDate: day(5), priority: 'low' },
      t4: { id: 't4', title: '부산지방법원 교육 만족도 설문 집계', status: 'doing', assignee: '박지영', dueDate: day(2), priority: 'medium' },
      t5: { id: 't5', title: '9월 출장비 정산', status: 'done', assignee: '장성진', dueDate: day(-5), priority: 'medium' },
      f1: { id: 'f1', status: 'feed', author: '김하람', description: '이번 주 쿠팡 현장 피드백: 오전 세션 참여율이 높았고, 오후 세션은 교대 시간과 겹쳐 인원이 적었습니다. 다음 회차는 시간 조정 필요.', timestamp: ts(90), acknowledgments: {} },
      notifications: { [ADMIN]: { n1: { title: '새 연차 신청', message: '박지영님이 연차를 신청했습니다.', timestamp: ts(30), read: false }, n2: { title: '업무 배정', message: '"부산지방법원 교육 만족도 설문 집계" 담당자로 지정되었습니다.', timestamp: ts(300), read: true } } },
    },
    businessTrips: {
      b1: trip('b1', '부산지방법원 피지컬케어 교육', day(0), day(0), '장성진', '확정', '부산 연제구 법원로 31'),
      b2: trip('b2', '쿠팡 이천 물류센터 찾아가는 상담실', day(1), day(2), '민홍', '확정', '경기 이천시 마장면'),
      b3: trip('b3', '수원지방법원 성남지원 직무스트레스 교육', day(3), day(3), '김하람', '조율중', '경기 성남시 수정구'),
      b4: trip('b4', '수원지방법원 성남지원 직무스트레스 교육', day(4), day(4), '김하람', '조율중', '경기 성남시 수정구'),
      b5: trip('b5', '한국해양교통안전공단 본사 정신건강 특강', day(8), day(8), '장성진, 민홍', '확정', '세종시 해수부'),
      b6: trip('b6', '광주광역시도시공사 피지컬 상담', day(9), day(11), '박지영', '확정', '광주 서구'),
    },
    leaves: {
      l1: { id: 'l1', uid: 'uJY', userName: '박지영', date: day(6), type: 1, subType: '1', status: 'pending', timestamp: ts(30) },
      l2: { id: 'l2', uid: 'uSJ', userName: '장성진', date: day(-3), type: 0.5, subType: '0.5am', status: 'approved', timestamp: ts(5000) },
      l3: { id: 'l3', uid: ADMIN, userName: '대장', date: day(12), type: 1, subType: '1', status: 'approved', timestamp: ts(9000) },
    },
    external_events: {
      e1: { id: 'e1', title: '[확정] 부산지방법원 피지컬케어 교육', startDate: day(0), dueDate: day(0), isExternal: true, description: '[FaWW 출장연동 ID: b1]', status: 'todo', assignee: 'FAWW 자동 연동' },
      e2: { id: 'e2', title: '대표님 외부 미팅 (투자사 IR)', startDate: day(2), dueDate: day(2), isExternal: true, status: 'todo', assignee: 'FAWW 자동 연동' },
      e3: { id: 'e3', title: '[휴가] 대장 연차', startDate: day(12), dueDate: day(12), isExternal: true, status: 'todo', assignee: 'FAWW 자동 연동' },
    },
    notices: {
      n1: { title: '10월 전사 워크숍 일정 안내', content: '10월 넷째 주 금요일 전사 워크숍이 있습니다. 장소는 추후 공지합니다.', author: '대장', timestamp: ts(2000), views: 12, important: true },
      n2: { title: '출장비 정산 양식 변경', content: '이번 달부터 새 정산 양식을 사용합니다.', author: '장성진', timestamp: ts(6000), views: 8 },
    },
    files: {
      fo1: { name: '2026 강의 자료', isFolder: true, timestamp: ts(9000) },
      fi1: { name: '텔러스헬스_강의안_v3_최종.pdf', uploader: '장성진', url: 'https://example.com/a.pdf', timestamp: ts(400), type: 'file', size: 1048576 },
      fi2: { name: '9월_출장비_정산서.xlsx', uploader: '박지영', url: 'https://example.com/b.xlsx', timestamp: ts(3000), type: 'file', size: 52000 },
    },
    consumables: {
      c1: { name: 'A4 복사용지', unit: '박스', currentStock: 2, threshold: 3, category: '사무용품' },
      c2: { name: '마사지 오일 (500ml)', unit: '병', currentStock: 14, threshold: 5, category: '교육용품' },
      c3: { name: '일회용 베드시트', unit: '팩', currentStock: 6, threshold: 4, category: '교육용품' },
    },
    chatMessages: {
      m1: { uid: 'uSJ', sender: '장성진', text: '부산 교육 자료 공유드립니다. 확인 부탁드려요!', timestamp: ts(45) },
      m2: { uid: ADMIN, sender: '대장', text: '확인했습니다. 수고 많았어요 👍', timestamp: ts(40) },
      m3: { uid: 'uMH', sender: '민홍', text: '내일 이천 출장 차량은 1호차로 배정되었습니다.', timestamp: ts(10) },
    },
    businessCommunications: {
      bc1: { title: 'RE: [텔러스헬스] 4분기 강의 일정 및 강사 배정 관련 문의드립니다', summary: '4분기 강의 일정 확정 및 강사 배정 요청 건입니다.', sender: '텔러스헬스 HR팀', category: '일정공유', categoryLabel: '업무소통', timestamp: ts(120) },
      bc2: { title: '준공검사보고서 송부', summary: '준공검사보고서 작성이 완료되어 사인 및 확인 요청 건입니다.', sender: '박지영', category: '업무보고', categoryLabel: '업무소통', timestamp: ts(800) },
    },
    tripVehicles: {}, consumablesLog: {}, privateChats: {},
  };
  const seg = (p) => String(p || '').split('/').filter(Boolean);
  const get = (p) => seg(p).reduce((n, k) => (n == null ? undefined : n[k]), data);
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const set = (p, v) => { const s = seg(p); let n = data; for (let i = 0; i < s.length - 1; i++) { if (typeof n[s[i]] !== 'object' || n[s[i]] === null) n[s[i]] = {}; n = n[s[i]]; }
    if (v === null || v === undefined) delete n[s[s.length - 1]]; else n[s[s.length - 1]] = clone(v); };
  const regs = new Set();
  function snap(q) {
    let v = get(q.path);
    if (v && typeof v === 'object' && (q._eq !== undefined || q._lim)) {
      let keys = Object.keys(v);
      if (q._oc && q._oc !== '$key' && q._eq === undefined) keys.sort((a, b) => ((v[a] || {})[q._oc] > (v[b] || {})[q._oc] ? 1 : -1)); else keys.sort();
      if (q._oc && q._eq !== undefined) keys = keys.filter(k => v[k] && v[k][q._oc] === q._eq);
      if (q._lim) keys = keys.slice(-q._lim);
      const o = {}; keys.forEach(k => { o[k] = v[k]; }); v = keys.length ? o : null;
    }
    return mkSnap(seg(q.path).pop() || null, v, q.path);
  }
  function mkSnap(key, v, path) {
    const c = clone(v);
    return { key, val: () => clone(c), exists: () => c !== null && c !== undefined, numChildren: () => (c && typeof c === 'object' ? Object.keys(c).length : 0),
      forEach(fn) { if (c && typeof c === 'object') for (const k of Object.keys(c)) { if (fn(mkSnap(k, c[k], path + '/' + k)) === true) return true; } return false; },
      child(p) { return mkSnap(seg(p).pop(), seg(p).reduce((n, k) => (n == null ? null : n[k]), c), path + '/' + p); },
      get ref() { return new Q(path); } };
  }
  function changed(p) { for (const r of regs) { const a = r.q.path; if (a === p || a.startsWith(p + '/') || p.startsWith(a + '/') || a === '') setTimeout(() => regs.has(r) && r.cb(snap(r.q)), 0); } }
  class Q {
    constructor(p, o = {}) { this.path = seg(p).join('/'); Object.assign(this, o); }
    w(x) { return new Q(this.path, { _oc: this._oc, _eq: this._eq, _lim: this._lim, ...x }); }
    get key() { return seg(this.path).pop() || null; }
    get ref() { return new Q(this.path); }
    child(c) { return new Q(this.path + '/' + c); }
    orderByChild(c) { return this.w({ _oc: c }); } orderByKey() { return this.w({ _oc: '$key' }); } orderByValue() { return this; }
    equalTo(v) { return this.w({ _eq: v }); } limitToLast(n) { return this.w({ _lim: n }); } limitToFirst(n) { return this.w({ _lim: n }); }
    startAt() { return this; } endAt() { return this; }
    on(ev, cb) { const r = { q: this, cb }; regs.add(r); setTimeout(() => regs.has(r) && cb(snap(this)), 0); return cb; }
    off(ev, cb) { for (const r of [...regs]) if (r.q.path === this.path && (!cb || r.cb === cb)) regs.delete(r); }
    once(ev, cb) { const s = snap(this); if (typeof cb === 'function') cb(s); return Promise.resolve(s); }
    async set(v) { set(this.path, v); changed(this.path); }
    async update(o) { for (const k of Object.keys(o)) set(this.path + '/' + k, o[k]); changed(this.path); }
    async remove() { set(this.path, null); changed(this.path); }
    push(v) { const k = '-P' + Math.random().toString(36).slice(2, 10); const q = this.child(k); const p = v !== undefined ? q.set(v) : Promise.resolve(); q.then = (a, b) => p.then(a, b); return q; }
    transaction(fn) { const nv = fn(clone(get(this.path))); if (nv !== undefined) set(this.path, nv); changed(this.path); return Promise.resolve({ committed: true, snapshot: snap(this) }); }
    onDisconnect() { return { set() {}, remove() {}, update() {} }; }
  }
  const user = { uid: ADMIN, email: 'contact@faww.co.kr', emailVerified: true, displayName: '대장', photoURL: '', getIdToken: () => Promise.resolve('fake') };
  const cbs = [];
  const authObj = { currentUser: null, onAuthStateChanged(cb) { cbs.push(cb); setTimeout(() => { authObj.currentUser = user; cb(user); }, 30); return () => {}; },
    setPersistence: () => Promise.resolve(), getRedirectResult: () => Promise.resolve({}), signInWithPopup: () => Promise.resolve({ user }), signInWithRedirect: () => Promise.resolve(), signOut: () => Promise.resolve() };
  const dbObj = { ref: (p) => new Q(p || '') };
  const storageRef = { child() { return storageRef; }, put: () => Promise.resolve({ ref: storageRef }), getDownloadURL: () => Promise.resolve('https://example.com/x'), delete: () => Promise.resolve() };
  const fns = { httpsCallable: () => () => Promise.reject(new Error('offline')) };
  window.firebase = {
    apps: [], initializeApp() { this.apps.push({}); return {}; }, app: () => ({ functions: () => fns }),
    auth: Object.assign(() => authObj, { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } }, GoogleAuthProvider: function () { this.addScope = () => {}; this.setCustomParameters = () => {}; } }),
    database: Object.assign(() => dbObj, { ServerValue: { TIMESTAMP: Date.now() } }),
    storage: () => ({ ref: () => storageRef }), functions: () => fns,
  };
})();
