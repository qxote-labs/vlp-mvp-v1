/* app-entry.js — 통합 진입(app.html): 전화번호 하나로 들어와 가진 역할 중 하나로 이동한다.
 *  - 이미 로그인한 역할 화면이 있으면(세션) 로그인 없이 그 사람의 마지막/우선 역할로 간다. ?login=1이면 건너뛰지 않는다.
 *  - 역할 선택 우선순위: ?role= → 마지막으로 쓴 역할(localStorage) → 고객 > 시공사 > 카마스터.
 *  - 이 데모는 본인인증이 없다(실제 서비스는 서버 인증). 처음 보는 전화번호는 이름을 받아 고객으로 시작한다.
 */
(function (g) {
  'use strict';
  const V = g.VLP; const root = document.getElementById('body-root');
  const q = new URLSearchParams(location.search);
  const digits = (p) => String(p || '').replace(/[^0-9]/g, '');
  const fmt = (raw) => { const d = digits(raw).slice(0, 11); return d.length > 7 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ss = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };

  function sessionPhone() {
    if (ss('v6_customer_logged') && ss('v6_customer_phone')) return ss('v6_customer_phone');
    const shop = ss('v6_shop_id') && g.Store.getShop(ss('v6_shop_id')); if (shop) return shop.phone;
    const km = ss('v6_km_id') && g.Store.getKarmaster(ss('v6_km_id')); if (km) return km.phone;
    return '';
  }
  function pick(roles) {
    const want = q.get('role'), last = V.roles.last();
    return roles.find((r) => r.role === want) || roles.find((r) => r.role === last) || roles[0];
  }
  function go(phone, roles) { const r = pick(roles); if (r) V.roles.switchTo(r.role, phone, { open: q.get('open') }); }

  function demoOptions() {
    const S = g.Store; const out = [];
    S.getDemoCustomers().forEach((c) => out.push([c.phone, c.name + ' · 고객 — ' + c.note]));
    S.getShops().filter((s) => s.verificationStatus === 'approved').forEach((s) => out.push([s.phone, s.name + ' · 시공사']));
    S.getKarmasters().forEach((k) => out.push([k.phone, k.name + ' · 카마스터']));
    const seen = {}; return out.filter(([p]) => (seen[p] ? false : (seen[p] = true)));
  }

  function renderLogin(msg) {
    root.innerHTML = '';
    const w = document.createElement('div'); w.className = 'ap-wrap';
    w.innerHTML = '<aside class="ap-brand"><div class="ap-logo" aria-hidden="true">🚘</div><h1>VLP</h1><p class="ap-tag">신차 인도부터 신차 케어까지, 한 앱에서</p>'
      + '<ul class="ap-roles" aria-label="이용 역할">'
      + '<li><span class="ap-ic" aria-hidden="true">🚗</span><div><b>고객</b><span>내 차량 인도·신차케어 진행 확인, 인수·수령 확인</span></div></li>'
      + '<li><span class="ap-ic" aria-hidden="true">🧰</span><div><b>시공사</b><span>견적 회신, 입고·시공·검수 관리</span></div></li>'
      + '<li><span class="ap-ic" aria-hidden="true">🤝</span><div><b>카마스터</b><span>계약 승인, 출고 의뢰, 인도 확인</span></div></li></ul></aside>'
      + '<section class="ap-card"><h2>로그인</h2>'
      + '<p class="ap-sub">전화번호 하나로 들어오면 가진 역할로 이어져요. 역할이 둘 이상이면 화면 위쪽에서 바꿀 수 있어요.</p>'
      + '<label for="app-phone" class="ap-label">전화번호</label>'
      + '<input id="app-phone" type="tel" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel">'
      + '<div id="app-name-box" hidden><label for="app-name" class="ap-label">이름 <span class="hint">· 처음 오셨어요. 고객으로 시작해요</span></label><input id="app-name" type="text" placeholder="홍길동" autocomplete="name"></div>'
      + '<div class="ap-note" id="app-unknown" hidden>가입된 번호가 아니에요. 고객이라면 이름을 적고 계속을 눌러 주세요. 카마스터라면 아래 <b>조회번호로 계약 열기</b>를 눌러 주세요.</div>'
      + '<div class="vlp-error" role="alert" id="app-err" hidden></div>'
      + '<button class="btn btn-primary ap-go" id="app-go" disabled>계속</button>'
      + '<div class="ap-or"><span>또는</span></div>'
      + '<a class="ap-claim" id="app-claim" href="karmaster.html?claim=1"><span class="ap-ic" aria-hidden="true">🔑</span><span class="ap-claim-tx"><b>조회번호로 계약 열기</b><span>카마스터 · 아직 가입 전이어도, 고객이 보낸 안내의 조회번호로 계약을 확인할 수 있어요</span></span><span class="ap-chev" aria-hidden="true">›</span></a>'
      + '<details class="ap-demo" id="app-demo"><summary>데모 계정으로 빠른 로그인</summary><select id="app-quick" aria-label="데모 계정"><option value="">계정 선택…</option>' + demoOptions().map(([p, t]) => '<option value="' + esc(p) + '">' + esc(t) + '</option>').join('') + '</select><div class="hint">본인인증 없이 들어가는 시연용 목록이에요.</div></details></section>';
    root.appendChild(w);
    const ph = w.querySelector('#app-phone'), nm = w.querySelector('#app-name'), box = w.querySelector('#app-name-box'), btn = w.querySelector('#app-go'), unk = w.querySelector('#app-unknown'), err = w.querySelector('#app-err');
    if (msg) { err.textContent = msg; err.hidden = false; }
    const valid = () => /^010-?\d{3,4}-?\d{4}$/.test(ph.value) && (box.hidden || nm.value.trim().length >= 2);
    const sync = () => { btn.disabled = !valid(); };
    ph.addEventListener('input', () => { ph.value = fmt(ph.value); if (!box.hidden) { box.hidden = true; unk.hidden = true; } err.hidden = true; sync(); });
    nm.addEventListener('input', sync);
    function submit(phone) {
      const roles = V.roles.forPhone(phone);
      if (roles.length) { go(phone, roles); return; }
      if (box.hidden) { box.hidden = false; unk.hidden = false; nm.focus(); sync(); return; } // 처음 보는 번호: 이름을 받는다
      g.Store.touchUserRole(phone, nm.value.trim(), 'customer');
      go(phone, V.roles.forPhone(phone));
    }
    btn.addEventListener('click', () => submit(ph.value));
    [ph, nm].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && valid()) submit(ph.value); }));
    w.querySelector('#app-quick').addEventListener('change', (e) => { if (e.target.value) { ph.value = e.target.value; submit(e.target.value); } });
    const pf = q.get('prefill'); if (pf) { ph.value = fmt(pf); const pn = q.get('prefillName'); if (pn && !V.roles.forPhone(ph.value).length) { box.hidden = false; nm.value = pn; } sync(); btn.focus(); } else ph.focus(); // 런처에서 전화번호를 채워 열기(계속은 직접 누른다)
  }

  function start() {
    if (q.get('claim')) { location.replace('karmaster.html?claim=1'); return; } // 고객이 보낸 안내 링크: 미가입 카마스터를 조회번호 화면으로
    const phone = q.get('login') ? '' : sessionPhone();
    if (phone) { const roles = V.roles.forPhone(phone); if (roles.length) { go(phone, roles); return; } }
    renderLogin();
  }
  start();
})(window);
