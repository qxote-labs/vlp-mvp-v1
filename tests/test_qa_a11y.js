// QA-03: 접근성·성능 점검 자동 측정. 결과는 tests/screenshots/qa03-report.json 에 남기고, 가로 넘침·글자 확대 깨짐·이름 없는 버튼은 실패로 본다.
// 대비·터치 크기·저사양 로딩 시간은 "측정값을 기록"하고 기준 미달 목록을 보고서에 담는다(사람이 판단).
const { chromium } = require('playwright'); const assert = require('assert');
const UI = require('./_ui'); const fs = require('fs'); const path = require('path');
const BASE = 'http://localhost:8000';
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); const errs = []; const report = { pages: {} };
  try {
    const d = await ctx.newPage(); await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    for (const s of ['dispatch', 'transit', 'arrive', 'inspect']) { await d.click('[data-step=' + s + ']'); await d.waitForFunction(() => /완료:|실패:/.test(document.querySelector('#step-status').textContent)); await d.evaluate(() => { document.querySelector('#step-status').textContent = ''; }); }
    const targets = { customer: BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1', karmaster: BASE + '/' + await d.getAttribute('#l-km', 'href') + '&nosw=1' };
    for (const [name, url] of Object.entries(targets)) {
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message));
      const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); // 저사양 기기 흉내(4배 느리게)
      const t0 = Date.now(); await p.goto(url); await p.waitForSelector(name === 'customer' ? '.vlp-nav-btn' : '.vlp-app-karmaster .vlp-today-row'); const loadMs = Date.now() - t0;
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      if (name === 'customer') { await UI.custOpen(p, '아이오닉'); } else { await UI.kmOpen(p, '아이오닉'); }
      await p.waitForSelector('.vlp-case'); await p.waitForTimeout(300);
      const measure = () => p.evaluate((lumSrc) => {
        const lum = eval('(' + lumSrc + ')');
        const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor.match(/[\d.]+/g).map(Number); if (c.length < 4 || c[3] > 0.95) return c.slice(0, 3); } return [255, 255, 255]; };
        const small = [], lowC = [], noName = [];
        document.querySelectorAll('button, a.btn, a[href], input:not([type=hidden]), select, textarea, summary').forEach((e) => {
          if (!vis(e)) return; const r = e.getBoundingClientRect();
          if (r.height < 44 || r.width < 44) small.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          const nm = (e.getAttribute('aria-label') || e.textContent || e.value || e.placeholder || (e.labels && e.labels[0] && e.labels[0].textContent) || e.title || '').trim();
          if (!nm) noName.push(e.outerHTML.slice(0, 80));
        });
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n, seen = new Set();
        while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const e = n.parentElement; if (!e || !vis(e) || seen.has(e)) continue; seen.add(e);
          const s = getComputedStyle(e), fg = s.color.match(/[\d.]+/g).map(Number), bgc = bg(e);
          const L1 = lum(fg[0], fg[1], fg[2]), L2 = lum(bgc[0], bgc[1], bgc[2]), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const px = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700, need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
          if (ratio < need) lowC.push(e.className + ' "' + t.slice(0, 20) + '" ' + ratio.toFixed(2) + '<' + need);
        }
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, lowC, noName, minFont: Math.min(...[...document.querySelectorAll('body *')].filter(vis).filter(e => e.childNodes.length && [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize))) };
      }, lum.toString());
      const base = await measure();
      await p.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); // 글자 크기 확대(기기 설정 200% 흉내)
      const big = await measure(); await p.screenshot({ path: path.join(__dirname, 'screenshots', 'qa03-' + name + '-200.png'), fullPage: false });
      report.pages[name] = { loadMsAt4xCpu: loadMs, base: { overflow: base.overflow, minFontPx: base.minFont, smallTargets: base.small.length, lowContrast: base.lowC.length, unnamed: base.noName.length }, at200: { overflow: big.overflow }, smallTargetsList: base.small.slice(0, 15), lowContrastList: base.lowC.slice(0, 15), unnamedList: base.noName };
      assert.ok(base.overflow <= 0, name + ' 360px 가로 넘침 ' + base.overflow); assert.ok(big.overflow <= 2, name + ' 글자 200%에서 가로 넘침 ' + big.overflow);
      assert.strictEqual(base.noName.length, 0, name + ' 이름 없는 조작 요소: ' + base.noName.join(' | '));
      console.log('✔ ' + name + ': 가로 넘침 없음(360px·글자 200%), 이름 없는 조작 요소 0, 4배 느린 CPU 로딩 ' + loadMs + 'ms, 터치 44px 미만 ' + base.small.length + '개, 대비 미달 ' + base.lowC.length + '개, 최소 글자 ' + base.minFont + 'px');
    }
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  fs.writeFileSync(path.join(__dirname, 'screenshots', 'qa03-report.json'), JSON.stringify(report, null, 2));
  if (errs.length) { console.error('JS 오류:\n' + errs.join('\n')); process.exitCode = 1; }
  await b.close(); if (!process.exitCode) console.log('\n--- QA-03 측정 완료 (tests/screenshots/qa03-report.json) ---');
})();
