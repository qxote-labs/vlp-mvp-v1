// 관리자 신차케어: 이의 중재 메뉴(보완 대기 / 운영자 중재 필요 구분) · 중재 완료 · 입고 경로·청구 표시
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const id = '20-202601-9001';
    // 시공 완료 → 검수 요청(추가 금액) → 이의 2건(보완 / 중재) 상황을 만든다
    await loginAs(p, 'supervisor', 'admin_super', '');
    await p.evaluate((i) => { Store.setCareShopStage(i, '최종검수'); Store.setCareCharged(i, 200000, '후면 PPF'); Store.requestCareInspection(i); Store.raiseCareDispute(i, '문 하단 기포', { escalated: false }); }, id);
    await p.reload(); await p.waitForSelector('.vlp-adm-nav-btn[data-menu=dispute]');
    assert.ok(/●3/.test(await p.locator('.vlp-adm-nav-btn[data-menu=dispute]').innerText()), '시드 2건(9006 보완·9007 중재) + 방금 만든 1건');
    await p.click('.vlp-adm-nav-btn[data-menu=dispute]'); await p.waitForSelector('#admin-care-list .vlp-case-row');
    assert.ok(/보완 중 \(이의 1회\)/.test(await p.locator('#admin-care-list').innerText()));
    assert.ok(/중재/.test(await p.locator('#admin-care-list .vlp-case-row').first().innerText()), '운영자 중재 건이 맨 위');
    await p.locator('#admin-care-list .vlp-case-row', { hasText: id }).first().click(); await p.waitForSelector('#admin-care-detail');
    let t = (await p.locator('#admin-care-detail').innerText()).replace(/\s+/g, ' ');
    assert.ok(/운영자 조치 불필요/.test(t) && /이의 회차 1회째/.test(t) && !(await p.locator('#a-resolve-dispute').count()), '이의 건은 운영 탭이 먼저 열림: ' + t.slice(0, 300));
    await p.locator('#admin-care-detail .vlp-tabs [role=tab]').nth(1).click(); t = (await p.locator('#admin-care-detail').innerText()).replace(/\s+/g, ' ');
    assert.ok(/입고 경로 고객 방문/.test(t) && /견적 1,730,000원 \+ 추가 200,000원/.test(t), '진행 탭에 입고·청구');
    assert.deepStrictEqual(await p.locator('#admin-care-detail .vlp-tabs [role=tab]').allInnerTexts(), ['개요', '진행', '운영', '이력'], '관리자 케어 상세 탭 = 고객·시공사와 같은 개요·진행·이력 + 관리자 전용 운영');
    console.log('✔ 보완 대기 건: 이의 회차·입고 경로·청구(견적+추가) 표시, 운영자 조치 버튼 없음');
    // 한도 초과 → 운영자 중재
    await p.evaluate((i) => { Store.completeCareRework(i); Store.raiseCareDispute(i, '재시공 요청', { escalated: true }); }, id);
    await p.reload(); await p.click('.vlp-adm-nav-btn[data-menu=dispute]'); await p.locator('#admin-care-list .vlp-case-row', { hasText: id }).first().click();
    assert.ok(/운영자 중재 중/.test(await p.locator('#admin-care-list').innerText()));
    await p.waitForSelector('#a-resolve-dispute'); await p.click('#a-resolve-dispute');
    await p.waitForFunction((i) => { const c = Store.getCareOrder(i); return c && !c.disputed && !c.escalated && c.status === '고객검수대기'; }, id);
    const rest = await p.locator('#admin-care-list').innerText(); assert.ok(!rest.includes(id) && rest.includes('20-202601-9006') && rest.includes('20-202601-9007'), '해소한 건은 빠지고 시드 이의 2건은 남는다');
    // 시드 9007(한도 초과): 이의 회차·사유가 상세에 보이고 중재 버튼이 있다
    await p.locator('#admin-care-list .vlp-case-row', { hasText: '20-202601-9007' }).first().click(); await p.waitForSelector('#a-resolve-dispute');
    t = (await p.locator('#admin-care-detail').innerText()).replace(/\s+/g, ' ');
    assert.ok(/보완 후에도 같은 부위 들뜸/.test(t) && /3회/.test(t), t.slice(0, 200));
    console.log('✔ 운영자 중재 필요 건: 중재 완료 → 고객 재검수 대기로 복귀, 이의 큐 비워짐');
    assert.deepStrictEqual(errs, []); console.log('PASS test_admin_care');
  } catch (e) { console.error('FAIL', e.message, errs); process.exitCode = 1; } finally { await b.close(); }
})();
