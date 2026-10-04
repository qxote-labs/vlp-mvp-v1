// 역할 상태 줄: 역할·이름 표시, 높이(폰 22px/PC 26px), 색 대비, 연결 이상 시 주황 줄, 테스트용 바 제거
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    for (const [nm, w, h, hh] of [['폰', 390, 760, 22], ['PC', 1280, 800, 26]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      const rb = (pg) => pg.evaluate(() => { const e = document.querySelector('#vlp-rolebar'); const cs = getComputedStyle(e); return { h: Math.round(e.getBoundingClientRect().height), text: e.innerText.replace(/\s+/g, ' ').trim(), bg: cs.backgroundColor, fg: cs.color, role: e.dataset.role, navbar: !!document.querySelector('.navbar'), footer: !!document.querySelector('.footer-note') }; });
      // 고객
      await loginAs(p, 'customer', 1); await p.waitForSelector('.vlp-app');
      let r = await rb(p); assert.strictEqual(r.h, hh, nm + ' 높이 ' + r.h); assert.ok(!r.navbar && !r.footer, '테스트용 바·안내 제거');
      assert.match(r.text, /^고객 · \S+/, nm + ' 고객 ' + r.text); assert.ok(ratio(r.fg, r.bg) >= 4.5, '대비 ' + ratio(r.fg, r.bg));
      // 카마스터
      await loginAs(p, 'karmaster', 'k1'); await p.waitForSelector('.vlp-app');
      r = await rb(p); assert.strictEqual(r.role, 'karmaster'); assert.match(r.text, /^카마스터 · 김도현/, r.text); assert.ok(ratio(r.fg, r.bg) >= 4.5);
      // 시공사
      await loginAs(p, 'shop', 'a'); await p.waitForSelector('.vlp-app');
      r = await rb(p); assert.strictEqual(r.text, '시공사 · 울산 A샵'); assert.ok(ratio(r.fg, r.bg) >= 4.5);
      assert.notStrictEqual(r.bg, 'rgb(11, 110, 138)', '시공사 색은 고객 색과 다르다');
      // 연결 이상
      await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline')));
      await p.waitForSelector('#vlp-rolebar.is-alert .rb-status');
      r = await rb(p); assert.match(r.text, /^시공사 · 울산 A샵 오프라인/); assert.ok(ratio(r.fg, r.bg) >= 4.5, '경고색 대비 ' + ratio(r.fg, r.bg) + ' ' + r.bg);
      await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online')));
      await p.waitForFunction(() => !document.querySelector('#vlp-rolebar.is-alert'));
      console.log('✔', nm, '폭: 역할·이름·높이·대비·연결 이상/복구');
      // 가로 스크롤 없음
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), nm + ' 가로 스크롤');
      await ctx.close();
    }
    assert.deepStrictEqual(errs, []);
    console.log('\n--- 역할 상태 줄 통과 ---');
  } catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
