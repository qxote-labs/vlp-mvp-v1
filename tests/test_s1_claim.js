// S1 (PWA-06 조회번호 1회 표시, PWA-07 권한, PWA-08 claim, PLAT-03 SMS 비활성): 미가입 카마스터 흐름 e2e.
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
const NEW_PHONE = '010-9999-0009';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [], consoleText = [];
  const track = (p, n) => { p.on('pageerror', e => errors.push(`[${n}] ${e.message}`)); p.on('console', m => { consoleText.push(m.text()); if (m.type() === 'error') errors.push(`[${n}] console: ${m.text()}`); }); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const km = await context.newPage(); track(km, 'karmaster');
    await customer.goto(BASE + '/customer.html?nosw=1');
    await customer.fill('#login-name', '이영희'); await customer.fill('#login-phone', '01011110002'); await customer.click('#login-submit');
    await customer.waitForSelector('#vh-new'); await customer.click('#vh-new');
    await customer.fill('#rq-contract-no', 'KA-777'); await customer.fill('#rq-car', '카니발'); await customer.fill('#rq-km-phone', NEW_PHONE);
    await customer.click('#rq-submit'); await customer.waitForSelector('#vd-token');
    const token = (await customer.textContent('#vd-token')).trim();
    assert.ok(token.length >= 8, '조회번호 표시');
    ok('미가입 카마스터 등록 → 조회번호 표시 (' + token.length + '자)');
    // 안내문에 카마스터 연락처(필수 입력)가 포함된다
    assert.strictEqual((await customer.textContent('#vd-kmphone')).trim(), NEW_PHONE);
    await customer.click('summary:has-text("안내문 미리보기")');
    const notice = await customer.textContent('#vd-notice');
    assert.ok(notice.includes(NEW_PHONE) && notice.includes('필수 입력') && notice.includes(token), '안내문에 연락처/조회번호 누락');
    ok('안내문에 카마스터 연락처(필수 입력)가 포함됨');

    // PLAT-03: 설정 off → 문자 발송 버튼 비활성, 켜면 활성
    assert.strictEqual(await customer.isDisabled('#vd-sms'), true, 'SMS 설정 off인데 버튼 활성');
    ok('시스템 SMS 설정 off → 발송 버튼 비활성');
    await customer.evaluate(() => { localStorage.setItem('vlp_policy', JSON.stringify({ systemSmsEnabled: true })); });
    await customer.reload(); // 새로고침하면 조회번호도 사라지므로 아래에서 확인
    assert.strictEqual(await customer.locator('#vd-token').count(), 0, '새로고침 후 조회번호 재표시');
    const txt = await customer.textContent('body');
    assert.ok(!txt.includes(token), '새로고침 후 화면에 조회번호 남음');
    assert.ok(await customer.locator('#vd-gone').count() === 1);
    ok('새로고침 후 조회번호 재표시 불가');
    await customer.evaluate(() => { localStorage.removeItem('vlp_policy'); });

    // 저장소·알림·이벤트·콘솔 어디에도 평문 없음
    const dump = await customer.evaluate(() => JSON.stringify({
      ls: Object.assign({}, localStorage), ss: Object.assign({}, sessionStorage),
      notif: VLP.api.adapter().admin.notifications(), events: VLP.api.adapter().admin.events(), state: VLP.api.adapter().admin.state(),
    }));
    assert.ok(!dump.includes(token), '저장소/알림/이벤트에 조회번호 평문');
    assert.ok(!consoleText.join('\n').includes(token), '콘솔에 조회번호 평문');
    ok('localStorage·sessionStorage·알림·이벤트·콘솔에 조회번호 평문 없음');

    // 권한 없는 호출은 실제로 거절된다
    const contractId = await customer.evaluate(async () => (await VLP.api.contracts.list({})).items[0].contractId);
    const probe = await customer.evaluate(async ({ id, phone }) => {
      const res = {};
      const t = async (k, fn) => { try { await fn(); res[k] = 'ACCEPTED'; } catch (e) { res[k] = e.status; } };
      VLP.ui.setCustomerSession('이영희', '01011110002');
      await t('customer_approve', () => VLP.api.contracts.approve(id, { destinationType: 'DEALERSHIP' }));
      VLP.ui.setCustomerSession('남', '01011110099');
      await t('other_customer_get', () => VLP.api.contracts.get(id));
      VLP.api.session.clear();
      await t('no_session', () => VLP.api.contracts.list({}));
      VLP.ui.setKarmasterSession(phone, '');
      await t('unclaimed_karmaster_get', () => VLP.api.contracts.get(id));
      VLP.ui.setCustomerSession('이영희', '01011110002');
      return res;
    }, { id: contractId, phone: NEW_PHONE });
    assert.deepStrictEqual(probe, { customer_approve: 404, other_customer_get: 404, no_session: 401, unclaimed_karmaster_get: 404 }, JSON.stringify(probe));
    ok('권한 없는 호출 거절 확인: ' + JSON.stringify(probe));

    // ---- 카마스터: claim (확인번호 정하기 포함) ----
    const PIN = '123456';
    const fillAll = async (tok, pin) => {
      await km.fill('#cl-phone', NEW_PHONE); await km.fill('#cl-token', tok); await km.fill('#cl-pin', pin);
      if (await km.isVisible('#cl-pin2')) await km.fill('#cl-pin2', pin);
    };
    await km.goto(BASE + '/karmaster.html?nosw=1');
    await km.click('text=비가입자이신가요?');
    await km.waitForSelector('#cl-phone');
    assert.strictEqual(await km.locator('#cl-pending').count(), 0, '조회번호 소지 전 대기 건수 노출');
    await fillAll('WRONG0', PIN); await km.click('#cl-submit'); await km.waitForSelector('#cl-pin2:visible'); // 처음이면 확인번호를 한 번 더 받는다(시도 횟수에는 안 셈)
    for (let i = 1; i <= 5; i++) {
      await fillAll('WRONG' + i, PIN); await km.click('#cl-submit');
      await km.waitForFunction((n) => { const t = document.querySelector('#cl-attempts').textContent + document.querySelector('#cl-error').textContent; return new RegExp('실패 ' + n + '회').test(t) || /잠겼/.test(t); }, i);
    }
    ok('오입력 후 실패 횟수 표시: ' + (await km.textContent('#cl-attempts')).trim());
    await fillAll(token, PIN); await km.click('#cl-submit');
    await km.waitForFunction(() => /잠겼/.test(document.querySelector('#cl-attempts').textContent));
    ok('상한 초과 후 올바른 번호도 잠금 메시지: ' + (await km.textContent('#cl-attempts')).trim());
    await km.evaluate((min) => VLP.api.adapter().admin.advanceTime(min * 60000), 16);
    await fillAll(token, PIN);
    await km.click('#cl-submit');
    await km.waitForSelector('.vlp-today');
    await km.waitForSelector('.vlp-app-karmaster .vlp-today-row');
    const html = await km.innerHTML('.vlp-app-karmaster');
    assert.ok(!html.includes('KA-777') && !html.includes('1111-0002'), '승인 전 마스킹 위반');
    ok('잠금 해제 후 claim(확인번호 설정) 성공 → 승인 대기 카드(마스킹) 표시');
    const kdump = await km.evaluate(() => JSON.stringify({ ls: Object.assign({}, localStorage), ss: Object.assign({}, sessionStorage), s: VLP.api.adapter().admin.state() }));
    assert.ok(!kdump.includes('"123456"') && !kdump.includes(token), '확인번호/조회번호 평문 저장');
    ok('확인번호 평문 저장 없음(해시만)');

    // 다시 들어가기: 세션을 비우고 연락처+확인번호로 로그인
    await km.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('vlp_km_session'); });
    await km.goto(BASE + '/karmaster.html?nosw=1');
    await km.click('text=비가입자이신가요?'); await km.waitForSelector('#cl-phone');
    await km.click('#cl-tab-login'); await km.fill('#cl-phone', NEW_PHONE); await km.fill('#cl-pin', '000000'); await km.click('#cl-submit');
    await km.waitForSelector('#cl-error:not([hidden])');
    await km.fill('#cl-pin', PIN); await km.click('#cl-submit');
    await km.waitForSelector('.vlp-app-karmaster .vlp-today-row');
    ok('연락처+확인번호로 다시 들어가기(틀린 번호는 거절)');

    // 같은 카마스터에게 새 고객 계약 → 조회번호 없이 자동 연결, 알림
    const auto = await customer.evaluate(async ({ phone }) => {
      VLP.ui.setCustomerSession('박새고객', '01011110003');
      const c = await VLP.api.contracts.create({ manufacturerContractNo: 'KA-901', vehicleModel: '레이', carmasterPhone: phone });
      return { matched: !!c.carmasterMatched, token: !!c.claimToken };
    }, { phone: NEW_PHONE });
    ok('자동 연결 응답: ' + JSON.stringify(auto));
    assert.strictEqual(auto.token, false, '자동 연결인데 조회번호 발급');
    await km.reload();
    await km.waitForSelector('.vlp-app-karmaster .vlp-today-row');
    const notes = await km.evaluate(async () => (await VLP.api.notifications.list({ limit: 20 })).items.map(n => n.title || n.refType || n.eventType));
    assert.ok(notes.length >= 1, '카마스터 알림 없음');
    ok('새 고객 계약은 조회번호 없이 자동 연결, 카마스터 알림 ' + notes.length + '건: ' + notes.join(','));

    // 만료 후 거부: 새 계약 + 49시간 경과
    await customer.goto(BASE + '/customer.html?nosw=1');
    await customer.waitForSelector('#vd-ok'); await customer.click('#vd-ok'); // 새로고침 뒤 남은 완료 화면에서 나간다
    await customer.waitForSelector('#vh-new'); await customer.click('#vh-new');
    await customer.fill('#rq-contract-no', 'KA-888'); await customer.fill('#rq-car', '모닝'); await customer.fill('#rq-km-phone', '010-9999-0010');
    await customer.click('#rq-submit'); await customer.waitForSelector('#vd-token');
    const token2 = (await customer.textContent('#vd-token')).trim();
    const lateResult = await customer.evaluate(async ({ phone, t }) => {
      VLP.api.adapter().admin.advanceTime(49 * 3600 * 1000);
      VLP.ui.setKarmasterSession(phone, '');
      try { await VLP.api.access.claim({ phone, claimToken: t, pin: '654321', pinConfirm: '654321' }); return 'ACCEPTED'; } catch (e) { return e.status; }
    }, { phone: '010-9999-0010', t: token2 });
    assert.strictEqual(lateResult, 404, '만료 후 claim 허용: ' + lateResult);
    ok('조회번호 만료(49시간) 후 claim 거부 404');

    // ---- 재발급: 만료된 건을 고객이 다시 발급 → 새 번호로 claim, 이전 번호는 무효 ----
    await customer.evaluate(() => goto('history'));
    await UI.custOpen(customer, '모닝');
    await customer.locator('.vlp-reissue-open').click();
    await customer.locator('.vlp-reissue-go').click();
    await customer.waitForSelector('#vd-token');
    const token3 = (await customer.textContent('#vd-token')).trim();
    assert.notStrictEqual(token3, token2, '재발급 번호가 이전과 같음');
    assert.ok(/다시 발급/.test(await customer.textContent('h2')));
    const re = await customer.evaluate(async ({ phone, oldT, newT }) => {
      VLP.ui.setKarmasterSession(phone, '');
      const r = {};
      try { await VLP.api.access.claim({ phone, claimToken: oldT, pin: '654321', pinConfirm: '654321' }); r.old = 'ACCEPTED'; } catch (e) { r.old = e.status; }
      try { await VLP.api.access.claim({ phone, claimToken: newT, pin: '654321', pinConfirm: '654321' }); r.fresh = 'OK'; } catch (e) { r.fresh = e.status; }
      return r;
    }, { phone: '010-9999-0010', oldT: token2, newT: token3 });
    assert.deepStrictEqual(re, { old: 404, fresh: 'OK' }, JSON.stringify(re));
    const dump2 = await customer.evaluate(() => JSON.stringify({ ls: Object.assign({}, localStorage), ss: Object.assign({}, sessionStorage), n: VLP.api.adapter().admin.notifications(), e: VLP.api.adapter().admin.events(), s: VLP.api.adapter().admin.state() }));
    assert.ok(!dump2.includes(token3) && !dump2.includes(token2), '재발급 번호 평문이 저장소에 남음');
    ok('만료 건 재발급 → 새 번호로 claim 성공, 이전 번호 무효(404), 평문 저장 없음');
  } catch (e) {
    console.error('FAIL', e.message); process.exitCode = 1;
  }
  if (errors.length) { console.error('JS 오류:\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();
  if (!process.exitCode) console.log('\n--- S1 claim 흐름 통과 ---');
})();
