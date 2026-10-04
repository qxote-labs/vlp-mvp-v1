// S1 확인번호·휴면·알림: 마지막 계약 종료 후 유예 기간이 지나면 접근이 닫히고, 새 조회번호로 다시 시작하면 이전 기록은 보이지 않는다. 앱 안 알림(고객·카마스터)이 표시된다.
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
const PH = '010-9999-0020', PIN = '123456', PIN2 = '654321';
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (p, n) => { p.on('pageerror', e => errors.push(`[${n}] ${e.message}`)); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const km = await context.newPage(); track(km, 'karmaster');
    await loginAs(customer, 'customer', { name: '이영희', phone: '010-1111-0002' });
    const mk = (no) => customer.evaluate(async ({ no, ph }) => { const c = await VLP.api.contracts.create({ manufacturerContractNo: no, vehicleModel: '스포티지', carmasterPhone: ph }); return c.claimToken; }, { no, ph: PH });
    const t1 = await mk('AC-1');
    await km.goto(BASE + '/karmaster.html?nosw=1&claim=1'); await km.waitForSelector('#cl-phone');
    await km.fill('#cl-phone', PH); await km.fill('#cl-token', t1); await km.fill('#cl-pin', PIN); await km.click('#cl-submit');
    await km.waitForSelector('#cl-pin2:visible'); await km.fill('#cl-pin2', PIN); await km.click('#cl-submit');
    await km.waitForSelector('.vlp-app-karmaster .vlp-today-row');
    ok('첫 계약: 조회번호 + 확인번호 설정으로 입장');
    // 카마스터 알림 패널(새 계약 알림)
    await km.waitForSelector('.vlp-notes-head');
    // 거절해서 계약을 종료 상태로 만든다
    await km.evaluate(async () => { const l = await VLP.api.contracts.list({}); await VLP.api.contracts.reject(l.items[0].contractId, { reasonCode: 'NOT_MY_CUSTOMER' }); });
    // 고객 화면 알림(거절됨)
    await customer.goto(BASE + '/customer.html?nosw=1'); await customer.evaluate(() => goto('history')); await customer.waitForSelector('.vlp-notes-head');
    const nc = await customer.evaluate(async () => (await VLP.api.notifications.list({})).unreadCount);
    assert.ok(nc >= 1, '고객 알림 없음');
    await customer.click('.vlp-notes-head');
    assert.ok(await customer.locator('.vlp-note').count() >= 1);
    ok('고객 화면 알림 목록/배지 표시 (미확인 ' + nc + '건)');
    // 유예 기간 31일 경과 → 휴면
    await km.evaluate(() => VLP.api.adapter().admin.skipTime(31 * 86400e3));
    const dormant = await km.evaluate(async (ph) => { try { VLP.ui.setKarmasterSession(ph, ''); await VLP.api.access.login({ phone: ph, pin: '123456' }); return 'OK'; } catch (e) { return e.status; } }, PH);
    assert.strictEqual(dormant, 409, '휴면인데 로그인 허용: ' + dormant);
    ok('마지막 계약 종료 후 31일 → 확인번호 로그인 거절(409)');
    // 새 조회번호로 다시 시작: 새 확인번호, 이전 계약 보이지 않음
    const t2 = await mk('AC-2');
    await km.goto(BASE + '/app.html?login=1&nosw=1'); await km.evaluate(() => sessionStorage.clear()); await km.goto(BASE + '/karmaster.html?nosw=1&claim=1'); await km.waitForSelector('#cl-phone');
    await km.fill('#cl-phone', PH); await km.fill('#cl-token', t2); await km.fill('#cl-pin', PIN2); await km.click('#cl-submit');
    await km.waitForSelector('#cl-pin2:visible'); await km.fill('#cl-pin2', PIN2); await km.click('#cl-submit');
    await km.waitForSelector('.vlp-app-karmaster .vlp-today-row');
    const seen = await km.evaluate(async () => (await VLP.api.contracts.list({})).items.length);
    assert.strictEqual(seen, 1, '휴면 전 기록이 보임: ' + seen);
    ok('새 조회번호로 다시 시작 → 새 확인번호, 이전 기록은 숨김(보이는 계약 ' + seen + '건)');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errors.length) { console.error('JS 오류:\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();
  if (!process.exitCode) console.log('\n--- S1 확인번호·휴면·알림 통과 ---');
})();
