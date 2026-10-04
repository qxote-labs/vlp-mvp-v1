/* admin-collection.js — PWA-17 관리자 수집 현황 카드: 마지막 자동 수집 시각, 지연(STALE) 건을 목록 맨 위에.
 * facade(admin.collectionStatus + contracts.list)만 사용한다. 관리자 로그인은 v6 화면(Store)이 쥐고 있어서,
 * 목 단계에서는 이 카드가 관리자 역할 세션을 직접 건다(실 API 전환 시 서버 로그인으로 대체: 추후 처리). */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui, esc = U.esc;
  const ORDER = { STALE: 0, COLLECTING: 1, NOT_STARTED: 2, STOPPED: 3 };
  const LABEL = { STALE: '수집 지연', COLLECTING: '수집 중', NOT_STARTED: '수집 전', STOPPED: '수집 종료' };
  function useAdminSession() { V.api.session.set({ userId: 'adm-1', role: 'admin', phone: '010-0000-0001', name: '관리자', token: 'mock-admin-1' }); }
  const sortRows = (rows) => rows.slice().sort((a, b) => (ORDER[a.collectionStatus] - ORDER[b.collectionStatus]) || ((b.staleMinutes || 0) - (a.staleMinutes || 0)) || String(a.deliveryId).localeCompare(String(b.deliveryId)));

  function card() {
    const box = document.createElement('section');
    box.className = 'vlp-collect'; box.setAttribute('aria-label', '위치 수집 현황');
    box.innerHTML = '<div class="vlp-collect-head"><b>위치 수집 현황</b><span class="hint vlp-collect-sum"></span></div><div class="vlp-error" role="alert" hidden></div><ul class="vlp-collect-list"></ul>';
    const list = box.querySelector('.vlp-collect-list'), sum = box.querySelector('.vlp-collect-sum'), err = box.querySelector('.vlp-error');
    let lastSig = null;
    async function load() {
      try {
        useAdminSession();
        const [cs, cts] = await Promise.all([V.api.admin.collectionStatus({ limit: 100 }), V.api.contracts.list({ limit: 100 })]);
        const byDelivery = {}; (cts.items || []).forEach((c) => { if (c.deliveryId) byDelivery[c.deliveryId] = c; });
        const sig = JSON.stringify([cs, byDelivery]); if (sig === lastSig) return; lastSig = sig; err.hidden = true;
        const rows = sortRows(cs.items || []), stale = rows.filter((r) => r.collectionStatus === 'STALE').length;
        sum.textContent = '진행 중 ' + rows.length + '건 · 수집 지연 ' + stale + '건';
        list.innerHTML = '';
        if (!rows.length) { list.innerHTML = '<li class="hint">진행 중인 배송이 없습니다.</li>'; return; }
        rows.forEach((r) => {
          const c = byDelivery[r.deliveryId] || {};
          const li = document.createElement('li'); li.className = 'vlp-collect-row'; li.dataset.status = r.collectionStatus; li.dataset.deliveryId = r.deliveryId;
          li.innerHTML = '<span class="badge vlp-collect-badge"></span> <b class="vlp-collect-car"></b> <span class="hint vlp-collect-no"></span><div class="hint vlp-collect-time"></div>';
          li.querySelector('.vlp-collect-badge').textContent = (r.collectionStatus === 'STALE' ? '▲ ' : '') + (LABEL[r.collectionStatus] || r.collectionStatus);
          li.querySelector('.vlp-collect-car').textContent = c.vehicleModel || '배송 건'; li.querySelector('.vlp-collect-no').textContent = c.serviceContractNo || String(r.deliveryId).slice(0, 8);
          li.querySelector('.vlp-collect-time').textContent = '마지막 자동 수집: ' + (r.lastAutoCollectedAt ? U.fmtDateTime(r.lastAutoCollectedAt) : '없음') + (r.staleMinutes != null && r.collectionStatus !== 'STOPPED' && r.collectionStatus !== 'NOT_STARTED' ? ' · ' + r.staleMinutes + '분 경과' : '');
          list.appendChild(li);
        });
      } catch (e) { err.textContent = U.errorText(e); err.hidden = false; }
    }
    load();
    const t = setInterval(() => { if (!document.body.contains(box)) { clearInterval(t); return; } load(); }, V.config.get('pollIntervalMs'));
    return box;
  }
  V.adminCollection = { card, sortRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.adminCollection;
})(typeof window !== 'undefined' ? window : globalThis);
