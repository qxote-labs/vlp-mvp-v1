/* vlp-delivery.js — S2 인도 트래킹 화면 부품 (PWA-13 위치 B안, PWA-14 보강 입력, PWA-15 지연, PWA-16 타임라인).
 * 모든 서버 호출은 VLP.api(facade)로만 한다. 지도 라이브러리·외부 스크립트는 쓰지 않는다.
 * 위치는 좌표가 아니라 "지역 문구"이며 출처(AUTO/MANAGER)와 관측 시각을 항상 함께 보여 준다. */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui, esc = U.esc;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstChild; };
  const SOURCE_LABEL = { AUTO: '자동 수집', MANAGER: '카마스터 입력' };
  const COLLECT_NOTE = {
    NOT_STARTED: '아직 위치 수집이 시작되지 않았어요. 배차 후 안내됩니다.',
    COLLECTING: '위치를 주기적으로 확인하고 있어요.',
    STALE: '최근 갱신이 오래되어 위치가 실제와 다를 수 있어요.',
    STOPPED: '도착하여 위치 수집이 끝났어요.',
  };
  const ago = (iso) => { if (!iso) return ''; const m = Math.max(0, Math.floor((U.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전'; };
  const reasonLabel = (code) => (V.config.get('delayReasonLabels') || {})[code] || code;

  /** 한 배송 건의 위치·타임라인을 한 번에 읽는다. */
  async function fetchTracking(deliveryId) {
    const [location, timeline] = await Promise.all([
      V.api.deliveries.location(deliveryId).catch(() => null),
      V.api.deliveries.timeline(deliveryId, { limit: 50 }).catch(() => ({ items: [] })),
    ]);
    return { location, timeline: (timeline && timeline.items) || [] };
  }

  // ---------- 주소 복사 / 외부 길찾기 ----------
  async function copyText(text) {
    try { if (g.navigator && g.navigator.clipboard && g.isSecureContext) { await g.navigator.clipboard.writeText(text); return true; } } catch (e) { /* 아래 대체 방법 */ }
    try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
  }
  const navUrl = (address) => String(V.config.get('navLinkTemplate') || '').replace('{q}', encodeURIComponent(address));

  function destinationCard(delivery, loc) {
    const site = delivery.deliverySite || {}, addr = (loc && loc.destinationAddress) || site.address || '';
    const box = el('<div class="vlp-dest"><div class="vlp-sub-title">인수 장소</div><div class="vlp-dest-name"></div><div class="vlp-dest-addr"></div><div class="btn-row"></div></div>');
    box.querySelector('.vlp-dest-name').textContent = site.name || '인수 장소';
    box.querySelector('.vlp-dest-addr').textContent = addr || '주소가 아직 정해지지 않았어요.';
    if (addr) {
      const row = box.querySelector('.btn-row');
      const cp = el('<button type="button" class="btn btn-sm vlp-copy-addr">주소 복사</button>');
      cp.addEventListener('click', async () => { U.toast((await copyText(addr)) ? '주소를 복사했어요' : '복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.'); });
      const go = el('<a class="btn btn-sm vlp-nav-link" target="_blank" rel="noopener noreferrer">길찾기 (외부 앱·웹)</a>');
      go.href = navUrl(addr);
      row.appendChild(cp); row.appendChild(go);
    }
    return box;
  }

  // ---------- 공통 단계 표시 (세로 타임라인): 배송 경로·신차케어 진행에서 같이 쓴다 ----------
  // nodes: [{ t:제목, sub:보조 문구, m:오른쪽 작은 표시, s:'done'|'cur'|'todo'|'skip' }]
  function stepper(nodes, label) {
    const ol = el('<ol class="vlp-stp"></ol>'); if (label) ol.setAttribute('aria-label', label);
    nodes.forEach((n) => {
      const li = el('<li class="vlp-stp-i ' + n.s + '"' + (n.s === 'cur' ? ' aria-current="step"' : '') + '><span class="vlp-stp-dot" aria-hidden="true"></span><span class="vlp-stp-body"><b class="vlp-stp-t"></b><span class="vlp-stp-s"></span></span><span class="vlp-stp-m"></span></li>');
      li.querySelector('.vlp-stp-t').textContent = n.t;
      const sub = li.querySelector('.vlp-stp-s'); if (n.sub) sub.textContent = n.sub; else sub.remove();
      const m = li.querySelector('.vlp-stp-m'); if (n.m) m.textContent = n.m; else m.remove();
      ol.appendChild(li);
    });
    return ol;
  }

  // ---------- 노선 개략도 (지도 아님: 지나온 지역 → 현재 → 도착지) ----------
  function routeOutline(delivery, loc) {
    const hist = ((loc && loc.history) || []).slice().reverse(); // 오래된 것 → 최신
    const places = []; hist.forEach((o) => { if (!places.length || places[places.length - 1] !== o.regionText) places.push(o.regionText); });
    const stopped = loc && loc.collectionStatus === 'STOPPED', arrived = delivery.storageState === 'ARRIVED' || delivery.storageState === 'DELIVERED';
    const cap = 4, shown = places.length > cap + 1 ? places.slice(-cap - 1) : places;
    const nodes = [{ t: '출발', s: 'done', m: '지나옴' }];
    if (places.length > shown.length) nodes.push({ t: '…', s: 'skip', m: '이전 ' + (places.length - shown.length) + '곳' });
    shown.forEach((p, i) => { const isCur = i === shown.length - 1 && !arrived; nodes.push({ t: p, s: isCur ? 'cur' : 'done', m: isCur ? '현재' : '지나옴' }); });
    nodes.push({ t: (delivery.deliverySite && delivery.deliverySite.name) || '도착지', s: arrived ? 'cur' : 'todo', m: arrived ? '도착' : '예정' });
    const ol = stepper(nodes.map((n) => ({ t: n.t, m: n.m, s: n.s })), '이동 경로 개략도'); ol.classList.add('vlp-route');
    return ol;
  }

  // ---------- 현재 위치 카드 + 시트 ----------
  function openSheet(title, bodyEl, opener, onClose) {
    const back = el('<div class="vlp-sheet-back"></div>');
    const sheet = el('<div class="vlp-sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="vlp-sheet-head"><b class="vlp-sheet-title"></b><button type="button" class="btn btn-sm vlp-sheet-close">닫기</button></div><div class="vlp-sheet-body"></div></div>');
    sheet.querySelector('.vlp-sheet-title').textContent = title; sheet.querySelector('.vlp-sheet-body').appendChild(bodyEl);
    const close = () => { back.remove(); sheet.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus(); if (onClose) onClose(); };
    const onKey = (e) => { if (e.key !== 'Escape') return; const all = document.querySelectorAll('.vlp-sheet'); if (all[all.length - 1] === sheet) close(); }; // 겹친 시트는 맨 위 것만 닫는다
    sheet.querySelector('.vlp-sheet-close').addEventListener('click', close); back.addEventListener('click', close); document.addEventListener('keydown', onKey);
    document.body.appendChild(back); document.body.appendChild(sheet); sheet.focus();
    return close;
  }
  function locationSheetBody(loc) {
    const b = el('<div class="vlp-loc-sheet"></div>');
    const l = loc.latest;
    b.appendChild(el('<div class="summary-line"><span>현재 위치</span><span class="vlp-ls-region"></span></div>'));
    b.querySelector('.vlp-ls-region').textContent = l ? l.regionText : '아직 없음';
    const rows = [['출처', l ? SOURCE_LABEL[l.sourceType] || l.sourceType : '-'], ['관측 시각', l ? U.fmtDateTime(l.observedAt) + ' (' + ago(l.observedAt) + ')' : '-'], ['마지막 자동 수집', loc.lastAutoCollectedAt ? U.fmtDateTime(loc.lastAutoCollectedAt) + ' (' + ago(loc.lastAutoCollectedAt) + ')' : '없음'], ['수집 상태', COLLECT_NOTE[loc.collectionStatus] || loc.collectionStatus]];
    rows.forEach(([k, v]) => { const r = el('<div class="summary-line"><span></span><span></span></div>'); r.children[0].textContent = k; r.children[1].textContent = v; b.appendChild(r); });
    b.appendChild(el('<div class="vlp-sub-title" style="margin-top:12px;">갱신 이력</div>'));
    const ul = el('<ul class="vlp-hist"></ul>');
    if (!(loc.history || []).length) ul.appendChild(el('<li class="hint">아직 기록이 없어요.</li>'));
    (loc.history || []).forEach((o) => { const li = el('<li><span class="vlp-hist-region"></span> <span class="badge info vlp-src"></span><div class="hint vlp-hist-time"></div></li>'); li.querySelector('.vlp-hist-region').textContent = o.regionText; li.querySelector('.vlp-src').textContent = SOURCE_LABEL[o.sourceType] || o.sourceType; li.querySelector('.vlp-hist-time').textContent = U.fmtDateTime(o.observedAt); ul.appendChild(li); });
    b.appendChild(ul); b.appendChild(el('<div class="hint vlp-loc-notice" style="margin-top:10px;"></div>')); b.querySelector('.vlp-loc-notice').textContent = V.config.get('locationNotice');
    return b;
  }
  function locationCard(loc) {
    const l = loc && loc.latest;
    const btn = el('<button type="button" class="vlp-loc-card" aria-haspopup="dialog"><span class="vlp-sub-title">현재 위치</span><b class="vlp-loc-region"></b><span class="hint vlp-loc-meta"></span><span class="hint vlp-loc-note"></span></button>');
    btn.querySelector('.vlp-loc-region').textContent = l ? l.regionText : '위치 정보 없음';
    btn.querySelector('.vlp-loc-meta').textContent = l ? (SOURCE_LABEL[l.sourceType] || l.sourceType) + ' · ' + U.fmtDateTime(l.observedAt) + ' · ' + ago(l.observedAt) : '';
    const st = loc ? loc.collectionStatus : 'NOT_STARTED';
    btn.querySelector('.vlp-loc-note').textContent = COLLECT_NOTE[st] || '';
    btn.dataset.collection = st;
    if (loc) btn.addEventListener('click', () => openSheet('현재 위치 상세', locationSheetBody(loc), btn));
    return btn;
  }

  // ---------- 타임라인 (PWA-16): 자동 수집 + 카마스터 입력을 한 줄로 병합, 출처 라벨 ----------
  const TYPE_LABEL = { LOCATION: '위치', STATE: '상태', EXCEPTION_RAISED: '지연 발생', EXCEPTION_RESOLVED: '지연 해소', AUGMENTATION: '안내', AUGMENTATION_DRAFT: '초안', STATE_CHANGED: '상태 변경' };
  function sortEntries(items) { // 최신 먼저, 같은 시각은 받은 순서를 유지(안정)
    return items.map((e, i) => ({ e, i })).sort((a, b) => (a.e.observedAt < b.e.observedAt ? 1 : a.e.observedAt > b.e.observedAt ? -1 : a.i - b.i)).map((x) => x.e);
  }
  function timelinePanel(items, opts) {
    opts = opts || {}; const internal = !!opts.internal, limit = opts.limit || 6;
    const box = el('<div class="vlp-tl"><div class="vlp-sub-title">진행 기록</div><ul class="vlp-tl-list"></ul></div>');
    const ul = box.querySelector('ul'); const all = sortEntries(items || []).filter((e) => internal || e.published !== false);
    if (!all.length) ul.appendChild(el('<li class="hint">아직 기록이 없어요.</li>'));
    const add = (e) => { const li = el('<li class="vlp-tl-item"><span class="vlp-tl-type badge"></span> <span class="vlp-tl-text"></span> <span class="badge info vlp-src"></span><div class="hint vlp-tl-time"></div></li>'); li.dataset.type = e.type; li.querySelector('.vlp-tl-type').textContent = TYPE_LABEL[e.type] || e.type; li.querySelector('.vlp-tl-text').textContent = e.text || ''; const sl = li.querySelector('.vlp-src'); sl.textContent = SOURCE_LABEL[e.sourceType] || e.sourceType || ''; sl.dataset.source = e.sourceType || ''; li.querySelector('.vlp-tl-time').textContent = U.fmtDateTime(e.observedAt) + (e.published === false ? ' · 고객에게 아직 안 보임' : ''); ul.appendChild(li); };
    all.slice(0, limit).forEach(add);
    if (all.length > limit) { const more = el('<button type="button" class="btn btn-sm vlp-tl-more">이전 기록 더 보기 (' + (all.length - limit) + ')</button>'); more.addEventListener('click', () => { all.slice(limit).forEach(add); more.remove(); }); box.appendChild(more); }
    return box;
  }

  /** 고객/공용 읽기 패널: 위치 B안 + 타임라인. */
  function trackingPanel(delivery, data, opts) {
    opts = opts || {};
    const wrap = el('<div class="vlp-track"></div>');
    const loc = data && data.location;
    wrap.appendChild(locationCard(loc));
    wrap.appendChild(routeOutline(delivery, loc));
    wrap.appendChild(destinationCard(delivery, loc));
    wrap.appendChild(timelinePanel(data && data.timeline, { internal: !!opts.internal }));
    wrap.appendChild(el('<div class="hint vlp-loc-notice"></div>')); wrap.lastChild.textContent = V.config.get('locationNotice');
    return wrap;
  }

  // ---------- 카마스터: 보강 입력(PWA-14) + 지연(PWA-15) ----------
  function openExceptionId(items) {
    const open = new Map();
    items.slice().reverse().forEach((e) => { if (e.type === 'EXCEPTION_RAISED' && e.exceptionId) open.set(e.exceptionId, e); else if (e.type === 'EXCEPTION_RESOLVED') open.delete(e.exceptionId); });
    return open.size ? Array.from(open.keys())[0] : null;
  }
  function manageForms(delivery, data, ctx) {
    const wrap = el('<div class="vlp-manage"></div>'), reload = ctx.reload || (() => {});
    const err = (box, e) => { box.textContent = U.errorText(e); box.hidden = false; };
    const items = (data && data.timeline) || [];

    // 지연
    const exId = openExceptionId(items), terminal = delivery.storageState === 'DELIVERED';
    const ex = el('<div class="vlp-exc"><div class="vlp-sub-title">지연 알림</div><div class="vlp-error" role="alert" hidden></div></div>');
    if (terminal) ex.appendChild(el('<div class="hint">인도가 종결된 건입니다.</div>'));
    else if (exId) {
      ex.insertBefore(el('<div class="vlp-exc-badge" role="status">▲ 지연 중입니다. 해소되면 아래 버튼을 눌러 주세요.</div>'), ex.querySelector('.vlp-error'));
      const b = el('<button type="button" class="btn btn-sm btn-primary vlp-exc-resolve">지연 해소</button>');
      b.addEventListener('click', async () => { b.disabled = true; try { await V.api.deliveries.resolveException(delivery.deliveryId, exId); reload(); } catch (e) { err(ex.querySelector('.vlp-error'), e); b.disabled = false; } });
      ex.appendChild(b);
    } else {
      const codes = V.config.get('delayReasonCodes');
      const f = el('<form class="vlp-exc-form" novalidate><label>지연 사유</label><select name="reason"></select><div class="vlp-exc-note" hidden><label>사유 직접 입력 (기타)</label><input type="text" name="note" autocomplete="off"></div><button type="submit" class="btn btn-sm vlp-exc-raise" style="margin-top:8px;">지연 알리기</button></form>');
      const sel = f.querySelector('select'); codes.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = reasonLabel(c); sel.appendChild(o); });
      sel.addEventListener('change', () => { f.querySelector('.vlp-exc-note').hidden = sel.value !== 'other'; });
      f.addEventListener('submit', async (ev) => { ev.preventDefault(); const body = { reasonCode: sel.value }; const note = f.elements.note.value.trim(); if (note) body.note = note; const b = f.querySelector('button'); b.disabled = true; try { await V.api.deliveries.raiseException(delivery.deliveryId, body); reload(); } catch (e) { err(ex.querySelector('.vlp-error'), e); b.disabled = false; } });
      ex.appendChild(f);
    }
    wrap.appendChild(ex);

    // 보강 입력: 초안 저장 → 게시해야 고객에게 보인다
    const aug = el('<div class="vlp-aug"><div class="vlp-sub-title">보강 정보 (초안 → 게시)</div><div class="hint">초안은 나만 볼 수 있어요. 게시하면 고객 화면에 나타납니다.</div><div class="vlp-error" role="alert" hidden></div></div>');
    if (!terminal) {
      const f = el('<form class="vlp-aug-form" novalidate><label>종류</label><select name="kind"><option value="LOCATION">위치 안내</option><option value="NOTE">메모·안내</option><option value="CUSTOMIZING">시공 진행</option></select><label>내용</label><input type="text" name="text" autocomplete="off" placeholder="예: 대전 휴게소 경유 중"><label>공개 대상</label><select name="audience"><option value="CUSTOMER">고객에게 보여 줄 안내 (게시 필요)</option><option value="INTERNAL">내부 메모 (고객에게 보이지 않음)</option></select><button type="submit" class="btn btn-sm vlp-aug-save" style="margin-top:8px;">초안 저장</button></form>');
      f.addEventListener('submit', async (ev) => { ev.preventDefault(); const body = { kind: f.elements.kind.value, audience: f.elements.audience.value }; const t = f.elements.text.value.trim(); if (t) body.text = t; const b = f.querySelector('button'); b.disabled = true; try { await V.api.deliveries.addAugmentation(delivery.deliveryId, body); reload(); } catch (e) { err(aug.querySelector('.vlp-error'), e); b.disabled = false; } });
      aug.appendChild(f);
    }
    const drafts = items.filter((e) => e.type === 'AUGMENTATION_DRAFT' && e.augmentationId);
    if (drafts.length) {
      const ul = el('<ul class="vlp-drafts"></ul>');
      drafts.forEach((d) => { const li = el('<li class="vlp-draft"><span class="vlp-draft-text"></span> <span class="badge vlp-draft-aud"></span></li>'); li.querySelector('.vlp-draft-text').textContent = d.text || '(내용 없음)'; li.querySelector('.vlp-draft-aud').textContent = d.audience === 'INTERNAL' ? '내부 메모' : '게시 대기'; if (d.audience !== 'INTERNAL') { const b = el('<button type="button" class="btn btn-sm btn-primary vlp-aug-publish">게시</button>'); b.addEventListener('click', async () => { b.disabled = true; try { await V.api.deliveries.publishAugmentation(delivery.deliveryId, d.augmentationId); reload(); } catch (e) { err(aug.querySelector('.vlp-error'), e); b.disabled = false; } }); li.appendChild(b); } ul.appendChild(li); });
      aug.appendChild(ul);
    }
    wrap.appendChild(aug);
    return wrap;
  }

  V.delivery = { stepper, TYPE_LABEL, fetchTracking, trackingPanel, manageForms, timelinePanel, locationCard, routeOutline, destinationCard, openSheet, copyText, navUrl, sortEntries, openExceptionId, SOURCE_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.delivery;
})(typeof window !== 'undefined' ? window : globalThis);
