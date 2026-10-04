/* karmaster-contracts.js — 카마스터 화면의 새 계약 흐름 (S1: PWA-07 승인 대기·거절·승인, PWA-08 조회번호 claim, PWA-10 출고 의뢰).
 * 서버 호출은 VLP.api(facade)만 쓴다. 승인 전 계약은 서버가 마스킹해서 내려 주고(9장), 이 화면은 받은 값만 그린다 —
 * 고객 연락처·제조사 계약번호는 승인 전에 DOM에 존재하지 않는다.
 */
(function (g) {
  'use strict';
  const V = g.VLP; const U = V.ui; const esc = U.esc;
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const S = V.karmasterScreens = {};

  // ================= 패널: 오늘 =================
  S.renderPanel = function (ctx) {
    if (!ctx.keepSession) U.setKarmasterSession(ctx.phone, ctx.name);
    const wrap = el(`<div class="vlp-today">
      <div id="kc-notes"></div>
      <div class="kpi-row" id="kc-kpi"></div>
      <div id="kc-body" aria-live="polite"><div class="hint">불러오는 중…</div></div>
    </div>`);
    const body = wrap.querySelector('#kc-body'), kpi = wrap.querySelector('#kc-kpi');
    let lastSig = null; const open = {};

    function approveBox(c, reload) {
      const box = el(`<div class="vlp-approve">
        <div class="hint">고객 연락처 등 상세 정보는 승인 후에 표시됩니다.</div>
        <fieldset class="vlp-fs"><legend>인도지 유형</legend>
          ${['DEALERSHIP', 'AFFILIATED_SHOP', 'CUSTOM_ADDRESS'].map((k) => `<label class="vlp-radio"><input type="radio" name="dest-${esc(c.contractId)}" value="${k}"> ${esc(U.DEST_LABEL[k])}</label>`).join('')}
        </fieldset>
        <div class="vlp-partner" hidden><label>협력업체명 (내부 전용, 선택)</label><input type="text" name="partnerName" autocomplete="off"></div>
        <label>상담 메모 (선택)</label><textarea name="consultationMemo" rows="2" aria-label="상담 메모"></textarea>
        <div class="btn-row">
          <button type="button" class="btn btn-primary btn-sm vlp-approve-btn" disabled>승인</button>
          <button type="button" class="btn btn-danger btn-sm vlp-reject-open">거절</button>
        </div>
        <div class="vlp-reject" hidden>
          <label>거절 사유</label>
          <select name="reasonCode">${V.config.get('rejectReasonCodes').map((r) => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}</select>
          <label>메모 (선택)</label><input type="text" name="note" autocomplete="off">
          <div class="btn-row"><button type="button" class="btn btn-danger btn-sm vlp-reject-btn">거절 확정</button></div>
        </div>
        <div class="vlp-error" role="alert" hidden></div>
      </div>`);
      const approveBtn = box.querySelector('.vlp-approve-btn'), err = box.querySelector('.vlp-error');
      const dest = () => { const r = box.querySelector('input[type=radio]:checked'); return r ? r.value : ''; };
      box.addEventListener('input', () => { box.dataset.dirty = '1'; });
      box.addEventListener('change', () => {
        box.dataset.dirty = '1';
        approveBtn.disabled = !dest();
        box.querySelector('.vlp-partner').hidden = dest() !== 'AFFILIATED_SHOP';
      });
      box.querySelector('.vlp-reject-open').addEventListener('click', () => { box.querySelector('.vlp-reject').hidden = false; box.dataset.dirty = '1'; });
      async function run(fn) {
        err.hidden = true;
        try { await fn(); delete box.dataset.dirty; reload(true); }
        catch (e) { err.textContent = U.errorText(e); err.hidden = false; if (e.status === 409) reload(true); }
      }
      approveBtn.addEventListener('click', () => {
        if (!dest()) return;
        approveBtn.disabled = true;
        const b = { destinationType: dest() };
        const pn = box.querySelector('[name=partnerName]').value.trim(), cm = box.querySelector('[name=consultationMemo]').value.trim();
        if (b.destinationType === 'AFFILIATED_SHOP' && pn) b.partnerName = pn;
        if (cm) b.consultationMemo = cm;
        run(() => V.api.contracts.approve(c.contractId, b)).then(() => { approveBtn.disabled = !dest(); });
      });
      box.querySelector('.vlp-reject-btn').addEventListener('click', () => {
        const b = { reasonCode: box.querySelector('[name=reasonCode]').value };
        const note = box.querySelector('[name=note]').value.trim(); if (note) b.note = note;
        run(() => V.api.contracts.reject(c.contractId, b));
      });
      return box;
    }

    function releaseBox(c, reload) {
      const box = el(`<div class="vlp-release-order"><div class="hint">고객의 출고 요청이 있으면 출고를 의뢰할 수 있습니다.</div>
        <button type="button" class="btn btn-primary btn-sm vlp-order-btn">출고 의뢰</button><div class="vlp-error" role="alert" hidden></div></div>`);
      const b = box.querySelector('button'), err = box.querySelector('.vlp-error');
      b.addEventListener('click', async () => {
        b.disabled = true; err.hidden = true;
        try { await V.api.contracts.releaseOrder(c.contractId, {}); reload(true); }
        catch (e) { err.textContent = U.errorText(e); err.hidden = false; b.disabled = false; }
      });
      return box;
    }

    // ---- 화면 구성안 5.1: 하단 내비(오늘｜담당 고객｜메시지｜내 정보) + 건 상세(고객과 같은 골격·탭 + 카마스터 입력 층) ----
    const route = V.caseView.route;
    const NAV = [['today', '📋', '오늘'], ['clients', '👥', '담당 고객'], ['msgs', '💬', '메시지'], ['me', '👤', '내 정보']];
    const FILTERS = [['all', '전체'], ['pending', '승인 대기'], ['order', '출고 의뢰'], ['moving', '배송 중'], ['delay', '지연'], ['done', '완료']];
    kpi.remove();
    const app = el('<div class="vlp-app vlp-app-karmaster"><div class="vlp-app-strip" hidden></div><div class="vlp-app-list"></div><div class="vlp-app-detail"></div><nav class="vlp-bottomnav" aria-label="주 메뉴"></nav></div>');
    body.innerHTML = ''; body.appendChild(app);
    const listPane = app.querySelector('.vlp-app-list'), detailPane = app.querySelector('.vlp-app-detail'), nav = app.querySelector('.vlp-bottomnav'), strip = app.querySelector('.vlp-app-strip');
    const layTop = (() => { let q = ''; try { q = new URLSearchParams(g.location.search).get('lay') || ''; } catch (e) { /* 무시 */ } return (q || V.config.get('karmasterLayout') || 'side') === 'top'; })(); // 상태 띠(가로) + 목록|상세, 상단 메뉴 — 'side'면 이전(좌측 메뉴·칩이 목록 안)
    if (layTop) app.classList.add('lay-top');
    let data = { items: [], deliveries: {}, tracking: {}, chat: {} }, filter = 'all', curDetail = null, loaded = false, pendingOpen = null;
    const wide = () => g.matchMedia && g.matchMedia('(min-width: 768px)').matches;
    const tabKey = 'vlp_km_tab';
    const getTab = () => { try { return sessionStorage.getItem(tabKey) || 'today'; } catch (e) { return 'today'; } };
    const putTab = (t) => { try { sessionStorage.setItem(tabKey, t); } catch (e) { /* 무시 */ } };
    const setTab = (t) => { putTab(t); route.clear(); };
    const stateChip = (d) => U.stateChip(d.displayState);

    function describe(c) {
      const d = data.deliveries[c.contractId], idx = V.caseView.stepIdxOf(d, false);
      let cat = 'done', urgent = '', next = '', badge = '<span class="badge ' + (U.STATUS_BADGE[c.status] || 'info') + '">' + esc(U.STATUS_LABEL[c.status] || c.status) + '</span>', todo = '';
      if (c.status === 'PENDING_APPROVAL') { cat = 'pending'; urgent = '승인 필요'; next = '승인하면 고객 연락처 등 상세가 열립니다'; todo = '검토'; }
      else if (c.status === 'APPROVED' && !d) { cat = 'order'; urgent = '출고 의뢰 대기'; next = '고객의 출고 요청이 오면 출고를 의뢰해 주세요'; todo = '출고 의뢰'; }
      else if (c.status === 'APPROVED' && d) {
        cat = 'moving'; badge = stateChip(d); todo = '열기';
        const s = d.storageState;
        if (s === 'ARRIVED') { urgent = '인도 확인 필요'; next = '다음: 도착을 확인하고 인도 확인을 진행해 주세요'; todo = '인도 확인'; }
        else if (s === 'DELIVERED') { cat = 'done'; next = '인도가 끝났습니다'; todo = ''; }
        else next = s === 'IN_TRANSIT' ? '다음: 도착하면 인도 확인을 진행합니다' : '다음: 탁송이 시작되면 위치·안내를 입력할 수 있어요';
        if (d.displayState === 'EXCEPTION') { cat = 'delay'; urgent = '지연 중'; badge = '<span class="badge delay">지연 중</span>'; next = '지연이 해소되면 [지연 해소]를 눌러 주세요'; todo = '지연 안내'; }
      } else { next = '처리가 끝난 계약입니다'; }
      return { d, idx, cat, urgent, next, badge, todo };
    }
    const inFilter = (x) => filter === 'all' || x.cat === filter || (filter === 'moving' && x.cat === 'delay');
    function openChat(c, btn) {
      V.chat.open(c.contractId, { role: 'karmaster', other: '고객', summary: (c.vehicleModel || '차량') + ' · ' + (c.serviceContractNo || '') + ' · 고객', opener: btn });
      (data.chat[c.contractId] || []).forEach((id) => { V.api.notifications.read(id).catch(() => null); }); data.chat[c.contractId] = [];
    }

    // 카마스터 입력 층 요약: 초안·게시 상태 한 줄 (입력 폼은 주요 행동 → 시트로 연다)
    function inputLayer(c, d, tr, openForms) {
      const drafts = ((tr && tr.timeline) || []).filter((e) => e.type === 'AUGMENTATION_DRAFT');
      const customerDraft = drafts.filter((e) => e.audience !== 'INTERNAL').length, internal = drafts.filter((e) => e.audience === 'INTERNAL').length;
      const box = el('<div class="vlp-cd vlp-input-layer"><h4>카마스터 입력</h4><p class="vlp-il-state"></p><button type="button" class="vlp-il-memo">내부 메모</button><button type="button" class="btn btn-sm vlp-preview-btn">고객 화면 보기</button></div>');
      box.querySelector('.vlp-il-state').textContent = '게시 상태: ' + (customerDraft ? '초안 ' + customerDraft + '건 (고객에게 아직 안 보임)' : '게시 대기 없음');
      box.querySelector('.vlp-il-memo').textContent = '내부 메모 ' + internal + '건 (내부 전용) ›';
      box.querySelector('.vlp-il-memo').addEventListener('click', (e) => openForms(e.currentTarget));
      const pv = box.querySelector('.vlp-preview-btn'); if (!d) pv.remove(); else pv.addEventListener('click', () => openCustomerView(c, d, tr, pv));
      return box;
    }
    // 고객 화면 보기(읽기 전용): 고객이 실제로 보는 내용을 시트로 연다
    function openCustomerView(c, d, tr, opener) {
      const w = el('<div class="vlp-cust-view"><div class="hint">고객에게 보이는 화면입니다. 읽기 전용이며 게시되지 않은 초안은 보이지 않습니다.</div></div>');
      w.appendChild(el('<div class="vlp-cv-graph">' + (d ? U.stepGraph(d) : '') + '</div>'));
      const note = V.caseView.noteCard(tr, '카마스터 안내'); if (note) w.appendChild(note);
      if (d) w.appendChild(V.caseView.locationTab(d, tr));
      if (V.caseView.hasConstruction(d, tr, false)) w.appendChild(V.caseView.constructionTab(d, tr, false));
      w.appendChild(V.caseView.historyTab(d, tr, false, c));
      V.delivery.openSheet('고객 화면 보기', w, opener);
    }

    function buildDetail(c) {
      const x = describe(c), d = x.d, tr = data.tracking[c.contractId];
      const closeThen = (h) => () => { if (h && h.close) h.close(); load(true); };
      const manageFormsFor = (btn) => { const h = {}; const bodyEl = V.delivery.manageForms(d, tr, { reload: closeThen(h) }); h.close = V.delivery.openSheet('보강정보 입력', bodyEl, btn); };
      const tabs = [{ id: 'overview', label: '개요', render: () => {
        const w = el('<div class="vlp-ov"></div>');
        w.appendChild(d && d.storageState !== 'DELIVERED' ? inputLayer(c, d, tr, manageFormsFor) : V.caseView.card('카마스터 입력', el('<p class="hint"></p>')));
        if (!d || d.storageState === 'DELIVERED') w.lastChild.querySelector('p').textContent = d ? '인도가 끝나 입력할 내용이 없어요.' : '출고 후 위치·안내를 입력할 수 있어요.';
        w.appendChild(V.caseView.summaryCard(c, 'karmaster', d, tr, {}));
        const note = V.caseView.noteCard(tr, '카마스터 안내'); if (note) w.appendChild(note);
        const ev = V.caseView.recentEvents(tr); if (ev) w.appendChild(ev);
        const cs = V.caseView.constructionCard(d, tr, true); if (cs) w.appendChild(cs);
        w.appendChild(V.caseView.chatPreview(c.contractId, (b) => openChat(c, b), { role: 'karmaster', other: '고객' }));
        return w; } }];
      tabs.push({ id: 'location', label: '위치', render: () => V.caseView.locationTab(d, tr) });
      tabs.push({ id: 'construction', label: '시공', render: () => V.caseView.constructionTab(d, tr, true) });
      tabs.push({ id: 'history', label: '이력', render: () => V.caseView.historyTab(d, tr, true, c) });
      const o = { role: 'karmaster', contract: c, delivery: d, idx: x.idx, stateHTML: x.badge, next: x.next, aside: (tr && tr.location && tr.location.latest) ? tr.location.latest.regionText : '', titleSuffix: c.customerDisplayName ? '고객 ' + c.customerDisplayName : '', tabs, defaultTab: d && (d.storageState === 'IN_TRANSIT') ? 'location' : 'overview',
        chatBadge: (data.chat[c.contractId] || []).length, onBack: route.clear, onChat: (b) => openChat(c, b), more: [] };
      if (c.status === 'PENDING_APPROVAL') o.primary = { label: '승인 · 거절', title: '계약 승인 / 거절', open: (h) => approveBox(c, closeThen(h)) };
      else if (c.status === 'APPROVED' && !d) o.primary = { label: '출고 의뢰', title: '출고 의뢰', open: (h) => releaseBox(c, closeThen(h)) };
      else if (c.status === 'APPROVED' && d) {
        const arrived = d.storageState === 'ARRIVED' || d.storageState === 'DELIVERED', terminal = d.storageState === 'DELIVERED';
        const manage = { label: '보강정보 입력', title: '보강정보 입력 (안내 · 지연)', open: (h) => V.delivery.manageForms(d, tr, { reload: closeThen(h) }) };
        const handover = { label: '카마스터 확인', title: '인도 확인', open: () => V.handover.karmasterPanel(d, { onChange: () => load(true) }) };
        if (arrived) { o.primary = handover; if (!terminal) o.more.push({ label: manage.label, title: manage.title, open: manage.open }); } else { o.primary = manage; }
      }
      o.more.push({ label: '고객에게 메시지', direct: (b) => openChat(c, b) });
      if (pendingOpen === c.contractId && o.primary) o.autoOpen = true;
      pendingOpen = null;
      return V.caseView.detail(o);
    }

    // ---- 목록 쪽(탭별) ----
    function head(title) { const h = el('<div class="vlp-pane-head"><h2></h2></div>'); h.querySelector('h2').textContent = title; return h; }
    function todayPane(activeId) {
      const head0 = head('오늘'); head0.appendChild(U.notificationsPanel({ role: 'karmaster', sheet: true, onAuthLost: () => ctx.onAuthLost && ctx.onAuthLost() })); listPane.appendChild(head0);
      const all = data.items.map((c) => ({ c, x: describe(c) }));
      const by = (cat) => all.filter(({ x }) => x.cat === cat);
      const arrived = all.filter(({ x }) => x.urgent === '인도 확인 필요');
      const moving = all.filter(({ x }) => x.cat === 'moving' && x.urgent !== '인도 확인 필요');
      const kp = el('<div class="vlp-kpi-strip" role="group" aria-label="오늘 요약"></div>');
      [['승인 대기', by('pending').length], ['출고 의뢰', by('order').length], ['배송 중', moving.length + arrived.length], ['지연 후보', by('delay').length]].forEach(([k, n]) => { const i = el('<span class="vlp-kpi"><b></b><span></span></span>'); i.querySelector('b').textContent = String(n); i.querySelector('span').textContent = k; if (!n) i.classList.add('zero'); kp.appendChild(i); });
      listPane.appendChild(kp);
      const sec = (title, list, subOf, tone) => {
        if (!list.length) return;
        const box = el('<section class="vlp-today-sec"><div class="vlp-section-title"></div></section>'); if (tone) box.dataset.tone = tone;
        box.querySelector('.vlp-section-title').innerHTML = '<span></span><span class="vlp-count"></span>';
        box.querySelector('.vlp-section-title span').textContent = title; box.querySelector('.vlp-count').textContent = String(list.length);
        list.forEach(({ c, x }) => {
          const r = el('<div class="vlp-today-row"><span class="vlp-today-text"><b></b><span class="hint"></span></span><button type="button" class="btn btn-sm vlp-today-act"></button></div>');
          r.dataset.contractId = c.contractId; r.querySelector('.vlp-today-text b').textContent = c.vehicleModel || '차종 미입력'; r.querySelector('.vlp-today-text .hint').textContent = subOf(c, x);
          const b = r.querySelector('.vlp-today-act'); b.textContent = x.todo; b.setAttribute('aria-label', x.todo + ' · ' + (c.vehicleModel || '차종 미입력'));
          b.addEventListener('click', () => { pendingOpen = ['검토', '출고 의뢰', '인도 확인', '지연 안내'].includes(x.todo) ? c.contractId : null; V.caseView.setTab(c.contractId, 'overview'); route.set(c.contractId); });
          box.appendChild(r);
        });
        listPane.appendChild(box);
      };
      const who = (c) => (c.customerDisplayName ? '고객 ' + c.customerDisplayName : '고객 정보 없음');
      sec('승인 대기', by('pending'), (c) => '계약 · ' + who(c), 'wait');
      sec('출고 의뢰', by('order'), (c) => '계약 · ' + who(c), 'info');
      sec('인도 확인', arrived, (c) => who(c) + ' · 도착', 'urgent');
      sec('배송 중', moving, (c, x) => (x.d ? (V.statusMap.LABEL || {})[x.d.displayState] || '' : '') || '배송 중', 'info');
      sec('지연 후보', by('delay'), () => '지연 중 · 고객 안내가 필요해요', 'urgent');
      if (!all.some(({ x }) => x.todo)) listPane.appendChild(el('<div class="vlp-todo-none"><span class="vlp-todo-ok" aria-hidden="true">✓</span><div><b>오늘 처리할 일이 없어요</b><span class="hint">새 계약이 오면 알려 드려요.</span></div></div>'));
    }
    function clientsPane(activeId) {
      const ttl = head('담당 고객'); const inStrip = layTop && wide(); if (!inStrip) listPane.appendChild(ttl);
      const chipRow = el('<div class="vlp-chip-row" role="group" aria-label="상태 필터"></div>'); listPane.appendChild(chipRow);
      FILTERS.forEach(([id, label]) => { const n = data.items.filter((c) => id === 'all' || describe(c).cat === id).length; const b = el('<button type="button" class="vlp-chip"></button>'); b.dataset.filter = id; b.appendChild(document.createElement('span')).textContent = label; b.appendChild(document.createTextNode(' ')); b.appendChild(document.createElement('b')).textContent = String(n); if (!n && id !== 'all') b.classList.add('zero'); b.setAttribute('aria-pressed', id === filter ? 'true' : 'false'); b.addEventListener('click', () => { filter = id; paint(); }); chipRow.appendChild(b); });
      if (inStrip) { strip.hidden = false; strip.innerHTML = ''; strip.appendChild(ttl); strip.appendChild(chipRow); } // 제목 → 상태 칩 → 목록|상세 (구매자 '내 차량'과 같은 순서)
      const list = data.items.map((cc) => ({ c: cc, x: describe(cc) })).filter(({ x }) => inFilter(x)).sort((a, b) => (b.x.urgent ? 1 : 0) - (a.x.urgent ? 1 : 0));
      const rowsEl = el('<div class="vlp-rows"></div>'); listPane.appendChild(rowsEl);
      if (!list.length) rowsEl.appendChild(el('<div class="hint">해당하는 계약이 없어요.</div>'));
      list.forEach(({ c: cc, x }) => rowsEl.appendChild(V.caseView.listRow({ contract: cc, delivery: x.d, idx: x.idx, badgeHTML: x.badge, urgent: x.urgent, active: cc.contractId === activeId, sub: cc.customerDisplayName ? '고객 ' + cc.customerDisplayName : '', inlineSub: true, onOpen: (cid) => route.set(cid) })));
      return list;
    }
    function msgsPane() {
      listPane.appendChild(head('메시지'));
      if (!data.items.length) listPane.appendChild(el('<div class="hint">대화할 계약이 없어요.</div>'));
      data.items.forEach((c) => {
        const r = el('<button type="button" class="vlp-case-row vlp-msg-row"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-chat-badge" hidden></span></span><span class="hint vlp-row-sub"></span></button>');
        r.dataset.contractId = c.contractId; r.querySelector('.vlp-row-title').textContent = c.vehicleModel || '차종 미입력';
        r.querySelector('.vlp-row-sub').textContent = [c.serviceContractNo, c.customerDisplayName].filter(Boolean).join(' · ');
        const n = (data.chat[c.contractId] || []).length; if (n) { const bd = r.querySelector('.vlp-chat-badge'); bd.hidden = false; bd.textContent = String(n); }
        r.addEventListener('click', () => openChat(c, r)); listPane.appendChild(r);
      });
    }
    function mePane() {
      listPane.appendChild(head('내 정보'));
      const me = el('<div class="vlp-cd"><h4></h4><p></p></div>'); me.querySelector('h4').textContent = ctx.name || '카마스터'; me.querySelector('p').textContent = U.formatPhone(ctx.phone || ''); listPane.appendChild(me);
      if (V.pushLink) listPane.appendChild(V.caseView.card('알림', V.pushLink.settingsRow()));
      if (ctx.meExtra) listPane.appendChild(V.caseView.card('표시 이름 설정 (닉네임/실명)', ctx.meExtra()));
      if (ctx.logout) { const lo = el('<button type="button" class="btn btn-outline vlp-logout-btn">로그아웃</button>'); lo.addEventListener('click', () => ctx.logout()); listPane.appendChild(lo); }
    }
    function paintNav(inCase) {
      nav.innerHTML = ''; const cur = getTab();
      NAV.forEach(([id, ico, label]) => { const b = el('<button type="button" class="vlp-nav-btn"><span aria-hidden="true"></span><b></b></button>'); b.dataset.tab = id; b.firstChild.textContent = ico; b.querySelector('b').textContent = label; if (id === cur && (!inCase || wide())) b.setAttribute('aria-current', 'page'); b.addEventListener('click', () => setTab(id)); nav.appendChild(b); });
    }
    function paint() {
      if (!loaded) return;
      if (curDetail && curDetail.__off) curDetail.__off();
      let id = route.get(), c = id && data.items.find((x) => x.contractId === id);
      if (c && wide() && getTab() !== 'clients') putTab('clients');
      const tab = getTab(); listPane.innerHTML = ''; strip.hidden = true; strip.innerHTML = '';
      let list = [];
      if (tab === 'today') todayPane(id); else if (tab === 'clients') list = clientsPane(id); else if (tab === 'msgs') msgsPane(); else mePane();
      if (!c && wide() && tab === 'clients' && list.length) { c = list[0].c; id = c.contractId; try { g.history.replaceState(null, '', g.location.pathname + g.location.search + '#case=' + encodeURIComponent(id)); } catch (e) { /* 무시 */ } listPane.querySelectorAll('.vlp-case-row').forEach((r) => { if (r.dataset.contractId === id) { r.classList.add('on'); r.setAttribute('aria-current', 'true'); } }); }
      app.classList.toggle('has-case', !!c); app.dataset.tab = tab; paintNav(!!c);
      detailPane.innerHTML = '';
      if (c) { curDetail = buildDetail(c); detailPane.appendChild(curDetail); } else { curDetail = null; detailPane.appendChild(el('<div class="vlp-empty-detail hint">' + (tab === 'clients' ? '왼쪽에서 계약을 선택해 주세요.' : '') + '</div>')); }
    }
    async function load(force) {
      let page;
      try { page = await V.api.contracts.list({ limit: 100 }); }
      catch (e) { if (e.status === 401 && ctx.onAuthLost) { ctx.onAuthLost(); return; } if (!loaded) { body.innerHTML = ''; body.appendChild(el('<div class="vlp-error" role="alert">' + esc(U.errorText(e)) + '</div>')); } return; }
      const items = page.items || [], deliveries = {}, tracking = {}, chat = {};
      await Promise.all(items.filter((c) => c.deliveryId).map(async (c) => { try { deliveries[c.contractId] = await V.api.deliveries.get(c.deliveryId); tracking[c.contractId] = await V.delivery.fetchTracking(c.deliveryId); } catch (e) { /* 칩만 생략 */ } }));
      try { const n = await V.api.notifications.list({ limit: 50 }); (n.items || []).forEach((x) => { if (!x.read && x.refType === 'contract' && /새 메시지/.test(x.text || '')) (chat[x.refId] = chat[x.refId] || []).push(x.notificationId); }); } catch (e) { /* 배지는 없어도 된다 */ }
      const sig = JSON.stringify([items, deliveries, tracking, chat, filter, route.get(), getTab()]);
      if (!force && sig === lastSig) return;
      if (!force && loaded && app.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      lastSig = sig; data = { items, deliveries, tracking, chat }; loaded = true;
      const deepId = V.pushLink && V.pushLink.applyDeep(items, {});
      if (deepId) { try { g.history.replaceState(null, '', g.location.pathname + g.location.search + '#case=' + encodeURIComponent(deepId)); } catch (e) { /* 무시 */ } }
      paint();
    }
    g.addEventListener('vlp-route', () => { if (!document.body.contains(wrap)) return; lastSig = null; paint(); g.scrollTo && g.scrollTo(0, 0); });
    load(true);
    const timer = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(timer); return; } load(false); }, V.config.get('pollIntervalMs'));
    return wrap;
  };

  // ================= PWA-08: 미가입 카마스터 — 조회번호로 처음 열기 / 확인번호로 다시 들어가기 =================
  const failKey = (phone) => 'vlp_claim_fail_' + U.digits(phone);
  const getFails = (phone) => { try { return parseInt(sessionStorage.getItem(failKey(phone)) || '0', 10) || 0; } catch (e) { return 0; } };
  const setFails = (phone, n) => { try { sessionStorage.setItem(failKey(phone), String(n)); } catch (e) { /* 무시 */ } };

  S.renderClaim = function (ctx) {
    const max = V.config.get('claimMaxAttempts'), ttl = V.config.get('claimTtlHours'), pinLen = V.config.get('pinLength'), grace = V.config.get('unregisteredGraceDays');
    const wrap = el(`<div class="vlp-claim ap-wrap ap-claim-wrap">
      <div class="ap-brand"><div class="ap-logo" aria-hidden="true">🚗</div><h1>VLP</h1><p class="ap-tag">미가입 카마스터 입장</p></div>
      <div class="ap-card">
        <div class="seg" role="tablist" aria-label="입장 방법">
          <button class="seg-b on" id="cl-tab-claim" type="button" role="tab" aria-selected="true">처음 열기 · 조회번호</button>
          <button class="seg-b" id="cl-tab-login" type="button" role="tab" aria-selected="false">다시 들어가기 · 확인번호</button>
        </div>
        <p class="ap-sub" id="cl-sub"></p>
        <label class="ap-label" for="cl-phone">내 연락처 <small>(고객 안내문의 번호 그대로)</small></label><input id="cl-phone" type="tel" inputmode="numeric" autocomplete="off" placeholder="010-0000-0000">
        <div id="cl-claim-only"><label class="ap-label" for="cl-token">조회번호</label><input id="cl-token" type="text" autocomplete="off" spellcheck="false">
          <label class="ap-label" for="cl-contract">제조사 계약번호 <small>(선택)</small></label><input id="cl-contract" type="text" autocomplete="off"></div>
        <label class="ap-label" for="cl-pin">확인번호 <small>(숫자 ${esc(pinLen)}자리)</small></label><input id="cl-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="${esc(pinLen)}">
        <div id="cl-confirm-wrap" hidden><label class="ap-label" for="cl-pin2">확인번호 한 번 더 <small>(처음 정할 때)</small></label><input id="cl-pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="${esc(pinLen)}"></div>
        <div class="hint" id="cl-pin-hint" style="margin:-6px 0 8px;"></div>
        <button class="btn btn-primary ap-go" id="cl-submit" type="button" disabled>계약 열기</button>
        <div class="vlp-attempts" id="cl-attempts" role="status"></div>
        <div class="vlp-error" id="cl-error" role="alert" hidden></div>
        <div class="hint" id="cl-lost" style="margin-top:10px;">조회번호를 잃어버렸거나 기한이 지났다면 고객에게 “조회번호 다시 발급”을 요청하세요.</div>
      </div>
      <button class="btn btn-outline ap-go" id="cl-back" type="button">← 로그인 화면으로</button>
    </div>`);
    const $ = (q) => wrap.querySelector(q);
    const phoneEl = $('#cl-phone'), tokenEl = $('#cl-token'), contractEl = $('#cl-contract'), pinEl = $('#cl-pin'), pin2El = $('#cl-pin2'), submit = $('#cl-submit'), errBox = $('#cl-error'), att = $('#cl-attempts');
    let mode = 'claim', locked = false, needConfirm = false;
    function setMode(m) {
      mode = m; needConfirm = false; errBox.hidden = true;
      $('#cl-tab-claim').className = 'seg-b' + (m === 'claim' ? ' on' : ''); $('#cl-tab-login').className = 'seg-b' + (m === 'login' ? ' on' : '');
      $('#cl-tab-claim').setAttribute('aria-selected', m === 'claim'); $('#cl-tab-login').setAttribute('aria-selected', m === 'login');
      $('#cl-claim-only').hidden = m !== 'claim'; $('#cl-confirm-wrap').hidden = true; $('#cl-lost').hidden = m !== 'claim';
      $('#cl-sub').textContent = m === 'claim'
        ? '조회번호는 발급 후 ' + ttl + '시간 동안 1회만 쓸 수 있고 최대 ' + max + '회 시도할 수 있어요. 처음이면 확인번호를 정해 주세요. 이후 계약은 조회번호 없이 자동 연결됩니다.'
        : '정해 둔 확인번호로 들어옵니다. 마지막 계약 종료 후 ' + grace + '일이 지나면 닫히며, 새 조회번호로 다시 시작할 수 있어요.';
      $('#cl-pin-hint').textContent = m === 'claim' ? '처음이면 새로 정할 번호, 이미 정했다면 기존 확인번호를 입력하세요.' : '';
      submit.textContent = m === 'claim' ? '계약 열기' : '들어가기'; validate();
    }
    function showAttempts() {
      const n = getFails(phoneEl.value);
      att.textContent = locked ? '시도 횟수를 초과해 잠겼습니다. 약 ' + V.config.get('claimLockMinutes') + '분 뒤 다시 시도해 주세요.' : (n > 0 ? '실패 ' + n + '회 / 최대 ' + max + '회 (이 화면 기준 · 최종 판단은 서버)' : '');
    }
    const pinOk = () => new RegExp('^\\d{' + pinLen + '}$').test(pinEl.value);
    function validate() { submit.disabled = locked || !(U.isPhone(phoneEl.value) && pinOk() && (mode === 'login' || tokenEl.value.trim().length > 0) && (!needConfirm || pin2El.value.length > 0)); }
    phoneEl.addEventListener('input', () => { const f = U.formatPhone(phoneEl.value); if (phoneEl.value !== f) phoneEl.value = f; locked = false; validate(); showAttempts(); });
    [tokenEl, pinEl, pin2El].forEach((e) => e.addEventListener('input', validate));
    $('#cl-tab-claim').addEventListener('click', () => setMode('claim')); $('#cl-tab-login').addEventListener('click', () => setMode('login'));
    $('#cl-back').addEventListener('click', () => ctx.back());
    submit.addEventListener('click', async () => {
      submit.disabled = true; errBox.hidden = true;
      U.setKarmasterSession(phoneEl.value, '');
      try {
        let res;
        if (mode === 'claim') {
          const body = { phone: phoneEl.value, claimToken: tokenEl.value.trim(), pin: pinEl.value };
          if (contractEl.value.trim()) body.manufacturerContractNo = contractEl.value.trim();
          if (needConfirm) body.pinConfirm = pin2El.value;
          res = await V.api.access.claim(body);
        } else res = await V.api.access.login({ phone: phoneEl.value, pin: pinEl.value });
        setFails(phoneEl.value, 0);
        const phone = phoneEl.value, token = res.sessionToken;
        tokenEl.value = ''; pinEl.value = ''; pin2El.value = '';
        ctx.onClaimed(phone, token);
      } catch (e) {
        const sub = e.details && e.details.subcode;
        if (e.status === 422 && sub === 'PIN_SETUP_CONFIRM') {
          needConfirm = true; $('#cl-confirm-wrap').hidden = false; errBox.textContent = pin2El.value ? '확인번호가 서로 다릅니다. 다시 입력해 주세요.' : '처음 정하는 확인번호입니다. 한 번 더 입력해 주세요.'; pin2El.value = '';
        } else if (e.status === 422 && sub === 'PIN_FORMAT') errBox.textContent = '확인번호는 숫자 ' + pinLen + '자리입니다.';
        else {
          if (e.status === 429) { locked = true; setFails(phoneEl.value, max); } else if (e.status === 404) setFails(phoneEl.value, getFails(phoneEl.value) + 1);
          errBox.textContent = e.status === 404 ? (mode === 'claim' ? '조회번호 또는 확인번호가 맞지 않거나 만료되었습니다. 번호와 연락처를 다시 확인해 주세요.' : '연락처 또는 확인번호가 맞지 않습니다.') : U.errorText(e);
          tokenEl.value = ''; pinEl.value = ''; pin2El.value = '';
        }
        errBox.hidden = false; showAttempts(); validate();
        if (e.status === 422 && sub === 'PIN_SETUP_CONFIRM') pin2El.focus();
      }
    });
    setMode('claim');
    return wrap;
  };
})(typeof window !== 'undefined' ? window : globalThis);
