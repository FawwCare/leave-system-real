/**
 * 테스트 러너의 종료 코드 검증 (별도 실행)
 * 1) 정상 실행 → 종료 코드 0
 * 2) SYNC_TEST_FORCE_FAIL=1 (의도적 assertion 실패) → 종료 코드 1
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(__dirname, 'run-sync-tests.mjs');

function run(label, extraEnv) {
    const env = { ...process.env, ...extraEnv };
    if (!extraEnv.SYNC_TEST_FORCE_FAIL) delete env.SYNC_TEST_FORCE_FAIL;
    const r = spawnSync(process.execPath, [runner], { env, encoding: 'utf-8' });
    const summary = (r.stdout.match(/결과: .*/) || ['(결과 줄 없음)'])[0];
    const failLines = (r.stderr.match(/^FAIL .*/gm) || []);
    console.log(`[${label}] status=${r.status} | ${summary}${failLines.length ? ' | ' + failLines.join(' / ') : ''}`);
    return r.status;
}

const normal = run('정상 실행', {});
const forced = run('의도적 실패 실행 (SYNC_TEST_FORCE_FAIL=1)', { SYNC_TEST_FORCE_FAIL: '1' });

const ok = normal === 0 && forced === 1;
console.log(ok ? '종료 코드 검증 통과: 정상=0, 의도적 실패=1' : `종료 코드 검증 실패: 정상=${normal}, 의도적 실패=${forced}`);
if (!ok) process.exitCode = 1;
