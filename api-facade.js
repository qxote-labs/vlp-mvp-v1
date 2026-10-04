/* api-facade.js — 서버 통신은 이 파일 한 곳으로만 (CLAUDE.md, 변경계획서 원칙 2).
 * 화면 코드는 VLP.api.<영역>.<동작>(...)만 호출한다. 메서드는 openapi operation과 1:1이다(vlp-ops.js).
 *   VLP.api.contracts.create(body)            POST /lifecycle/contracts
 *   VLP.api.contracts.approve(id, body)       POST /lifecycle/contracts/{id}/approve
 *   VLP.api.contracts.list({cursor,limit,status})
 * 인자 순서: path 변수들 -> body(있으면) -> query(있으면) -> 마지막에 선택 옵션 { idempotencyKey }.
 * 모든 명령(POST)에는 Idempotency-Key가 붙는다. 오프라인 큐(PWA-18)가 같은 키로 재전송할 수 있도록
 * 호출자가 opts.idempotencyKey를 넘기면 그 값을 그대로 쓴다.
 * 어댑터 교체: VLP.api.use('mock' | 'http') — 설정 VLP.config 'adapter' 한 줄.
 * 실패는 VLP.ApiError(status, code, message, details, traceId)로 던진다.
 */
(function (g) {
  'use strict';
  g.VLP = g.VLP || {};
  const V = g.VLP;
  const need = (name) => { if (!V[name]) throw new Error('api-facade: VLP.' + name + ' 먼저 로드하세요'); return V[name]; };

  class ApiError extends Error {
    constructor(status, body) {
      const b = body && typeof body === 'object' ? body : {};
      super(b.message || ('HTTP ' + status));
      this.name = 'VLPApiError';
      this.status = status; this.code = b.code || ('HTTP-' + status);
      this.details = b.details || null; this.traceId = b.traceId || null;
    }
  }
  V.ApiError = ApiError;

  function uuid() {
    if (g.crypto && g.crypto.randomUUID) return g.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  }

  function createFacade() {
    const ops = need('ops');
    let adapter = null, adapterName = null, identity = null;
    const listeners = [], respListeners = [];
    const facade = {
      ApiError,
      newIdempotencyKey: uuid,
      // ---- 세션: 서버가 신원에서 역할을 판정한다. 클라이언트 role 값은 어댑터가 신뢰하지 않는다(9장). ----
      session: {
        set(id) { identity = id ? Object.assign({}, id) : null; },
        get() { return identity ? Object.assign({}, identity) : null; },
        clear() { identity = null; },
      },
      use(name, opts) {
        const A = need('adapters');
        if (!A[name]) throw new Error('api-facade: 알 수 없는 어댑터 ' + name);
        adapter = A[name].create(opts || {}); adapterName = name; return facade;
      },
      adapterName() { return adapterName; },
      adapter() { return adapter; },
      onResponse(fn) { respListeners.push(fn); return () => { const i = respListeners.indexOf(fn); if (i >= 0) respListeners.splice(i, 1); }; },
      onRequest(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
      /** 사진 본문 올리기(업로드 URL로 PUT). 어댑터가 구현한다. 명령이 아니므로 Idempotency-Key는 없다. */
      async upload(uploadUrl, blob, contentType) { if (!adapter || !adapter.upload) throw new Error('api-facade: 이 어댑터는 업로드를 지원하지 않습니다'); return adapter.upload(uploadUrl, blob, contentType); },
      /** 화면에 그릴 수 있는 사진 주소(목: 데이터 URL, 실서버: 서명된 썸네일 URL). */
      mediaSrc(media) { return adapter && adapter.mediaSrc ? adapter.mediaSrc(media) : null; },
      async call(opName, args, opts) {
        const op = ops.byName[opName];
        if (!op) throw new Error('api-facade: 알 수 없는 operation ' + opName);
        if (!adapter) throw new Error('api-facade: 어댑터가 없습니다. VLP.api.use()를 먼저 호출하세요');
        args = args || {}; opts = opts || {};
        let path = op.path;
        op.pathParams.forEach(p => {
          if (args.path == null || args.path[p] == null) throw new Error('api-facade: ' + opName + ' 경로 변수 ' + p + ' 누락');
          path = path.replace('{' + p + '}', encodeURIComponent(args.path[p]));
        });
        const req = {
          op: opName, method: op.method, path, pathParams: args.path || {}, query: args.query || {}, body: args.body,
          idempotencyKey: op.command ? (opts.idempotencyKey || uuid()) : null, identity: identity ? Object.assign({}, identity) : null,
        };
        listeners.forEach(fn => { try { fn(req); } catch (e) { /* 관찰용 */ } });
        const res = await adapter.request(req);
        respListeners.forEach(fn => { try { fn(req, res); } catch (e) { /* 관찰용 */ } });
        if (res.status >= 200 && res.status < 300) return res.body;
        throw new ApiError(res.status, res.body);
      },
    };
    // operation 표에서 메서드 생성
    ops.list.forEach(op => {
      const [ns, fn] = op.name.split('.');
      facade[ns] = facade[ns] || {};
      facade[ns][fn] = function () {
        const a = Array.prototype.slice.call(arguments);
        const args = { path: {} };
        op.pathParams.forEach((p, i) => { args.path[p] = a[i]; });
        let k = op.pathParams.length;
        if (op.body) args.body = a[k++];
        if (op.query) args.query = a[k++];
        return facade.call(op.name, args, a[k]);
      };
    });
    return facade;
  }

  V.createFacade = createFacade;
  // 기본 인스턴스. 어댑터는 설정 한 줄(VLP.config 'adapter')로 고른다 — 어댑터 파일이 이 파일보다 먼저 로드돼야 한다.
  V.api = createFacade();
  V.bootApi = function (opts) { V.api.use((V.config && V.config.get('adapter')) || 'mock', opts); return V.api; };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createFacade, ApiError };
})(typeof window !== 'undefined' ? window : globalThis);
