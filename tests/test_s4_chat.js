// S4 PWA-23: 대화 스레드 — 고객/카마스터 주고받기, 이전 대화 보기, 실패 재전송 중복 없음, 관리자 읽기 전용+사유 전 가림, 폭별 배치
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const errs = [];
  const hook = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(n + ' console: ' + m.text()); }); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const d = await ctx.newPage(); hook(d, 'demo');
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const custHref = BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1', kmHref = BASE + '/' + await d.getAttribute('#l-km', 'href') + '&nosw=1';

    const c = await ctx.newPage(); hook(c, 'cust'); await c.setViewportSize({ width: 360, height: 740 });
    await c.goto(custHref);
    const card = await UI.custOpen(c, '아이오닉');
    const cid = await card.getAttribute('data-contract-id');
    // 미리 40개 대화 넣기(이전 대화 보기 검증)
    await c.evaluate(async (id) => { for (let i = 0; i < 40; i++) await VLP.api.engagement.send(id, { body: '메시지 ' + i }, { idempotencyKey: 'seed-key-fixture-' + i }); }, cid);
    await card.locator('.vlp-case-chat').click();
    await c.waitForSelector('.vlp-chatdock .msg-bubble');
    const box = await c.locator('.vlp-chatdock').boundingBox();
    assert.ok(box.x >= 0 && box.width >= 330 && box.y + box.height >= 715 && box.height >= 500, '폰: 본문 칸, 본문 영역 전체 ' + JSON.stringify(box));
    { const rb = await c.evaluate(() => { const r = document.getElementById('vlp-rolebar'); return r ? r.getBoundingClientRect().bottom : 0; }); assert.ok(box.y >= rb - 1, '상단 역할 줄은 가리지 않는다 ' + rb + ' / ' + box.y); }
    assert.ok(/와 대화|과 대화/.test(await c.locator('.vlp-chat-to').innerText()), '대화 상대 표기');
    assert.strictEqual(await c.locator('.vlp-chat-body .msg-bubble').count(), 30);
    assert.ok(/메시지 39/.test(await c.locator('.vlp-chat-body .msg-bubble').last().textContent()), '최신이 하단');
    ok('폰 360: 대화가 역할 줄 아래 본문 자리를 채우고, 최근 30개만 보이고 최신이 하단');
    await c.locator('.vlp-chat-older').click();
    assert.strictEqual(await c.locator('.vlp-chat-body .msg-bubble').count(), 40);
    ok('"이전 대화 보기"로 나머지 로드');

    // 보내기 / Enter
    await c.fill('.vlp-chatdock textarea', '안녕하세요'); await c.press('.vlp-chatdock textarea', 'Enter');
    await c.waitForFunction(() => /안녕하세요/.test(document.querySelector('.vlp-chat-body').textContent) && !document.querySelector('.msg-bubble.pending'));
    ok('Enter로 전송, 하단에 내 말풍선');

    // 실패 재전송 중복 없음
    await c.evaluate(() => VLP.api.adapter().admin.dropResponses && VLP.api.adapter().admin.dropResponses(1));
    await c.fill('.vlp-chatdock textarea', '재전송 테스트'); await c.click('.vlp-chat-send');
    await c.waitForSelector('.vlp-msg-retry');
    await c.click('.vlp-msg-retry');
    await c.waitForFunction(() => !document.querySelector('.msg-bubble.pending'));
    const dup = await c.locator('.vlp-chat-body .msg-bubble', { hasText: '재전송 테스트' }).count();
    assert.strictEqual(dup, 1, '중복 ' + dup);
    ok('응답이 사라진 전송 → [다시 보내기] → 한 번만 등록');
    await c.click('.vlp-chat-close'); assert.strictEqual(await c.locator('.vlp-chatdock').count(), 0);

    // 카마스터에게 보임
    const k = await ctx.newPage(); hook(k, 'km'); await k.setViewportSize({ width: 1400, height: 900 });
    await k.goto(kmHref); await UI.kmOpen(k, '아이오닉');
    await k.locator('.vlp-case .vlp-case-chat').click();
    await k.waitForFunction(() => /재전송 테스트/.test(document.querySelector('.vlp-chat-body').textContent));
    const kb = await k.locator('.vlp-chatdock').boundingBox();
    assert.ok(kb.width <= 361 && kb.x >= 1400 - 361, 'PC: 우측 열 ' + JSON.stringify(kb));
    assert.ok(await k.evaluate(() => parseInt(getComputedStyle(document.body).paddingRight) >= 359), '본문이 가려지지 않음');
    ok('PC 1400: 대화는 우측 고정 열, 본문 폭 확보');

    // 관리자
    const a = await ctx.newPage(); hook(a, 'admin'); await a.setViewportSize({ width: 1400, height: 900 });
    await a.goto(BASE + '/admin.html?nosw=1');
    await a.evaluate(() => { const ad = Store.getAdmins().find(x => x.adminScope === 'community'); window.tryLogin(ad.id); });
    await a.waitForSelector('.vlp-app-admin .vlp-case-row', { timeout: 15000 });
    await a.locator('.vlp-app-admin .vlp-case-row[data-contract-id="' + cid + '"]').click(); await a.waitForSelector('.vlp-case');
    await a.click('.vlp-case-chat');
    await a.waitForSelector('.vlp-chat-masked');
    assert.strictEqual(await a.locator('.vlp-chatdock textarea').count(), 0);
    assert.ok(!/재전송 테스트/.test(await a.locator('.vlp-chat-body').textContent()));
    ok('관리자: 입력창 없음(읽기 전용), 사유 전 본문 가림');
    await a.click('.vlp-chat-reason'); await a.selectOption('#vlp-reason-sel', { index: 1 }); await a.click('.vlp-reason-go');
    await a.waitForFunction(() => /재전송 테스트/.test(document.querySelector('.vlp-chat-body').textContent));
    assert.strictEqual(await a.locator('.vlp-chat-masked').count(), 0);
    ok('사유 선택 → 열람 기록 → 본문 표시');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error('JS 오류:\n' + errs.join('\n')); process.exitCode = 1; }
  await b.close();
  if (!process.exitCode) console.log('\n--- S4 PWA-23 대화 통과 ---');
})();
