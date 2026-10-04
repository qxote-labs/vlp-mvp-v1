/* push-link.js — PWA-24 푸시·알림 딥링크.
 *  · 알림(refType/refId)을 화면 주소로 바꾼다: customer.html?open=contract:<id> / delivery:<id>. 푸시 본문엔 계약 내용을 싣지 않는다.
 *  · 주소를 열면 해당 계약 카드가 펼쳐지고 스크롤된다(applyDeep). 한 번 처리하면 주소에서 open 값을 지운다.
 *  · 푸시 제공자(pushProvider)·VAPID 키는 설정 값이다. 비어 있으면 앱 안 알림만 쓴다(추후 처리 문서 D-33).
 *  · 구독 정보를 서버에 보내는 API는 아직 계약에 없다 → 구독만 만들고 전송은 훅(onSubscribe)으로 비워 둔다. */
(function (g) {
  'use strict';
  const V = g.VLP;
  const PAGE = { customer: 'customer.html', karmaster: 'karmaster.html', shop: 'shop.html', admin: 'admin.html' };
  const REF = /^(contract|delivery):[A-Za-z0-9_-]{1,64}$/;

  /** 알림 하나 → 열 주소(같은 출처 상대 주소). 알 수 없으면 역할 첫 화면. */
  function urlFor(note, role) {
    const page = PAGE[role] || PAGE.customer;
    if (!note || !note.refType || !note.refId) return page;
    const v = note.refType + ':' + note.refId;
    return REF.test(v) ? page + '?open=' + encodeURIComponent(v) : page;
  }
  /** 푸시 알림이 열 주소(통합 앱): 겸임인 사람이 다른 역할로 로그인해 있어도 app.html이 그 역할 세션을 맞춘 뒤 해당 건을 연다. */
  function appUrl(note, role) {
    const base = 'app.html?role=' + encodeURIComponent(PAGE[role] ? role : 'customer');
    if (!note || !note.refType || !note.refId) return base;
    const v = note.refType + ':' + note.refId;
    return REF.test(v) ? base + '&open=' + encodeURIComponent(v) : base;
  }
  function parseOpen(search) {
    const v = new URLSearchParams(search || '').get('open');
    if (!v || !REF.test(v)) return null;
    const i = v.indexOf(':'); return { refType: v.slice(0, i), refId: v.slice(i + 1) };
  }
  let consumed = false;
  /** 목록에서 딥링크 대상을 찾아 펼침 상태(open)에 넣는다. 대상 contractId를 돌려준다(없으면 null). 한 번만 동작. */
  function applyDeep(items, open, search) {
    if (consumed) return null;
    const t = parseOpen(search !== undefined ? search : (g.location ? g.location.search : ''));
    if (!t) return null;
    const c = (items || []).find((x) => (t.refType === 'contract' ? x.contractId : x.deliveryId) === t.refId);
    if (!c) return null;
    consumed = true; open[c.contractId] = true;
    try { const u = new URL(g.location.href); u.searchParams.delete('open'); g.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } catch (e) { /* 무시 */ }
    return c.contractId;
  }
  function scrollTo(contractId) {
    if (!contractId) return;
    setTimeout(() => { const el = document.querySelector('.vlp-card[data-contract-id="' + contractId + '"]'); if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } } }, 50);
  }
  /** 서비스 워커가 알림을 눌렀을 때 쓸 주소인지 확인(같은 출처 상대 주소만). sw.js에도 같은 규칙이 있다. */
  function safeTarget(u, base) {
    try { const b = new URL(base || 'https://x.invalid/'), x = new URL(u, b); return x.origin === b.origin ? x.pathname.replace(/^\//, '') + x.search : null; } catch (e) { return null; }
  }

  function supported() { return typeof g.Notification !== 'undefined' && !!(g.navigator && g.navigator.serviceWorker) && typeof g.PushManager !== 'undefined'; }
  function b64ToU8(s) { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); }
  /** 알림 패널 맨 아래에 붙는 설정 줄. 제공자 미정이면 안내 문구만. */
  function settingsRow() {
    const row = document.createElement('div'); row.className = 'vlp-pushrow hint';
    const key = V.config.get('vapidPublicKey');
    if (!V.config.get('pushProvider') || !key) { row.textContent = '휴대폰 푸시 알림은 준비 중이에요. 지금은 앱 안 알림으로 알려드려요.'; return row; }
    if (!supported()) { row.textContent = '이 기기·브라우저는 푸시 알림을 지원하지 않아요. (iPhone은 홈 화면에 추가한 앱에서만 가능)'; return row; }
    const perm = g.Notification.permission;
    if (perm === 'denied') { row.textContent = '알림이 차단돼 있어요. 브라우저 설정에서 허용해 주세요.'; return row; }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm vlp-push-on'; b.textContent = perm === 'granted' ? '푸시 알림 켜짐 · 다시 설정' : '푸시 알림 켜기';
    b.addEventListener('click', async () => {
      try {
        const r = await g.Notification.requestPermission(); if (r !== 'granted') { row.textContent = '알림을 허용하지 않으셨어요. 앱 안 알림은 계속 쓸 수 있어요.'; return; }
        const reg = await g.navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
        if (api.onSubscribe) await api.onSubscribe(sub.toJSON());
        b.textContent = '푸시 알림 켜짐';
      } catch (e) { row.appendChild(document.createTextNode(' 설정하지 못했어요.')); }
    });
    row.appendChild(b); return row;
  }
  const api = { urlFor, appUrl, parseOpen, applyDeep, scrollTo, safeTarget, settingsRow, supported, onSubscribe: null, _reset() { consumed = false; } };
  V.pushLink = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
