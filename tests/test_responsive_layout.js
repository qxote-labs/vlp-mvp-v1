// PWA-05 검증: 360 / 768 / 1280 폭에서 (1) 가로 스크롤 없음 (2) 레이아웃 뼈대가 의도한 열 수 (3) 스크린샷 3장 비교용 저장.
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
const SHOTS = path.join(__dirname, 'screenshots');
const WIDTHS = [[360, 740], [768, 1024], [1280, 800]];

// 로그인 후 목록이 보이는 상태까지 (v6 데모 로그인)
const LOGINS = {
  customer: async (p) => { await loginAs(p, 'customer', 1); await p.waitForTimeout(300); },
  karmaster: async (p) => { await loginAs(p, 'karmaster', 'k1'); await p.waitForTimeout(300); },
  shop: async (p) => { await loginAs(p, 'shop', 'a'); await p.waitForTimeout(300); },
  admin: async (p) => { await loginAs(p, 'admin', 'admin_ulsan'); await p.waitForTimeout(300); },
  index: async () => {},
};

async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        // 자체 가로 스크롤 영역 안쪽은 허용
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === 'auto' || o === 'scroll') && a.getBoundingClientRect().right <= vw + 1) return; }
        bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' right=' + Math.round(r.right));
      }
    });
    return { vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 6) };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let failed = false;
  try {
    // 1) 기존 5개 화면(로그인 전/후)
    for (const [w, h] of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push(w + ' ' + e.message));
      for (const name of Object.keys(LOGINS)) {
        for (const stage of ['before', 'after']) {
          await page.goto(`${BASE}/${name}.html`); await page.waitForTimeout(250);
          if (stage === 'after') await LOGINS[name](page);
          const rep = await overflowReport(page);
          const ok = rep.scrollW <= rep.vw && rep.bad.length === 0;
          if (!ok) { failed = true; console.log(`❌ ${name}(${stage}) @${w}: scrollWidth ${rep.scrollW} > ${rep.vw}`, rep.bad); }
          if (stage === 'after') await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: true });
        }
      }
      await ctx.close();
      if (!failed) console.log(`1) ${w}px: index·customer·karmaster·shop·admin (로그인 전/후) 가로 스크롤 없음`);
    }

    // 2) 레이아웃 뼈대 (S1+ 화면이 쓸 클래스) 열 수·표시 규칙
    const expect = {
      360:  { queueCols: 1, customerCols: 1, chat: 'below', hab: true,  actions: false, chips: 'scroll' },
      768:  { queueCols: 2, customerCols: 1, chat: 'below', hab: true,  actions: false },
      1280: { queueCols: 3, customerCols: 2, chat: 'right', hab: false, actions: true },
    };
    for (const [w, h] of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/tests/fixtures/layout-shell.html`);
      const m = await page.evaluate(() => {
        const cols = (id) => getComputedStyle(document.getElementById(id)).gridTemplateColumns.split(' ').length;
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
        const chat = r('chat'), detail = r('detail'), list = r('list'), body = document.getElementById('chat-body'), chips = document.getElementById('chips');
        const lastMsg = body.lastElementChild.getBoundingClientRect(), firstMsg = body.firstElementChild.getBoundingClientRect();
        const input = document.querySelector('#chat .vlp-chat-input').getBoundingClientRect();
        return {
          queueCols: cols('queue-shell'), customerCols: cols('customer-shell'),
          chat: chat.left >= detail.right - 1 ? 'right' : 'below', listLeftOfDetail: list.right <= detail.left + 1,
          hab: vis('hab'), actions: vis('actions'),
          newestAtBottom: lastMsg.top > firstMsg.top, inputBelowMessages: input.top >= lastMsg.bottom - 1,
          chipsScroll: chips.scrollWidth > chips.clientWidth, chipHeight: Math.round(chips.firstElementChild.getBoundingClientRect().height),
          docScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
      });
      const e = expect[w];
      try {
        assert.equal(m.queueCols, e.queueCols, `작업 큐형 열 수 @${w}`);
        assert.equal(m.customerCols, e.customerCols, `고객형 열 수 @${w}`);
        assert.equal(m.chat, e.chat, `대화 패널 위치 @${w}`);
        assert.equal(m.hab, e.hab, `HAB 표시 @${w}`);
        assert.equal(m.actions, e.actions, `상태 영역 행동 버튼 @${w}`);
        assert.ok(m.newestAtBottom && m.inputBelowMessages, '대화: 최신 하단, 입력 하단');
        assert.ok(m.docScroll, `뼈대 가로 스크롤 @${w}`);
        assert.ok(m.chipHeight >= 44, `칩 터치 영역 ${m.chipHeight}`);
        if (w >= 768) assert.ok(m.listLeftOfDetail, '목록 열이 상세 왼쪽');
        if (w === 360) assert.ok(m.chipsScroll, '칩 줄은 좁은 폭에서 안쪽 가로 스크롤');
        console.log(`2) ${w}px 뼈대 OK:`, JSON.stringify(m));
      } catch (err) { failed = true; console.log('❌', err.message, JSON.stringify(m)); }
      await page.screenshot({ path: path.join(SHOTS, `shell-${w}.png`), fullPage: false });
      await ctx.close();
    }
    if (errors.length) { failed = true; console.log('페이지 오류:', errors); }
  } catch (e) { failed = true; console.error(e); }
  await browser.close();
  console.log(failed ? '\n❌ 반응형 검증 실패' : '\n--- 반응형(360/768/1280) 시나리오 통과 ---');
  process.exitCode = failed ? 1 : 0;
})();
