/* 관리자 · 전체 사용자 관리: 구매자·카마스터·시공업체·관리자를 전화번호 기준 한 목록으로 모아
 * 열마다 정렬·검색(필터)하고, 선택한 사용자의 개요·운영 메모·처리 기록을 본다.
 * 목 단계: Store(브라우저 저장)에서 모은다. 서버 구현 시 사용자 목록·검색 API가 필요하다(docs/추후_처리_항목.md). */
(function (g) {
  'use strict';
  const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
  const norm = (p) => String(p || '').replace(/[^0-9]/g, '');
  const ROLES = ['구매자', '카마스터', '시공업체', '관리자'];
  const stamp = (t) => { if (!t || t < 1e12) return '-'; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const st = { sort: 'joined', dir: -1, scope: 'all', f: { q: '', role: '', group: '', cases: '' }, sel: null, mode: null, picked: new Set(), auto: false, view: 'users' };

  function aggregate(admin) {
    const S = g.Store, map = new Map();
    const community = admin && admin.adminScope === 'community', mine = (admin && admin.assignedGroupIds) || [];
    const inGroups = (ids) => !community || (ids || []).some((x) => mine.includes(x));
    const get = (phone, name) => {
      const k = norm(phone) || ('x' + map.size);
      if (!map.has(k)) map.set(k, { key: k, phone: phone || '', name: '', roles: new Set(), groups: new Set(), cases: [], joined: 0, inScope: !community });
      const r = map.get(k); if (name && !r.name) r.name = name; if (phone && !r.phone) r.phone = phone; return r;
    };
    const gname = (id) => { const x = S.getGroup(id); return x ? x.name : id; };
    (S.getUsers() || []).forEach((u) => { const r = get(u.phone, u.name); r.joined = r.joined || u.createdAt || 0; (u.roleAttributes || []).forEach((ra) => r.roles.add({ customer: '구매자', karmaster: '카마스터', shop: '시공업체' }[ra.role] || ra.role)); });
    (S.getReservations() || []).forEach((x) => { if (!x.customer || !x.customer.phone) return; const r = get(x.customer.phone, x.customer.name); r.roles.add('구매자'); r.cases.push({ id: x.id, kind: '신차 인도', label: x.carModel || x.id }); r.joined = r.joined || x.createdAt || 0; if (community && reservationInAdminScope(x, admin)) r.inScope = true; });
    (S.getCareOrders() || []).forEach((c) => { if (!c.customer || !c.customer.phone) return; const r = get(c.customer.phone, c.customer.name); r.roles.add('구매자'); r.cases.push({ id: c.id, kind: '신차 케어', label: c.carModel || c.id }); if (community && careOrderInAdminScope(c, admin)) r.inScope = true; });
    (S.getKarmasters() || []).forEach((k) => { const r = get(k.phone, k.name); r.roles.add('카마스터'); (k.groupIds || []).forEach((x) => r.groups.add(gname(x))); (S.getReservationsByKarmaster ? S.getReservationsByKarmaster(k.id) : []).forEach((x) => r.cases.push({ id: x.id, kind: '신차 인도', label: x.carModel || x.id })); if (inGroups(k.groupIds)) r.inScope = true; });
    (S.getShops() || []).forEach((s) => { const r = get(s.phone, s.name); r.roles.add('시공업체'); (s.groupIds || []).forEach((x) => r.groups.add(gname(x))); (S.getCareOrders() || []).filter((c) => c.shopId === s.id).forEach((c) => r.cases.push({ id: c.id, kind: '신차 케어', label: c.carModel || c.id })); if (inGroups(s.groupIds)) r.inScope = true; });
    (S.getAdmins() || []).forEach((a) => { const r = get(a.phone, a.name); r.roles.add('관리자'); r.adminKind = a.adminScope === 'super' ? '슈퍼바이저' : '커뮤니티관리자'; (a.assignedGroupIds || []).forEach((x) => r.groups.add(gname(x))); if (!community || a.id === admin.id) r.inScope = true; });
    return [...map.values()].filter((r) => r.inScope).map((r) => Object.assign(r, { roles: [...r.roles], groups: [...r.groups] }));
  }

  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } } };
  const SORT_TXT = { name: ['가나다순', '가나다 역순'], phone: ['번호 낮은 순', '번호 높은 순'], role: ['역할순', '역할 역순'], group: ['그룹순', '그룹 역순'], cases: ['연결 건 적은 순', '연결 건 많은 순'], joined: ['오래된 순', '최신순'] };
  const SCOPE_TXT = { all: '전체', name: '이름', phone: '전화' };

  function render(admin, groupCatalog) {
    const all = aggregate(admin);
    const auto0 = (() => { const v = LS.get('vlp_adm_users_auto'); if (v === '1') return true; if (v === '0') return false; return !!(g.VLP && VLP.config && VLP.config.get('adminUsersAutoDetail')); })();
    st.auto = auto0;
    const root = el('<div class="vlp-usr"><div class="vlp-pane-head"><h2></h2></div><div class="vlp-usr-tabs" role="tablist" hidden></div><div class="vlp-usr-uview">'
      + '<div class="vlp-usr-bar"><select class="vlp-usr-scope" aria-label="검색 범위"></select><input type="search" class="vlp-usr-q" placeholder="검색어 입력" aria-label="사용자 검색">'
      + '<select class="vlp-usr-chip" data-f="role" aria-label="역할"></select><select class="vlp-usr-chip" data-f="group" aria-label="소속 그룹"></select><select class="vlp-usr-chip" data-f="cases" aria-label="연결 건"></select>'
      + '<span class="vlp-usr-sp"></span><label class="vlp-usr-auto" title="켜면 행을 한 번 누르는 것만으로 상세 칸이 열려요"><input type="checkbox" role="switch"> 상세 칸 자동 열기</label></div>'
      + '<div class="vlp-usr-state"><span class="vlp-usr-count" role="status"></span><span class="vlp-usr-sortinfo"></span><label class="vlp-usr-sortsel">정렬 <select aria-label="정렬 기준"></select> <button type="button" class="btn btn-sm vlp-usr-dir" aria-label="정렬 방향 바꾸기"></button></label><span class="vlp-usr-chips" aria-label="적용 중인 조건"></span></div>'
      + '<div class="vlp-usr-wrap"><div class="vlp-usr-list"><div class="vlp-usr-scroll"><table class="vlp-usr-table"><thead></thead><tbody></tbody></table></div></div><div class="vlp-usr-detail" aria-live="polite" hidden></div></div></div><div class="vlp-usr-gview" hidden></div></div>');
    root.querySelector('h2').textContent = admin && admin.adminScope === 'community' ? '사용자 (담당 그룹)' : '사용자/그룹';
    const thead = root.querySelector('thead'), tbody = root.querySelector('tbody'), cnt = root.querySelector('.vlp-usr-count'), detail = root.querySelector('.vlp-usr-detail');
    const sortInfo = root.querySelector('.vlp-usr-sortinfo'), chipsBox = root.querySelector('.vlp-usr-chips'), q = root.querySelector('.vlp-usr-q'), scopeSel = root.querySelector('.vlp-usr-scope');
    const COLS = [{ k: 'name', t: '이름' }, { k: 'phone', t: '전화번호' }, { k: 'role', t: '역할' }, { k: 'group', t: '소속 그룹' }, { k: 'cases', t: '연결 건' }, { k: 'joined', t: '가입일' }];
    const groupNames = [...new Set(all.flatMap((r) => r.groups))].sort((a, b) => a.localeCompare(b, 'ko'));
    const val = (r, k) => k === 'name' ? r.name || '' : k === 'phone' ? norm(r.phone) : k === 'role' ? r.roles.join(' ') : k === 'group' ? r.groups.join(' ') : k === 'cases' ? r.cases.length : r.joined;
    const fill = (sel, first, opts) => { sel.innerHTML = ''; [['', first]].concat(opts).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }); };
    Object.keys(SCOPE_TXT).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = '검색: ' + SCOPE_TXT[k]; scopeSel.appendChild(o); });
    const chip = (f) => root.querySelector('.vlp-usr-chip[data-f=' + f + ']');
    fill(chip('role'), '역할 전체', ROLES.map((x) => [x, x])); fill(chip('group'), '그룹 전체', groupNames.map((x) => [x, x])); fill(chip('cases'), '연결 건 전체', [['has', '연결 건 있음'], ['none', '연결 건 없음']]);
    // 머리글: 정렬 가능 표시(⇅)를 항상 보여준다
    const tr1 = el('<tr></tr>');
    COLS.forEach((c) => {
      const th = el('<th scope="col"><button type="button" class="vlp-usr-sort" title="눌러서 정렬"><span></span><i aria-hidden="true">⇅</i></button></th>'); th.dataset.col = c.k;
      th.querySelector('span').textContent = c.t; th.querySelector('button').addEventListener('click', () => { if (st.sort === c.k) st.dir = -st.dir; else { st.sort = c.k; st.dir = c.k === 'joined' || c.k === 'cases' ? -1 : 1; } paint(); });
      tr1.appendChild(th);
    });
    tr1.appendChild(el('<th scope="col" class="vlp-usr-actcol"><span class="vh">상세</span></th>')); thead.appendChild(tr1);
    const sortSel = root.querySelector('.vlp-usr-sortsel select'), dirBtn = root.querySelector('.vlp-usr-dir');
    COLS.forEach((c) => { const o = document.createElement('option'); o.value = c.k; o.textContent = c.t; sortSel.appendChild(o); });
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; st.dir = st.sort === 'joined' || st.sort === 'cases' ? -1 : 1; paint(); });
    dirBtn.addEventListener('click', () => { st.dir = -st.dir; paint(); });
    // 검색·조건
    q.value = st.f.q; scopeSel.value = st.scope; ['role', 'group', 'cases'].forEach((f) => { chip(f).value = st.f[f]; });
    q.addEventListener('input', () => { st.f.q = q.value; paint(); }); scopeSel.addEventListener('change', () => { st.scope = scopeSel.value; paint(); });
    ['role', 'group', 'cases'].forEach((f) => chip(f).addEventListener('change', () => { st.f[f] = chip(f).value; paint(); }));
    const clearAll = () => { st.f = { q: '', role: '', group: '', cases: '' }; st.scope = 'all'; q.value = ''; scopeSel.value = 'all'; ['role', 'group', 'cases'].forEach((f) => { chip(f).value = ''; }); paint(); };
    const autoBox = root.querySelector('.vlp-usr-auto input'); autoBox.checked = st.auto; autoBox.addEventListener('change', () => { st.auto = autoBox.checked; LS.set('vlp_adm_users_auto', st.auto ? '1' : '0'); if (!st.auto && st.mode === 'user') closeDetail(); });
    function rows() {
      const f = st.f, has = (s, n) => String(s).toLowerCase().includes(String(n).trim().toLowerCase());
      const out = all.filter((r) => {
        if (f.q.trim()) {
          const hay = st.scope === 'name' ? [r.name] : st.scope === 'phone' ? [r.phone, norm(r.phone)] : [r.name, r.phone, norm(r.phone), r.groups.join(' '), r.roles.join(' ')];
          if (!hay.some((x) => has(x, f.q))) return false;
        }
        if (f.role && !r.roles.includes(f.role)) return false; if (f.group && !r.groups.includes(f.group)) return false;
        if (f.cases === 'has' && !r.cases.length) return false; if (f.cases === 'none' && r.cases.length) return false;
        return true;
      });
      out.sort((a, b) => { const x = val(a, st.sort), y = val(b, st.sort); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko'); return (c || String(a.name).localeCompare(String(b.name), 'ko')) * st.dir; });
      return out;
    }
    function paintState(list) {
      thead.querySelectorAll('th[data-col]').forEach((th) => { const on = th.dataset.col === st.sort; th.setAttribute('aria-sort', on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'); th.classList.toggle('on', on); th.querySelector('i').textContent = on ? (st.dir > 0 ? '▲' : '▼') : '⇅'; });
      cnt.textContent = list.length === all.length ? '전체 ' + all.length + '명' : list.length + '명 / 전체 ' + all.length + '명';
      const col = COLS.find((c) => c.k === st.sort); sortInfo.textContent = '정렬: ' + col.t + ' · ' + SORT_TXT[st.sort][st.dir > 0 ? 0 : 1] + ' (머리글을 눌러 바꿔요)';
      sortSel.value = st.sort; dirBtn.textContent = st.dir > 0 ? '▲ 오름' : '▼ 내림';
      chipsBox.innerHTML = ''; const f = st.f, tags = [];
      if (f.q.trim()) tags.push([SCOPE_TXT[st.scope] + ' 검색: ' + f.q.trim(), () => { st.f.q = ''; q.value = ''; }]);
      if (f.role) tags.push(['역할: ' + f.role, () => { st.f.role = ''; chip('role').value = ''; }]); if (f.group) tags.push(['그룹: ' + f.group, () => { st.f.group = ''; chip('group').value = ''; }]);
      if (f.cases) tags.push(['연결 건: ' + (f.cases === 'has' ? '있음' : '없음'), () => { st.f.cases = ''; chip('cases').value = ''; }]);
      tags.forEach(([t, undo]) => { const b = el('<button type="button" class="vlp-usr-tag"><span></span> <i aria-hidden="true">✕</i></button>'); b.querySelector('span').textContent = t; b.setAttribute('aria-label', t + ' 조건 지우기'); b.addEventListener('click', () => { undo(); paint(); }); chipsBox.appendChild(b); });
      if (tags.length > 1) { const b = el('<button type="button" class="btn btn-sm vlp-usr-reset">모두 지우기</button>'); b.addEventListener('click', clearAll); chipsBox.appendChild(b); }
    }
    function paint() {
      const list = rows(); tbody.innerHTML = ''; paintState(list);
      if (!list.length) { const e = el('<tr class="vlp-usr-empty"><td colspan="7"></td></tr>'); e.firstElementChild.textContent = '조건에 맞는 사용자가 없어요.'; tbody.appendChild(e); }
      list.forEach((r) => {
        const tr = el('<tr class="vlp-usr-row" tabindex="0"><td></td><td></td><td></td><td></td><td></td><td></td><td class="vlp-usr-actcol"><button type="button" class="btn btn-sm vlp-usr-open" aria-label="상세 보기">상세 ›</button></td></tr>'); tr.dataset.key = r.key; const c = tr.children;
        c[0].textContent = r.name || '-'; c[1].textContent = r.phone || '-';
        r.roles.forEach((x) => { const t = el('<span class="tag"></span>'); t.textContent = x === '관리자' && r.adminKind ? r.adminKind : x; c[2].appendChild(t); }); if (!r.roles.length) c[2].textContent = '-';
        c[3].textContent = r.groups.join(', ') || '-'; c[4].textContent = r.cases.length ? r.cases.length + '건' : '-'; c[5].textContent = stamp(r.joined);
        if (st.picked.has(r.key)) tr.setAttribute('aria-selected', 'true');
        const pick = () => { st.picked = new Set([r.key]); tbody.querySelectorAll('tr[aria-selected]').forEach((x) => x.removeAttribute('aria-selected')); tr.setAttribute('aria-selected', 'true'); };
        const open = () => { pick(); showDetail(r); };
        tr.addEventListener('click', (e) => { if (e.target.closest('.vlp-usr-open')) return; pick(); if (st.auto) showDetail(r); else if (st.mode === 'user') showDetail(r); });
        tr.addEventListener('dblclick', open); tr.querySelector('.vlp-usr-open').addEventListener('click', open);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } else if (e.key === ' ') { e.preventDefault(); pick(); } });
        tbody.appendChild(tr);
      });
      const cur = all.find((r) => r.key === st.sel); if (st.mode === 'user' && !(cur && list.includes(cur))) closeDetail(); else if (st.mode === 'user' && !detail.firstChild) showDetail(cur);
    }
    function closeDetail() { st.sel = null; st.mode = null; detail.innerHTML = ''; detail.hidden = true; root.classList.remove('has-sel'); fit(); }
    function openPane(title) {
      detail.innerHTML = ''; detail.hidden = false; root.classList.add('has-sel');
      const h = el('<div class="vlp-usr-dh"><b></b><button type="button" class="btn btn-sm vlp-usr-close"><span class="w">닫기 ✕</span><span class="n">← 목록으로</span></button></div>'); h.querySelector('b').textContent = title;
      h.querySelector('button').addEventListener('click', closeDetail); detail.appendChild(h); detail.scrollTop = 0; fit();
    }
    function fit() {
      const sc = root.querySelector('.vlp-usr-scroll'), gv = root.querySelector('.vlp-usr-gview'); if (!sc || !document.body.contains(root)) return;
      const minH = (() => { try { return (g.VLP && VLP.config && VLP.config.get('fitPanesMinHeight')) || 700; } catch (e) { return 700; } })(), wide = g.innerWidth >= 768 && g.innerHeight >= minH; // 다른 칸 화면(vlp-boot.js)과 같은 기준
      if (!wide) { sc.style.height = ''; detail.style.height = ''; gv.style.height = ''; return; }
      const pane = !gv.hidden ? gv : (sc.offsetParent ? sc : detail), keep = pane.style.height, keepT = pane.scrollTop, keepD = detail.scrollTop; pane.style.height = '9999px'; const r = pane.getBoundingClientRect(), topP = Math.round(r.top + (g.scrollY || 0)), below = Math.max(0, document.documentElement.scrollHeight - Math.round(r.bottom + (g.scrollY || 0))); pane.style.height = keep; pane.scrollTop = keepT; detail.scrollTop = keepD;
      const h = Math.max(240, g.innerHeight - topP - below); if (!gv.hidden) gv.style.height = h + 'px'; else { sc.style.height = h + 'px'; detail.style.height = h + 'px'; }
      if (g.scrollY > 0 && !root._fitted) { try { g.scrollTo(0, 0); } catch (e) { /* 무시 */ } } root._fitted = true; root._fitSig = g.innerWidth + 'x' + g.innerHeight;
    }
    const kick = () => { if (root._fitSig === g.innerWidth + 'x' + g.innerHeight) return; g.requestAnimationFrame(fit); }; g.addEventListener('resize', kick); // 창 크기가 그대로면 다시 재지 않는다(iOS 는 스크롤 중에도 resize 가 오고, 재면서 높이를 바꾸면 터치 스크롤이 끊김)
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });
    function showDetail(r) {
      st.sel = r.key; st.mode = 'user'; openPane((r.name || '(이름 없음)') + ' · ' + (r.phone || ''));
      const V = g.VLP && g.VLP.caseView, id = 'user:' + (norm(r.phone) || r.key);
      const o = el('<div class="vlp-cd vlp-usr-ov"><h4>개요</h4><dl class="vlp-usr-dl"></dl></div>');
      const dl = o.querySelector('dl'), add = (k, v) => { const a = el('<dt></dt>'), b = el('<dd></dd>'); a.textContent = k; b.textContent = v; dl.appendChild(a); dl.appendChild(b); };
      add('전화번호', r.phone || '-'); add('보유 역할', r.roles.map((x) => x === '관리자' && r.adminKind ? r.adminKind : x).join(' · ') || '-'); add('겸임', r.roles.length > 1 ? '겸임 중' : '-'); add('소속 그룹', r.groups.join(', ') || '-'); add('가입일', stamp(r.joined));
      detail.appendChild(o);
      const cs = el('<div class="vlp-cd vlp-usr-cases"><h4>연결된 건</h4><div class="vlp-an-list"></div></div>'), cl = cs.querySelector('.vlp-an-list');
      const seen = new Set(); const uniq = r.cases.filter((x) => !seen.has(x.id) && seen.add(x.id));
      if (!uniq.length) cl.appendChild(el('<div class="hint vlp-an-empty">연결된 건이 없어요.</div>'));
      uniq.slice(0, 20).forEach((x) => { const e = el('<div class="vlp-an-row"><div class="vlp-an-meta hint"></div><div class="vlp-an-text"></div></div>'); e.querySelector('.vlp-an-meta').textContent = x.kind; e.querySelector('.vlp-an-text').textContent = x.label + ' (' + x.id + ')'; cl.appendChild(e); });
      detail.appendChild(cs);
      if (V && V.adminNotesCard) { detail.appendChild(V.adminNotesCard(id)); detail.appendChild(V.adminLogCard(id)); }
    }
    paint();
    if (groupCatalog) {
      const tabs = root.querySelector('.vlp-usr-tabs'), uv = root.querySelector('.vlp-usr-uview'), gv = root.querySelector('.vlp-usr-gview'); tabs.hidden = false; root.querySelector('.vlp-pane-head').appendChild(tabs);
      const S = g.Store, nGroups = () => (S.getGroups() || []).length;
      const mk = (id, label) => { const b = el('<button type="button" role="tab" class="vlp-usr-tab"></button>'); b.dataset.view = id; b.textContent = label; b.addEventListener('click', () => show(id)); tabs.appendChild(b); return b; };
      mk('users', '사용자 ' + all.length + '명'); mk('groups', '그룹 관리 ' + nGroups() + '개');
      const memberCount = (gid, kind) => kind === 'km' ? (S.getKarmasters() || []).filter((k) => (k.groupIds || []).includes(gid)).length : kind === 'shop' ? (S.getShops() || []).filter((x) => (x.groupIds || []).includes(gid)).length : (S.getAdmins() || []).filter((a) => (a.assignedGroupIds || []).includes(gid)).length;
      const TYPE = { region: '지역', community: '커뮤니티', industry: '산업군' };
      function paintGroups() {
        gv.innerHTML = '';
        const card = el('<div class="vlp-cd"><h4>그룹(커뮤니티) 목록</h4><div class="hint">그룹 생성은 슈퍼바이저만 할 수 있어요. 커뮤니티관리자의 담당 범위와 카마스터·시공업체 소속의 기준이 됩니다.</div><div class="vlp-usr-scroll vlp-usr-gscroll"><table class="vlp-usr-table"><thead><tr><th>그룹</th><th>유형</th><th>카마스터</th><th>시공업체</th><th>담당 관리자</th><th>설명</th></tr></thead><tbody></tbody></table></div></div>');
        const tb = card.querySelector('tbody');
        (S.getGroups() || []).forEach((x) => { const tr = el('<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>'), c = tr.children; c[0].textContent = x.name; c[1].textContent = TYPE[x.type] || x.type; c[2].textContent = memberCount(x.groupId, 'km') + '명'; c[3].textContent = memberCount(x.groupId, 'shop') + '곳'; c[4].textContent = memberCount(x.groupId, 'adm') + '명'; c[5].textContent = x.description || '-'; tb.appendChild(tr); });
        gv.appendChild(card); gv.appendChild(groupCatalog);
      }
      function show(id) { st.view = id; uv.hidden = id !== 'users'; gv.hidden = id !== 'groups'; tabs.querySelectorAll('.vlp-usr-tab').forEach((b) => { const on = b.dataset.view === id; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }); if (id === 'groups') paintGroups(); fit(); }
      tabs.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = st.view === 'users' ? 'groups' : 'users'; show(n); tabs.querySelector('[data-view=' + n + ']').focus(); } });
      groupCatalog.addEventListener('click', () => { setTimeout(() => { if (!gv.hidden) { tabs.querySelector('[data-view=groups]').textContent = '그룹 관리 ' + nGroups() + '개'; } }, 50); });
      show(st.view === 'groups' ? 'groups' : 'users');
    }
    g.requestAnimationFrame(() => { g.requestAnimationFrame(fit); });
    return root;
  }
  g.VLP = g.VLP || {}; g.VLP.adminUsers = { render, aggregate };
})(window);
