/* vlp-capture.js — 사진 촬영/선택 → 줄이기 → 업로드 큐(upload-queue.js) → 상태 표시.
 * 카메라 입력(<input type=file accept=image/* capture=environment>)을 쓰고, 올리기는 큐가 맡는다.
 * 큐가 기기에 보관하므로 연결이 끊겨도 사진이 사라지지 않는다. */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui, esc = U.esc;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstChild; };
  const STATE_TEXT = { QUEUED: '대기 중', INITED: '올리는 중', UPLOADED: '마무리 중', DONE: '올림 완료', FAILED: '실패' };
  const labelOf = (slot) => (V.config.get('requiredShotLabels') || {})[slot] || slot;

  /** 사진을 긴 변 photoMaxPx로 줄여 JPEG Blob으로 만든다(데이터 절약). 줄일 수 없으면 원본을 그대로 쓴다. */
  async function shrink(file) {
    const max = V.config.get('photoMaxPx') || 1024, q = V.config.get('photoQuality') || 0.7;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
      return blob || file;
    } catch (e) { return file; }
  }
  /** 시연용 샘플 사진(글자가 적힌 그림). 실제 촬영이 아니며 목 어댑터 시연 전용. */
  async function samplePhoto(text, hue) {
    const c = document.createElement('canvas'); c.width = 480; c.height = 320; const x = c.getContext('2d');
    x.fillStyle = 'hsl(' + (hue || 210) + ',55%,88%)'; x.fillRect(0, 0, 480, 320);
    x.fillStyle = 'hsl(' + (hue || 210) + ',50%,35%)'; x.fillRect(120, 150, 240, 70); x.fillRect(160, 110, 160, 50);
    x.beginPath(); x.arc(170, 225, 22, 0, 7); x.arc(310, 225, 22, 0, 7); x.fill();
    x.fillStyle = '#222'; x.font = 'bold 22px sans-serif'; x.fillText(text, 24, 44); x.font = '14px sans-serif'; x.fillText('시연용 샘플 사진', 24, 70);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.7));
  }

  /**
   * 슬롯별 촬영 그리드. opts: {deliveryId, purpose, slots:[key], doneSlots:Set(서버에 올라간 슬롯), queue, onDone()}
   * 큐 상태가 바뀌면 이 그리드만 다시 그린다(입력 중인 다른 화면을 건드리지 않는다).
   */
  function slotGrid(opts) {
    const q = opts.queue, box = el('<div class="vlp-cap"><div class="vlp-cap-note hint" role="status"></div><ul class="vlp-cap-list"></ul></div>');
    const list = box.querySelector('.vlp-cap-list'), note = box.querySelector('.vlp-cap-note');
    let lastDone = null;
    async function paint() {
      const items = await q.list({ deliveryId: opts.deliveryId });
      const bySlot = {}; items.filter((x) => x.purpose === opts.purpose).forEach((x) => { const k = x.slot || '_'; if (!bySlot[k] || x.createdAt >= bySlot[k].createdAt) bySlot[k] = x; });
      list.innerHTML = '';
      const pend = items.filter((x) => x.state !== 'DONE' && x.state !== 'FAILED').length;
      note.textContent = pend ? '저장 대기 ' + pend + '장 · 연결되면 자동으로 올라가요.' + (q.persistent ? '' : ' (이 기기는 앱을 닫으면 대기 사진이 사라질 수 있어요)') : '';
      (opts.slots || ['_']).forEach((slot) => {
        const it = bySlot[slot], done = (opts.doneSlots && opts.doneSlots.has(slot)) || (it && it.state === 'DONE');
        const li = el('<li class="vlp-cap-row"><span class="vlp-cap-name"></span><span class="badge vlp-cap-state"></span><span class="vlp-cap-actions"></span><div class="vlp-error vlp-cap-err" hidden></div></li>');
        li.dataset.slot = slot; li.dataset.state = done ? 'DONE' : (it ? it.state : 'NONE');
        li.querySelector('.vlp-cap-name').textContent = slot === '_' ? '사진' : labelOf(slot);
        li.querySelector('.vlp-cap-state').textContent = done ? '✔ 올림 완료' : (it ? (STATE_TEXT[it.state] || it.state) : '미촬영');
        const acts = li.querySelector('.vlp-cap-actions');
        if (!done || it) {
          const lab = el('<label class="btn btn-sm vlp-cap-btn" tabindex="0"></label>'); lab.textContent = done ? '다시 촬영' : (it ? '다시 촬영' : '촬영');
          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); inp.className = 'vlp-cap-input'; inp.setAttribute('aria-label', (slot === '_' ? '사진' : labelOf(slot)) + ' 촬영');
          inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; if (!f) return; const blob = await shrink(f); await q.enqueue({ deliveryId: opts.deliveryId, purpose: opts.purpose, slot: slot === '_' ? undefined : slot, blob, contentType: blob.type || 'image/jpeg' }); inp.value = ''; });
          lab.appendChild(inp); acts.appendChild(lab);
        }
        if (it && it.state === 'FAILED') {
          const err = li.querySelector('.vlp-cap-err'); err.hidden = false; err.textContent = it.lastError || '등록하지 못했어요';
          const rt = el('<button type="button" class="btn btn-sm">다시 보내기</button>'); rt.addEventListener('click', () => q.retry(it.id));
          const dc = el('<button type="button" class="btn btn-sm">삭제</button>'); dc.addEventListener('click', () => q.discard(it.id));
          acts.appendChild(rt); acts.appendChild(dc);
        } else if (it && it.state !== 'DONE' && it.lastError) { const err = li.querySelector('.vlp-cap-err'); err.hidden = false; err.textContent = it.lastError; }
        list.appendChild(li);
      });
      const nDone = items.filter((x) => x.state === 'DONE').length; if (lastDone !== null && nDone > lastDone && opts.onDone) opts.onDone(); lastDone = nDone;
    }
    const off = q.on(() => { if (!document.body.contains(box)) { off(); return; } paint(); });
    paint();
    return box;
  }

  V.capture = { slotGrid, shrink, samplePhoto, labelOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.capture;
})(typeof window !== 'undefined' ? window : globalThis);
