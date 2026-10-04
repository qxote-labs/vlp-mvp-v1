// npm run serve 없이 `npm test`만으로 정적 서버 기동 + 전체 시나리오 순차 실행 + 결과 요약까지 처리한다.
const path = require('path');
const { spawn } = require('child_process');
const httpServer = require('http-server');

const ROOT = path.join(__dirname, '..');
const PORT = 8000;

const TEST_FILES = [
  'test_pwa_shell.js',
  'test_responsive_layout.js',
  'test_s1_contract_flow.js',
  'test_s1_claim.js', 'test_s1_account.js',
  'test_s1_demo.js',
  'test_s2_state.js',
  'test_s2_tracking.js',
  'test_s2_demo.js',
  'test_s3_handover.js',
  'test_s4_chat.js',
  'test_s4_push.js',
  'test_aug_notify.js',
  'test_fit_panes.js',
  'test_chat_consent.js',
  'test_admin_notes.js',
  'test_admin_home.js',
  'test_admin_users.js',
  'test_hero_scroll.js',
  'test_chat_filter_reopen.js',
  'test_list_closed_flicker.js',
  'test_qa_a11y.js',
  'test_guide.js',
  'test_offline_banner.js',
  'test_rolebar.js',
  'test_role_switch.js',
  'test_app_entry.js',
  'test_login_unify.js',
  'test_home_screens.js',
  'test_care_customer.js',
  'test_shop_accounts.js', 'test_shop_care.js', 'test_admin_care.js', 'test_care_chat.js', 'test_new_flow_extra.js', 'test_care_seed_cases.js', 'test_demo_flows.js', 'test_list_collapse.js',
];

// child_process.spawn(비동기)을 써야 한다. spawnSync는 이벤트 루프를 블로킹해서,
// 같은 프로세스에서 떠 있는 http-server가 그동안 요청을 하나도 처리하지 못하게 된다.
function runTest(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    child.on('close', code => resolve(code));
  });
}

async function main() {
  const server = httpServer.createServer({ root: ROOT, cache: -1 });
  // 이미 같은 포트에 정적 서버가 떠 있으면(개발 중 수동 실행 등) 그것을 그대로 쓴다.
  let owned = true;
  await new Promise(resolve => {
    server.server.once('error', (e) => { if (e.code === 'EADDRINUSE') { owned = false; console.log(`포트 ${PORT}의 기존 서버를 사용합니다\n`); resolve(); } else throw e; });
    server.listen(PORT, () => { console.log(`정적 서버 시작: http://localhost:${PORT}\n`); resolve(); });
  });

  const results = [];
  for (const file of TEST_FILES) {
    console.log(`=== ${file} ===`);
    const code = await runTest(file);
    console.log('');
    results.push({ file, code });
  }

  if (owned) server.close();

  console.log('=== 결과 요약 ===');
  let failed = false;
  for (const { file, code } of results) {
    const ok = code === 0;
    if (!ok) failed = true;
    console.log(`${ok ? '✅' : '❌'} ${file}`);
  }

  process.exitCode = failed ? 1 : 0;
}

main();
