// 일정 달력: 구글 캘린더 일정은 앱에서 수정·삭제(취소) 불가 — 브라우저 테스트 (가짜 Firebase, 실제 캘린더 연결 없음)
// 준비: cd tools/mobile-audit && npm install → 루트에서 npx vite build / 실행: node tools/automation/test-calendar-readonly-ui.mjs
import { openPage, closeAll } from '../mobile-audit/harness.mjs';
const res = []; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (const userKey of ['admin', 'staff']) {
  const page = await openPage({ userKey });
  await page.evaluate(() => { firebase.database().ref('tasks/tt1').set({ title: '테스트 업무', status: 'todo', author: firebase.auth().currentUser.displayName, assignee: '', timestamp: 1 }); });
  await sleep(500);
  // 구글 캘린더 동기화 함수 호출 감시
  await page.evaluate(() => { window.__gcal = { sync: 0, del: 0 }; const s = window.syncExternalEventToGoogleCalendar, d = window.deleteGoogleCalendarEvent;
    window.syncExternalEventToGoogleCalendar = function () { window.__gcal.sync++; return s && s.apply(this, arguments); };
    window.deleteGoogleCalendarEvent = function () { window.__gcal.del++; return d && d.apply(this, arguments); }; });
  const st = await page.evaluate(() => {
    const ev = AppStore.getExternalEvents(); const id = Object.keys(ev).find(k => !/FaWW 출장연동/.test(ev[k].description || '')) || Object.keys(ev)[0];
    const e = ev[id]; openModal(id, e.title, e.description || '', e.dueDate, e.startDate, 'external');
    const q = (s) => document.querySelector(s);
    return { id, inputsDisabled: ['modalTitleInput', 'modalTaskType', 'modalStartDate', 'modalDueDate', 'modalAssigneeInput', 'modalDescription'].every(i => q('#' + i).disabled),
      chipsDisabled: [...document.querySelectorAll('#taskModal .status-chip')].every(b => b.disabled),
      saveHidden: getComputedStyle(q('#taskModal button[onclick="saveDescription()"]')).display === 'none', delHidden: getComputedStyle(q('#modalDeleteBtn')).display === 'none',
      note: (q('#modalReadOnlyNote') || {}).textContent || '',
      dateLocked: ['#modalStartDate', '#modalDueDate'].every(s2 => getComputedStyle(q(s2)).pointerEvents === 'none'),
      tagLocked: [...document.querySelectorAll('#taskModal .assignee-tag')].every(t => getComputedStyle(t).pointerEvents === 'none' && [...t.querySelectorAll('.material-symbols-rounded')].every(i => getComputedStyle(i).display === 'none')) };
  });
  check(`[${userKey}] 캘린더 일정: 입력·상태 칩·날짜·담당자 태그 잠김, 저장·삭제 버튼 숨김, 안내 표시`, st.inputsDisabled && st.chipsDisabled && st.saveHidden && st.delHidden && /보기만 가능/.test(st.note) && st.dateLocked && st.tagLocked, JSON.stringify(st));
  const w0 = await page.evaluate(() => window.__dbWrites || 0);
  await page.evaluate(() => { saveDescription(); }); await sleep(400);
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(m => { if (/수정할 수 없습니다/.test(m.textContent) && m.id !== 'taskModal') m.style.display = 'none'; }); deleteCurrentTask(); }); await sleep(400);
  const after = await page.evaluate(() => ({ w: window.__dbWrites || 0, g: window.__gcal, alert: /삭제·취소할 수 없습니다|수정할 수 없습니다/.test(document.body.innerText) }));
  check(`[${userKey}] 저장·삭제 함수를 직접 호출해도 DB 쓰기 0건, 구글 캘린더 동기화·삭제 호출 0건, 안내 표시`, after.w === w0 && after.g.sync === 0 && after.g.del === 0 && after.alert, JSON.stringify({ w0, ...after }));
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); });
  const task = await page.evaluate(() => {
    const t = AppStore.getTasks()['tt1']; openModal('tt1', t.title, '', '', '', 'task');
    const q = (s) => document.querySelector(s);
    return { enabled: !q('#modalTitleInput').disabled && !q('#modalDescription').disabled && [...document.querySelectorAll('#taskModal .status-chip')].every(b => !b.disabled),
      saveShown: getComputedStyle(q('#taskModal button[onclick="saveDescription()"]')).display !== 'none', delShown: getComputedStyle(q('#modalDeleteBtn')).display !== 'none',
      noteHidden: !q('#modalReadOnlyNote') || getComputedStyle(q('#modalReadOnlyNote')).display === 'none',
      unlocked: !document.getElementById('taskModal').classList.contains('tm-readonly') && getComputedStyle(q('#modalStartDate')).pointerEvents !== 'none' };
  });
  check(`[${userKey}] 일반 업무는 그대로 수정 가능 (입력 활성, 저장 표시, 작성자 삭제 가능, 안내 없음)`, task.enabled && task.saveShown && task.delShown && task.noteHidden && task.unlocked, JSON.stringify(task));
  check(`[${userKey}] 페이지 오류 없음`, page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
}
await closeAll();
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
