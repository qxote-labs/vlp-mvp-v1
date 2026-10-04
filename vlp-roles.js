/* vlp-roles.js — 한 사람이 가진 역할 목록과 역할 전환.
 *  - 전화번호가 공통 식별자다(한 사람 = 계정 하나 + 역할 여러 개). 역할은 Store의 사용자 역할 속성과
 *    시공사·카마스터 레지스트리(전화번호 일치)에서 계산한다. (mock — 서버 계약이 정해지면 로그인 응답으로 대체, 계획서 5절)
 *  - 전환은 대상 역할의 세션을 이어 붙이고 그 역할 화면으로 이동한다. 같은 사람이 이미 로그인한 상태이므로 다시 묻지 않는다.
 */
(function (g) {
  'use strict';
  g.VLP = g.VLP || {};
  const V = g.VLP;
  const ORDER = ['customer', 'shop', 'karmaster'];
  const LABEL = { customer: '고객', shop: '시공사', karmaster: '카마스터' };
  const PAGE = { customer: 'customer.html', shop: 'shop.html', karmaster: 'karmaster.html' };
  const digits = (p) => String(p || '').replace(/[^0-9]/g, '');
  const ss = { set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } } };

  function forPhone(phone) {
    const S = g.Store; const d = digits(phone);
    if (!S || !d) return [];
    const found = {};
    const user = (S.getUsers() || []).find((u) => digits(u.phone) === d);
    if (user) (user.roleAttributes || []).forEach((r) => { if (r.active !== false) found[r.role] = { name: user.name || '' }; });
    // 예약·케어 신청의 고객으로 이미 기록된 번호는 고객 역할이 있다(이름은 기록에서)
    if (!found.customer) {
      const rec = (S.getReservationsByPhone(phone)[0] || S.getCareOrders().find((c) => digits(c.customer && c.customer.phone) === d));
      if (rec && rec.customer) found.customer = { name: rec.customer.name || '' };
    }
    const shop = (S.getShops() || []).find((s) => digits(s.phone) === d && s.verificationStatus === 'approved');
    if (shop) found.shop = { name: shop.name, id: shop.id };
    const km = (S.getKarmasters() || []).find((k) => digits(k.phone) === d);
    if (km) found.karmaster = { name: String(km.name || '').replace(/\s*카마스터$/, ''), id: km.id };
    return ORDER.filter((r) => found[r] && (r === 'customer' || found[r].id)).map((r) => Object.assign({ role: r, label: LABEL[r], page: PAGE[r], phone }, found[r]));
  }

  function switchTo(role, phone, opts) {
    const target = forPhone(phone).find((r) => r.role === role);
    if (!target) return false;
    if (role === 'customer') {
      const name = target.name || '고객';
      ss.set('v6_customer_logged', '1'); ss.set('v6_customer_name', name); ss.set('v6_customer_phone', phone); ss.set('v6_view', 'history');
    } else if (role === 'shop') ss.set('v6_shop_id', target.id);
    else if (role === 'karmaster') ss.set('v6_km_id', target.id);
    try { localStorage.setItem('vlp_last_role', role); } catch (e) { /* 저장 불가 */ }
    if (V.pwa && V.pwa.clearApiCache) V.pwa.clearApiCache();
    if (V.api && V.api.session && V.api.session.clear) V.api.session.clear(); // 이전 역할의 조회 세션이 섞이지 않게
    const open = opts && opts.open && /^(contract|delivery):[A-Za-z0-9_-]{1,64}$/.test(opts.open) ? opts.open : null;
    g.location.href = target.page + (open ? '?open=' + encodeURIComponent(open) : '');
    return true;
  }

  // 역할 화면(시공사·카마스터·구매자)의 자체 로그인 대신 통합 로그인(app.html)으로 보낸다. 로그인 화면은 한 곳만 둔다.
  // 런처에서 채워 온 prefill 값은 이어서 넘긴다. (역할 화면에는 별도 로그인 UI가 없다)
  function loginRedirect(role) {
    const q = new URLSearchParams(g.location.search);
    const p = new URLSearchParams({ login: '1', role });
    ['prefill', 'prefillName'].forEach((k) => { if (q.get(k)) p.set(k, q.get(k)); });
    g.location.replace('app.html?' + p.toString());
    return true;
  }

  V.roles = { forPhone, switchTo, loginRedirect, LABEL, last() { try { return localStorage.getItem('vlp_last_role'); } catch (e) { return null; } } };
})(typeof window !== 'undefined' ? window : globalThis);
