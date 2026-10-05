// 터치 기기(아이패드 폭): 칸 모드를 쓰지 않아 내용이 창보다 길어도 페이지 스크롤로 끝까지 볼 수 있다 + 마우스 PC는 칸 모드 유지
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const { ROLES, openMenu } = require('./_screens');
const probe = () => { const out = []; document.querySelectorAll('.frame *').forEach((e) => { if (e.closest('.vlp-chatdock')) return; const cs = getComputedStyle(e); if (!/(auto|scroll)/.test(cs.overflowY) || e.clientHeight < 150) return; if (e.scrollHeight - e.clientHeight > 2) out.push((e.className.toString().slice(0, 30) || e.tagName) + ' ' + e.clientHeight + '/' + e.scrollHeight); }); return { fit: document.querySelectorAll('.fit-panes').length, sc: out.slice(0, 3) }; };
const BASE = 'http://localhost:8000';
async function open(b, ctxOpts) {
  const p = await (await b.newContext(ctxOpts)).newPage();
  await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
  await loginAs(p, 'customer', 1); await p.waitForSelector('.vlp-app'); await p.waitForTimeout(800);
  await p.click('.vlp-nav-btn[data-tab=cars]'); await p.waitForTimeout(1200); return p;
}
(async () => {
  const b = await chromium.launch();
  try {
    for (const [w, h] of [[820, 1180], [1180, 820], [1024, 768]]) {
      const p = await open(b, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const r = await p.evaluate(() => { const d = document.querySelector('.vlp-app-detail'), cs = d && getComputedStyle(d);
        return { coarse: matchMedia('(pointer: coarse)').matches, fit: document.querySelector('.vlp-app').classList.contains('fit-panes'), ov: cs && cs.overflowY, own: d ? d.scrollHeight - d.clientHeight : 0 }; });
      assert(r.coarse, w + ' 터치 에뮬레이션 안 됨'); assert(!r.fit, w + ' 터치 기기인데 칸 모드가 켜짐'); assert(r.own <= 1, w + ' 상세 칸 안쪽에 스크롤이 갇힘 ' + r.own);
      await p.context().close();
    }
    // 모든 역할·메뉴: 터치 기기에서 칸 안쪽 스크롤 상자가 없어야 한다(막대가 안 보여 내용을 놓침)
    const bad = [];
    for (const [w, h] of [[820, 1180], [1180, 820]]) for (const [role, id] of ROLES) {
      const p = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      await loginAs(p, role, id); await p.waitForSelector('.vlp-app, .vlp-adm'); await p.waitForTimeout(800);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('.vlp-nav-btn[data-tab], .vlp-adm-nav-btn[data-menu], .vlp-adm-mi[data-menu]')].map((e) => e.dataset.tab ? ['t', e.dataset.tab] : ['m', e.dataset.menu]));
      for (const [k, v] of tabs) {
        try { await openMenu(p, k, v); } catch (e) { continue; } await p.waitForTimeout(800);
        const chk = async (when) => { const r = await p.evaluate(probe); if (r.fit || r.sc.length) bad.push(w + ' ' + role + ' ' + v + ' ' + when + ' ' + JSON.stringify(r)); };
        await chk('목록');
        const row = p.locator('.vlp-case-row, .vlp-car-chip').first();
        if (await row.count() && await row.isVisible().catch(() => false)) { await row.click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(600); await chk('상세'); }
      }
      await p.context().close();
    }
    assert.deepStrictEqual(bad, [], '\n' + bad.join('\n'));
    const p = await open(b, { viewport: { width: 1440, height: 900 } });
    assert(await p.evaluate(() => document.querySelector('.vlp-app').classList.contains('fit-panes')), '마우스 PC에서 칸 모드가 꺼짐');
    console.log('PASS test_touch_scroll');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
