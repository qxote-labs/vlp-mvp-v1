// 보강 정보(위치·안내) 게시 → 고객 알림 + 고객 화면 위치 갱신 / 탁송 중 시연 건 존재
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const errs = [];
  try {
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load');
    await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const before = await p.evaluate(() => VLP.api.adapter().admin.notifications().length);
    await loginAs(p, 'karmaster', 'k1'); await p.waitForSelector('.vlp-app'); await p.click('.vlp-nav-btn[data-tab=clients]');
    const row = p.locator('.vlp-case-row', { hasText: '아반떼' }); assert.ok(await row.count(), '탁송 중 시연 건(아반떼)이 있다');
    assert.match(await row.first().innerText(), /탁송 중/);
    await row.first().click(); await p.waitForSelector('.vlp-case');
    await p.getByRole('button', { name: '보강정보 입력' }).first().click(); await p.waitForSelector('.vlp-aug-form');
    await p.selectOption('.vlp-aug-form [name=kind]', 'LOCATION'); await p.fill('.vlp-aug-form [name=text]', '구미 휴게소 경유 중'); await p.click('.vlp-aug-form button'); await p.waitForSelector('.vlp-aug-form', { state: 'detached', timeout: 20000 }); await p.waitForTimeout(600); // 저장이 끝나 입력창이 닫힌 뒤에 확인(부하가 있을 때 고정 대기만으로는 모자람)
    assert.strictEqual(await p.evaluate(() => VLP.api.adapter().admin.notifications().length), before, '초안만으로는 알림이 가지 않는다');
    // 초안 목록은 저장 뒤 서버에서 다시 읽어 와야 보이므로, 부하가 있을 때는 시트를 닫았다 다시 열어 확인한다(최대 4번)
    for (let k = 0; k < 4; k++) {
      await p.getByRole('button', { name: '보강정보 입력' }).first().click();
      if (await p.waitForSelector('.vlp-draft button', { timeout: 6000 }).then(() => true, () => false)) break;
      await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
    }
    await p.waitForSelector('.vlp-draft button'); await p.locator('.vlp-draft button').first().click(); await p.waitForTimeout(700);
    const notes = await p.evaluate(() => VLP.api.adapter().admin.notifications());
    const n = notes.slice(before).find((x) => x.toRole === 'customer' && /배송 안내/.test(x.text));
    assert.ok(n, '게시하면 고객에게 알림이 간다'); assert.ok(!/구미/.test(n.text), '알림 문구에 위치 평문을 싣지 않는다');
    console.log('✔ 위치 안내 게시 → 고객 알림, 초안은 알림 없음');
    console.log('✔ 탁송 중 시연 건 존재');
    assert.deepStrictEqual(errs, [], errs.join('\n'));
    console.log('\n--- 보강 정보 알림 통과 ---');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
