/* vlp-boot.js — 모든 화면이 맨 먼저 로드하는 부트스트랩 (PWA-02/04).
 *  - api-facade의 어댑터를 설정(VLP.config 'adapter') 한 줄로 고른다.
 *  - 서비스 워커를 등록하고, 오프라인/마지막 상태 배너를 띄운다.
 *  - 로그아웃 시 VLP.pwa.clearApiCache()로 조회 캐시를 비운다.
 */
(function (g) {
  'use strict';
  g.VLP = g.VLP || {};
  const V = g.VLP;
  if (V.api && !V.api.adapter()) V.bootApi();

  const SYNC_KEY = 'vlp_last_sync';
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } } };
  const fmt = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  let staleAt = null, bannerEl = null, pendingN = 0;
  // 업로드 대기 건수: 큐가 바뀔 때마다 갱신해 두고 배너는 이 값을 쓴다(깜박임 방지)
  function refreshPending() { try { const q = V.uploadQueue && V.uploadQueue.shared(); if (q && q.pendingCount) q.pendingCount().then((n) => { if (n !== pendingN) { pendingN = n; render(); } }).catch(() => {}); } catch (e) { /* 큐 없음 */ } }

  function ensureBanner() {
    if (bannerEl || typeof document === 'undefined' || !document.body) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'vlp-offline-banner'; bannerEl.setAttribute('role', 'status'); bannerEl.setAttribute('aria-live', 'polite'); bannerEl.hidden = true;
    document.body.appendChild(bannerEl); return bannerEl;
  }
  function render() {
    const rb = V.rolebar && V.rolebar.mounted() ? V.rolebar : null;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline && !staleAt) { if (rb) rb.status(null); const b = bannerEl; if (b) b.hidden = true; return; }
    const last = staleAt || ls.get(SYNC_KEY);
    const full = (offline ? '오프라인입니다. 마지막으로 확인한 상태를 보고 있어요' : '연결이 불안정해 저장된 상태를 보여드려요') + (last ? ' · 마지막 갱신 ' + fmt(last) : '') + (pendingN > 0 ? ' · 업로드 대기 ' + pendingN + '건' + (offline ? ' · 연결되면 자동 전송' : '') : '');
    if (rb) { // 역할 상태 줄이 있으면 그 줄에 짧게 보이고, 전체 문구는 툴팁/읽기용으로 둔다
      if (bannerEl) bannerEl.hidden = true;
      rb.status({ text: (offline ? '오프라인' : '저장된 상태') + (pendingN > 0 ? ' · 업로드 대기 ' + pendingN + '건' : ''), title: full });
      return;
    }
    const el = ensureBanner(); if (!el) return;
    el.textContent = full; el.hidden = false;
  }

  const pwa = {
    lastSync() { return ls.get(SYNC_KEY); },
    markUpdated() { staleAt = null; ls.set(SYNC_KEY, new Date().toISOString()); render(); },
    markStale(cachedAt) { staleAt = cachedAt || ls.get(SYNC_KEY); render(); },
    isOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; },
    async clearApiCache() {
      try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' }); } catch (e) { /* 무시 */ }
    },
    _deferredInstall: null,
    async install() { const p = pwa._deferredInstall; if (!p) return false; p.prompt(); const r = await p.userChoice; pwa._deferredInstall = null; return r.outcome === 'accepted'; },
    async register() {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
      const okOrigin = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!okOrigin || /[?&]nosw=1/.test(location.search)) return null;
      try { return await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('[vlp] 서비스 워커 등록 실패', e); return null; }
    },
  };
  V.pwa = pwa;

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { refreshPending(); render(); }); window.addEventListener('offline', () => { refreshPending(); render(); });
    setInterval(refreshPending, 2500); // 이벤트를 놓쳐도 대기 건수가 곧 따라오게 한다
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa._deferredInstall = e; });
    if (V.api) {
      V.api.onResponse((req, res) => { if (res.status >= 200 && res.status < 300) { if (res.fromCache) pwa.markStale(res.cachedAt); else pwa.markUpdated(); } });
    }
    const init = () => { try { if (V.uploadQueue) V.uploadQueue.shared().on(refreshPending); } catch (e) { /* 큐 없음 */ } refreshPending(); render(); pwa.register(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = pwa;
})(typeof window !== 'undefined' ? window : globalThis);

/* ---- 아래에 더 있다는 표시 (폰·태블릿, 공통) ----
 * 페이지가 화면보다 길고 아직 끝까지 안 내려왔으면 하단에 ↓ 칩을 보인다. 채팅·시트가 열려 있으면 숨긴다. */
(function (g) {
  if (typeof document === 'undefined' || g.__vlpScrollHint) return; g.__vlpScrollHint = true;
  const mq = g.matchMedia ? g.matchMedia('(max-width: 1023.98px)') : { matches: false };
  let box = null, raf = 0;
  function ensure() {
    if (box) return box;
    box = document.createElement('div'); box.className = 'vlp-scrollhint'; box.hidden = true;
    box.innerHTML = '<button type="button" aria-label="아래에 내용이 더 있어요. 아래로 이동"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><path d="M5 8.5 11 14.5l6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    box.querySelector('button').addEventListener('click', () => g.scrollBy({ top: Math.round(g.innerHeight * 0.7), behavior: 'smooth' }));
    document.body.appendChild(box); return box;
  }
  function update() {
    raf = 0; if (!document.body) return;
    const de = document.documentElement, remain = de.scrollHeight - (g.scrollY + g.innerHeight);
    const busy = document.body.classList.contains('vlp-chat-open') || document.querySelector('.vlp-sheet, .vlp-rate-screen');
    const show = mq.matches && remain > 56 && !busy;
    if (!show && !box) return;
    const b = ensure(); b.hidden = !show; if (!show) return;
    const nav = document.querySelector('.vlp-bottomnav'); let off = 0;
    if (nav && getComputedStyle(nav).position === 'fixed') { const r = nav.getBoundingClientRect(); if (r.height) off = Math.max(0, g.innerHeight - r.top); }
    b.style.setProperty('--sh-b', off + 'px');
  }
  const kick = () => { if (!raf) raf = g.requestAnimationFrame(update); };
  const start = () => {
    g.addEventListener('scroll', kick, { passive: true }); g.addEventListener('resize', kick);
    try { new MutationObserver(kick).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] }); } catch (e) { /* 무시 */ }
    kick();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);

/* 카마스터·시공사 2단(목록 | 상세): 창이 충분히 높으면(설정 fitPanesMinHeight, 기본 700px 이상) 목록·상세를 "화면 높이에 맞춘 칸"으로 만들어 각자 안에서만 스크롤하게 한다.
 * 칸 높이 = 화면 높이 − 칸 윗선 − 아래 여백(26px). 칸 윗선 위치는 화면마다 달라 여기서 재서 --pane-top 으로 CSS에 넘긴다.
 * 낮은 창·폰은 이 클래스를 달지 않아 기존대로 페이지 전체가 스크롤된다. 목록 아래에 항목이 더 있으면 .more-below 를 달아 "더 있음" 표시를 켠다. */
(function (g) {
  'use strict';
  const MIN_H = (() => { try { return (g.VLP && g.VLP.config && g.VLP.config.get('fitPanesMinHeight')) || 700; } catch (e) { return 700; } })(), MIN_W = 768; // 노트북 브라우저 높이(약 700~800px)에서도 칸 모드가 켜지도록 700 [제안]
  let raf = 0, listEl = null, detEl = null, mo = null, lastScroll = 0, lastSig = '';
  const watch = () => { if (mo) try { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'data-tab'] }); } catch (e) { /* 무시 */ } };
  const onListScroll = () => { if (listEl) listEl.classList.toggle('more-below', listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight > 4); };
  const onDetScroll = () => { if (!detEl) return; const act = detEl.querySelector('.vlp-case-act'); detEl.style.setProperty('--act-h', (act ? act.offsetHeight : 0) + 'px'); detEl.classList.toggle('more-below', detEl.scrollHeight - detEl.scrollTop - detEl.clientHeight > 4); }; // 아래 고정 버튼 줄이 있으면 그 위에 "더 있음" 표시
  const onListScrollEv = () => { lastScroll = g.Date.now(); onListScroll(); };
  const onDetScrollEv = () => { lastScroll = g.Date.now(); onDetScroll(); };
  const update = () => {
    raf = 0;
    if (g.Date.now() - lastScroll < 250) { g.setTimeout(kick, 260); return; } // 손가락·휠로 스크롤하는 동안엔 칸을 다시 재지 않는다(재면서 칸 높이를 바꾸면 iOS 가 스크롤을 끊음)
    if (mo) mo.disconnect(); // 이 함수가 바꾸는 클래스가 다시 이 함수를 부르지 않게 잠시 끊는다
    try { run(); } finally { watch(); }
  };
  const run = () => {
    const app = document.querySelector('.vlp-app-karmaster.has-case.lay-top[data-tab=clients], .vlp-app-shop.has-case.lay-top[data-tab=clients], .vlp-app-admin.lay-top[data-tab=cases], .vlp-app-admin.lay-top[data-tab=care], .vlp-app-karmaster.lay-top[data-tab=today]:not(.has-case), .vlp-app-shop.lay-top[data-tab=today]:not(.has-case), .vlp-app-karmaster.lay-top[data-tab=me], .vlp-app-shop.lay-top[data-tab=me], .vlp-app-customer.has-case[data-tab=cars], .vlp-app-customer.has-case[data-tab=care]');
    const all = document.querySelectorAll('.vlp-app.fit-panes');
    all.forEach((a) => { if (a !== app) { a.classList.remove('fit-panes'); const l = a.querySelector('.vlp-app-list'); if (l) l.classList.remove('more-below'); } });
    if (!app) { listEl = null; return; }
    const list = app.querySelector('.vlp-app-list');
    const det0 = app.querySelector('.vlp-app-detail'), closed = !!list && getComputedStyle(list).display === 'none'; // 목록을 접어도 상세 칸은 같은 높이 규칙을 따른다
    const coarse = (() => { try { return !!(g.matchMedia && g.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } })(); // 아이패드 등 터치 기기: 칸 높이를 dvh 계산 대신 px 로 직접 넣는다
    const ok = g.innerWidth >= MIN_W && g.innerHeight >= MIN_H && list && (!closed || det0);
    if (!ok) { app.classList.remove('fit-panes'); if (list) list.classList.remove('more-below'); listEl = null; return; }
    const was = app.classList.contains('fit-panes'); if (!was) app.classList.add('fit-panes'); // 이미 켜져 있으면 건드리지 않는다(껐다 켜면 목록 스크롤 위치가 초기화됨)
    const pr = (closed || app.classList.contains('vlp-app-customer')) ? det0 : list; // 고객 화면은 목록이 칩 줄뿐이라 스크롤은 상세 칸이 맡는다 // 잴 기준 칸(목록이 접히면 상세)
    const top = Math.round(pr.getBoundingClientRect().top + (g.scrollY || 0)); // 칸이 시작하는 페이지 기준 위치
    // 칸 아래에 남는 틀 안쪽 여백·틀 바깥 여백. 목록이 짧아 페이지가 화면보다 낮으면 scrollHeight가 화면 높이로 고정돼 아래 여백이 부풀려지므로, 칸을 잠깐 아주 크게 만들어 잰다.
    const sig = [g.innerWidth, g.innerHeight, top, closed ? 1 : 0, app.className.replace(/\bmore-below\b/g, ''), app.getAttribute('data-tab')].join('|');
    if (was && sig === lastSig) { onListScroll(); onDetScroll(); return; } // 달라진 게 없으면 칸을 건드리지 않는다(스크롤 위치·진행 중인 터치 스크롤 보호)
    const keepH = pr.style.height, keepT = pr.scrollTop, det = det0, keepDT = det ? det.scrollTop : 0; pr.style.height = '9999px';
    const below = Math.max(0, document.documentElement.scrollHeight - Math.round(pr.getBoundingClientRect().bottom + (g.scrollY || 0)));
    pr.style.height = keepH; pr.scrollTop = keepT; if (det) det.scrollTop = keepDT; // 늘렸다 줄이면 스크롤 위치가 0으로 돌아가므로 되돌린다
    const root = document.documentElement.style;
    if (root.getPropertyValue('--pane-top') !== top + 'px') root.setProperty('--pane-top', top + 'px');
    if (root.getPropertyValue('--pane-below') !== below + 'px') root.setProperty('--pane-below', below + 'px');
    // 소수점 배율(125% 등)에서 반올림 때문에 페이지가 1~몇 px 넘쳐 창 스크롤 막대가 생기는 경우: 넘친 만큼 아래 여백을 더 빼 맞춘다
    { const ex = document.documentElement.scrollHeight - g.innerHeight; if (ex > 0 && ex < 48) root.setProperty('--pane-below', (below + ex) + 'px'); }
    if (coarse) { const hh = Math.max(240, g.innerHeight - top - parseFloat(root.getPropertyValue('--pane-below') || below)); if (root.getPropertyValue('--pane-h') !== hh + 'px') root.setProperty('--pane-h', hh + 'px'); } else if (root.getPropertyValue('--pane-h')) root.removeProperty('--pane-h');
    if (g.scrollY > 0 && !was) try { g.scrollTo(0, 0); } catch (e) { /* 무시 */ }
    if (listEl !== list) { if (listEl) listEl.removeEventListener('scroll', onListScrollEv); listEl = list; list.addEventListener('scroll', onListScrollEv, { passive: true }); }
    onListScroll();
    if (det0 && detEl !== det0) { if (detEl) detEl.removeEventListener('scroll', onDetScrollEv); detEl = det0; det0.addEventListener('scroll', onDetScrollEv, { passive: true }); }
    onDetScroll(); lastSig = sig;
  };
  // 진단용: 주소에 ?fitdebug=1 을 붙이면 오른쪽 아래에 창 크기와 칸 모드 상태를 표시한다(평소엔 아무것도 하지 않음).
  const dbg = (() => { try { if (/[?&]fitdebug=1/.test(g.location.search)) { try { g.sessionStorage.setItem('vlpFitDebug', '1'); } catch (e) { /* 무시 */ } return true; } if (/[?&]fitdebug=0/.test(g.location.search)) { try { g.sessionStorage.removeItem('vlpFitDebug'); } catch (e) { /* 무시 */ } return false; } return g.sessionStorage.getItem('vlpFitDebug') === '1'; } catch (e) { return false; } })(); // 한 번 켜면 이 탭에서는 주소가 바뀌어도(로그인 후 이동 등) 유지, ?fitdebug=0 으로 끔
  const paintDbg = () => {
    if (!dbg) return; let d = document.getElementById('vlp-fitdbg');
    if (!d) { d = document.createElement('div'); d.id = 'vlp-fitdbg'; d.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;background:#222;color:#fff;font:12px/1.4 monospace;padding:6px 10px;border-radius:8px;opacity:.92;pointer-events:none;white-space:pre-wrap;max-width:62vw'; document.body.appendChild(d); }
    const app = document.querySelector('.vlp-app'), list = app && app.querySelector('.vlp-app-list'), r = list ? list.getBoundingClientRect() : null, cs = list ? g.getComputedStyle(list) : null;
    const doc = document.documentElement, rt = g.getComputedStyle(doc);
    d.textContent = (function () { const o = document.querySelector('.vlp-adm-ovf'), pn = document.querySelector('.vlp-adm-ovp'); if (!o || o.hidden) return ''; const q = pn.getBoundingClientRect(), e = pn.hidden ? null : document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return '[⋯메뉴] 펼침 ' + o.getAttribute('aria-expanded') + ' · 패널 hidden ' + pn.hidden + ' ' + g.getComputedStyle(pn).position + ' ' + Math.round(q.left) + ',' + Math.round(q.top) + ' ' + Math.round(q.width) + '×' + Math.round(q.height) + ' · 그 자리 요소 ' + (e ? (pn.contains(e) ? '패널' : (e.className.toString().slice(0, 24) || e.tagName)) : '-') + '\n'; })() + 'build v110 · 터치 ' + (g.matchMedia && g.matchMedia('(pointer: coarse)').matches ? '예' : '아니오') + '\n마지막 터치: ' + T.tgt + '\n이동 ' + T.moves + '회(취소 ' + T.prevented + ') dy ' + T.dy + ' · 스크롤 이벤트 목록 ' + T.n.list + ' 상세 ' + T.n.detail + ' 창 ' + T.n.win + ' 기타 ' + T.n.other + '\n창 ' + g.innerWidth + '×' + g.innerHeight + ' (배율 ' + g.devicePixelRatio + ')\n기준 높이 ' + MIN_H + ' · 폭 ' + MIN_W + '\n칸 모드 ' + (app && app.classList.contains('fit-panes') ? 'ON' : 'OFF') + ' · 앱 ' + (app ? app.className.replace(/vlp-app\s*/, '') : '-') + '\n페이지 넘침 ' + (doc.scrollHeight - g.innerHeight) + 'px · 목록 ' + (r ? Math.round(r.top) + '~' + Math.round(r.bottom) : '-') + ' ' + (cs ? cs.position + '/' + cs.overflowY : '') + '\n상세 ' + (function () { const dd = app && app.querySelector('.vlp-app-detail'); return dd ? dd.clientHeight + '/' + dd.scrollHeight + ' ' + g.getComputedStyle(dd).overflowY : '-'; })() + ' · --pane-h ' + (rt.getPropertyValue('--pane-h') || '-') + '\n--pane-top ' + (rt.getPropertyValue('--pane-top') || '-') + ' · --pane-below ' + (rt.getPropertyValue('--pane-below') || '-');
  };
  // 진단(?fitdebug=1): 마지막 터치가 닿은 곳과 가장 가까운 스크롤 칸, 스크롤 이벤트가 어디서 몇 번 났는지, 터치 이동이 취소됐는지 표시
  const T = { tgt: '-', n: { list: 0, detail: 0, win: 0, other: 0 }, moves: 0, prevented: 0, dy: 0, sy: 0 };
  if (dbg) {
    const nm = (e) => (e && e.className ? e.className.toString().split(' ').slice(0, 2).join('.') : (e && e.tagName) || '-');
    const scroller = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const c = g.getComputedStyle(n); if (/(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 1) return n; } return null; };
    document.addEventListener('touchstart', (e) => { const t = e.target, sc = scroller(t); T.tgt = nm(t) + ' → 스크롤칸 ' + (sc ? nm(sc) + ' ' + sc.clientHeight + '/' + sc.scrollHeight : '없음'); T.sy = e.touches[0].clientY; T.moves = 0; T.prevented = 0; }, { passive: true, capture: true });
    document.addEventListener('touchmove', (e) => { T.moves++; if (e.defaultPrevented) T.prevented++; T.dy = Math.round(e.touches[0].clientY - T.sy); }, { passive: true, capture: true });
    document.addEventListener('scroll', (e) => { const t = e.target; if (t === document || t === document.documentElement) T.n.win++; else if (t.classList && t.classList.contains('vlp-app-list')) T.n.list++; else if (t.classList && t.classList.contains('vlp-app-detail')) T.n.detail++; else T.n.other++; }, { passive: true, capture: true });
  }
  if (dbg) { g.addEventListener('resize', () => g.setTimeout(paintDbg, 100)); g.setInterval(paintDbg, 700); }
  const kick = () => { if (!raf) raf = g.requestAnimationFrame(update); };
  const start = () => {
    g.addEventListener('resize', kick);
    try { mo = new MutationObserver((recs) => { // 목록·상세의 '더 있음' 표시 켜고 끄기(스크롤 중 우리가 바꾸는 클래스)는 칸 다시 재기를 부르지 않는다
      if (recs.every((r) => r.type === 'attributes' && r.attributeName === 'class' && String(r.oldValue || '').replace(/\bmore-below\b/, '').trim() === r.target.className.toString().replace(/\bmore-below\b/, '').trim())) return;
      kick(); }); } catch (e) { mo = null; }
    watch(); kick();
    // 글꼴·이미지가 늦게 들어와 칸 윗선이 밀리는 경우를 위해 한 번씩 더 맞춘다
    try { g.addEventListener('load', kick); if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick); } catch (e) { /* 무시 */ }
    g.setTimeout(kick, 600); g.setTimeout(kick, 2000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
