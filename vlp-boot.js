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
