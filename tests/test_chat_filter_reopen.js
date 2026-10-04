// PC 와이드(≥1440) 카마스터 담당 고객: 필터를 바꿔도(목록이 비어도) 대화 패널은 열린 채 유지되고, 다른 건으로 바뀔 때 본문 폭 표시(vlp-chat-open)가 껐다 켜지지 않는다(깜박임). 몇 초 뒤 같은 화면을 또 그리지 않는다.
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, 'karmaster', 'k1'); await p.waitForSelector('.vlp-app'); await p.click('.vlp-nav-btn[data-tab=clients]'); await p.waitForSelector('.vlp-case-row'); await p.waitForTimeout(800);
    const chat = () => p.evaluate(() => !!document.querySelector('.vlp-chatdock'));
    const pick = async (t) => { await p.locator('.vlp-chip', { hasText: t }).first().click(); await p.waitForTimeout(700); };
    await p.evaluate(() => { window.__bc = 0; new MutationObserver((ms) => { ms.forEach((m) => { if (m.attributeName === 'class' && !document.body.classList.contains('vlp-chat-open')) window.__bc++; }); }).observe(document.body, { attributes: true, attributeFilter: ['class'] }); });
    await pick('완료'); assert.ok(await chat(), '완료: 대화 패널 열림');
    await pick('지연'); assert.ok(await chat(), '지연 0: 건이 없어도 대화 패널은 그대로');
    await pick('완료'); assert.ok(await chat(), '다시 건이 나타나도 열려 있음');
    await pick('배송 중'); assert.ok(await chat(), '다른 건으로 바뀌어도 열려 있음');
    await pick('전체'); assert.ok(await chat(), '전체');
    assert.strictEqual(await p.evaluate(() => window.__bc), 0, '건이 바뀔 때 본문 폭 표시(vlp-chat-open)가 한 번도 꺼지지 않음');
    // 몇 초 뒤 폴링이 같은 화면을 다시 그리지 않는다
    await p.evaluate(() => { window.__n = 0; new MutationObserver(() => { window.__n++; }).observe(document.querySelector('.vlp-app-list'), { childList: true }); });
    await p.waitForTimeout(4500);
    assert.strictEqual(await p.evaluate(() => window.__n), 0, '가만히 두면 목록을 다시 그리지 않음');
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_chat_filter_reopen');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
