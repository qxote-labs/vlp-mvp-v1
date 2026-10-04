// 화면 순회 도우미: 역할별 모든 메뉴(탭)를 차례로 눌러 콜백을 부른다. 폰 폭의 관리자 "더보기"·넓은 폭의 "⋯" 메뉴도 처리한다.
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
const ROLES = [['customer', 1], ['karmaster', 'k1'], ['shop', 'a'], ['supervisor', 'admin_super']];
async function openMenu(p, k, v) {
  if (k === 't') return p.click('.vlp-nav-btn[data-tab=' + v + ']', { timeout: 3000 });
  const s = '.vlp-adm-nav-btn[data-menu=' + v + ']';
  if (await p.locator(s).first().isVisible()) return p.click(s, { timeout: 3000 });
  const mb = (await p.locator('.vlp-adm-more').first().isVisible()) ? '.vlp-adm-more' : '.vlp-adm-ovf';
  await p.click(mb, { timeout: 2000 }); return p.click('.vlp-adm-mi[data-menu=' + v + ']', { timeout: 3000 });
}
async function eachScreen(browser, w, h, cb, errs) {
  for (const [role, id] of ROLES) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage(); if (errs) p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, role, id); await p.waitForSelector('.vlp-app, .vlp-adm'); await p.waitForTimeout(900);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.vlp-nav-btn[data-tab], .vlp-adm-nav-btn[data-menu], .vlp-adm-mi[data-menu]')].map((e) => e.dataset.tab ? ['t', e.dataset.tab] : ['m', e.dataset.menu]).filter((x, i, a) => x[1] !== 'logout' && a.findIndex((y) => y[1] === x[1]) === i));
    const seen = []; for (const [k, v] of tabs) { await openMenu(p, k, v); await p.waitForTimeout(1000); await cb(p, role, v, seen); }
    await p.context().close();
  }
}
module.exports = { eachScreen, ROLES };
