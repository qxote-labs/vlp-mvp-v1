/* upload-queue.js — PWA-18 사진 업로드 큐 (이어올리기).
 * 촬영한 사진을 기기(IndexedDB)에 먼저 저장하고, 네트워크가 돌아오면 이어서 올린다.
 * 한 장의 단계: media.init → 본문 PUT(업로드 URL) → media.complete. 단계마다 Idempotency-Key를 항목에 저장해 두고
 * 재시도 때 같은 키로 보낸다 — 응답을 잃어도 서버에 같은 사진이 두 번 만들어지지 않는다(openapi: 재시도·오프라인 큐는 Idempotency-Key로 중복을 막는다).
 * 서버 호출은 모두 VLP.api(facade)로만 한다. 로그인한 사람(owner)의 항목만 올리고, 다른 사람의 항목은 건드리지 않는다. */
(function (g) {
  'use strict';
  const V = g.VLP = g.VLP || {};

  // ---------- 저장소: IndexedDB (없으면 메모리) ----------
  function memStore() {
    const m = new Map();
    return { persistent: false, async put(it) { m.set(it.id, Object.assign({}, it)); }, async get(id) { const x = m.get(id); return x ? Object.assign({}, x) : null; }, async del(id) { m.delete(id); }, async all() { return Array.from(m.values()).map((x) => Object.assign({}, x)); } };
  }
  function idbStore(dbName) {
    const idb = g.indexedDB;
    if (!idb) return null;
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const rq = idb.open(dbName, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('items', { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('items', mode); const st = t.objectStore('items'); const rq = fn(st); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
    return { persistent: true, put: (it) => tx('readwrite', (s) => s.put(it)), get: (id) => tx('readonly', (s) => s.get(id)).then((x) => x || null), del: (id) => tx('readwrite', (s) => s.delete(id)), all: () => tx('readonly', (s) => s.getAll()).then((x) => x || []) };
  }

  const isRetryable = (e) => !!(e && (e.network || e.httpStatus >= 500 || (e.status === undefined && !(e.httpStatus)) || e.status >= 500 || e.status === 429 || e.status === 0));
  const isAuth = (e) => e && e.status === 401;
  const uuid = () => (V.api && V.api.newIdempotencyKey ? V.api.newIdempotencyKey() : String(Date.now()) + Math.random().toString(16).slice(2));

  function create(opts) {
    opts = opts || {};
    const api = opts.api || V.api;
    const store = opts.store || idbStore(opts.dbName || 'vlp_upload_queue') || memStore();
    const retryMs = opts.retryMs != null ? opts.retryMs : ((V.config && V.config.get('uploadRetryMs')) || 15000);
    const listeners = []; let running = null, timer = null, again = false;
    const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* 관찰용 */ } });
    const me = () => { const s = api.session.get(); return s ? s.userId : null; };

    async function enqueue(spec) { // {deliveryId, purpose, slot?, blob, contentType, sizeBytes?, clientCreatedAt?}
      const owner = me(); if (!owner) throw new Error('업로드 큐: 로그인이 필요합니다');
      const it = {
        id: uuid(), owner, deliveryId: spec.deliveryId, purpose: spec.purpose, slot: spec.slot || null, contentType: spec.contentType || (spec.blob && spec.blob.type) || 'image/jpeg',
        sizeBytes: spec.sizeBytes || (spec.blob && spec.blob.size) || undefined, clientCreatedAt: spec.clientCreatedAt || new Date().toISOString(),
        blob: spec.blob, keys: { init: uuid(), complete: uuid() }, state: 'QUEUED', mediaId: null, uploadUrl: null, attempts: 0, lastError: null, createdAt: Date.now(),
      };
      await store.put(it); emit(); run(); return it.id;
    }
    async function list(filter) {
      const all = await store.all(); const o = me();
      return all.filter((x) => (!filter || ((filter.deliveryId == null || x.deliveryId === filter.deliveryId) && (filter.owner === false || x.owner === o)))).sort((a, b) => a.createdAt - b.createdAt);
    }
    async function patch(it, p) { Object.assign(it, p); await store.put(it); emit(); }

    async function step(it) { // 한 단계씩 저장하며 진행한다. 중간에 끊겨도 다음에 이어서 한다.
      if (it.state === 'QUEUED') {
        const body = { purpose: it.purpose, contentType: it.contentType, clientCreatedAt: it.clientCreatedAt };
        if (it.slot) body.slot = it.slot; if (it.sizeBytes) body.sizeBytes = it.sizeBytes;
        const r = await api.media.init(it.deliveryId, body, { idempotencyKey: it.keys.init });
        await patch(it, { state: 'INITED', mediaId: r.mediaId, uploadUrl: r.uploadUrl });
      }
      if (it.state === 'INITED') { await api.upload(it.uploadUrl, it.blob, it.contentType); await patch(it, { state: 'UPLOADED' }); }
      if (it.state === 'UPLOADED') { await api.media.complete(it.mediaId, { idempotencyKey: it.keys.complete }); await patch(it, { state: 'DONE', blob: null, lastError: null }); }
    }

    async function drain() {
      const o = me(); let blocked = false;
      const items = (await store.all()).filter((x) => x.owner === o && x.state !== 'DONE' && x.state !== 'FAILED').sort((a, b) => a.createdAt - b.createdAt);
      for (const it of items) {
        try { await patch(it, { attempts: it.attempts + 1 }); await step(it); }
        catch (e) {
          if (isAuth(e)) { await patch(it, { lastError: '로그인이 필요합니다' }); blocked = true; break; }
          if (isRetryable(e)) { await patch(it, { lastError: e.network ? '연결이 끊겨 대기 중' : (e.message || '일시 오류') }); blocked = true; break; } // 다음 항목도 같은 이유로 막힐 가능성이 커서 멈춘다
          await patch(it, { state: 'FAILED', lastError: (e && e.message) || '등록할 수 없는 사진입니다' }); // 4xx: 다시 보내도 같다
        }
      }
      return blocked;
    }
    function schedule() { if (timer) return; timer = setTimeout(() => { timer = null; run(); }, retryMs); if (timer && timer.unref) timer.unref(); }
    function run() {
      if (running) { again = true; return running; }
      running = (async () => {
        try { do { again = false; const blocked = await drain(); if (blocked) schedule(); } while (again); }
        finally { running = null; emit(); }
      })();
      return running;
    }
    async function retry(id) { const it = await store.get(id); if (!it) return; await patch(it, { state: it.mediaId ? (it.uploadUrl ? 'INITED' : 'QUEUED') : 'QUEUED', lastError: null }); return run(); }
    async function discard(id) { await store.del(id); emit(); }
    async function clearDone(deliveryId) { (await store.all()).filter((x) => x.state === 'DONE' && (deliveryId == null || x.deliveryId === deliveryId)).forEach((x) => store.del(x.id)); emit(); }
    function on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
    if (g.addEventListener && opts.autoRun !== false) {
      g.addEventListener('online', () => run());
      if (g.document) g.document.addEventListener('visibilitychange', () => { if (!g.document.hidden) run(); });
    }
    return { enqueue, list, run, retry, discard, clearDone, on, persistent: store.persistent, pendingCount: async () => (await list()).filter((x) => x.state !== 'DONE' && x.state !== 'FAILED').length };
  }

  let shared = null;
  V.uploadQueue = { create, memStore, idbStore, shared() { return shared || (shared = create({})); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.uploadQueue;
})(typeof window !== 'undefined' ? window : globalThis);
