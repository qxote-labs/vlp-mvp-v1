/* vlp-rolebar.js — 역할 상태 줄 (22px).
 *  - 왼쪽: `역할 · 이름`. 오른쪽: 평소 비움(또는 작은 동작 버튼), 연결 이상이면 같은 줄이 주황색이 되고 상태 문구를 보인다.
 *  - 오프라인/마지막 상태 안내는 vlp-boot.js가 status()로 보낸다. 이 줄이 화면에 없으면 boot가 고정 배너를 대신 쓴다.
 *  - 페이지는 <div id="vlp-rolebar" data-role="customer|karmaster|shop"></div> 한 줄만 두면 된다.
 */
(function (g) {
  'use strict';
  g.VLP = g.VLP || {};
  const V = g.VLP;
  const LABEL = { customer: '고객', karmaster: '카마스터', shop: '시공사' };
  const st = { role: null, name: '', phone: '', action: null, status: null, open: false };
  let bound = false;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const node = () => (typeof document === 'undefined' ? null : document.getElementById('vlp-rolebar'));

  function paint() {
    const el = node(); if (!el) return;
    const role = st.role || el.getAttribute('data-role') || 'customer';
    el.setAttribute('data-role', role);
    el.classList.toggle('is-alert', !!st.status);
    const roles = V.roles && st.phone ? V.roles.forPhone(st.phone) : [];
    const multi = roles.length > 1;
    const label = '<b>' + esc(LABEL[role] || role) + '</b>' + (st.name ? ' · ' + esc(st.name) : '');
    let who;
    if (multi) who = '<button type="button" class="rb-who rb-switch" aria-haspopup="listbox" aria-expanded="' + (st.open ? 'true' : 'false') + '" aria-label="역할 전환, 현재 ' + esc(LABEL[role] || role) + '">' + label + ' <span aria-hidden="true">' + (st.open ? '▴' : '▾') + '</span></button>';
    else who = '<span class="rb-who">' + label + '</span>';
    let right = '';
    if (st.status) right = '<span class="rb-status" role="status" aria-live="polite" title="' + esc(st.status.title || st.status.text) + '">' + esc(st.status.text) + '</span>';
    else if (st.action) right = '<button type="button" class="rb-action"' + (st.action.id ? ' id="' + esc(st.action.id) + '"' : '') + '>' + esc(st.action.label) + '</button>';
    let menu = '';
    if (multi && st.open) {
      menu = '<div class="rb-menu" role="listbox" aria-label="역할 선택">' + roles.map((r) => '<button type="button" role="option" class="rb-opt" data-role="' + esc(r.role) + '" aria-selected="' + (r.role === role ? 'true' : 'false') + '"><b>' + esc(r.label) + '</b><span>' + esc(r.name || '') + '</span>' + (r.role === role ? '<i>현재 역할 ✓</i>' : '') + '</button>').join('') + '</div>';
    }
    el.innerHTML = who + right + menu;
    const btn = el.querySelector('.rb-action');
    if (btn && st.action) btn.addEventListener('click', st.action.onClick);
    bind(el);
  }

  function setOpen(v, focusBack) {
    if (st.open === v) return; st.open = v; paint();
    const el = node(); if (!el) return;
    if (v) { const cur = el.querySelector('.rb-opt[aria-selected=true]') || el.querySelector('.rb-opt'); if (cur) cur.focus(); }
    else if (focusBack) { const sw = el.querySelector('.rb-switch'); if (sw) sw.focus(); }
  }
  // 이벤트는 한 번만 묶는다(내용은 다시 그려져도 줄 요소는 그대로)
  function bind(el) {
    if (bound) return; bound = true;
    el.addEventListener('click', (e) => {
      const sw = e.target.closest('.rb-switch'); if (sw) { setOpen(!st.open, true); return; }
      const opt = e.target.closest('.rb-opt');
      if (opt) { const r = opt.getAttribute('data-role'); if (r === (st.role || el.getAttribute('data-role'))) { setOpen(false, true); return; } V.roles.switchTo(r, st.phone); }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && st.open) { e.preventDefault(); setOpen(false, true); return; }
      if (st.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const opts = Array.from(el.querySelectorAll('.rb-opt')); const i = opts.indexOf(document.activeElement);
        if (opts.length) { e.preventDefault(); opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].focus(); }
      }
    });
    // 안쪽 클릭으로 줄이 다시 그려지면 e.target이 떨어져 나가므로 경로(composedPath)로 판단한다
    document.addEventListener('click', (e) => { const path = e.composedPath ? e.composedPath() : []; if (st.open && !path.includes(el)) setOpen(false, false); });
  }

  V.rolebar = {
    // set({ role, name, phone, action:{label,onClick}|null }) — phone을 주면 겸임 여부를 보고 전환 메뉴를 붙인다
    set(o) { Object.assign(st, o || {}); paint(); },
    // 연결 상태: { text, title } 또는 null(정상)
    status(s) { st.status = s || null; paint(); },
    mounted() { return !!node(); },
    state() { return Object.assign({}, st); },
  };
  if (typeof document !== 'undefined') {
    const init = () => paint();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
