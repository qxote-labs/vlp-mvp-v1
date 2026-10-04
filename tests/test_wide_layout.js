// 넓은 화면(v101): ① 단일 목록 탭(오늘·내 차량·신차케어)도 창 높이에 맞춰 바깥 스크롤이 없다 ② 관리자 상단 메뉴와 제목 사이 여백 ③ 넓은 화면에서 대화창이 본문 틀 바로 옆(간격 16)에 붙는다 ④ 고객 폭만 1180 유지
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (w, h, role, id) => {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, role, id); await p.waitForSelector('.vlp-app, .vlp-adm'); await p.waitForTimeout(1000); return p;
  };
  const over = (p) => p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  try {
    for (const [w, h] of [[1920, 950], [1440, 800]]) {
      let p = await open(w, h, 'karmaster', 'k1'); assert.strictEqual(await over(p), 0, '카마스터 오늘 ' + w + 'x' + h); await p.context().close();
      p = await open(w, h, 'shop', 'a'); assert.strictEqual(await over(p), 0, '시공사 오늘 ' + w + 'x' + h); await p.context().close();
      p = await open(w, h, 'customer', 1);
      for (const t of ['cars', 'care']) { await p.click('.vlp-nav-btn[data-tab=' + t + ']'); await p.waitForTimeout(1800); assert.strictEqual(await over(p), 0, '고객 ' + t + ' ' + w + 'x' + h); }
      await p.context().close();
    }
    console.log('✔ 단일 목록 탭: 창 높이에 맞춤(바깥 스크롤 없음)');
    let p = await open(1440, 900, 'supervisor', 'admin_super'); await p.click('.vlp-adm-nav-btn[data-menu=care]'); await p.waitForSelector('.vlp-pane-head', { timeout: 15000 }); await p.waitForTimeout(800);
    const gap = await p.evaluate(() => document.querySelector('.vlp-pane-head').getBoundingClientRect().top - document.querySelector('.vlp-adm-nav').getBoundingClientRect().bottom);
    assert.ok(gap >= 8, '관리자 메뉴-제목 간격 ' + gap); await p.context().close(); console.log('✔ 관리자 상단 메뉴 아래 여백 ' + Math.round(gap) + 'px');
    p = await open(2560, 1300, 'karmaster', 'k1'); await p.click('.vlp-nav-btn[data-tab=clients]'); await p.waitForSelector('.vlp-case-row'); await p.waitForSelector('.vlp-chatdock'); await p.waitForTimeout(1500);
    const g = await p.evaluate(() => { const f = document.querySelector('.frame').getBoundingClientRect(), d = document.querySelector('.vlp-chatdock').getBoundingClientRect(); return { gap: Math.round(d.left - f.right), fw: Math.round(f.width) }; });
    assert.ok(Math.abs(g.gap - 16) <= 2, '틀-대화창 간격 ' + g.gap); assert.ok(g.fw > 1180, '카마스터 틀 폭 ' + g.fw); await p.context().close();
    p = await open(2560, 1300, 'customer', 1); const cw = await p.evaluate(() => Math.round(document.querySelector('.app').getBoundingClientRect().width)); assert.ok(cw <= 1180, '고객 폭 ' + cw); await p.context().close();
    console.log('✔ 대화창은 본문 틀 바로 옆(16px), 고객 폭만 1180 유지');
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_wide_layout');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
