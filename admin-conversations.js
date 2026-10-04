/* admin-conversations.js — PWA-23/25 관리자 대화 열람(읽기 전용).
 * 계약 목록에서 건을 고르면 우측 대화 패널이 읽기 전용으로 열린다. 본문은 열람 사유를 남기기 전에는 가려진다(BR-12).
 * facade(contracts.list, engagement.messages, admin.recordSensitiveView)만 사용한다. 관리자 세션은 목 단계에서 직접 건다. */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui;
  function useAdminSession() { V.api.session.set({ userId: 'adm-1', role: 'admin', phone: '010-0000-0001', name: '관리자', token: 'mock-admin-1' }); }
  function card() {
    const box = document.createElement('section');
    box.className = 'vlp-collect vlp-adminconv'; box.setAttribute('aria-label', '대화 열람');
    box.innerHTML = '<div class="vlp-collect-head"><b>대화 열람 (읽기 전용)</b><span class="hint vlp-conv-sum"></span></div><div class="vlp-error" role="alert" hidden></div><ul class="vlp-collect-list vlp-conv-list"></ul>';
    const list = box.querySelector('.vlp-conv-list'), sum = box.querySelector('.vlp-conv-sum'), err = box.querySelector('.vlp-error');
    let lastSig = null;
    async function load() {
      try {
        useAdminSession();
        const page = await V.api.contracts.list({ limit: 100 });
        const rows = page.items || [];
        const sig = JSON.stringify(rows.map((c) => c.contractId)); if (sig === lastSig) return; lastSig = sig; err.hidden = true;
        sum.textContent = rows.length + '건'; list.innerHTML = '';
        if (!rows.length) { list.innerHTML = '<li class="hint">대화를 볼 계약이 없습니다.</li>'; return; }
        rows.forEach((c) => {
          const li = document.createElement('li'); li.className = 'vlp-collect-row'; li.dataset.contractId = c.contractId;
          li.innerHTML = '<b class="vlp-conv-car"></b> <span class="hint vlp-conv-no"></span> <button type="button" class="btn btn-sm vlp-conv-open">대화 보기</button>';
          li.querySelector('.vlp-conv-car').textContent = c.vehicleModel || '계약'; li.querySelector('.vlp-conv-no').textContent = c.serviceContractNo || '';
          const b = li.querySelector('button');
          b.addEventListener('click', () => { useAdminSession(); V.chat.open(c.contractId, { role: 'admin', readOnly: true, summary: (c.vehicleModel || '차량') + ' · ' + (c.serviceContractNo || '') + ' · 읽기 전용', opener: b }); });
          list.appendChild(li);
        });
      } catch (e) { err.textContent = U.errorText(e); err.hidden = false; }
    }
    load();
    return box;
  }
  V.adminConversations = { card };
})(typeof window !== 'undefined' ? window : globalThis);
