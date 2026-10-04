// S1 (PWA-06~11, PLAT-03): 새 계약 흐름 e2e — 등록 → 승인 대기/마스킹 → 거절·재등록 → 승인 → 확인 → 출고 요청 → 출고 의뢰(READY)
// + 미가입 카마스터 조회번호 claim(오입력 잠금 포함). 서버 호출은 모두 facade(목 어댑터)를 거친다.
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
const KM_PHONE = '010-2222-3301'; // v6 시드 카마스터(김도현) — 목 명부에 가입 카마스터로 동기화된다

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const track = (p, n) => { p.on('pageerror', e => errors.push(`[${n}] ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errors.push(`[${n}] console: ${m.text()}`); }); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const customer = await context.newPage(); track(customer, 'customer');
    const km = await context.newPage(); track(km, 'karmaster');

    // ---- 고객 로그인 → 등록 폼 ----
    await customer.goto(BASE + '/customer.html?nosw=1');
    await customer.fill('#login-name', '홍길동'); await customer.fill('#login-phone', '01011110001'); await customer.click('#login-submit');
    await customer.waitForSelector('.vlp-nav-btn');
    await customer.click('#vh-new');
    await customer.waitForSelector('#rq-contract-no');
    // 필수 3개 중 하나라도 비면 제출 불가 (PWA-06)
    assert.strictEqual(await customer.isDisabled('#rq-submit'), true);
    await customer.fill('#rq-contract-no', 'HM-2026-0001'); await customer.fill('#rq-car', '쏘렌토');
    assert.strictEqual(await customer.isDisabled('#rq-submit'), true, '카마스터 연락처 없이 제출 가능');
    await customer.fill('#rq-km-phone', KM_PHONE);
    assert.strictEqual(await customer.isDisabled('#rq-submit'), false);
    await customer.fill('#rq-car', '');
    assert.strictEqual(await customer.isDisabled('#rq-submit'), true, '차량 모델 없이 제출 가능');
    await customer.fill('#rq-car', '쏘렌토');
    ok('필수 3개(제조사 계약번호·차량 모델·카마스터 연락처) 누락 시 제출 불가');

    // 입력 안정성: 타이핑 중 노드 교체 없음
    await customer.evaluate(() => { document.querySelector('#rq-trim').__m = 1; });
    await customer.type('#rq-trim', '시그니처', { delay: 250 });
    assert.strictEqual(await customer.evaluate(() => document.querySelector('#rq-trim').__m === 1), true, '입력 중 노드 교체');
    assert.strictEqual(await customer.inputValue('#rq-trim'), '시그니처');
    ok('입력 중 폼 노드가 유지됨');

    // 서버도 필수 누락을 거부한다 (UI를 우회한 직접 호출)
    const direct = await customer.evaluate(async () => { try { await VLP.api.contracts.create({ vehicleModel: 'x', carmasterPhone: '010-2222-3301' }); return 'accepted'; } catch (e) { return e.status + ':' + e.code; } });
    assert.ok(/^422:/.test(direct), '서버가 필수 누락을 거부해야 함: ' + direct);
    ok('서버 직접 호출도 필수 누락 422 거부 (' + direct + ')');

    await customer.click('#rq-submit');
    await customer.waitForSelector('.vlp-done');
    assert.ok((await customer.textContent('#vd-no')).match(/^SS-\d{6}-\d{4}$/), '서비스 계약번호 형식');
    assert.strictEqual(await customer.locator('#vd-token').count(), 0, '가입 카마스터에게는 조회번호가 없어야 함');
    assert.ok(await customer.locator('#vd-matched').count() === 1);
    ok('가입 카마스터: 승인 요청 전달, 조회번호 없음');
    await customer.click('#vd-ok');

    // ---- 카마스터: 승인 대기 (마스킹) ----
    await km.goto(BASE + '/karmaster.html?nosw=1');
    await km.selectOption('#quick-login', { index: 1 });
    await UI.kmOpen(km, { urgent: '승인 필요' });
    const pendHTML = await km.innerHTML('.vlp-app-karmaster');
    assert.ok(!pendHTML.includes('HM-2026-0001'), '승인 전에 제조사 계약번호가 DOM에 있음');
    assert.ok(!pendHTML.includes('1111-0001') && !pendHTML.includes('01011110001'), '승인 전에 고객 연락처가 DOM에 있음');
    assert.ok(pendHTML.includes('쏘렌토'));
    ok('승인 전 DOM에 고객 연락처·제조사 계약번호 없음 (차량·접수번호·마스킹된 이름만)');

    // 거절 → 고객이 다시 등록 가능
    await UI.primary(km, '승인'); await km.click('.vlp-reject-open'); await km.selectOption('.vlp-sheet [name=reasonCode]', 'WRONG_INFO'); await km.click('.vlp-reject-btn');
    await UI.waitChip(km, 'done', 1);
    await customer.reload(); await UI.custOpen(customer, '쏘렌토');
    await customer.waitForSelector('.vlp-reregister');
    ok('거절됨 → 고객 화면에 "다시 등록" 노출');
    await customer.click('.vlp-reregister');
    await customer.waitForSelector('#rq-contract-no');
    assert.strictEqual(await customer.inputValue('#rq-contract-no'), 'HM-2026-0001', '다시 등록 시 기존 내용 채움');
    await customer.click('#rq-submit'); await customer.waitForSelector('.vlp-done'); await customer.click('#vd-ok');
    ok('거절 후 같은 계약번호로 재등록 가능');

    // ---- 승인 → 확인 → 출고 요청 ----
    await UI.waitChip(km, 'pending', 1); await UI.kmOpen(km, { urgent: '승인 필요' });
    await UI.primary(km, '승인'); await km.check('.vlp-sheet input[value=AFFILIATED_SHOP]');
    await km.click('.vlp-approve-btn');
    await UI.waitChip(km, 'order', 1);
    await customer.reload(); await UI.custOpen(customer, { text: '쏘렌토', not: '거절' });
    await UI.primary(customer, '계약 내용 확인'); await customer.click('.vlp-confirm');
    await UI.primary(customer, '출고 요청');
    await customer.waitForSelector('.vlp-release');
    // REMOTE_PROXY: 동의 없으면 제출 불가 (PWA-09)
    await customer.selectOption('select[name=deliverySiteId]', { index: 1 });
    await customer.check('input[value=REMOTE_PROXY]');
    assert.strictEqual(await customer.isDisabled('.vlp-release-submit'), true, '동의 없이 REMOTE_PROXY 제출 가능');
    await customer.check('input[name=proxyConsent]');
    assert.strictEqual(await customer.isDisabled('.vlp-release-submit'), false);
    await customer.uncheck('input[name=proxyConsent]');
    assert.strictEqual(await customer.isDisabled('.vlp-release-submit'), true);
    ok('REMOTE_PROXY 선택 시 위임 동의 미체크면 제출 불가');
    await customer.check('input[name=proxyConsent]');
    await customer.click('.vlp-release-submit');
    await customer.waitForSelector('[data-role=released]');
    ok('출고 요청 전송');

    // ---- 카마스터 출고 의뢰 → 고객 READY 칩 (PWA-10) ----
    await UI.kmOpen(km, { urgent: '출고 의뢰' }); await UI.primary(km, '출고 의뢰'); await km.click('.vlp-order-btn');
    await UI.ensureClients(km); await km.waitForSelector('.vlp-app-karmaster .vlp-case-row .vlp-state-chip[data-state=READY]');
    await customer.reload(); await UI.custOpen(customer, { text: '쏘렌토', not: '거절' }); await customer.waitForSelector('.vlp-case .vlp-state-chip[data-state=READY]');
    ok('출고 의뢰 후 고객 화면 상태 칩 READY');

    // ---- PWA-11: 펼침/접힘 필드 누락 없음 ----
    const labels = ['서비스 계약번호', '제조사 계약번호', '차량', '계약일자', '카마스터', '계약자', '목적지·수령지', '상담 메모', '이력'];
    await UI.tab(customer, '개요');
    await customer.click('.vlp-sum-top');
    let body = await customer.textContent('.vlp-sum-more');
    labels.forEach(l => assert.ok(body.includes(l), '개요 탭에 ' + l + ' 없음'));
    assert.ok(body.includes('HM-2026-0001'), '제조사 계약번호 값 누락');
    assert.strictEqual(await customer.locator('.vlp-tab').count(), 4, '배송이 있으면 탭 4개(개요·위치·시공·이력)');
    await UI.tab(customer, '이력'); await customer.waitForSelector('.vlp-hist-tab');
    ok('건 상세 개요 탭: 필드 누락 없음(제조사 계약번호 포함), 탭 4개(개요·위치·시공·이력)');
  } catch (e) {
    console.error('FAIL', e.message); process.exitCode = 1;
  }
  if (errors.length) { console.error('JS 오류:\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();
  if (!process.exitCode) console.log('\n--- S1 계약 흐름 통과 ---');
})();
