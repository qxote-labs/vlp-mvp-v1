/* adapters/mock.js — 목 어댑터. openapi.yaml 계약을 localStorage(또는 메모리)에서 그대로 구현한다.
 * v6 store.js의 도메인 흐름(승인 -> 확인 -> 출고 -> 배송 -> 인수 -> 평가)을 openapi 응답 형태로 옮긴 것이며,
 * 응답이 스키마를 통과하는지는 tests/unit/mock-conformance.test.js가 검증한다(계약과 목의 어긋남 방지).
 * 같은 엔진을 tools/mock-server.js(API-03)가 HTTP로 감싼다.
 *
 * 규칙: 신원 없음 401 / 역할 불일치·범위 밖·없음은 모두 404(구분하지 않는다, 9·10장) / 상태 충돌 409 / 검증 422 / 시도 초과 429.
 * 조회번호(claimToken)는 생성 응답에서만 평문이고, 저장은 해시만. 이벤트·알림·로그에는 넣지 않는다.
 */
(function (g) {
  'use strict';
  g.VLP = g.VLP || {};
  const V = g.VLP;
  V.adapters = V.adapters || {};

  const STORE_KEY = 'vlp_mock_v1';
  const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;

  // 레지스트리 고정 ID (목 데이터; 실제는 JEFLIX가 소유)
  const ID = {
    karmaster1: '11111111-1111-4111-8111-111111111111',
    karmaster2: '11111111-1111-4111-8111-222222222222',
    shop1: '22222222-2222-4222-8222-111111111111',
    site1: '33333333-3333-4333-8333-111111111111',     // 제휴 시공소
    site2: '33333333-3333-4333-8333-222222222222',     // 영업소(시공소 아님)
    deliveryCo: '44444444-4444-4444-8444-111111111111',
  };
  const digits = s => String(s == null ? '' : s).replace(/[^0-9]/g, '');

  function memoryStorage() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
  function defaultStorage() { try { if (typeof localStorage !== 'undefined') { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; } } catch (e) { /* 사용 불가 */ } return memoryStorage(); }

  function uuid() {
    if (g.crypto && g.crypto.randomUUID) return g.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  }
  async function sha256(text) {
    if (g.crypto && g.crypto.subtle) {
      const buf = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.prototype.map.call(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return 'weak-' + (h >>> 0).toString(16); // crypto 없는 환경 대비(목 전용)
  }
  function newToken() { // 조회번호: 8자리 숫자
    const a = new Uint32Array(1);
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(a); else a[0] = Math.random() * 4294967296;
    return String(a[0] % 100000000).padStart(8, '0');
  }
  function randHex(n) { // 세션 토큰용 무작위 문자열
    const a = new Uint8Array(n);
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.random() * 256;
    return Array.prototype.map.call(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  const maskName = n => { n = String(n || ''); if (n.length <= 1) return n || '고객'; if (n.length === 2) return n[0] + '*'; return n[0] + '*'.repeat(n.length - 2) + n[n.length - 1]; };

  function freshState() {
    return {
      v: 1, seq: {}, contracts: [], grants: [], deliveries: [], events: [], notifications: [], timeline: [],
      media: [], augmentations: [], exceptions: [], ratings: [], points: {}, messages: [], sensitiveViews: [],
      idem: {}, claimLocks: {}, uploadData: {}, accounts: {}, sessions: {},
      registry: {
        karmasters: {
          '01022220001': { id: ID.karmaster1, name: '김카마', dealershipName: '울산 남구 영업소' },
          '01022220002': { id: ID.karmaster2, name: '박카마', dealershipName: '울산 북구 영업소' },
        },
        shops: [{ shopId: ID.shop1, name: '울산 제휴 시공소', userId: 'shop-1' }],
        sites: [
          { siteId: ID.site1, name: '울산 제휴 시공소', address: '울산광역시 남구 삼산로 100', shopId: ID.shop1 },
          { siteId: ID.site2, name: '현대 울산 전시장', address: '울산광역시 북구 산업로 200', shopId: null },
        ],
        deliveryCompany: { id: ID.deliveryCo, name: '글로비스 탁송(목)', mainPhone: '1588-0000' },
      },
    };
  }

  function createEngine(opts) {
    opts = opts || {};
    const storage = opts.storage || defaultStorage();
    const key = opts.storeKey || STORE_KEY;
    const cfg = opts.config || V.config || { get: () => undefined };
    let nowFn = opts.now || (() => Date.now() + ((S && S.timeOffsetMs) || 0)); // 시연용 시간 건너뛰기는 상태에 저장되어 모든 화면이 공유한다
    const displayOf = opts.displayOf || ((x) => (V.statusMap ? V.statusMap.deriveDisplay(x) : x.storageState));
    const newId = opts.idGen || uuid;

    let S = null;
    const load = () => { try { const raw = storage.getItem(key); S = raw ? JSON.parse(raw) : freshState(); } catch (e) { S = freshState(); } return S; };
    const save = () => storage.setItem(key, JSON.stringify(S));
    const iso = (t) => new Date(t == null ? nowFn() : t).toISOString();

    class Err { constructor(status, code, message, details) { this.status = status; this.body = { code, message }; if (details) this.body.details = details; } }
    const E = {
      auth: () => new Err(401, 'VLP-AUTH-401', '로그인이 필요합니다'),
      nf: () => new Err(404, 'VLP-RES-404', '찾을 수 없습니다'),
      conflict: (m, d) => new Err(409, 'VLP-STATE-409', m || '현재 상태에서 할 수 없습니다', d),
      val: (m, d) => new Err(422, 'VLP-VAL-422', m || '입력을 확인해 주세요', d),
      rate: (m) => new Err(429, 'VLP-RATE-429', m || '시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요'),
    };
    const nextSeq = (name) => { S.seq[name] = (S.seq[name] || 0) + 1; return S.seq[name]; };

    // ---- 이벤트·알림 (조회번호는 어디에도 넣지 않는다) ----
    function emit(eventType, ctx, payload, actor) {
      const ev = {
        eventId: newId(), eventType, version: 1, occurredAt: iso(),
        contractId: (ctx && ctx.contractId) || null, deliveryId: (ctx && ctx.deliveryId) || null,
        actor: actor ? { role: actor.role, userId: actor.userId } : { role: 'system', userId: 'system' },
        payload: payload || {},
      };
      S.events.push(ev);
      notifyFor(ev);
      return ev;
    }
    // 알림: 이벤트 참조(ref) + 일반 문구만 가진다. 조회번호·연락처 등 평문을 싣지 않는다(9장, DM-10).
    // 수신자: 고객은 userId, 카마스터는 전화번호(숫자)로 지정한다. 미가입 카마스터(조회번호 전)에게는 앱 알림을 보낼 수 없다.
    const NOTE = {
      ContractRegistered: ['karmaster', '새 계약 확인 요청이 도착했습니다'],
      ContractApprovedByCarmaster: ['customer', '계약이 승인되었습니다. 내용을 확인해 주세요'],
      ReleaseRequested: ['karmaster', '출고 요청이 도착했습니다'],
      ReleaseOrdered: ['customer', '출고가 의뢰되었습니다'],
      DeliveryStateChanged: ['customer', '배송 상태가 변경되었습니다'],
      DeliveryExceptionRaised: ['customer', '배송에 지연이 발생했습니다'],
      AccessGrantClaimed: ['customer', '카마스터가 조회를 시작했습니다'],
      DeliveryCompleted: ['customer', '인도가 완료되었습니다'],
    };
    function pushNote(toRole, who, text, ev, ref) {
      const rec = { notificationId: newId(), toRole, text, refType: ref.refType, refId: ref.refId, eventId: ev ? ev.eventId : null, createdAt: iso(), read: false };
      if (toRole === 'customer') rec.toUserId = who; else rec.toPhone = who;
      S.notifications.push(rec);
    }
    function notifyFor(ev) {
      const n = NOTE[ev.eventType]; if (!n) return;
      const c = ev.contractId ? S.contracts.find(x => x.contractId === ev.contractId) : null;
      if (!c) return;
      const ref = { refType: ev.deliveryId ? 'delivery' : 'contract', refId: ev.deliveryId || ev.contractId };
      if (n[0] === 'customer') pushNote('customer', c.customerId, n[1], ev, ref);
      else {
        const gr = grantOfContract(c);
        if (gr && gr.status === 'ACTIVE') pushNote('karmaster', digits(c.carmasterPhone), n[1], ev, ref); // 조회번호 전(PENDING_CLAIM)에는 보낼 수 없다
      }
    }

    // ---- 조회·접근 판정 ----
    const regK = (phone) => S.registry.karmasters[digits(phone)] || null;
    const accountOf = (ph) => S.accounts[ph] || null;
    const accountActive = (ph) => { const a = accountOf(ph); return !!a && !a.dormant; };
    const pinHash = (ph, pin) => sha256('pin:' + ph + ':' + pin); // 목 전용. 실서비스는 느린 해시(bcrypt/argon2)와 서버 보관
    const fmtPhone = (d) => d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d;
    async function startSession(ph) {
      const token = randHex(24);
      S.sessions[await sha256('sess:' + token)] = { phone: ph, exp: nowFn() + cfg.get('sessionHours') * HOUR };
      return token;
    }
    async function sessionOf(token) {
      if (!token) return null;
      const rec = S.sessions[await sha256('sess:' + token)];
      return rec && rec.exp > nowFn() ? rec : null;
    }
    const siteOf = (id) => S.registry.sites.find(s => s.siteId === id) || null;
    const shopOfIdentity = (idn) => S.registry.shops.find(s => s.userId === idn.userId) || null;
    const contractOf = (id) => S.contracts.find(c => c.contractId === id) || null;
    const deliveryOf = (id) => S.deliveries.find(d => d.deliveryId === id) || null;
    const grantOfContract = (c) => S.grants.find(gr => gr.contractId === c.contractId) || null;

    function karmasterSees(idn, c) {
      if (digits(c.carmasterPhone) !== digits(idn.phone)) return false;
      if (c.status === 'EXPIRED') return false;
      const gr = grantOfContract(c);
      return !!gr && !gr.archived && (gr.status === 'ACTIVE' || !!c.completedAt);
    }
    function shopSees(idn, c) {
      if (!c.deliveryId) return false;
      const d = deliveryOf(c.deliveryId); if (!d || !d.siteId) return false;
      const shop = shopOfIdentity(idn), site = siteOf(d.siteId);
      return !!(shop && site && site.shopId === shop.shopId);
    }
    function canSeeContract(idn, c) {
      switch (idn.role) {
        case 'customer': return c.customerId === idn.userId;
        case 'karmaster': return karmasterSees(idn, c);
        case 'shop': return shopSees(idn, c);
        case 'admin': return true;
        default: return false;
      }
    }
    const canWriteAsKarmaster = (idn, c) => idn.role === 'karmaster' && karmasterSees(idn, c);

    // ---- 응답 변환 ----
    function contractView(idn, c) {
      const masked = idn.role === 'karmaster' && c.status !== 'APPROVED' ? true : (idn.role === 'karmaster' && !c.confirmedAt && c.status === 'PENDING_APPROVAL');
      const maskedNow = idn.role === 'karmaster' && c.status !== 'APPROVED'; // 승인 전: 차량·접수번호·고객 표시명만 (서버 마스킹, 9장)
      void masked;
      const base = { contractId: c.contractId, serviceContractNo: c.serviceContractNo, status: c.status, vehicleModel: c.vehicleModel, customerDisplayName: maskName(c.customerName), expiresAt: iso(c.expiresAt), masked: maskedNow };
      if (maskedNow) return base;
      if (idn.role === 'customer') { const gr = grantOfContract(c); if (gr && ['PENDING_CLAIM', 'EXPIRED'].includes(gr.status)) base.grantId = gr.grantId; } // [PROPOSED-ADD] 재발급용
      return Object.assign(base, {
        manufacturerContractNo: c.manufacturerContractNo, trim: c.trim, color: c.color, contractDate: c.contractDate,
        carmaster: { name: c.carmasterName || (regK(c.carmasterPhone) || {}).name || '', phone: c.carmasterPhone, dealershipName: c.dealershipName || (regK(c.carmasterPhone) || {}).dealershipName || '' },
        destinationType: c.destinationType || undefined, deliveryId: c.deliveryId || null,
      });
    }
    const clean = (o) => JSON.parse(JSON.stringify(o)); // undefined 제거
    function deliveryEvents(d) { return S.events.filter(e => e.deliveryId === d.deliveryId); }
    function ratingTargetsOf(d) { // [PROPOSED-ADD] 평가 대상 ID를 화면이 알 방법이 없어 배송 응답에 담는다
      const c = contractOf(d.contractId), k = c && regK(c.carmasterPhone), site = d.siteId ? siteOf(d.siteId) : null, shop = site && site.shopId ? S.registry.shops.find(x => x.shopId === site.shopId) : null;
      const out = [];
      if (k) out.push({ targetType: 'KARMASTER', targetId: k.id, name: k.name });
      if (shop) out.push({ targetType: 'SHOP', targetId: shop.shopId, name: shop.name });
      out.push({ targetType: 'DELIVERY_COMPANY', targetId: S.registry.deliveryCompany.id, name: S.registry.deliveryCompany.name });
      return out;
    }
    function deliveryView(d) {
      const evs = deliveryEvents(d);
      const display = displayOf({ storageState: d.storageState, events: evs });
      const site = d.siteId ? siteOf(d.siteId) : null;
      const times = d.stateTimes || {};
      const order = ['READY', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];
      const idxStorage = { PLANNED: 0, SHIPPED: 1, IN_TRANSIT: 2, ARRIVED: 3, DELIVERED: 4 }[d.storageState];
      const stepAt = { READY: times.PLANNED, DISPATCHED: times.SHIPPED, IN_TRANSIT: times.IN_TRANSIT, DELIVERED: times.ARRIVED, CONFIRMED: times.DELIVERED };
      return clean({
        deliveryId: d.deliveryId, contractId: d.contractId, displayState: display, storageState: d.storageState,
        destinationType: d.destinationType, receiptMode: d.receiptMode,
        deliverySite: site ? { name: site.name, address: site.address, isHome: false } : { name: '고객 지정 장소', address: d.customAddress, isHome: true },
        deliveryCompany: { name: S.registry.deliveryCompany.name, mainPhone: S.registry.deliveryCompany.mainPhone }, // BR-10: 기사 개인 연락처 없음
        steps: order.map((st, i) => ({ state: st, at: stepAt[st] ? iso(stepAt[st]) : undefined, done: i <= idxStorage })),
        ratingTargets: ratingTargetsOf(d),
      });
    }
    function pageOf(arr, q, mapFn) {
      q = q || {};
      const limit = Math.min(Math.max(parseInt(q.limit || 20, 10) || 20, 1), 100);
      const start = q.cursor ? parseInt(Buffer_atob(q.cursor), 10) : 0;
      if (q.cursor && (isNaN(start) || start < 0)) throw E.val('cursor가 올바르지 않습니다');
      const items = arr.slice(start, start + limit).map(mapFn || (x => x));
      const nextCursor = start + limit < arr.length ? Buffer_btoa(String(start + limit)) : null;
      return { items, nextCursor };
    }
    function Buffer_btoa(s) { return typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64'); }
    function Buffer_atob(s) { try { return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString(); } catch (e) { return 'NaN'; } }

    // ---- 검증 보조 ----
    const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
    function requireFields(body, names) {
      const missing = names.filter(n => !isStr(body && body[n]));
      if (missing.length) throw E.val('필수 항목이 비어 있습니다', { missing });
    }
    const inEnum = (v, list, name) => { if (!list.includes(v)) throw E.val(name + ' 값이 올바르지 않습니다', { field: name, allowed: list }); };

    // ---- 만료 정리 (읽기·쓰기 전에 지연 평가) ----
    function sweep() {
      const t = nowFn();
      S.contracts.forEach(c => {
        if (c.status === 'PENDING_APPROVAL' && t > c.expiresAt) {
          c.status = 'EXPIRED';
          emit('ContractExpired', { contractId: c.contractId }, { expiredAt: iso(c.expiresAt) });
          const gr = grantOfContract(c);
          if (gr && gr.status !== 'EXPIRED') { gr.status = 'EXPIRED'; emit('AccessGrantExpired', { contractId: c.contractId }, { grantId: gr.grantId }); }
        }
      });
      S.grants.forEach(gr => {
        if (gr.status === 'PENDING_CLAIM' && t > gr.expiresAt) { gr.status = 'EXPIRED'; emit('AccessGrantExpired', { contractId: gr.contractId }, { grantId: gr.grantId }); }
      });
      // 미확인 리마인드·만료 임박 알림 (고객, 연결된 카마스터). 알림은 앱 안 목록에 쌓인다.
      S.contracts.forEach(c => {
        if (c.status !== 'PENDING_APPROVAL') return;
        const ref = { refType: 'contract', refId: c.contractId };
        if (!c.remindedAt && t >= c.createdAt + cfg.get('notifyUnconfirmedHours') * HOUR) { c.remindedAt = t; pushNote('customer', c.customerId, '카마스터가 아직 확인하지 않았어요. 안내문을 다시 보내거나 조회번호를 다시 발급할 수 있어요', null, ref); }
        if (!c.warnedAt && t >= c.expiresAt - cfg.get('notifyExpiryWarnHours') * HOUR) {
          c.warnedAt = t; pushNote('customer', c.customerId, '곧 만료됩니다. 승인되지 않으면 자동으로 만료돼요', null, ref);
          const gr = grantOfContract(c); if (gr && gr.status === 'ACTIVE') pushNote('karmaster', digits(c.carmasterPhone), '승인 대기 중인 계약이 곧 만료됩니다', null, ref);
        }
      });
      // 미가입 카마스터 계정: 마지막 계약이 끝난 뒤 유예 기간이 지나면 휴면(접근 불가). 기록은 보관만 하고 정식 가입 시 되돌린다.
      Object.keys(S.accounts).forEach(ph => {
        const a = S.accounts[ph]; if (a.dormant || regK(ph)) return;
        const mine = S.contracts.filter(c => digits(c.carmasterPhone) === ph && !(grantOfContract(c) || {}).archived);
        if (mine.some(c => c.status === 'PENDING_APPROVAL' || (c.status === 'APPROVED' && !c.completedAt))) return;
        const ends = mine.map(c => c.status === 'REJECTED' ? (c.rejectedAt || c.createdAt) : c.status === 'EXPIRED' ? c.expiresAt : c.status === 'APPROVED' ? c.completedAt : c.createdAt);
        const last = Math.max.apply(null, [a.createdAt].concat(ends));
        if (t > last + cfg.get('unregisteredGraceDays') * DAY) {
          a.dormant = true; a.dormantAt = t;
          S.grants.forEach(gr => { if (gr.carmasterPhone === ph) gr.archived = true; });
          Object.keys(S.sessions).forEach(k => { if (S.sessions[k].phone === ph) delete S.sessions[k]; });
        }
      });
    }

    // ======================= 핸들러 =======================
    const H = {};

    H['contracts.create'] = async (r) => {
      const b = r.body || {}, idn = r.identity;
      requireFields(b, ['manufacturerContractNo', 'vehicleModel', 'carmasterPhone']);
      if (digits(b.carmasterPhone).length < 9) throw E.val('카마스터 연락처 형식을 확인해 주세요', { field: 'carmasterPhone' });
      if (b.contractDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(b.contractDate)) throw E.val('계약일자는 YYYY-MM-DD 형식입니다', { field: 'contractDate' });
      const dup = S.contracts.find(c => c.customerId === idn.userId && c.manufacturerContractNo === b.manufacturerContractNo.trim() && ['PENDING_APPROVAL', 'APPROVED'].includes(c.status));
      if (dup) throw E.conflict('이미 등록된 제조사 계약번호입니다');
      const t = nowFn(), d = new Date(t);
      const ym = String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0');
      const no = (cfg.get('serviceContractNoPrefix') || 'SS') + '-' + ym + '-' + String(nextSeq('contract-' + ym)).padStart(4, '0');
      const matched = !!regK(b.carmasterPhone) || accountActive(digits(b.carmasterPhone)); // 가입 카마스터 + 확인번호를 정한(휴면 아닌) 카마스터는 조회번호 없이 자동 연결
      const c = {
        contractId: newId(), serviceContractNo: no, customerId: idn.userId, customerName: idn.name || '', customerPhone: idn.phone || '',
        manufacturerContractNo: b.manufacturerContractNo.trim(), vehicleModel: b.vehicleModel.trim(), brand: b.brand, trim: b.trim, color: b.color,
        contractDate: b.contractDate, carmasterPhone: b.carmasterPhone, carmasterName: b.carmasterName, dealershipName: b.dealershipName, memo: b.memo,
        status: 'PENDING_APPROVAL', destinationType: null, deliveryId: null, createdAt: t, expiresAt: t + cfg.get('unapprovedExpiryHours') * HOUR,
        confirmedAt: null, releaseRequest: null, completedAt: null,
      };
      S.contracts.push(c);
      const gr = { grantId: newId(), contractId: c.contractId, carmasterPhone: digits(b.carmasterPhone), status: matched ? 'ACTIVE' : 'PENDING_CLAIM', tokenHash: null, expiresAt: c.expiresAt };
      let claimToken = null;
      if (!matched) {
        claimToken = newToken();
        gr.tokenHash = await sha256(gr.grantId + ':' + claimToken); // 해시만 저장
        gr.expiresAt = Math.min(c.expiresAt, t + cfg.get('claimTtlHours') * HOUR);
      }
      S.grants.push(gr);
      emit('ContractRegistered', { contractId: c.contractId }, { serviceContractNo: no, carmasterMatched: matched, grantStatus: gr.status, vehicleModel: c.vehicleModel }, idn);
      return { status: 201, body: { contractId: c.contractId, serviceContractNo: no, claimToken, carmasterMatched: matched, grantId: matched ? null : gr.grantId } };
    };

    H['contracts.list'] = async (r) => {
      const q = r.query || {};
      const allowed = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'];
      if (q.status != null && !allowed.includes(q.status)) throw E.val('status 값이 올바르지 않습니다', { allowed });
      let arr = S.contracts.filter(c => canSeeContract(r.identity, c) && (!q.status || c.status === q.status));
      arr = arr.slice().sort((a, b) => b.createdAt - a.createdAt);
      return { status: 200, body: clean(pageOf(arr, q, c => contractView(r.identity, c))) };
    };

    H['contracts.get'] = async (r) => {
      const c = contractOf(r.pathParams.id);
      if (!c || !canSeeContract(r.identity, c)) throw E.nf();
      return { status: 200, body: clean(contractView(r.identity, c)) };
    };

    const ownKarmasterContract = (r) => { const c = contractOf(r.pathParams.id); if (!c || !canWriteAsKarmaster(r.identity, c)) throw E.nf(); return c; };
    const ownCustomerContract = (r) => { const c = contractOf(r.pathParams.id); if (!c || c.customerId !== r.identity.userId) throw E.nf(); return c; };

    H['contracts.approve'] = async (r) => {
      const c = ownKarmasterContract(r), b = r.body || {};
      inEnum(b.destinationType, ['DEALERSHIP', 'AFFILIATED_SHOP', 'CUSTOM_ADDRESS'], 'destinationType');
      if (c.status !== 'PENDING_APPROVAL') throw E.conflict('이미 처리되었거나 만료된 계약입니다');
      c.status = 'APPROVED'; c.destinationType = b.destinationType; c.consultationMemo = b.consultationMemo; c.partnerName = b.partnerName;
      emit('ContractApprovedByCarmaster', { contractId: c.contractId }, { destinationType: c.destinationType }, r.identity);
      return { status: 200, body: clean(contractView(r.identity, c)) };
    };

    H['contracts.reject'] = async (r) => {
      const c = ownKarmasterContract(r), b = r.body || {};
      requireFields(b, ['reasonCode']);
      if (c.status !== 'PENDING_APPROVAL') throw E.conflict('이미 처리되었거나 만료된 계약입니다');
      c.status = 'REJECTED'; c.rejectedAt = nowFn(); c.rejectReason = { code: b.reasonCode, note: b.note };
      pushNote('customer', c.customerId, '카마스터가 계약을 승인하지 않았습니다. 내용을 확인해 다시 등록할 수 있어요', null, { refType: 'contract', refId: c.contractId });
      return { status: 200, body: clean(contractView(r.identity, c)) };
    };

    H['contracts.confirm'] = async (r) => {
      const c = ownCustomerContract(r);
      if (c.status !== 'APPROVED' || c.confirmedAt) throw E.conflict('승인된 계약만 확인할 수 있고, 한 번만 확인합니다');
      c.confirmedAt = nowFn();
      emit('ContractConfirmedByCustomer', { contractId: c.contractId }, {}, r.identity);
      return { status: 200, body: clean(contractView(r.identity, c)) };
    };

    H['contracts.releaseRequest'] = async (r) => {
      const c = ownCustomerContract(r), b = r.body || {};
      inEnum(b.receiptMode, ['ON_SITE', 'REMOTE_PROXY'], 'receiptMode');
      if (!c.confirmedAt) throw E.conflict('계약 확인 후 출고를 요청할 수 있습니다');
      if (c.releaseRequest) throw E.conflict('이미 출고를 요청했습니다');
      if (b.receiptMode === 'REMOTE_PROXY' && b.proxyConsent !== true) throw E.val('원격 승인·대리 인수에는 위임 동의가 필요합니다', { field: 'proxyConsent' });
      if (!b.deliverySiteId && !isStr(b.customAddress)) throw E.val('인도지(deliverySiteId) 또는 customAddress가 필요합니다');
      let site = null;
      if (b.deliverySiteId) { site = siteOf(b.deliverySiteId); if (!site) throw E.val('인도지를 찾을 수 없습니다', { field: 'deliverySiteId' }); }
      if (b.receiptMode === 'REMOTE_PROXY' && !(site && site.shopId)) throw E.val('대리 인수는 시공사가 있는 인도지에서만 가능합니다', { field: 'deliverySiteId' });
      c.releaseRequest = { siteId: site ? site.siteId : null, customAddress: site ? null : b.customAddress.trim(), receiptMode: b.receiptMode, proxyConsent: b.proxyConsent === true, at: nowFn() };
      emit('ReleaseRequested', { contractId: c.contractId }, { receiptMode: b.receiptMode, hasSite: !!site }, r.identity);
      return { status: 200, body: clean(contractView(r.identity, c)) };
    };

    H['contracts.releaseOrder'] = async (r) => {
      const c = ownKarmasterContract(r);
      if (!c.releaseRequest) throw E.conflict('고객의 출고 요청이 먼저 필요합니다');
      if (c.deliveryId) throw E.conflict('이미 출고 의뢰되었습니다');
      const t = nowFn();
      const rr = c.releaseRequest;
      const d = { deliveryId: newId(), contractId: c.contractId, storageState: 'PLANNED', siteId: rr.siteId, customAddress: rr.customAddress, destinationType: c.destinationType, receiptMode: rr.receiptMode, stateTimes: { PLANNED: t }, collection: { registeredAt: t, startedAt: null, stoppedAt: null, lastAutoAt: null }, observations: [], proxyReceipt: null, managerConfirmedAt: null, customerApprovedAt: null, approvalType: null, receiverType: 'CUSTOMER', inspectionItems: [], overrideReason: null };
      S.deliveries.push(d); c.deliveryId = d.deliveryId;
      emit('ReleaseOrdered', { contractId: c.contractId, deliveryId: d.deliveryId }, {}, r.identity);
      pushTimeline(d, 'RELEASE_ORDERED', '출고가 의뢰되었습니다', 'AUTO', true);
      return { status: 200, body: deliveryView(d) };
    };

    // ---- 접근 (claim) ----
    H['access.claim'] = async (r) => {
      const b = r.body || {}, idn = r.identity, t = nowFn();
      requireFields(b, ['phone', 'claimToken']);
      const ph = digits(idn.phone), pinLen = cfg.get('pinLength');
      if (typeof b.pin !== 'string' || !new RegExp('^\\d{' + pinLen + '}$').test(b.pin)) throw E.val('확인번호는 숫자 ' + pinLen + '자리입니다', { field: 'pin', subcode: 'PIN_FORMAT' });
      const lock = S.claimLocks[ph] || (S.claimLocks[ph] = { attempts: 0, lockedUntil: 0 });
      if (lock.lockedUntil > t) throw E.rate();
      if (lock.lockedUntil && lock.lockedUntil <= t) { lock.attempts = 0; lock.lockedUntil = 0; }
      const fail = () => {
        lock.attempts += 1;
        if (lock.attempts >= cfg.get('claimMaxAttempts')) lock.lockedUntil = t + cfg.get('claimLockMinutes') * MIN;
        save(); // 실패 시도도 기록되어야 하므로 오류 응답 전에 저장
        return E.nf(); // 틀린 번호·없는 건·만료·틀린 확인번호를 구분하지 않는다
      };
      const acct = accountOf(ph), fresh = !acct || acct.dormant;
      // 처음(또는 휴면 뒤) 정하는 확인번호는 두 번 입력해야 한다. 이미 정했다면 그 번호가 맞아야 한다.
      if (fresh && b.pinConfirm !== b.pin) throw E.val('처음 정하는 확인번호는 한 번 더 입력해 주세요', { field: 'pinConfirm', subcode: 'PIN_SETUP_CONFIRM' });
      if (!fresh && acct.pinHash !== await pinHash(ph, b.pin)) throw fail();
      if (digits(b.phone) !== ph) throw fail(); // 전화번호 일치 필수
      const cands = S.grants.filter(gr => gr.status === 'PENDING_CLAIM' && !gr.archived && gr.carmasterPhone === ph && t <= gr.expiresAt
        && (!b.manufacturerContractNo || (contractOf(gr.contractId) || {}).manufacturerContractNo === b.manufacturerContractNo));
      let hit = null;
      for (const gr of cands) { if (gr.tokenHash && gr.tokenHash === await sha256(gr.grantId + ':' + b.claimToken)) { hit = gr; break; } }
      if (!hit) throw fail();
      if (fresh) S.accounts[ph] = { pinHash: await pinHash(ph, b.pin), createdAt: t, dormant: false };
      hit.status = 'ACTIVE'; lock.attempts = 0; lock.lockedUntil = 0;
      const sessionToken = await startSession(ph);
      emit('AccessGrantClaimed', { contractId: hit.contractId }, { grantId: hit.grantId }, idn);
      return { status: 200, body: { grantId: hit.grantId, contractId: hit.contractId, status: hit.status, expiresAt: iso(hit.expiresAt), sessionToken } };
    };

    // 확인번호 로그인: 이미 확인번호를 정한 미가입 카마스터가 조회번호 없이 다시 들어온다. 휴면이면 거부.
    H['access.login'] = async (r) => {
      const b = r.body || {}, idn = r.identity, t = nowFn();
      requireFields(b, ['phone', 'pin']);
      const ph = digits(idn.phone);
      const lock = S.claimLocks[ph] || (S.claimLocks[ph] = { attempts: 0, lockedUntil: 0 });
      if (lock.lockedUntil > t) throw E.rate();
      if (lock.lockedUntil && lock.lockedUntil <= t) { lock.attempts = 0; lock.lockedUntil = 0; }
      const fail = () => {
        lock.attempts += 1;
        if (lock.attempts >= cfg.get('claimMaxAttempts')) lock.lockedUntil = t + cfg.get('claimLockMinutes') * MIN;
        save(); return E.nf();
      };
      const acct = accountOf(ph);
      if (digits(b.phone) !== ph || !acct) throw fail();
      if (acct.pinHash !== await pinHash(ph, String(b.pin))) throw fail();
      if (acct.dormant) throw E.conflict('접근 기간이 지났습니다. 고객에게 받은 새 조회번호로 다시 시작하거나 정식 가입해 주세요');
      lock.attempts = 0; lock.lockedUntil = 0;
      const sessionToken = await startSession(ph);
      return { status: 200, body: { sessionToken, expiresAt: iso(t + cfg.get('sessionHours') * HOUR) } };
    };

    // ---- 알림 (앱 안 목록) ----
    const myNotes = (idn) => S.notifications.filter(n => idn.role === 'customer' ? n.toUserId === idn.userId : idn.role === 'karmaster' ? n.toPhone === digits(idn.phone) : false);
    const noteView = (n) => ({ notificationId: n.notificationId, text: n.text, refType: n.refType, refId: n.refId, createdAt: n.createdAt, read: !!n.read });
    H['notifications.list'] = async (r) => {
      const q = r.query || {};
      let arr = myNotes(r.identity).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const unreadCount = arr.filter(n => !n.read).length;
      if (q.unread === true || q.unread === 'true') arr = arr.filter(n => !n.read);
      const page = pageOf(arr, q, noteView);
      return { status: 200, body: clean(Object.assign(page, { unreadCount })) };
    };
    H['notifications.read'] = async (r) => {
      const n = myNotes(r.identity).find(x => x.notificationId === r.pathParams.id);
      if (!n) throw E.nf();
      n.read = true; n.readAt = iso();
      return { status: 200, body: clean(noteView(n)) };
    };

    H['access.grants'] = async (r) => {
      const arr = S.grants.filter(gr => gr.carmasterPhone === digits(r.identity.phone)).sort((a, b) => b.expiresAt - a.expiresAt);
      // PENDING_CLAIM 건은 claim 전이므로 내용(contractId)을 알려주지 않는다
      return { status: 200, body: clean(pageOf(arr, r.query, gr => gr.status === 'PENDING_CLAIM' ? { grantId: gr.grantId, status: gr.status, expiresAt: iso(gr.expiresAt) } : { grantId: gr.grantId, contractId: gr.contractId, status: gr.status, expiresAt: iso(gr.expiresAt) })) };
    };

    H['access.reissue'] = async (r) => {
      const gr = S.grants.find(x => x.grantId === r.pathParams.id);
      const c = gr && contractOf(gr.contractId);
      if (!gr || !c || c.customerId !== r.identity.userId) throw E.nf();
      if (regK(c.carmasterPhone) || gr.status === 'ACTIVE') throw E.conflict('이미 접근 권한이 활성화되었습니다');
      if (!['PENDING_APPROVAL', 'EXPIRED'].includes(c.status)) throw E.conflict('재발급할 수 없는 상태입니다');
      const t = nowFn(), token = newToken();
      c.status = 'PENDING_APPROVAL'; c.expiresAt = t + cfg.get('unapprovedExpiryHours') * HOUR;
      gr.status = 'PENDING_CLAIM'; gr.tokenHash = await sha256(gr.grantId + ':' + token); gr.expiresAt = Math.min(c.expiresAt, t + cfg.get('claimTtlHours') * HOUR);
      S.claimLocks[gr.carmasterPhone] = { attempts: 0, lockedUntil: 0 };
      return { status: 200, body: { contractId: c.contractId, serviceContractNo: c.serviceContractNo, claimToken: token, carmasterMatched: false } };
    };

    // ---- 배송 ----
    function accessDelivery(r) {
      const d = deliveryOf(r.pathParams.id); const c = d && contractOf(d.contractId);
      if (!d || !c || !canSeeContract(r.identity, c)) throw E.nf();
      return { d, c };
    }
    function pushTimeline(d, type, text, sourceType, published, extra) {
      const e = Object.assign({ entryId: newId(), deliveryId: d.deliveryId, type, text, sourceType, observedAt: iso(), published: !!published, seq: S.timeline.length }, extra || {});
      S.timeline.push(e); return e;
    }
    H['deliveries.get'] = async (r) => ({ status: 200, body: deliveryView(accessDelivery(r).d) });

    H['deliveries.timeline'] = async (r) => {
      const { d } = accessDelivery(r);
      const internal = r.identity.role === 'karmaster' || r.identity.role === 'admin';
      let arr = S.timeline.filter(e => e.deliveryId === d.deliveryId && (internal || e.published));
      // 최신 먼저. 같은 시각이면 나중에 쌓인 것(seq)이 먼저 — 정렬이 매번 같도록 한다.
      arr = arr.slice().sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : (b.seq || 0) - (a.seq || 0)));
      return { status: 200, body: clean(pageOf(arr, r.query, e => ({ entryId: e.entryId, type: e.type, text: e.text, sourceType: e.sourceType, observedAt: e.observedAt, published: e.published, exceptionId: e.exceptionId, augmentationId: internal ? e.augmentationId : undefined, audience: internal ? e.audience : undefined }))) };
    };

    function collectionStatusOf(d) {
      const t = nowFn();
      if (d.storageState === 'PLANNED') return 'NOT_STARTED';
      if (d.storageState === 'ARRIVED' || d.storageState === 'DELIVERED') return 'STOPPED';
      const last = d.collection.lastAutoAt || d.collection.startedAt;
      return t - last > cfg.get('locationStaleMinutes') * MIN ? 'STALE' : 'COLLECTING';
    }
    H['deliveries.location'] = async (r) => {
      const { d } = accessDelivery(r);
      const obs = d.observations.map((o, i) => ({ o, i })).sort((a, b) => (b.o.at - a.o.at) || (b.i - a.i)).map(x => x.o).map(o => ({ regionText: o.regionText, sourceType: o.sourceType, observedAt: iso(o.at) }));
      const site = d.siteId ? siteOf(d.siteId) : null;
      return { status: 200, body: clean({ latest: obs[0], history: obs, collectionStatus: collectionStatusOf(d), lastAutoCollectedAt: d.collection.lastAutoAt ? iso(d.collection.lastAutoAt) : undefined, destinationAddress: site ? site.address : d.customAddress }) };
    };

    const ownKarmasterDelivery = (r, roles) => {
      const { d, c } = accessDelivery(r);
      if (r.identity.role === 'karmaster' && !canWriteAsKarmaster(r.identity, c)) throw E.nf();
      if (roles && !roles.includes(r.identity.role)) throw E.nf();
      return { d, c };
    };

    H['deliveries.addAugmentation'] = async (r) => {
      const { d } = ownKarmasterDelivery(r, ['karmaster']), b = r.body || {};
      inEnum(b.kind, ['LOCATION', 'NOTE', 'CUSTOMIZING'], 'kind');
      const audience = b.audience || 'INTERNAL';
      inEnum(audience, ['INTERNAL', 'CUSTOMER'], 'audience');
      if (d.storageState === 'DELIVERED') throw E.conflict('인도가 종결된 건입니다');
      if ((b.kind === 'LOCATION' || b.kind === 'NOTE') && !isStr(b.text)) throw E.val('text가 필요합니다', { field: 'text' });
      (b.mediaIds || []).forEach(mid => { const m = S.media.find(x => x.mediaId === mid && x.deliveryId === d.deliveryId); if (!m) throw E.val('mediaIds에 알 수 없는 사진이 있습니다', { field: 'mediaIds' }); });
      const a = { augmentationId: newId(), deliveryId: d.deliveryId, kind: b.kind, text: b.text, audience, mediaIds: b.mediaIds || [], status: 'DRAFT', createdAt: nowFn() };
      S.augmentations.push(a);
      pushTimeline(d, 'AUGMENTATION_DRAFT', a.text || '(보강정보 초안)', 'MANAGER', false, { augmentationId: a.augmentationId, audience: a.audience });
      return { status: 201, body: clean({ augmentationId: a.augmentationId, kind: a.kind, text: a.text, audience: a.audience, mediaIds: a.mediaIds, status: a.status }) };
    };

    H['deliveries.publishAugmentation'] = async (r) => {
      const { d } = ownKarmasterDelivery(r, ['karmaster']);
      const a = S.augmentations.find(x => x.augmentationId === r.pathParams.aid && x.deliveryId === d.deliveryId);
      if (!a) throw E.nf();
      if (a.status === 'PUBLISHED') throw E.conflict('이미 게시되었습니다');
      a.status = 'PUBLISHED'; a.audience = 'CUSTOMER'; a.publishedAt = nowFn(); // 게시는 고객 노출을 뜻한다 [구현 결정: audience INTERNAL 초안도 게시 시 CUSTOMER]
      const tl = S.timeline.find(e => e.augmentationId === a.augmentationId);
      if (tl) { tl.type = 'AUGMENTATION'; tl.published = true; tl.audience = 'CUSTOMER'; tl.observedAt = iso(); }
      if (a.kind === 'LOCATION') d.observations.push({ regionText: a.text, sourceType: 'MANAGER', at: nowFn() });
      emit('AugmentationPublished', { contractId: d.contractId, deliveryId: d.deliveryId }, { augmentationId: a.augmentationId, kind: a.kind, audience: a.audience }, r.identity);
      if (a.kind === 'LOCATION') emit('LocationObserved', { contractId: d.contractId, deliveryId: d.deliveryId }, { regionText: a.text, sourceType: 'MANAGER', observedAt: iso() }, r.identity);
      return { status: 200, body: clean({ augmentationId: a.augmentationId, kind: a.kind, text: a.text, audience: a.audience, mediaIds: a.mediaIds, status: a.status }) };
    };

    H['deliveries.raiseException'] = async (r) => {
      const { d } = ownKarmasterDelivery(r, ['karmaster', 'admin']), b = r.body || {};
      requireFields(b, ['reasonCode']);
      inEnum(b.reasonCode, cfg.get('delayReasonCodes'), 'reasonCode');
      if (b.reasonCode === 'other' && !isStr(b.note)) throw E.val('기타 사유는 직접 입력이 필요합니다', { field: 'note' });
      if (d.storageState === 'DELIVERED') throw E.conflict('인도가 종결된 건입니다');
      if (S.exceptions.some(x => x.deliveryId === d.deliveryId && !x.resolvedAt)) throw E.conflict('이미 진행 중인 지연이 있습니다');
      const x = { exceptionId: newId(), deliveryId: d.deliveryId, reasonCode: b.reasonCode, note: b.note, raisedAt: nowFn(), resolvedAt: null };
      S.exceptions.push(x);
      emit('DeliveryExceptionRaised', { contractId: d.contractId, deliveryId: d.deliveryId }, { exceptionId: x.exceptionId, reasonCode: x.reasonCode }, r.identity);
      pushTimeline(d, 'EXCEPTION_RAISED', '배송 지연이 발생했습니다 (' + (((cfg.get('delayReasonLabels') || {})[x.reasonCode]) || x.reasonCode) + ')', 'MANAGER', true, { exceptionId: x.exceptionId });
      return { status: 201, body: clean({ exceptionId: x.exceptionId, reasonCode: x.reasonCode, raisedAt: iso(x.raisedAt) }) };
    };

    H['deliveries.resolveException'] = async (r) => {
      const { d } = ownKarmasterDelivery(r, ['karmaster', 'admin']);
      const x = S.exceptions.find(e => e.exceptionId === r.pathParams.eid && e.deliveryId === d.deliveryId);
      if (!x) throw E.nf();
      if (x.resolvedAt) throw E.conflict('이미 해소되었습니다');
      x.resolvedAt = nowFn();
      emit('DeliveryExceptionResolved', { contractId: d.contractId, deliveryId: d.deliveryId }, { exceptionId: x.exceptionId }, r.identity);
      pushTimeline(d, 'EXCEPTION_RESOLVED', '배송 지연이 해소되었습니다', 'MANAGER', true, { exceptionId: x.exceptionId });
      return { status: 200, body: clean({ exceptionId: x.exceptionId, reasonCode: x.reasonCode, raisedAt: iso(x.raisedAt), resolvedAt: iso(x.resolvedAt) }) };
    };

    // ---- 미디어 ----
    function mediaDelivery(r) { // karmaster(소속 건) 또는 shop(인도지 소속)만
      const { d, c } = accessDelivery(r);
      if (r.identity.role === 'karmaster' && !canWriteAsKarmaster(r.identity, c)) throw E.nf();
      return { d, c };
    }
    const mediaView = (m) => ({ mediaId: m.mediaId, purpose: m.purpose, slot: m.slot, status: m.status, thumbUrl: 'mock://media/' + m.mediaId + '/thumb', url: 'mock://media/' + m.mediaId });
    function ownMedia(r) {
      const m = S.media.find(x => x.mediaId === r.pathParams.mid); if (!m) throw E.nf();
      const d = deliveryOf(m.deliveryId), c = d && contractOf(d.contractId);
      if (!d || !c) throw E.nf();
      if (r.identity.role === 'shop') { if (!shopSees(r.identity, c)) throw E.nf(); }
      else if (!canWriteAsKarmaster(r.identity, c)) throw E.nf();
      if (m.uploaderId !== r.identity.userId) throw E.nf(); // 올린 사람만 완료·회수할 수 있다
      return { m, d, c };
    }
    H['media.init'] = async (r) => {
      const { d } = mediaDelivery(r), b = r.body || {};
      inEnum(b.purpose, ['INTAKE', 'REQUIRED_SHOT', 'CUSTOMIZING', 'OTHER'], 'purpose');
      if (!isStr(b.contentType) || !/^image\//.test(b.contentType)) throw E.val('이미지 파일만 등록할 수 있습니다', { field: 'contentType' });
      if (b.purpose === 'REQUIRED_SHOT') inEnum(b.slot, cfg.get('requiredShotSlots'), 'slot');
      if (b.sizeBytes != null && (!Number.isInteger(b.sizeBytes) || b.sizeBytes <= 0)) throw E.val('sizeBytes가 올바르지 않습니다', { field: 'sizeBytes' });
      if (d.storageState === 'DELIVERED') throw E.conflict('인도가 종결된 건입니다');
      const m = { mediaId: newId(), deliveryId: d.deliveryId, uploaderId: r.identity.userId, uploaderRole: r.identity.role, purpose: b.purpose, slot: b.slot, contentType: b.contentType, sizeBytes: b.sizeBytes, clientCreatedAt: b.clientCreatedAt, status: 'PENDING', createdAt: nowFn() };
      S.media.push(m);
      return { status: 201, body: { mediaId: m.mediaId, uploadUrl: 'https://mock.invalid/upload/' + m.mediaId, expiresAt: iso(nowFn() + HOUR) } };
    };
    H['media.complete'] = async (r) => {
      const { m, d } = ownMedia(r);
      if (m.status !== 'PENDING') throw E.conflict('이미 완료되었거나 회수된 사진입니다');
      m.status = 'PUBLISHED'; m.publishedAt = nowFn();
      emit('MediaPublished', { contractId: d.contractId, deliveryId: d.deliveryId }, { mediaId: m.mediaId, purpose: m.purpose, slot: m.slot || null }, r.identity);
      pushTimeline(d, 'MEDIA', '사진이 등록되었습니다', 'MANAGER', m.purpose === 'CUSTOMIZING');
      return { status: 200, body: clean(mediaView(m)) };
    };
    H['media.withdraw'] = async (r) => {
      const { m, d } = ownMedia(r);
      if (m.status === 'WITHDRAWN') throw E.conflict('이미 회수되었습니다');
      if (d.storageState === 'DELIVERED') throw E.conflict('인도가 종결된 건입니다');
      const wasPublished = m.status === 'PUBLISHED';
      m.status = 'WITHDRAWN';
      if (wasPublished) emit('MediaWithdrawn', { contractId: d.contractId, deliveryId: d.deliveryId }, { mediaId: m.mediaId }, r.identity);
      return { status: 200, body: clean(mediaView(m)) };
    };

    // ---- 인수 ----
    const handoverMediaIds = (d) => S.media.filter(m => m.deliveryId === d.deliveryId && m.status === 'PUBLISHED' && ['INTAKE', 'REQUIRED_SHOT'].includes(m.purpose)).map(m => m.mediaId);
    const missingShots = (d) => { const have = new Set(S.media.filter(m => m.deliveryId === d.deliveryId && m.status === 'PUBLISHED' && m.purpose === 'REQUIRED_SHOT' && m.uploaderRole === 'shop').map(m => m.slot)); return cfg.get('requiredShotSlots').filter(s => !have.has(s)); };
    function handoverView(d) {
      return clean({ deliveryId: d.deliveryId, receiverType: d.receiverType, managerConfirmedAt: d.managerConfirmedAt ? iso(d.managerConfirmedAt) : undefined, customerApprovedAt: d.customerApprovedAt ? iso(d.customerApprovedAt) : undefined, approvalType: d.approvalType || undefined, requiredShotsDone: missingShots(d).length === 0, inspectionItems: d.inspectionItems, mediaIds: handoverMediaIds(d), media: handoverMediaIds(d).map(id => mediaView(S.media.find(m => m.mediaId === id))) });
    }
    function maybeComplete(d, c, actor) {
      if (d.managerConfirmedAt && d.customerApprovedAt && d.storageState === 'ARRIVED') {
        transition(d, 'DELIVERED', actor);
        c.completedAt = nowFn();
        d.collection.stoppedAt = d.collection.stoppedAt || nowFn();
        const gr = grantOfContract(c);
        if (gr && gr.status === 'ACTIVE') { gr.status = 'EXPIRED'; emit('AccessGrantExpired', { contractId: c.contractId }, { grantId: gr.grantId }, actor); } // 권한 수명 종료
        emit('DeliveryCompleted', { contractId: c.contractId, deliveryId: d.deliveryId }, {}, actor);
        pushTimeline(d, 'COMPLETED', '인도가 종결되었습니다', 'AUTO', true);
      }
    }
    H['handover.get'] = async (r) => ({ status: 200, body: handoverView(accessDelivery(r).d) });

    H['handover.managerConfirm'] = async (r) => {
      const { d, c } = ownKarmasterDelivery(r, ['karmaster']);
      if (d.storageState !== 'ARRIVED') throw E.conflict('도착 후에만 인도를 확인할 수 있습니다');
      if (d.managerConfirmedAt) throw E.conflict('이미 확인했습니다');
      d.managerConfirmedAt = nowFn();
      emit('ManagerAcceptanceConfirmed', { contractId: c.contractId, deliveryId: d.deliveryId }, {}, r.identity);
      maybeComplete(d, c, r.identity);
      return { status: 200, body: handoverView(d) };
    };

    H['handover.customerApprove'] = async (r) => {
      const { d, c } = accessDelivery(r), b = r.body || {};
      if (c.customerId !== r.identity.userId) throw E.nf();
      inEnum(b.approvalType, ['ON_SITE', 'REMOTE'], 'approvalType');
      if (d.storageState !== 'ARRIVED') throw E.conflict('도착 후에만 승인할 수 있습니다');
      if (d.customerApprovedAt) throw E.conflict('이미 승인했습니다');
      if (b.approvalType === 'REMOTE') {
        if (d.receiptMode !== 'REMOTE_PROXY') throw E.val('원격 승인은 대리 인수를 위임한 건에서만 가능합니다', { subcode: 'REMOTE_NOT_ALLOWED' });
        if (!d.managerConfirmedAt) throw E.conflict('카마스터 인도 확인이 먼저 필요합니다');
        if (!d.proxyReceipt) throw E.val('시공사 대리 인수 기록이 필요합니다', { subcode: 'PROXY_RECEIPT_REQUIRED' });
        const viewed = new Set(b.viewedMediaIds || []);
        const unseen = handoverMediaIds(d).filter(id => !viewed.has(id));
        if (unseen.length) throw E.val('사진을 모두 열람한 뒤 원격 승인할 수 있습니다', { subcode: 'PHOTOS_NOT_VIEWED', unseen });
      }
      if (d.inspectionItems.some(i => i.result === 'FAIL') && !isStr(b.overrideReason)) throw E.val('검수 불합격 항목이 있어 사유 없이는 승인할 수 없습니다', { subcode: 'INSPECTION_FAIL_OVERRIDE_REQUIRED' });
      d.customerApprovedAt = nowFn(); d.approvalType = b.approvalType; d.overrideReason = b.overrideReason || null;
      d.approvalAudit = { viewedMediaIds: b.viewedMediaIds || [], memo: b.memo, signature: b.signature ? true : false };
      emit('CustomerAcceptanceConfirmed', { contractId: c.contractId, deliveryId: d.deliveryId }, { approvalType: b.approvalType, overrideUsed: !!d.overrideReason }, r.identity);
      maybeComplete(d, c, r.identity);
      return { status: 200, body: handoverView(d) };
    };

    H['handover.proxyReceipt'] = async (r) => {
      const { d, c } = accessDelivery(r), b = r.body || {};
      if (!shopSees(r.identity, c)) throw E.nf(); // 인도지 소속 시공사만
      if (d.receiptMode !== 'REMOTE_PROXY') throw E.conflict('대리 인수가 위임되지 않은 건입니다');
      if (d.storageState !== 'ARRIVED') throw E.conflict('도착 후에만 대리 인수를 기록할 수 있습니다');
      if (d.proxyReceipt) throw E.conflict('이미 대리 인수가 기록되었습니다');
      if (!Array.isArray(b.mediaIds) || b.mediaIds.length < 1) throw E.val('mediaIds가 필요합니다', { field: 'mediaIds' });
      b.mediaIds.forEach(id => { const m = S.media.find(x => x.mediaId === id && x.deliveryId === d.deliveryId && x.status === 'PUBLISHED' && x.uploaderId === r.identity.userId); if (!m) throw E.val('등록되지 않았거나 본인이 올리지 않은 사진이 있습니다', { field: 'mediaIds' }); });
      const missing = missingShots(d);
      if (missing.length) throw E.val('필수 촬영이 끝나지 않았습니다', { subcode: 'SHOTS_INCOMPLETE', missing });
      d.proxyReceipt = { at: nowFn(), mediaIds: b.mediaIds, note: b.note }; d.receiverType = 'PROXY_INSTALLER';
      emit('ProxyReceiptRecorded', { contractId: c.contractId, deliveryId: d.deliveryId }, { mediaCount: b.mediaIds.length }, r.identity);
      return { status: 200, body: handoverView(d) };
    };

    // ---- 평가·포인트 ----
    H['engagement.rate'] = async (r) => {
      const b = r.body || {}, idn = r.identity;
      inEnum(b.targetType, ['KARMASTER', 'SHOP', 'DELIVERY_COMPANY'], 'targetType');
      if (!isStr(b.targetId)) throw E.val('targetId가 필요합니다', { field: 'targetId' });
      if (!Array.isArray(b.aspects) || !b.aspects.length) throw E.val('평가 항목이 필요합니다', { field: 'aspects' });
      b.aspects.forEach(a => { if (!isStr(a.aspect) || !Number.isInteger(a.score) || a.score < 1 || a.score > 5) throw E.val('점수는 1~5 정수입니다', { field: 'aspects' }); });
      const allowed = (cfg.get('ratingAspects') || {})[b.targetType] || [];
      if (allowed.length) b.aspects.forEach(a => { if (!allowed.includes(a.aspect)) throw E.val('허용되지 않은 평가 항목입니다', { field: 'aspects', allowed }); });
      let d = null, c = null;
      if (b.deliveryId) { d = deliveryOf(b.deliveryId); c = d && contractOf(d.contractId); if (!d || !c || c.customerId !== idn.userId) throw E.nf(); }
      else { c = S.contracts.filter(x => x.customerId === idn.userId && x.completedAt).slice(-1)[0]; d = c && deliveryOf(c.deliveryId); if (!c) throw E.conflict('인도가 종결된 건이 없습니다'); }
      if (d.storageState !== 'DELIVERED') throw E.conflict('인도 종결(CONFIRMED) 이후에 평가할 수 있습니다'); // BR-13
      const expected = { KARMASTER: (regK(c.carmasterPhone) || {}).id, SHOP: (siteOf(d.siteId) || {}).shopId, DELIVERY_COMPANY: S.registry.deliveryCompany.id }[b.targetType];
      if (!expected || expected !== b.targetId) throw E.val('이 건의 평가 대상이 아닙니다', { field: 'targetId' });
      if (S.ratings.some(x => x.deliveryId === d.deliveryId && x.targetType === b.targetType && x.customerId === idn.userId)) throw E.conflict('이미 평가했습니다');
      const rt = { ratingId: newId(), customerId: idn.userId, deliveryId: d.deliveryId, targetType: b.targetType, targetId: b.targetId, aspects: b.aspects, comment: b.comment, createdAt: iso() };
      S.ratings.push(rt);
      const w = S.points[idn.userId] || (S.points[idn.userId] = { balance: 0, ledger: [] });
      const delta = cfg.get('pointsPerRating'); w.balance += delta; w.ledger.push({ delta, reason: 'RATING_' + b.targetType, at: iso() });
      emit('RatingSubmitted', { contractId: c.contractId, deliveryId: d.deliveryId }, { ratingId: rt.ratingId, targetType: rt.targetType }, idn);
      emit('PointsAwarded', { contractId: c.contractId, deliveryId: d.deliveryId }, { delta, balance: w.balance }, idn);
      return { status: 201, body: { ratingId: rt.ratingId, targetType: rt.targetType, createdAt: rt.createdAt } };
    };
    H['engagement.points'] = async (r) => { const w = S.points[r.identity.userId] || { balance: 0, ledger: [] }; return { status: 200, body: clone(w) }; };
    const clone = (x) => JSON.parse(JSON.stringify(x));

    // ---- 대화 (threadId = contractId [구현 결정: openapi에 thread 생성·조회 경로가 없다]) ----
    function thread(r) {
      const c = contractOf(r.pathParams.id);
      if (!c || !canSeeContract(r.identity, c)) throw E.nf();
      return c;
    }
    H['engagement.messages'] = async (r) => {
      const c = thread(r);
      const arr = S.messages.filter(m => m.threadId === c.contractId); // 오래된 것 -> 최신 (최신이 하단)
      // 관리자는 사유를 남겨 열람 로그(CHAT_FULL)가 있는 동안에만 본문을 본다(BR-12). 없으면 본문 없이 보낸 사람·시각만 준다.
      const t = nowFn(), win = cfg.get('sensitiveViewWindowMinutes') * MIN;
      const hide = r.identity.role === 'admin' && !S.sensitiveViews.some(v => v.userId === r.identity.userId && v.contractId === c.contractId && v.viewType === 'CHAT_FULL' && t - v.lastAt <= win);
      return { status: 200, body: clean(pageOf(arr, r.query, m => ({ messageId: m.messageId, senderRole: m.senderRole, body: hide ? '' : m.body, masked: hide ? true : undefined, createdAt: m.createdAt, readBy: m.readBy }))) };
    };
    H['engagement.send'] = async (r) => {
      const c = thread(r), b = r.body || {};
      if (!isStr(b.body)) throw E.val('내용을 입력해 주세요', { field: 'body' });
      if (b.body.length > 2000) throw E.val('2000자를 넘을 수 없습니다', { field: 'body' });
      const m = { messageId: newId(), threadId: c.contractId, senderRole: r.identity.role, senderId: r.identity.userId, body: b.body, mediaIds: b.mediaIds || [], createdAt: iso(), readBy: [r.identity.userId] };
      S.messages.push(m);
      // 상대방에게 앱 안 알림(내용은 싣지 않는다)
      if (r.identity.role !== 'customer') pushNote('customer', c.customerId, '새 메시지가 도착했습니다', null, { refType: 'contract', refId: c.contractId });
      if (r.identity.role !== 'karmaster') { const gr = grantOfContract(c); if (gr && gr.status === 'ACTIVE') pushNote('karmaster', digits(c.carmasterPhone), '새 메시지가 도착했습니다', null, { refType: 'contract', refId: c.contractId }); }
      return { status: 201, body: clean({ messageId: m.messageId, senderRole: m.senderRole, body: m.body, createdAt: m.createdAt, readBy: m.readBy }) };
    };

    // ---- 관리자 ----
    H['admin.collectionStatus'] = async (r) => {
      const t = nowFn();
      const arr = S.deliveries.filter(d => d.storageState !== 'DELIVERED');
      return { status: 200, body: clean(pageOf(arr, r.query, d => {
        const last = d.collection.lastAutoAt;
        return { deliveryId: d.deliveryId, collectionStatus: collectionStatusOf(d), lastAutoCollectedAt: last ? iso(last) : undefined, staleMinutes: last ? Math.floor((t - last) / MIN) : (d.collection.startedAt ? Math.floor((t - d.collection.startedAt) / MIN) : 0) };
      })) };
    };
    H['admin.recordSensitiveView'] = async (r) => {
      const b = r.body || {}, idn = r.identity;
      inEnum(b.viewType, ['CHAT_FULL', 'CONSULT_MEMO_FULL', 'CUSTOMER_PHONE_SHOWN', 'AUDIT_VIEW'], 'viewType');
      if (!isStr(b.contractId)) throw E.val('contractId가 필요합니다', { field: 'contractId' });
      inEnum(b.reasonCode, cfg.get('sensitiveViewReasonCodes'), 'reasonCode');
      const c = contractOf(b.contractId); if (!c || !canSeeContract(idn, c)) throw E.nf();
      const t = nowFn(), win = cfg.get('sensitiveViewWindowMinutes') * MIN;
      const prev = S.sensitiveViews.find(v => v.userId === idn.userId && v.contractId === c.contractId && v.viewType === b.viewType && t - v.lastAt <= win);
      if (prev) { prev.lastAt = t; prev.count += 1; return { status: 201, body: { recorded: true, merged: true } }; }
      S.sensitiveViews.push({ id: newId(), userId: idn.userId, role: idn.role, contractId: c.contractId, viewType: b.viewType, reasonCode: b.reasonCode, firstAt: t, lastAt: t, count: 1 });
      return { status: 201, body: { recorded: true, merged: false } };
    };

    // ---- 상태 전이 (플랫폼/탁송 쪽 사건 — API에는 없고 목 전용 관리 훅으로만 일으킨다) ----
    const NEXT = { PLANNED: 'SHIPPED', SHIPPED: 'IN_TRANSIT', IN_TRANSIT: 'ARRIVED' };
    function transition(d, to, actor) {
      const from = d.storageState; d.storageState = to; d.stateTimes[to] = nowFn();
      if (to === 'SHIPPED') d.collection.startedAt = nowFn();
      if (to === 'ARRIVED') d.collection.stoppedAt = nowFn();
      emit('DeliveryStateChanged', { contractId: d.contractId, deliveryId: d.deliveryId }, { from, to }, actor);
      const lab = (x) => ((V.statusMap && V.statusMap.LABEL) || {})[V.statusMap && V.statusMap.STORAGE_TO_DISPLAY[x]] || x;
      pushTimeline(d, 'STATE_CHANGED', lab(from) + ' → ' + lab(to), 'AUTO', true);
    }

    // ======================= 진입점 =======================
    // 같은 화면에서 동시에 들어온 요청이 서로의 load/save를 덮어쓰지 않도록 한 줄로 처리한다 (await 사이에 상태가 바뀌는 문제 방지)
    let chain = Promise.resolve();
    const locked = (fn) => (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) ? navigator.locks.request('vlp-mock-state:' + key, fn) : fn(); // 같은 출처의 다른 탭과도 겹치지 않게
    function handle(req) { const p = chain.then(() => locked(() => handleOne(req))); chain = p.catch(() => {}); return p; }
    async function handleOne(req) {
      load();
      try {
        const opDef = V.ops && V.ops.byName[req.op];
        if (!opDef || !H[req.op]) throw E.nf();
        let idn = req.identity;
        if (idn && !idn.userId && idn.token) { // HTTP 목 서버: 세션 토큰만 온 요청은 세션에서 신원을 복원한다
          const sess = await sessionOf(idn.token);
          if (sess) idn = req.identity = { userId: 'km-' + sess.phone, role: 'karmaster', phone: fmtPhone(sess.phone), token: idn.token };
        }
        if (!idn || !idn.userId || !idn.role) throw E.auth();
        if (!opDef.roles.includes(idn.role)) throw E.nf(); // 역할 불일치도 404 (존재 여부를 알리지 않는다)
        sweep();
        // 미가입 카마스터(명부에 없음) 중 확인번호 계정이 있는 번호는 유효한 세션 토큰이 있어야 한다. 휴면이면 세션이 없어 401.
        if (idn.role === 'karmaster' && !regK(idn.phone) && req.op !== 'access.claim' && req.op !== 'access.login') {
          const ph = digits(idn.phone);
          if (accountOf(ph)) { const sess = await sessionOf(idn.token); if (!sess || sess.phone !== ph) throw E.auth(); }
        }
        let idemSlot = null;
        if (opDef.command) {
          const k = req.idempotencyKey;
          if (typeof k !== 'string' || k.length < 16 || k.length > 128) throw E.val('Idempotency-Key(16~128자)가 필요합니다', { header: 'Idempotency-Key' });
          idemSlot = idn.userId + '|' + req.op + '|' + k;
          const fp = await sha256(JSON.stringify([req.pathParams || {}, req.body == null ? null : req.body])); // 해시만 보관: 요청 본문(조회번호 입력 등)의 평문이 저장소에 남지 않게 한다
          const prev = S.idem[idemSlot];
          if (prev) {
            if (prev.fp !== fp) throw E.val('같은 Idempotency-Key로 다른 요청을 보낼 수 없습니다', { header: 'Idempotency-Key' });
            return clone({ status: prev.status, body: prev.body, replayed: true }); // 같은 키 재전송 -> 부작용 없이 같은 응답
          }
          req._fp = fp;
        }
        const out = await H[req.op](Object.assign({}, req, { pathParams: req.pathParams || {}, query: req.query || {} }));
        if (idemSlot) {
          // 멱등 재전송용 응답 보관본에서는 조회번호를 지운다: 저장소에 평문이 남으면 안 된다(CLAUDE.md, BR-02).
          // 응답을 잃은 재전송은 claimToken 없이 돌아오고, 고객은 access.reissue로 새 번호를 받는다.
          const keep = out.body && (Object.prototype.hasOwnProperty.call(out.body, 'claimToken') || Object.prototype.hasOwnProperty.call(out.body, 'sessionToken'))
            ? Object.assign({}, out.body, Object.prototype.hasOwnProperty.call(out.body, 'claimToken') ? { claimToken: null } : {}, Object.prototype.hasOwnProperty.call(out.body, 'sessionToken') ? { sessionToken: null } : {}) : out.body;
          S.idem[idemSlot] = { fp: req._fp, status: out.status, body: keep };
        }
        save();
        return clone(out);
      } catch (e) {
        if (e instanceof Err) { save(); return { status: e.status, body: e.body }; }
        throw e;
      }
    }

    // ======================= 목 전용 관리 훅 (HTTP로는 tools/mock-server.js의 /__mock/* 로만 노출) =======================
    const admin = {
      reset() { S = freshState(); save(); },
      setNow(ms) { nowFn = typeof ms === 'function' ? ms : () => ms; },
      resetTime() { load(); S.timeOffsetMs = 0; save(); return nowFn(); },
      skipTime(ms) { load(); S.timeOffsetMs = (S.timeOffsetMs || 0) + ms; save(); return nowFn(); }, // 시연용: 모든 화면에 적용되는 시간 건너뛰기
      now() { load(); return nowFn(); },
      advanceTime(ms) { const base = nowFn(); nowFn = () => base + ms; },
      state() { load(); return clone(S); },
      advance(deliveryId, to) {
        load(); const d = deliveryOf(deliveryId); if (!d) throw new Error('delivery not found');
        if (NEXT[d.storageState] !== to) throw new Error('허용되지 않은 전이: ' + d.storageState + ' -> ' + to + ' (DELIVERED는 양측 확인으로만)');
        transition(d, to); save(); return deliveryView(d);
      },
      observe(deliveryId, regionText) { // AUTO 위치 관측
        load(); const d = deliveryOf(deliveryId); if (!d) throw new Error('delivery not found');
        if (!['SHIPPED', 'IN_TRANSIT'].includes(d.storageState)) throw new Error('수집 중이 아닌 건');
        d.observations.push({ regionText, sourceType: 'AUTO', at: nowFn() }); d.collection.lastAutoAt = nowFn();
        emit('LocationObserved', { contractId: d.contractId, deliveryId: d.deliveryId }, { regionText, sourceType: 'AUTO', observedAt: iso() });
        pushTimeline(d, 'LOCATION', regionText, 'AUTO', true); save(); return true;
      },
      setInspection(deliveryId, items) { load(); const d = deliveryOf(deliveryId); d.inspectionItems = items; save(); },
      registerKarmaster(phone, name, dealershipName) { // 정식 가입 (실서비스는 본인 확인 필수: 14장 미결). 휴면으로 보관 중이던 기록을 되돌린다.
        load(); const ph = digits(phone);
        S.registry.karmasters[ph] = { id: newId(), name, dealershipName };
        S.grants.forEach(gr => { if (gr.carmasterPhone === ph) gr.archived = false; });
        const a = S.accounts[ph]; if (a) { a.dormant = false; a.migrated = true; }
        save();
      },
      accounts() { load(); return clone(S.accounts); },
      registerShop(userId, name) { load(); const shop = { shopId: newId(), name, userId }; S.registry.shops.push(shop); save(); return shop; },
      events() { load(); return clone(S.events); },
      notifications() { load(); return clone(S.notifications); },
      sensitiveViews() { load(); return clone(S.sensitiveViews); },
      ids: ID,
      putMediaData(mediaId, dataUrl) { load(); S.uploadData[mediaId] = dataUrl; save(); }, // 샘플 사진(v6 generateSamplePhoto) 보관용
      getMediaData(mediaId) { load(); return S.uploadData[mediaId] || null; },
      sweepNow() { load(); sweep(); save(); },
    };
    return { handle, admin };
  }

  V.adapters.mock = {
    createEngine,
    create(opts) {
      const engine = createEngine(opts);
      // 시험·시연용 장애 주입(메모리에만 둔다): offline = 요청이 서버에 닿지 않음, dropResponses = 서버는 처리했지만 응답이 유실됨
      const fault = { offline: false, drop: 0 };
      const netErr = () => { const e = new Error('네트워크에 연결할 수 없습니다'); e.network = true; return e; };
      engine.admin.setOffline = (on) => { fault.offline = !!on; };
      engine.admin.dropResponses = (n) => { fault.drop = n | 0; };
      const readAsDataUrl = (blob) => new Promise((res, rej) => { if (typeof blob === 'string') return res(blob); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
      return {
        name: 'mock', engine, admin: engine.admin,
        async request(req) { if (fault.offline) throw netErr(); const res = await engine.handle(req); if (fault.drop > 0) { fault.drop--; throw netErr(); } return res; },
        /** 업로드 URL로 사진 본문을 올린다(실 어댑터는 PUT). 목은 데이터 URL로 보관한다. */
        async upload(uploadUrl, blob, contentType) { if (fault.offline) throw netErr(); const id = String(uploadUrl).split('/').pop(); engine.admin.putMediaData(id, await readAsDataUrl(blob)); return { ok: true }; },
        mediaSrc(media) { return media && media.mediaId ? engine.admin.getMediaData(media.mediaId) : null; },
      };
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.adapters.mock;
})(typeof window !== 'undefined' ? window : globalThis);
