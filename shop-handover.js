/* shop-handover.js — PWA-21 시공사 화면의 신차인도 대리 인수 섹션 (새 흐름).
 * 인도지 소속 시공사에게 보이는 건만 나온다(서버 판정). 시공사 로그인은 v6 화면(Store)이 쥐고 있어서 목 단계에서는
 * 목 명부의 시공사 계정으로 세션을 건다 — 실 API 전환 시 서버 로그인으로 대체(추후 처리). */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstChild; };
  // 로그인한 시공업체(v6 계정)가 인도지 시공소로 연결돼 있으면 그 신원으로, 아니면 어떤 인도지에도 속하지 않은 신원으로 조회한다(그래서 대리 인수 건이 비어 보인다).
  let curShopId = null;
  function useShopSession() {
    const linked = V.config.get('handoverShopId');
    if (!curShopId || curShopId === linked) V.api.session.set({ userId: 'shop-1', role: 'shop', phone: '010-0000-0003', name: '울산 제휴 시공소', token: 'mock-shop-1' });
    else V.api.session.set({ userId: 'shop-v6-' + curShopId, role: 'shop', phone: '010-0000-0099', name: '대리 인수 비대상 업체', token: 'mock-shop-v6-' + curShopId });
  }

  /** 대리 인수 대상 건의 데이터 원천. 시공사 화면(shop-care.js)이 자기 할 일 목록에 합쳐 쓴다.
   *  load(force) -> 바뀌었으면 true / rows·dels·trk는 st에 / rowFor(c,active,onOpen) -> 목록 행 / detail(c,{onBack,reload}) -> 상세 */
  function source(shopId) {
    curShopId = shopId || null;
    const st = { rows: [], dels: {}, trk: {}, loaded: false }; let lastSig = null;
    async function load(force) {
      useShopSession();
      const page = await V.api.contracts.list({ limit: 50 });
      const items = (page.items || []).filter((c) => c.deliveryId);
      const dels = {}, trk = {}; await Promise.all(items.map(async (c) => { try { dels[c.contractId] = await V.api.deliveries.get(c.deliveryId); trk[c.contractId] = await V.delivery.fetchTracking(c.deliveryId); } catch (e) { /* 생략 */ } }));
      const rows = items.filter((c) => dels[c.contractId] && dels[c.contractId].receiptMode === 'REMOTE_PROXY');
      const sig = JSON.stringify([rows.map((c) => c.contractId), rows.map((c) => dels[c.contractId].storageState)]);
      if (!force && st.loaded && sig === lastSig) return false;
      lastSig = sig; st.rows = rows; st.dels = dels; st.trk = trk; st.loaded = true; return true;
    }
    function rowFor(cc, active, onOpen) {
      const d = st.dels[cc.contractId];
      return V.caseView.listRow({ contract: cc, delivery: d, idx: V.caseView.stepIdxOf(d, true), badgeHTML: U.stateChip(d.displayState), urgent: d.storageState === 'ARRIVED' ? '대리 인수 필요' : '', active, keepSub: true, sub: (d.deliverySite && d.deliverySite.name) || '', onOpen });
    }
    // 진행 탭: 시공사(인도지)의 실제 작업 = 도착 확인 → 필수 촬영 → 대리 인수 기록. 입력은 하단 버튼(대리 인수 기록)에서 한다.
    function progressTab(c, d) {
      const w = el('<div class="vlp-ov"></div>');
      const arrived = d.storageState === 'ARRIVED', done = d.storageState === 'DELIVERED';
      const nodes = [
        { s: arrived || done ? 'done' : 'cur', t: '차량 도착', sub: arrived || done ? '' : '이동 중이에요. 도착하면 알려 드려요' },
        { s: done ? 'done' : (arrived ? 'cur' : 'todo'), t: '필수 촬영', sub: '외관 사방 · 계기판 · 특이사항' },
        { s: done ? 'done' : 'todo', t: '대리 인수 기록' },
      ];
      const box = el('<div class="vlp-cd"><h4>진행</h4></div>'); box.appendChild(V.delivery.stepper(nodes, '대리 인수 진행 순서')); w.appendChild(box);
      const rec = el('<div class="vlp-cd"><h4>인수 기록</h4><div class="vlp-hand-sum hint">불러오는 중…</div></div>'); w.appendChild(rec);
      const sum = rec.querySelector('.vlp-hand-sum');
      V.api.handover.get(d.deliveryId).then((h) => {
        const n = new Set((h.media || []).filter((m) => m.purpose === 'REQUIRED_SHOT').map((m) => m.slot)).size, total = (V.config.get('requiredShotSlots') || []).length;
        if (h.receiverType === 'PROXY_INSTALLER') { sum.className = ''; sum.innerHTML = ''; sum.appendChild(el('<div class="vlp-hand-done" role="status">✔ 대리 인수가 기록되었습니다.</div>')); sum.appendChild(V.handover.photoStrip(h, d.deliveryId)); }
        else sum.textContent = arrived ? '필수 촬영 ' + n + '/' + total + '컷 · 하단 [대리 인수 기록]에서 촬영하고 기록해 주세요.' : '차량이 도착하면 촬영을 시작할 수 있어요.';
      }).catch((e) => { sum.textContent = U.errorText(e); });
      return w;
    }
    function detail(c, ctx) {
      const d = st.dels[c.contractId], tr = st.trk[c.contractId], idx = V.caseView.stepIdxOf(d, true);
      const next = d.storageState === 'ARRIVED' ? '다음: 필수 촬영 6컷을 마치고 대리 인수를 기록해 주세요' : (d.storageState === 'DELIVERED' ? '인도가 끝났습니다' : '다음: 차량이 도착하면 대리 인수를 진행합니다');
      const tabs = [
        { id: 'overview', label: '개요', render: () => { const w = el('<div class="vlp-ov"></div>'); w.appendChild(V.caseView.card('지금 상태', el('<p class="vlp-next-card"></p>'))).querySelector('p').textContent = next; w.appendChild(V.caseView.destinationOnly ? V.caseView.destinationOnly(d) : V.delivery.destinationCard(d, tr && tr.location)); return w; } },
        { id: 'progress', label: '진행', render: () => progressTab(c, d) },
        { id: 'history', label: '이력', render: () => V.caseView.historyTab(d, tr, false, c) },
      ];
      const o = { role: 'shop', contract: c, delivery: d, idx, stateHTML: U.stateChip(d.displayState), next, aside: (d.deliverySite && d.deliverySite.name) || '', tabs, onBack: ctx.onBack, chatBadge: 0, onChat: (b) => V.chat.open(c.contractId, { role: 'shop', summary: (c.vehicleModel || '차량') + ' · ' + (c.serviceContractNo || '') + ' · 카마스터·고객', opener: b }) };
      if (d.storageState === 'ARRIVED' || d.storageState === 'DELIVERED') o.primary = { label: d.storageState === 'ARRIVED' ? '대리 인수 기록' : '인수 기록 보기', title: '대리 인수', open: () => V.handover.shopPanel(d, { onChange: ctx.reload }) };
      o.more = [{ label: '고객에게 메시지', direct: (b) => o.onChat(b) }];
      return V.caseView.detail(o);
    }
    return { st, load, rowFor, detail };
  }
  V.shopFlow = { source };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.shopFlow;
})(typeof window !== 'undefined' ? window : globalThis);
