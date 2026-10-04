// e2e 공용 화면 조작 헬퍼 — 화면 구성안 기준 구조(목록 → 상세, 상단 탭, 하단 행동 시트)에 맞춘다.
async function dismissSheets(page) { // 도착 건은 인수 확인 시트가 자동으로 열린다(구성안 2.4) — 다른 조작 전에 닫는다
  try { await page.waitForFunction(() => !document.querySelector('.vlp-case[data-auto]') || document.querySelector('.vlp-sheet'), null, { timeout: 1500 }); } catch (e) { /* 자동 시트 없음 */ }
  for (let i = 0; i < 4 && await page.locator('.vlp-sheet').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); }
}
async function ensureClients(page) {
  await page.locator('.vlp-nav-btn[data-tab=clients]').first().waitFor({ state: 'attached', timeout: 15000 });
  if (!(await page.locator('.vlp-chip').count())) await page.locator('.vlp-nav-btn[data-tab=clients]').first().click();
  await page.waitForSelector('.vlp-chip', { timeout: 15000 });
}
module.exports = {
  dismissSheets, ensureClients,
  /** 고객: 내 차량 탭 → (텍스트가 있으면 그 행, 제외 텍스트 지원) 열기 → 상세 */
  async custOpen(page, o) {
    o = typeof o === 'string' ? { text: o } : (o || {});
    const nav = page.locator('.vlp-nav-btn[data-tab=cars]');
    await nav.first().waitFor({ state: 'attached', timeout: 15000 });
    await dismissSheets(page);
    if (await page.locator('.vlp-case').count() === 0 || await nav.first().isVisible()) { if (await nav.first().isVisible()) await nav.first().click(); }
    await dismissSheets(page);
    // 계약이 1건이면 차량 칩 줄 없이 상세가 바로 열린다(상단 메뉴 레이아웃)
    await page.waitForSelector('.vlp-case-row:not(.vlp-msg-row), .vlp-car-chip, .vlp-nav-car, .vlp-case', { state: 'attached', timeout: 15000 });
    if (await page.locator('.vlp-case-row:not(.vlp-msg-row), .vlp-car-chip, .vlp-nav-car').count() === 0 && await page.locator('.vlp-case').count()) { await dismissSheets(page); return page.locator('.vlp-case'); }
    let row = page.locator('.vlp-case-row:not(.vlp-msg-row), .vlp-car-chip, .vlp-nav-car');
    if (o.text) row = row.filter({ hasText: o.text }); if (o.not) row = row.filter({ hasNotText: o.not });
    await row.first().waitFor({ state: 'attached', timeout: 15000 });
    await page.evaluate(() => { document.querySelectorAll('.vlp-nav-past').forEach((d) => { d.open = true; }); document.querySelectorAll('.vlp-nav-sub[hidden]').forEach((n) => { n.hidden = false; }); }).catch(() => {});
    await row.first().waitFor({ timeout: 15000 });
    await row.first().click();
    await page.waitForSelector('.vlp-case', { timeout: 15000 });
    await dismissSheets(page);
    return page.locator('.vlp-case');
  },
  /** 고객: 이미 상세가 열려 있다고 보고 주소 해시로 바로 가기 */
  async tab(page, label) { await page.locator('.vlp-tab', { hasText: label }).click(); },
  async primary(page, label) {
    // 느린 환경에서는 화면이 다시 그려지거나 도착 건의 인수 확인 시트가 뒤늦게 자동으로 열린다 — 문구가 맞을 때까지 기다리고, 이미 시트가 열렸으면 그대로 쓴다
    const b = page.locator('.vlp-primary-btn:visible').first(); await b.waitFor({ timeout: 10000 });
    if (label) await page.waitForFunction((l) => [...document.querySelectorAll('.vlp-primary-btn')].some((x) => x.offsetParent && x.textContent.includes(l)), label, { timeout: 8000 }).catch(async () => { throw new Error('주요 행동 문구 불일치: ' + (await b.textContent())); });
    await page.waitForTimeout(150);
    if (!(await page.locator('.vlp-sheet, .vlp-rate-screen').count())) { try { await b.click({ timeout: 4000 }); } catch (e) { if (!(await page.locator('.vlp-sheet, .vlp-rate-screen').count())) throw e; } }
    await page.waitForSelector('.vlp-sheet, .vlp-rate-screen');
  },
  async more(page, label) { await page.locator('.vlp-more-btn:visible').first().click(); await page.waitForSelector('.vlp-sheet'); await page.locator('.vlp-menu-item', { hasText: label }).click(); },
  /** 카마스터: 필터 → 행 열기. o: {text, urgent, filter} */
  async kmOpen(page, o) {
    o = typeof o === 'string' ? { text: o } : (o || {});
    await ensureClients(page);
    if (o.filter) await page.locator('.vlp-chip[data-filter=' + o.filter + ']').click();
    let row = page.locator('.vlp-app-karmaster .vlp-case-row');
    if (o.text) row = row.filter({ hasText: o.text }); if (o.urgent) row = row.filter({ has: page.locator('.vlp-row-prog', { hasText: o.urgent === true ? '●' : o.urgent }) });
    await row.first().waitFor({ timeout: 15000 });
    await row.first().click();
    await page.waitForSelector('.vlp-case', { timeout: 15000 });
  },
  async chipCount(page, filter) { await ensureClients(page); const t = await page.locator('.vlp-chip[data-filter=' + filter + ']').textContent(); return parseInt(t.replace(/\D+/g, ''), 10); },
  async waitChip(page, filter, n) { await ensureClients(page); await page.waitForFunction(([f, n]) => { const c = document.querySelector('.vlp-chip[data-filter=' + f + ']'); return c && parseInt(c.textContent.replace(/\D+/g, ''), 10) === n; }, [filter, n], { timeout: 15000 }); },
};
