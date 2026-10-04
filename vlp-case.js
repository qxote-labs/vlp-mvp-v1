/* vlp-case.js — 화면 구성안(v0.11)·목업 기준의 공용 "건 상세" 셸과 목록 행.
 *  · 상세: 헤더(← 차량 · 채팅 배지) / 상태 요약(단계 그래프, 다음 안내, 스크롤하면 한 줄로 압축) / 상단 탭 / 본문 / 하단 주요 행동(+ ⋯ 다른 작업).
 *  · 입력이 필요한 조작은 하단 시트로 연다(기존 폼/패널을 그대로 재사용). 서버 호출은 이 파일에 없다(각 화면이 facade로 처리).
 *  · 목록 행: 차량 · 접수번호 · 상태 칩 · 미니 진행("3/5 · 다음 도착"). 어떤 상세를 보고 있는지는 해시(#case=<계약ID>)로 기억한다. */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui, esc = U.esc, SM = V.statusMap;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstElementChild; };
  let lastAutoChat = null; // PC 와이드(≥1440)에서 대화 패널을 자동으로 연 마지막 계약
  const tabMem = {};      // 계약ID -> 마지막으로 본 탭(화면 안에서만)

  /** 3/5 · 다음 도착 */
  function progressText(idx) { return (idx + 1) + '/5' + (idx < 4 ? ' · 다음 ' + SM.STEPS[idx + 1] : ''); }
  function stepIdxOf(delivery, released) { return delivery ? SM.stepIndex(delivery.storageState) : (released ? 1 : 0); }

  // ---------- 해시 라우팅: #case=<id> ----------
  const route = {
    get() { const m = /(?:^|[#&])case=([^&]+)/.exec(g.location.hash || ''); return m ? decodeURIComponent(m[1]) : null; },
    set(id) { const h = id ? '#case=' + encodeURIComponent(id) : ''; if ((g.location.hash || '') === h) { g.dispatchEvent(new Event('vlp-route')); return; } g.location.hash = h; },
    clear() { if (g.location.hash) g.history.pushState(null, '', g.location.pathname + g.location.search); g.dispatchEvent(new Event('vlp-route')); },
  };
  g.addEventListener('hashchange', () => g.dispatchEvent(new Event('vlp-route')));

  // ---------- 목록 행 ----------
  /** o: {contract, delivery, role, badgeHTML, idx, sub, urgent, active, onOpen} */
  function listRow(o) {
    const c = o.contract;
    const row = el('<button type="button" class="vlp-case-row"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-row-badge"></span></span><span class="hint vlp-row-sub"></span><span class="vlp-row-prog"></span></button>');
    row.dataset.contractId = c.contractId; if (o.urgent) row.classList.add('urgent'); if (o.active) { row.classList.add('on'); row.setAttribute('aria-current', 'true'); }
    row.querySelector('.vlp-row-title').textContent = (c.vehicleModel || '차종 미입력') + (o.titleSuffix ? ' · ' + o.titleSuffix : '');
    row.querySelector('.vlp-row-badge').innerHTML = o.badgeHTML || '';
    // 목업: 제목 줄(차량 · 고객) + 상태 칩, 둘째 줄은 진행 요약만. 계약번호·담당자는 상세의 계약 요약에서 본다. 보조 줄이 필요한 화면만 keepSub로 둔다.
    const subEl = row.querySelector('.vlp-row-sub');
    if (o.keepSub) subEl.textContent = [c.serviceContractNo, o.sub].filter(Boolean).join(' · '); else subEl.remove();
    if (!o.keepSub && !o.titleSuffix && o.sub && o.inlineSub) row.querySelector('.vlp-row-title').textContent += ' · ' + o.sub;
    if (/지연|예외/.test(o.urgent || '')) row.classList.add('exc');
    row.querySelector('.vlp-row-prog').textContent = (o.urgent ? o.urgent + ' · ' : '') + (o.idx != null ? progressText(o.idx) : '');
    row.addEventListener('click', () => o.onOpen(c.contractId));
    return row;
  }

  // ---------- 상세 ----------
  /** o: {role, contract, delivery, idx, stateHTML, aside, next, tabs:[{id,label,render}], defaultTab, primary:{label,title,open,onClose,direct}, more:[{label,title,open}], chatBadge, onBack, onChat, summary} */
  /** 전체 과정 안내 시트: 처음 들어온 고객에게 1회(기기별). 자동화 브라우저에서는 ?guide=1일 때만 열린다 */
  function processGuide(opener) {
    const desc = V.config.get('stepDescriptions') || [];
    const ol = el('<ol class="vlp-guide"></ol>');
    SM.STEPS.forEach((n, k) => { const li = document.createElement('li'); li.appendChild(document.createElement('b')).textContent = n; li.appendChild(document.createElement('span')).textContent = desc[k] || ''; ol.appendChild(li); });
    const box = el('<div><p class="hint">차량 구매는 자주 있는 일이 아니라서 전체 과정을 먼저 알려 드려요. 화면 위 단계 막대의 ▾를 누르면 언제든 다시 볼 수 있어요.</p></div>'); box.appendChild(ol);
    const ok = el('<button type="button" class="btn btn-primary vlp-guide-ok">확인했어요</button>'); box.appendChild(ok);
    const close = V.delivery.openSheet('전체 과정 안내', box, opener); ok.addEventListener('click', () => close());
  }
  function maybeGuide(opener) {
    if (!V.config.get('firstEntryGuide')) return;
    let q = ''; try { q = new URLSearchParams(g.location.search).get('guide') || ''; } catch (e) { /* 무시 */ }
    if (g.navigator && g.navigator.webdriver && q !== '1') return;
    let seen = false; try { seen = g.localStorage.getItem('vlp_guide_seen') === '1' && q !== '1'; } catch (e) { /* 무시 */ }
    if (seen) return;
    try { g.localStorage.setItem('vlp_guide_seen', '1'); } catch (e) { /* 무시 */ }
    setTimeout(() => { if (opener.isConnected && !document.querySelector('.vlp-sheet, .vlp-rate-screen')) processGuide(opener); }, 400);
  }
  function detail(o) {
    const c = o.contract;
    const root = el('<section class="vlp-case" aria-label="계약 상세"><div class="vlp-case-top"><header class="vlp-case-hdr"><button type="button" class="vlp-case-back" aria-label="목록으로">←</button><button type="button" class="vlp-list-toggle" aria-label="목록 접기" aria-expanded="true" hidden></button><b class="vlp-case-title"></b><button type="button" class="btn btn-sm vlp-chat-open-btn vlp-case-chat" aria-label="대화하기">💬 채팅<span class="vlp-chat-badge" hidden></span></button></header>' +
      '<div class="vlp-case-hero"><div class="vlp-case-hl"><span class="vlp-case-state"></span><em class="vlp-case-sm"></em><span class="vlp-case-aside"></span><button type="button" class="vlp-case-stp" aria-label="단계 설명" aria-expanded="false">▾</button></div><div class="vlp-case-graph"></div><p class="vlp-case-next"></p><ul class="vlp-step-desc" hidden></ul></div>' +
      '<div class="vlp-tabs" role="tablist"></div></div><div class="vlp-case-body" role="tabpanel" tabindex="-1"></div><div class="vlp-case-act" hidden></div></section>');
    root.dataset.contractId = c.contractId;
    root.querySelector('.vlp-case-title').textContent = (c.vehicleModel || '차종 미입력') + (o.titleSuffix ? ' · ' + o.titleSuffix : '');
    // 태블릿·PC의 목록|상세 2단 화면에서 왼쪽 목록을 접고 펼친다(카마스터·시공사·관리자). 접힘 여부는 이 탭 세션에 기억한다.
    (function () {
      const tg = root.querySelector('.vlp-list-toggle'); if (o.role === 'customer') return; tg.hidden = false;
      // 22px 표시, 24 격자에 맞춘 가는 선(1.3): 바깥 틀 + 왼쪽 칸. 펼침은 왼쪽 칸을 옅게 채우고 ‹, 접힘은 칸을 비우고 ›
      const SV = (closed) => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (closed ? '' : '<path d="M5.5 4h4.5v16H5.5A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4Z" fill="currentColor" fill-opacity=".16" stroke="none"/>') + '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M10 4v16"/>' + (closed ? '<path d="M5.9 9.8 7.9 12l-2 2.2"/>' : '<path d="M7.7 9.8 5.7 12l2 2.2"/>') + '</svg>';
      const ICON_OUT = SV(false), ICON_IN = SV(true); // 펼침(누르면 ‹ 왼쪽으로 접힘) / 접힘(누르면 › 펼침)
      const KEY = 'vlp_list_closed'; const get = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
      const set = (v) => { try { sessionStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* 저장 불가 환경 */ } };
      const host = () => root.closest('.vlp-app') || document.querySelector('.vlp-app');
      const paint = (closed) => { const h = host(); if (h) h.classList.toggle('list-closed', closed); tg.innerHTML = closed ? ICON_IN : ICON_OUT; tg.title = closed ? '목록 펼치기' : '목록 접기 (상세 넓히기)'; tg.setAttribute('aria-expanded', String(!closed)); tg.setAttribute('aria-label', closed ? '목록 펼치기' : '목록 접기'); };
      tg.addEventListener('click', () => { const v = !host().classList.contains('list-closed'); set(v); paint(v); });
      // 상세가 다시 그려질 때(건 바꿈 등) 아직 화면에 붙기 전일 수 있어 한 박자 뒤에 적용한다
      tg.innerHTML = ICON_OUT; setTimeout(() => paint(get()), 0);
    })();
    if (!o.onBack) root.querySelector('.vlp-case-back').hidden = true; else root.querySelector('.vlp-case-back').addEventListener('click', o.onBack);
    const badge = root.querySelector('.vlp-chat-badge'); if (o.chatBadge) { badge.hidden = false; badge.textContent = String(o.chatBadge); }
    if (o.onChat) root.querySelector('.vlp-case-chat').addEventListener('click', (e) => o.onChat(e.currentTarget)); else root.querySelector('.vlp-case-chat').hidden = true; // 케어 등 대화가 없는 건
    root.querySelector('.vlp-case-state').innerHTML = o.stateHTML || '';
    root.querySelector('.vlp-case-sm').textContent = o.progress != null ? o.progress : progressText(o.idx);
    root.querySelector('.vlp-case-aside').textContent = o.aside || '';
    root.querySelector('.vlp-case-graph').innerHTML = o.graphHTML != null ? o.graphHTML : U.stepGraph(o.delivery || { storageState: o.idx === 1 ? 'PLANNED' : null, displayState: null });
    root.querySelector('.vlp-case-next').textContent = o.next || '';
    // 단계 설명 ▾ (목업 .dsc): 눌러서 5단계 각각의 설명을 펼친다. 펼침 상태는 화면을 다시 그려도 유지
    { const btn = root.querySelector('.vlp-case-stp'), ul = root.querySelector('.vlp-step-desc'), desc = o.stepDescs || V.config.get('stepDescriptions') || [];
      (o.steps || SM.STEPS).forEach((n, k) => { const li = document.createElement('li'); li.appendChild(document.createElement('b')).textContent = n; li.appendChild(document.createTextNode(' ' + (desc[k] || ''))); if (k === o.idx) li.classList.add('cur'); ul.appendChild(li); });
      const set = (on) => { ul.hidden = !on; btn.textContent = on ? '▴' : '▾'; btn.setAttribute('aria-expanded', String(on)); };
      let on0 = false; try { on0 = sessionStorage.getItem('vlp_stepdesc') === '1'; } catch (e) { /* 무시 */ } set(on0);
      btn.addEventListener('click', () => { const on = ul.hidden; set(on); try { sessionStorage.setItem('vlp_stepdesc', on ? '1' : '0'); } catch (e) { /* 무시 */ } });
      if (o.role === 'customer' && !o.noGuide) maybeGuide(btn); }

    // 탭
    const tabsEl = root.querySelector('.vlp-tabs'), bodyEl = root.querySelector('.vlp-case-body');
    let cur = tabMem[c.contractId] && o.tabs.some((t) => t.id === tabMem[c.contractId]) ? tabMem[c.contractId] : (o.defaultTab || o.tabs[0].id);
    const btns = {};
    function show(id) {
      cur = id; tabMem[c.contractId] = id;
      o.tabs.forEach((t) => { const on = t.id === id; btns[t.id].setAttribute('aria-selected', on ? 'true' : 'false'); btns[t.id].tabIndex = on ? 0 : -1; });
      bodyEl.innerHTML = ''; bodyEl.dataset.tab = id; const t = o.tabs.find((x) => x.id === id); const content = t.render(); if (content) bodyEl.appendChild(content);
    }
    o.tabs.forEach((t) => {
      const b = el('<button type="button" role="tab" class="vlp-tab"></button>'); b.textContent = t.label; b.dataset.tab = t.id; btns[t.id] = b;
      b.addEventListener('click', () => show(t.id)); tabsEl.appendChild(b);
    });
    tabsEl.addEventListener('keydown', (e) => { const i = o.tabs.findIndex((t) => t.id === cur); if (e.key === 'ArrowRight' && i < o.tabs.length - 1) { show(o.tabs[i + 1].id); btns[cur].focus(); } if (e.key === 'ArrowLeft' && i > 0) { show(o.tabs[i - 1].id); btns[cur].focus(); } });
    // 좌우 스와이프로 탭 전환
    let sx = null, sy = null;
    bodyEl.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    bodyEl.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) < 70 || Math.abs(dy) > 40) return; const i = o.tabs.findIndex((t) => t.id === cur), n = dx < 0 ? i + 1 : i - 1; if (o.tabs[n]) show(o.tabs[n].id); }, { passive: true });
    show(cur);

    // 주요 행동: 폰·태블릿은 하단 고정 바, PC(≥1280)는 상태 영역 우측 상단(2.14). 다른 작업은 헤더 ⋮ (4.1)
    const act = root.querySelector('.vlp-case-act'), hl = root.querySelector('.vlp-case-hl');
    let primaryBtn = null;
    if (o.heroExtra) { o.heroExtra.classList.add('vlp-hero-extra'); hl.appendChild(o.heroExtra); }
    if (o.primary) {
      const runPrimary = (btn) => { if (o.primary.direct) { o.primary.direct(btn); return; } const h = {}; const body = o.primary.open(h); h.close = V.delivery.openSheet(o.primary.title || o.primary.label, body, btn, o.primary.onClose); };
      act.hidden = false;
      const p = el('<button type="button" class="vlp-primary-btn"></button>'); p.textContent = o.primary.label; p.addEventListener('click', () => runPrimary(p)); act.appendChild(p);
      const ph = el('<button type="button" class="vlp-primary-btn vlp-primary-hero"></button>'); ph.textContent = o.primary.label; ph.addEventListener('click', () => runPrimary(ph)); hl.appendChild(ph);
      primaryBtn = p;
    }
    if (o.more && o.more.length) {
      // 다른 작업(⋯)은 목업처럼 주요 행동 버튼 옆에 둔다: 폰·태블릿은 하단 바, PC는 상태 영역 우측 상단
      act.hidden = false;
      const openMore = (m) => {
        const menu = el('<div class="vlp-menu"></div>'); let close;
        o.more.forEach((it) => { const b = el('<button type="button" class="vlp-menu-item"></button>'); b.textContent = it.label; b.addEventListener('click', () => { close(); if (it.direct) it.direct(m); else { const h = {}; const body = it.open(h); h.close = V.delivery.openSheet(it.title || it.label, body, m); } }); menu.appendChild(b); });
        close = V.delivery.openSheet('다른 작업', menu, m);
      };
      [[act, ''], [hl, ' vlp-more-hero']].forEach(([host, cls]) => { const m = el('<button type="button" class="vlp-more-btn' + cls + '" aria-haspopup="dialog" aria-label="다른 작업">⋯</button>'); m.addEventListener('click', () => openMore(m)); host.appendChild(m); });
    }
    // 도착(인수 확인 대기)에는 인수 확인 시트를 한 번 자동으로 연다(2.4). 호출한 쪽이 "이미 열었는지"를 정해 autoOpen을 넘긴다.
    if (o.autoOpen && primaryBtn) {
      root.dataset.auto = '1';
      setTimeout(() => { if (root.isConnected && !document.querySelector('.vlp-sheet') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) primaryBtn.click(); }, 0);
    }
    // PC 와이드(≥1440): 대화 패널을 건과 함께 항상 보이게 한다(2.14). 사용자가 닫은 뒤 같은 건의 새로고침 때는 다시 열지 않는다.
    if (o.onChat && !o.noAutoChat && g.matchMedia && g.matchMedia('(min-width: 1440px)').matches && lastAutoChat !== c.contractId) {
      lastAutoChat = c.contractId;
      setTimeout(() => { if (root.isConnected && !(V.chat && V.chat.isOpenFor && V.chat.isOpenFor(c.contractId))) o.onChat(null); }, 0);
    }
    // 스크롤하면 상태 요약을 한 줄로
    const hero = root.querySelector('.vlp-case-hero');
    // 태블릿·PC 2단에서는 상세 칸이 자기 스크롤을 가지므로(.vlp-app-detail) 그 스크롤도 함께 본다
    let pane = null;
    const onScroll = () => { const y = Math.max(g.scrollY || document.documentElement.scrollTop || 0, pane ? pane.scrollTop : 0); if (y > 48) hero.classList.add('c'); else if (y < 8) hero.classList.remove('c'); }; // 압축하면 문서가 짧아져 스크롤이 줄어드는 경우가 있어, 되돌리는 기준을 낮춰 깜박임을 막는다
    g.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(() => { pane = root.closest && root.closest('.vlp-app-detail'); if (pane) pane.addEventListener('scroll', onScroll, { passive: true }); }, 0);
    root.__off = () => { g.removeEventListener('scroll', onScroll); if (pane) pane.removeEventListener('scroll', onScroll); };
    return root;
  }

  /** 최근 대화 한 줄 미리보기(개요 탭). 눌러서 대화를 연다. */
  function chatPreview(contractId, opener, opts) {
    opts = opts || {};
    const box = el('<div class="vlp-cd vlp-chat-preview" role="button" tabindex="0" hidden><div class="vlp-sum-top"><h4>대화</h4><span class="vlp-sum-link">전체 보기 ›</span></div><p class="vlp-cp-text"></p></div>');
    V.chat.loadAll(contractId).then((r) => {
      const last = r.items.filter((m) => !m.masked && m.senderRole !== 'system').slice(-2); if (!last.length) return;
      box.querySelector('.vlp-cp-text').innerHTML = last.map((m) => esc((m.senderRole === opts.role ? '나' : (opts.other || '상대')) + ': ' + m.body)).join('<br>'); box.hidden = false;
    }).catch(() => { /* 미리보기는 없어도 된다 */ });
    box.addEventListener('click', () => opener(box)); box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opener(box); } });
    return box;
  }

  /** 계약 필드 요약(개요 탭) */
  function fieldList(c, role, delivery) {
    const box = el('<div class="vlp-fields"></div>');
    U.fieldRows(c, role, delivery).forEach(([k, v]) => { const r = el('<div class="summary-line"><span></span><span></span></div>'); r.children[0].innerHTML = k; r.children[1].innerHTML = v; box.appendChild(r); });
    return box;
  }
  const card = (title, bodyEl) => { const d = el('<div class="vlp-cd"><h4></h4></div>'); d.querySelector('h4').textContent = title; if (bodyEl) d.appendChild(bodyEl); return d; };

  /** 위치 탭: 노선 개략도 → 현재 위치 → 목적지 */
  const hintCard = (title, text) => { const h = el('<div class="hint"></div>'); h.textContent = text; return card(title, h); };
  function locationTab(delivery, tracking) {
    if (!delivery) { const w = el('<div class="vlp-loc-tab"></div>'); ['배송 경로', '현재 위치', '목적지'].forEach((t) => w.appendChild(hintCard(t, '출고가 의뢰되고 배송이 시작되면 표시됩니다.'))); return w; }
    const w = el('<div class="vlp-loc-tab"></div>'), loc = tracking && tracking.location;
    w.appendChild(card('배송 경로 (개략)', V.delivery.routeOutline(delivery, loc)));
    w.appendChild(V.delivery.locationCard(loc));
    w.appendChild(V.delivery.destinationCard(delivery, loc));
    const n = el('<div class="hint vlp-loc-notice"></div>'); n.textContent = V.config.get('locationNotice'); w.appendChild(n);
    return w;
  }
  /** 시공 탭: 게시된 안내(시공 진행·메모) */
  function constructionTab(delivery, tracking, internal) {
    const w = el('<div class="vlp-cons-tab"></div>');
    if (!delivery) { w.appendChild(hintCard('시공 상태', '출고 후 옵션 시공이 있으면 표시됩니다.')); w.appendChild(el('<div class="vlp-sub-title">공정 현황</div>')); w.appendChild(el('<div class="hint">공정 현황이 아직 없어요.</div>')); return w; }
    const items = V.delivery.sortEntries((tracking && tracking.timeline) || []).filter((e) => (e.type === 'AUGMENTATION' || (internal && e.type === 'AUGMENTATION_DRAFT')));
    const st = el('<p class="vlp-cons-state"></p>'); st.textContent = constructionState(delivery, items);
    w.appendChild(card('시공 상태', st));
    if (delivery && delivery.displayState === 'CUSTOMIZING') w.appendChild(el('<div class="vlp-exc-badge" style="background:#f3ecfa;color:#5b2a8a;border-color:#7a3fb0" role="status">✦ 옵션 시공 중입니다</div>'));
    w.appendChild(el('<div class="vlp-sub-title">공정 현황</div>'));
    if (!items.length) w.appendChild(el('<div class="hint">공정 현황이 아직 없어요. 옵션 시공이 있으면 여기에 게시됩니다.</div>'));
    items.forEach((e) => { const d = el('<div class="vlp-cd vlp-aug-item"><h4></h4><p></p></div>'); d.querySelector('h4').textContent = U.fmtDateTime(e.observedAt) + (e.type === 'AUGMENTATION_DRAFT' ? ' · 초안(나만 보임)' : ''); d.querySelector('p').textContent = e.text || ''; w.appendChild(d); });
    return w;
  }
  function constructionState(delivery, items) {
    if (delivery && delivery.displayState === 'CUSTOMIZING') return '옵션 시공 중';
    return items && items.length ? '안내가 게시되어 있어요' : '진행 중인 옵션 시공이 없어요';
  }
  /** 개요 탭: 배송 정보 한 줄 카드 (목업: 배송사 대표번호 · 도착지) */
  function deliveryInfoCard(d, tr) {
    if (!d) return hintCard('배송 정보', '출고 전이라 배송 정보가 없어요.');
    const co = d.deliveryCompany || {}, site = (d.deliverySite && d.deliverySite.name) || '';
    return hintCard('배송 정보', ['배송사 ' + [co.name, co.mainPhone].filter(Boolean).join(' '), site ? '도착지 ' + site : ''].filter((x) => x.trim() !== '배송사').join(' · ') || '정보 없음');
  }
  /** 개요 탭: 시공 한 줄 카드 (목업: 옵션 시공 있음 · 공정 현황은 시공 탭) */
  function constructionCard(d, tr, internal) {
    if (!d) return hintCard('시공', '출고 후 옵션 시공이 있으면 표시됩니다.');
    const items = ((tr && tr.timeline) || []).filter((e) => e.type === 'AUGMENTATION' || (internal && e.type === 'AUGMENTATION_DRAFT'));
    return hintCard('시공', (d.displayState === 'CUSTOMIZING' || items.length) ? '옵션 시공 있음 · 공정 현황은 시공 탭' : '진행 중인 옵션 시공이 없어요');
  }
  /** 시공 탭은 배송이 있으면 항상 둔다(원안 메뉴: 개요·위치·시공·이력). 내용이 없으면 안내 문구만 보인다. */
  function hasConstruction(delivery, tracking, internal) {
    if (!delivery) return false;
    return true;
  }
  /** 이력 탭: 인수 기록(접기 카드) → 진행 기록(날짜 구분 · 한 줄 행 · 최근 N건만). 위치 수집은 위치 탭에서 본다. */
  function historyTab(delivery, tracking, internal, contract) {
    const w = el('<div class="vlp-hist-tab"></div>');
    if (!delivery) {
      const l = el('<ul class="vlp-hl-list"></ul>'); const add = (t, d) => { if (d) { const li = el('<li class="vlp-hl-row"><span class="vlp-hl-time"></span><span class="vlp-hl-text"></span></li>'); li.querySelector('.vlp-hl-time').textContent = U.fmtDateTime(d); li.querySelector('.vlp-hl-text').textContent = t; l.appendChild(li); } };
      add('계약 등록', contract.createdAt); add('승인', contract.approvedAt); if (!l.children.length) l.appendChild(el('<li class="hint">아직 기록이 없어요.</li>'));
      w.appendChild(el('<h3 class="vlp-hl-title">진행 기록</h3>')); w.appendChild(l); return w;
    }
    if (delivery.storageState === 'DELIVERED' && V.handover && V.handover.recordCard) w.appendChild(V.handover.recordCard(delivery));
    const D = V.delivery, SRC = { AUTO: '자동', MANAGER: '카마스터' };
    const all = D.sortEntries((tracking && tracking.timeline) || []).filter((e) => (internal || e.published !== false) && e.type !== 'LOCATION');
    const limit = V.config.get('historyVisible') || 5;
    w.appendChild(el('<h3 class="vlp-hl-title">진행 기록</h3>'));
    const box = el('<div class="vlp-hl"></div>'); w.appendChild(box);
    if (!all.length) box.appendChild(el('<div class="hint">아직 기록이 없어요.</div>'));
    let lastDay = '';
    const two = (n) => String(n).padStart(2, '0');
    const add = (host, e) => {
      const d = new Date(e.observedAt), day = two(d.getMonth() + 1) + '-' + two(d.getDate());
      if (day !== lastDay) { lastDay = day; const sameDay = new Date(); const isToday = sameDay.getMonth() === d.getMonth() && sameDay.getDate() === d.getDate(); host.appendChild(el('<div class="vlp-hl-day">' + day + (isToday ? ' · 오늘' : '') + '</div>')); }
      const row = el('<div class="vlp-hl-row"><span class="vlp-hl-time"></span><span class="vlp-hl-text"></span><span class="vlp-hl-src"></span></div>');
      row.dataset.type = e.type;
      row.querySelector('.vlp-hl-time').textContent = two(d.getHours()) + ':' + two(d.getMinutes());
      row.querySelector('.vlp-hl-text').textContent = (e.text || (D.TYPE_LABEL && D.TYPE_LABEL[e.type]) || '') + (e.published === false ? ' (고객에게 아직 안 보임)' : '');
      row.querySelector('.vlp-hl-src').textContent = SRC[e.sourceType] || '';
      host.appendChild(row);
    };
    all.slice(0, limit).forEach((e) => add(box, e));
    if (all.length > limit) { const more = el('<button type="button" class="vlp-hl-more">이전 기록 더 보기 (' + (all.length - limit) + ') ▾</button>'); more.addEventListener('click', () => { all.slice(limit).forEach((e) => add(box, e)); more.remove(); }); w.appendChild(more); }
    return w;
  }


  // ---------- 개요 탭 카드 (구성안 2.11) ----------
  /** 계약 처리 이력 한 줄: 등록 → 승인 → 고객 확인 → 출고 요청 (+ 배송 → 도착 → 인수). 위치·안내 이벤트는 넣지 않는다(그건 이력 탭). */
  function processChain(c, d, flags) {
    flags = flags || {};
    const out = ['등록'];
    if (c.status === 'REJECTED') { out.push('거절'); return out; }
    if (c.status === 'EXPIRED') { out.push('기한 만료'); return out; }
    if (c.status === 'PENDING_APPROVAL') return out;
    out.push('승인');
    if (flags.confirmed || flags.released || d) out.push('고객 확인');
    if (flags.released || d) out.push('출고 요청');
    if (d) { const done = (d.steps || []).filter((x) => x.done).map((x) => x.state); if (done.includes('IN_TRANSIT')) out.push('배송'); if (done.includes('DELIVERED')) out.push('도착'); if (done.includes('CONFIRMED')) out.push('인수'); }
    return out;
  }
  function contractRows(c, role, d, o) {
    const masked = !!c.masked, later = '승인 후 표시', v = (x) => (x == null || x === '' ? '-' : String(x));
    const km = c.carmaster || {};
    const who = role === 'customer' ? [o.customer && o.customer.name, o.customer && o.customer.phone ? U.formatPhone(o.customer.phone) : ''].filter(Boolean).join(' · ') : (masked ? '' : v(c.customerDisplayName));
    const dest = [c.destinationType ? U.DEST_LABEL[c.destinationType] : '', d && d.deliverySite && d.deliverySite.name, d && d.receiptMode ? U.RECEIPT_LABEL[d.receiptMode] : ''].filter(Boolean).join(' · ');
    return [
      ['서비스 계약번호', v(c.serviceContractNo)],
      ['제조사 계약번호', masked ? later : v(c.manufacturerContractNo)],
      ['차량', [c.vehicleModel, c.trim, c.color].filter(Boolean).join(' · ') || '-'],
      ['계약일자', masked ? later : v(c.contractDate)],
      ['카마스터', [km.name, km.dealershipName, km.phone ? U.formatPhone(km.phone) : ''].filter(Boolean).join(' · ') || '-'],
      ['계약자', who || (masked ? later : '-')],
      ['목적지·수령지', masked ? later : (dest || '-')],
      ['상담 메모', masked ? later : v(c.consultationMemo)],
      ['이력', processChain(c, d, o.flags).join(' → ')],
    ];
  }
  /** 계약 요약 카드 (목업 CS): 제목 줄 오른쪽 '상세 ▾ / 접기 ▴'로 펼치면 아래에 전체 필드와 이력 한 줄이 나온다. 별도 상세 화면은 없다.
   *  o: {flags:{confirmed,released}, customer:{name,phone}} */
  function summaryCard(c, role, delivery, tracking, o) {
    o = o || {};
    const root = el('<div class="vlp-cd vlp-sum"><div class="vlp-sum-top" role="button" tabindex="0" aria-expanded="false"><h4>계약 요약</h4><span class="vlp-sum-link">상세 ▾</span></div><div class="vlp-sum-lines"></div><div class="vlp-sum-more vlp-fields" hidden></div></div>');
    const dest = (delivery && delivery.deliverySite && delivery.deliverySite.name) || (c.destinationType ? U.DEST_LABEL[c.destinationType] : '') || '';
    const car = [c.vehicleModel, c.trim, c.color].filter(Boolean).join(' · ') || '차종 미입력';
    const l1 = [c.serviceContractNo ? '서비스 계약번호 ' + c.serviceContractNo : '', car].filter(Boolean).join(' · ');
    const l2 = [c.contractDate ? '계약일 ' + String(c.contractDate).slice(5) : '', dest ? '수령지 ' + dest : '', U.STATUS_LABEL[c.status] || ''].filter(Boolean).join(' · ');
    const lines = root.querySelector('.vlp-sum-lines');
    [l1, l2].forEach((t) => { const p = el('<p class="vlp-sum-line"></p>'); p.textContent = t; if (t) lines.appendChild(p); });
    const more = root.querySelector('.vlp-sum-more'), head = root.querySelector('.vlp-sum-top'), link = root.querySelector('.vlp-sum-link');
    let built = false;
    function toggle() {
      const open = head.getAttribute('aria-expanded') !== 'true';
      if (open && !built) { built = true; contractRows(c, role, delivery, o).forEach(([k, val]) => { const r = el('<div class="summary-line"><span></span><span></span></div>'); r.children[0].textContent = k; r.children[1].textContent = val; more.appendChild(r); }); }
      head.setAttribute('aria-expanded', open ? 'true' : 'false'); root.classList.toggle('open', open); link.textContent = open ? '접기 ▴' : '상세 ▾'; more.hidden = !open;
      if (open && root.scrollIntoView) root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    head.addEventListener('click', toggle); head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return root;
  }
  /** 게시된 최신 안내 한 건 */
  function noteCard(tracking, title) {
    const e = V.delivery.sortEntries(((tracking && tracking.timeline) || []).filter((x) => x.type === 'AUGMENTATION'))[0];
    if (!e) return hintCard(title || '카마스터 안내', '게시된 안내가 없어요.');
    const b = el('<p class="vlp-note-card"></p>'); b.textContent = e.text || '';
    const d = card(title || '카마스터 안내', b); const t = el('<div class="hint"></div>'); t.textContent = U.fmtDateTime(e.observedAt); d.appendChild(t); return d;
  }
  /** 최근 이벤트 한 줄 카드 (목업: 14:05 출발 · 13:40 상차 · 13:10 출고 의뢰) */
  function recentEvents(tracking) {
    const list = V.delivery.sortEntries(((tracking && tracking.timeline) || []).filter((x) => x.published !== false && x.type !== 'AUGMENTATION' && x.type !== 'AUGMENTATION_DRAFT')).slice(0, 3);
    if (!list.length) return hintCard('최근 이벤트', '아직 이벤트가 없어요.');
    const hm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    return hintCard('최근 이벤트', list.map((e) => hm(e.observedAt) + ' ' + (e.text || e.type)).join(' · '));
  }

  V.caseView = { processGuide, detail, listRow, progressText, stepIdxOf, route, chatPreview, fieldList, locationTab, constructionTab, historyTab, card, summaryCard, noteCard, recentEvents, hasConstruction, deliveryInfoCard, constructionCard, setTab: (id, tab) => { tabMem[id] = tab; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.caseView;
})(typeof window !== 'undefined' ? window : globalThis);
