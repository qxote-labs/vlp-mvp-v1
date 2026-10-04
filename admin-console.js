/* admin-console.js — 관리자 운영 관제 콘솔 (화면 구성안 2.10·2.14·5.4).
 *  · 건 목록(필터: 상태·지연·수집 지연) + 상세(요약｜경로｜이력) + 우측 대화 감독(읽기 전용, vlp-chat 도크).
 *  · 요약 탭: 표시 상태(7-state) ↔ 저장 상태 매핑, 수집·알림 현황 카드. 경로 탭: 노선 개략도 + 위치 처리 이력 + 마지막 수집 시각.
 *  · 개입은 상태 영역 우측 상단 [개입 ▾]: 지연 안내 게시 / 시공사 연락(이의 중재) / 자동 수집 재시도 / 채팅 감독 열기.
 *    서버 API가 있는 것(지연 안내=exceptions, 채팅 감독=sensitive-views)만 동작하고, 없는 것은 비활성으로 보여 준다(추후 처리 D-46).
 *  서버 호출은 facade(contracts.list, admin.collectionStatus, deliveries.*)만 쓴다. 관리자 세션은 목 단계에서 직접 건다(admin-collection.js와 동일). */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui, esc = U.esc, SM = V.statusMap;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstElementChild; };
  const useAdminSession = () => V.api.session.set({ userId: 'adm-1', role: 'admin', phone: '010-0000-0001', name: '관리자', token: 'mock-admin-1' });
  const COLLECT_LABEL = { STALE: '수집 지연', COLLECTING: '수집 중', NOT_STARTED: '수집 전', STOPPED: '수집 종료' };
  const FILTERS = [['all', '전체'], ['moving', '배송 중'], ['exception', '예외·지연'], ['stale', '수집 지연'], ['done', '완료']];
  const filterKey = 'vlp_adm_filter';

  let _cache = null; // 메뉴를 오갈 때 목록을 바로 그리기 위한 직전 불러온 값(곧바로 새로 불러와 맞춘다)
  function render() {
    const wrap = el('<div class="vlp-app vlp-app-admin lay-top" data-tab="cases"><div class="vlp-app-strip" hidden></div><div class="vlp-app-list"></div><div class="vlp-app-detail"></div></div>');
    try { wrap.classList.toggle('list-closed', !!(window.VLP && VLP.caseView && VLP.caseView.listClosed && VLP.caseView.listClosed())); } catch (e) { /* 무시 */ } // 접힘을 첫 그림부터 적용(나중에 적용하면 목록이 한 번 보였다 사라져 깜박임)
    const strip = wrap.querySelector('.vlp-app-strip'), listPane = wrap.querySelector('.vlp-app-list'), detailPane = wrap.querySelector('.vlp-app-detail');
    const route = V.caseView.route;
    let data = { items: [], deliveries: {}, tracking: {}, collect: {} }, loaded = false, lastSig = null, curDetail = null;
    const getFilter = () => { try { return sessionStorage.getItem(filterKey) || 'all'; } catch (e) { return 'all'; } };
    const putFilter = (f) => { try { sessionStorage.setItem(filterKey, f); } catch (e) { /* 무시 */ } };
    const wide = () => g.matchMedia && g.matchMedia('(min-width: 768px)').matches;

    function describe(c) {
      const d = data.deliveries[c.contractId], col = d && data.collect[d.deliveryId], idx = V.caseView.stepIdxOf(d, false);
      const stale = !!(col && col.collectionStatus === 'STALE'), exc = !!(d && d.displayState === 'EXCEPTION');
      const done = !!(d && d.storageState === 'DELIVERED'), moving = !!d && !done;
      let urgent = '', next = '';
      if (exc) urgent = '예외·지연'; else if (stale) urgent = '수집 지연' + (col.staleMinutes != null ? ' +' + col.staleMinutes + '분' : '');
      if (!d) next = '아직 출고 전입니다 (' + (U.STATUS_LABEL[c.status] || c.status) + ')'; else if (done) next = '인도가 끝났습니다'; else if (exc) next = '지연·예외가 진행 중입니다. 카마스터 안내를 확인해 주세요'; else if (stale) next = '위치 자동 수집이 지연되고 있습니다';
      else next = '정상 진행 중입니다';
      const badge = d ? U.stateChip(d.displayState) : '<span class="badge ' + (U.STATUS_BADGE[c.status] || 'info') + '">' + esc(U.STATUS_LABEL[c.status] || c.status) + '</span>';
      return { d, col, idx, stale, exc, done, moving, urgent, next, badge };
    }
    const passes = (f, x) => f === 'all' || (f === 'moving' && x.moving) || (f === 'exception' && x.exc) || (f === 'stale' && x.stale) || (f === 'done' && x.done);
    const countOf = (f) => data.items.filter((c) => passes(f, describe(c))).length;

    function openChat(c, btn) { useAdminSession(); V.chat.open(c.contractId, { role: 'admin', readOnly: true, summary: (c.serviceContractNo || '') + ' · ' + (c.vehicleModel || '차량') + ' · 읽기 전용', opener: btn }); }

    // ---- 개입 ▾ ----
    function interventionMenu(c, d, btn) {
      const menu = el('<div class="vlp-menu vlp-intervene"></div>'); let close;
      const item = (label, run, note) => { const b = el('<button type="button" class="vlp-menu-item"></button>'); { const t = document.createElement('span'); t.appendChild(document.createTextNode(label)); if (note) { const n = document.createElement('span'); n.className = 'mi-note'; n.textContent = note; t.appendChild(n); } b.appendChild(t); } if (!run) { b.disabled = true; b.classList.add('off'); } else b.addEventListener('click', () => { close(); run(btn); }); menu.appendChild(b); };
      item('지연 안내 게시 요청', d && d.storageState !== 'DELIVERED' ? (o) => delayForm(c, d, o) : null, d ? (d.storageState === 'DELIVERED' ? '종결된 건' : '') : '배송 전');
      item('시공사 연락 (이의 중재)', null, '서버 기능 확정 후 제공');
      item('자동 수집 재시도', null, '서버 기능 확정 후 제공');
      item('채팅 감독 열기 (읽기 전용 · 열람 기록)', (o) => openChat(c, o));
      close = V.delivery.openSheet('개입', menu, btn);
    }
    function delayForm(c, d, opener) {
      const labels = V.config.get('delayReasonLabels') || {};
      const f = el('<form class="vlp-aug-form" novalidate><div class="hint">지연 안내를 게시하면 고객·카마스터 화면에 지연 상태가 표시됩니다. 이 조치는 기록됩니다.</div><label>사유</label><select name="reasonCode"></select><label>메모 (기타는 필수)</label><input type="text" name="note" autocomplete="off"><button type="submit" class="btn btn-primary btn-sm" style="margin-top:8px;">지연 안내 게시</button><div class="vlp-error" role="alert" hidden></div></form>');
      V.config.get('delayReasonCodes').forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = labels[k] || k; f.elements.reasonCode.appendChild(o); });
      let close;
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const b = f.querySelector('button'), er = f.querySelector('.vlp-error'); b.disabled = true; er.hidden = true;
        const body = { reasonCode: f.elements.reasonCode.value }; const n = f.elements.note.value.trim(); if (n) body.note = n;
        try { useAdminSession(); await V.api.deliveries.raiseException(d.deliveryId, body); Store.logAdminAction(c.contractId, 'intervene', '지연 안내 게시 · ' + (labels[body.reasonCode] || body.reasonCode)); close(); load(true); } catch (e) { er.textContent = U.errorText(e); er.hidden = false; b.disabled = false; }
      });
      close = V.delivery.openSheet('지연 안내 게시', f, opener);
    }

    // ---- 상세 ----
    // 운영 탭: 관리자 전용 — 표시↔저장 상태 매핑, 수집·알림 현황
    function opsTab(c, x, tr) {
      const d = x.d, w = el('<div class="vlp-ov"></div>');
      // 표시 상태 ↔ 저장 상태 (구성안 5.4)
      const map = el('<div class="vlp-cd vlp-state-map"><h4>상태 매핑</h4></div>');
      const label = (s) => (SM.LABEL || {})[s] || s;
      if (d) {
        const derived = d.displayState === 'CUSTOMIZING' || d.displayState === 'EXCEPTION';
        [['표시 상태', label(d.displayState) + ' (' + d.displayState + ')'], ['저장 상태', d.storageState + ' · ' + SM.STEPS[SM.stepIndex(d.storageState)]]].forEach(([k, v]) => { const r = el('<div class="summary-line"><span></span><span></span></div>'); r.children[0].textContent = k; r.children[1].textContent = v; r.children[1].dataset.k = k === '표시 상태' ? 'display' : 'storage'; map.appendChild(r); });
        if (derived) map.appendChild(el('<div class="hint">' + esc(label(d.displayState)) + '은(는) 이벤트에서 파생하는 표시이며 저장 상태가 없습니다. 저장 상태는 직전 값 그대로입니다.</div>'));
      } else map.appendChild(el('<div class="hint">출고 전이라 배송 상태가 없습니다. 계약 상태: ' + esc(U.STATUS_LABEL[c.status] || c.status) + '</div>'));
      w.appendChild(map);
      // 수집·알림 현황
      const col = x.col, cc = el('<div class="vlp-cd vlp-collect-card"><h4>수집·알림 현황</h4></div>');
      if (d && col) {
        [['마지막 수집', col.lastAutoCollectedAt ? U.fmtDateTime(col.lastAutoCollectedAt) + (col.staleMinutes != null && col.collectionStatus !== 'STOPPED' ? ' (' + col.staleMinutes + '분 경과)' : '') : '없음'], ['수집 상태', (col.collectionStatus === 'STALE' ? '▲ ' : '') + (COLLECT_LABEL[col.collectionStatus] || col.collectionStatus)]].forEach(([k, v]) => { const r = el('<div class="summary-line"><span></span><span></span></div>'); r.children[0].textContent = k; r.children[1].textContent = v; if (k === '수집 상태') r.dataset.status = col.collectionStatus; cc.appendChild(r); });
      } else cc.appendChild(el('<div class="hint">수집 대상이 아닙니다.</div>'));
      cc.appendChild(el('<div class="summary-line"><span>알림 발송</span><span>집계 항목 미정</span></div>'));
      w.appendChild(cc);
      w.appendChild(V.caseView.adminNotesCard(c.contractId)); w.appendChild(V.caseView.adminLogCard(c.contractId));
      return w;
    }
    // 개요 탭: 고객·카마스터 화면과 같은 카드(계약 요약·카마스터 안내·최근 이벤트·배송 정보)
    function overviewTab(c, x, tr) {
      const d = x.d, w = el('<div class="vlp-ov"></div>');
      w.appendChild(V.caseView.summaryCard(c, 'admin', d, tr, { onHistory: () => { const b = detailPane.querySelector('.vlp-tab[data-tab=history]'); if (b) b.click(); } }));
      const note = V.caseView.noteCard(tr, '카마스터 안내'); if (note) w.appendChild(note);
      const ev = V.caseView.recentEvents(tr); if (ev) w.appendChild(ev);
      const di = V.caseView.deliveryInfoCard(d, tr); if (di) w.appendChild(di);
      const cs = V.caseView.constructionCard(d, tr, true); if (cs) w.appendChild(cs);
      return w;
    }
    function routeTab(c, x, tr) {
      const d = x.d; if (!d) return el('<div class="hint">출고 전이라 경로 정보가 없습니다.</div>');
      const w = V.caseView.locationTab(d, tr), col = x.col;
      const cc = el('<div class="vlp-cd"><h4>자동 수집</h4><p></p></div>');
      cc.querySelector('p').textContent = col ? (COLLECT_LABEL[col.collectionStatus] || col.collectionStatus) + ' · 마지막 ' + (col.lastAutoCollectedAt ? U.fmtDateTime(col.lastAutoCollectedAt) : '없음') : '정보 없음';
      w.insertBefore(cc, w.firstChild);
      const loc = tr && tr.location;
      if (loc && (loc.history || []).length) { const ul = el('<ul class="vlp-tl-list"></ul>'); loc.history.slice(0, 8).forEach((o) => { const li = el('<li class="vlp-tl-item"><span class="vlp-tl-text"></span><div class="hint vlp-tl-time"></div></li>'); li.querySelector('.vlp-tl-text').textContent = o.regionText + ' · ' + (V.delivery.SOURCE_LABEL[o.sourceType] || o.sourceType); li.querySelector('.vlp-tl-time').textContent = U.fmtDateTime(o.observedAt); ul.appendChild(li); }); w.appendChild(V.caseView.card('위치 처리 이력', ul)); }
      return w;
    }
    function buildDetail(c) {
      const x = describe(c), d = x.d, tr = data.tracking[c.contractId];
      const tabs = [{ id: 'overview', label: '개요', render: () => overviewTab(c, x, tr) }, { id: 'location', label: '위치', render: () => routeTab(c, x, tr) }, { id: 'construction', label: '시공', render: () => V.caseView.constructionTab(d, tr, true) }, { id: 'ops', label: '운영', render: () => opsTab(c, x, tr) }, { id: 'history', label: '이력', render: () => V.caseView.historyTab(d, tr, true, c) }];
      const ib = el('<button type="button" class="vlp-hero-extra vlp-intervene-btn" aria-haspopup="dialog">개입 ▾</button>'); ib.addEventListener('click', () => interventionMenu(c, d, ib));
      const dRoot = V.caseView.detail({ role: 'admin', contract: c, delivery: d, idx: x.idx, stateHTML: x.badge, next: x.next, aside: c.customerDisplayName || '', tabs, defaultTab: 'ops', onBack: route.clear, onChat: (b) => openChat(c, b), heroExtra: ib });
      if (V.adminHome) V.adminHome.crumb(dRoot, c.contractId);
      return dRoot;
    }

    // ---- 목록 ----
    function paintList(activeId) {
      listPane.innerHTML = '';
      const h = el('<div class="vlp-pane-head"><h2></h2></div>'); h.querySelector('h2').textContent = getFilter() === 'exception' ? '예외 큐' : '건 목록'; const inStrip = wide(); /* 제목은 메뉴 이름과 같게(예외 큐 메뉴에서는 "예외 큐") */ strip.hidden = !inStrip; strip.innerHTML = ''; // 상단 메뉴 + 상태 띠 구조(카마스터와 동일)
      if (inStrip) strip.appendChild(h); else listPane.appendChild(h);
      const f = getFilter();
      const chips = el('<div class="vlp-chip-row" role="group" aria-label="상태 필터"></div>'); (inStrip ? strip : listPane).appendChild(chips);
      FILTERS.forEach(([id, label]) => { const b = el('<button type="button" class="vlp-chip"></button>'); b.dataset.filter = id; { const n = countOf(id); b.appendChild(document.createElement('span')).textContent = label; b.appendChild(document.createTextNode(' ')); b.appendChild(document.createElement('b')).textContent = String(n); if (!n && id !== 'all') b.classList.add('zero'); } b.setAttribute('aria-pressed', id === f ? 'true' : 'false'); b.addEventListener('click', () => { putFilter(id); paint(); }); chips.appendChild(b); });
      const rows = data.items.map((c) => ({ c, x: describe(c) })).filter(({ x }) => passes(f, x)).sort((a, b) => (b.x.urgent ? 1 : 0) - (a.x.urgent ? 1 : 0) || ((b.x.col && b.x.col.staleMinutes) || 0) - ((a.x.col && a.x.col.staleMinutes) || 0));
      const box = el('<div class="vlp-rows"></div>'); listPane.appendChild(box);
      if (!rows.length) box.appendChild(el('<div class="hint">해당하는 건이 없어요.</div>'));
      rows.forEach(({ c, x }) => { const r = V.caseView.listRow({ contract: c, delivery: x.d, idx: x.idx, badgeHTML: x.badge, urgent: x.urgent, active: c.contractId === activeId, keepSub: true, sub: [c.customerDisplayName, x.col ? COLLECT_LABEL[x.col.collectionStatus] : ''].filter(Boolean).join(' · '), onOpen: (id) => route.set(id) }); r.dataset.collect = (x.col && x.col.collectionStatus) || ''; box.appendChild(r); });
      return rows;
    }
    function paint() {
      if (!loaded) return;
      if (curDetail && curDetail.__off) curDetail.__off();
      let id = route.get(), c = id && data.items.find((x) => x.contractId === id);
      if (c && !passes(getFilter(), describe(c))) { c = null; id = null; try { g.history.replaceState(null, '', g.location.pathname + g.location.search); } catch (e) { /* 무시 */ } } // 필터에 안 걸리는 건이 상세에 남지 않게
      const rows = paintListSafe(id); 
      if (!c && wide() && rows.length) { c = rows[0].c; id = c.contractId; try { g.history.replaceState(null, '', g.location.pathname + g.location.search + '#case=' + encodeURIComponent(id)); } catch (e) { /* 무시 */ } listPane.querySelectorAll('.vlp-case-row').forEach((r) => { if (r.dataset.contractId === id) { r.classList.add('on'); r.setAttribute('aria-current', 'true'); } }); }
      if (wrap.isConnected && V.chat && V.chat.isOpen() && !(c && V.chat.isOpenFor(c.contractId))) V.chat.close(); // 다른 건의 대화 열람을 남기지 않는다
      wrap.classList.toggle('has-case', !!c);
      detailPane.innerHTML = '';
      if (c) { curDetail = buildDetail(c); detailPane.appendChild(curDetail); } else { curDetail = null; detailPane.appendChild(el('<div class="vlp-empty-detail hint">왼쪽에서 건을 선택해 주세요.</div>')); }
    }
    function paintListSafe(id) { return paintList(id); }
    function announce() { try { g.dispatchEvent(new CustomEvent('vlp-adm-counts', { detail: { exception: countOf('exception') } })); } catch (e) { /* 무시 */ } }

    async function load(force) {
      try {
        useAdminSession();
        const [page, cs] = await Promise.all([V.api.contracts.list({ limit: 100 }), V.api.admin.collectionStatus({ limit: 100 })]);
        const items = page.items || [], collect = {}, deliveries = {}, tracking = {};
        (cs.items || []).forEach((r) => { collect[r.deliveryId] = r; });
        await Promise.all(items.filter((c) => c.deliveryId).map(async (c) => { try { deliveries[c.contractId] = await V.api.deliveries.get(c.deliveryId); tracking[c.contractId] = await V.delivery.fetchTracking(c.deliveryId); } catch (e) { /* 건별 생략 */ } }));
        const sig = JSON.stringify([items, collect, deliveries, tracking]); // 선택된 건(route)은 넣지 않는다: 첫 그림이 맨 위 건을 고르며 바꾸는 값이라, 넣으면 몇 초 뒤 같은 화면을 다시 그려 깜박였다
        if (!force && sig === lastSig) return;
        lastSig = sig; data = { items, deliveries, tracking, collect }; _cache = { sig, data, at: Date.now() }; loaded = true; paint(); announce();
      } catch (e) { if (!loaded) { listPane.innerHTML = ''; listPane.appendChild(el('<div class="vlp-error" role="alert">' + esc(U.errorText(e)) + '</div>')); } }
    }
    g.addEventListener('vlp-route', () => { if (!document.body.contains(wrap)) return; paint(); g.scrollTo && g.scrollTo(0, 0); });
    if (_cache && Date.now() - _cache.at < 60000) { data = _cache.data; lastSig = _cache.sig; loaded = true; paint(); announce(); load(false); } else load(true);
    const timer = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(timer); return; } load(false); }, V.config.get('pollIntervalMs'));
    return wrap;
  }
  // 관리자 홈이 쓰는 요약: 예외·지연 건, 수집 지연 건 (화면을 그리지 않고 목록만 읽는다)
  async function summary() {
    useAdminSession();
    const [page, cs] = await Promise.all([V.api.contracts.list({ limit: 100 }), V.api.admin.collectionStatus({ limit: 100 })]);
    const items = page.items || [], collect = {}, exceptions = [], stale = [];
    (cs.items || []).forEach((r) => { collect[r.deliveryId] = r; });
    await Promise.all(items.filter((c) => c.deliveryId).map(async (c) => {
      try {
        const d = await V.api.deliveries.get(c.deliveryId), col = collect[c.deliveryId];
        const row = { id: c.contractId, label: [c.vehicleModel || '차량', c.customerDisplayName].filter(Boolean).join(' · ') };
        if (d && d.displayState === 'EXCEPTION') exceptions.push(row); else if (col && col.collectionStatus === 'STALE') stale.push(row);
      } catch (e) { /* 건별 생략 */ }
    }));
    return { exceptions, stale };
  }
  V.adminConsole = { render, summary };
})(typeof window !== 'undefined' ? window : globalThis);
