// 홈 화면: 고객 홈에 신차케어 건·확인할 일·바로가기 카드, 카마스터 오늘 구역 카드
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const login = async (phone) => { await p.evaluate(() => sessionStorage.clear()); await loginAs(p, 'customer', phone); await p.waitForSelector('.vlp-app'); await p.waitForSelector('.vlp-tile'); };
    // 오지안: 견적 도착(신차케어) → 확인할 일 카드, 진행 중에 케어 건, 바로가기 3카드
    await login('010-7777-7000');
    assert.match(await p.innerText('.vlp-home-sum'), /신차케어 3건/);
    const todo = p.locator('.vlp-todo-care'); assert.strictEqual(await todo.count(), 1);
    assert.match(await todo.innerText(), /투싼 · 울산 A샵/); assert.match(await todo.innerText(), /견적 확인하기/);
    assert.strictEqual(await p.locator('.vlp-case-row[data-care-id]').count(), 2, '진행 중에 나머지 케어 건 2개');
    const tiles = await p.locator('.vlp-tile').allInnerTexts(); assert.strictEqual(tiles.length, 3);
    assert.ok(/카마스터 찾기[\s\S]*상담/.test(tiles[0]) && /계약내역 등록/.test(tiles[1]) && /신차케어 신청/.test(tiles[2]), tiles.join('|'));
    await todo.locator('.vlp-todo-act').click();
    await p.waitForFunction(() => !document.querySelector('.vlp-todo-care') && /투싼/.test(document.body.innerText) && /견적/.test(document.body.innerText)); assert.ok(await p.locator('.vlp-todo-care').count() === 0, '홈이 아니라 케어 건 상세가 열림');
    console.log('✔ 고객 홈: 케어 확인할 일 카드 → 케어 탭, 진행 중 케어 건, 바로가기 카드');
    // 김민준: 해야 할 일 없음 안내 카드, 진행 중에 케어 건
    await login('010-7777-1000');
    assert.match(await p.innerText('.vlp-todo-none'), /지금 해야 할 일이 없어요/);
    assert.ok(await p.locator('.vlp-case-row[data-care-id="20-202601-9001"]').count(), '작업 중인 케어 건이 홈에 보임');
    console.log('✔ 고객 홈: 할 일 없음 카드, 진행 중 케어 건');
    // 바로가기: 계약내역 등록
    await p.click('#vh-new'); await p.waitForTimeout(300); console.log('✔ 바로가기 동작');
    // 카마스터 오늘: 구역 카드와 개수
    await p.evaluate(() => sessionStorage.clear()); await loginAs(p, 'karmaster', 'k1'); await p.waitForSelector('.vlp-today-sec');
    const secs = await p.locator('.vlp-today-sec .vlp-section-title').allInnerTexts(); assert.deepStrictEqual(secs.map((t) => t.replace(/\s+/g, ' ').trim()), ['승인 대기 1', '출고 의뢰 3', '인도 확인 2', '배송 중 3']);
    assert.strictEqual(await p.locator('.vlp-kpi.zero').count(), 1, '0건 요약 칸은 흐리게');
    assert.ok(await p.locator('.vlp-today-sec .vlp-today-row b').first().innerText(), '차량명이 굵은 글씨로');
    console.log('✔ 카마스터 오늘: 구역 카드(승인 대기·출고 의뢰·배송 중), 0건 칸 흐림');
    assert.deepStrictEqual(errs, []);
    console.log('\n--- 홈 화면 통과 ---');
  } catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
