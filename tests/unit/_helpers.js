// 테스트 공용: 인메모리 목 + 역할별 신원 + openapi 스키마 검증기(ajv)
const fs = require('fs'), path = require('path');
const { VLP, root } = require('./_load');
const Ajv = require('ajv'); // ajv v8
const addFormats = require('ajv-formats');
const YAML = require('yaml');

const doc = YAML.parse(fs.readFileSync(path.join(root, 'contracts', 'openapi.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(doc, 'oas');
const schemaValidator = (name) => ajv.getSchema('oas#/components/schemas/' + name);

/** 응답이 openapi가 선언한 스키마를 통과하는지 확인한다. 반환: 오류 문자열 배열(없으면 빈 배열). */
function checkAgainstOpenapi(opName, status, body) {
  const op = VLP.ops.byName[opName];
  const spec = doc.paths[op.path][op.method.toLowerCase()];
  const resp = spec.responses[String(status)];
  if (!resp) return ['openapi에 선언되지 않은 상태 코드 ' + status + ' (' + opName + ')'];
  let ref;
  if (resp.$ref) { // components/responses/*
    const r = doc.components.responses[resp.$ref.split('/').pop()];
    ref = r.content['application/json'].schema.$ref;
  } else ref = resp.content['application/json'].schema.$ref;
  const v = ajv.getSchema('oas' + ref);
  if (!v(body)) return v.errors.map(e => opName + ' ' + status + ' ' + e.instancePath + ' ' + e.message);
  return [];
}

const IDS = require('../../tools/mock-fixtures').IDENTITIES;

function memoryStorage() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; }

/** 새 facade + 인메모리 목 엔진. calls[]에 (op,status,body)를 모아 두고 모두 스키마 검증할 수 있게 한다. */
function setup(opts) {
  VLP.config.reset();
  if (opts && opts.config) VLP.config.set(opts.config);
  const f = VLP.createFacade();
  const storage = memoryStorage();
  f.use('mock', { storage });
  const log = [];
  const adapter = f.adapter();
  const origReq = adapter.request.bind(adapter);
  const sess = {}; // 미가입 카마스터 세션 토큰 (claim/login 응답에서 받아 이후 요청에 쓴다)
  adapter.request = async (req) => {
    const res = await origReq(req);
    log.push({ op: req.op, status: res.status, body: res.body });
    if ((req.op === 'access.claim' || req.op === 'access.login') && res.status === 200 && res.body.sessionToken) sess[req.identity.userId] = res.body.sessionToken;
    return res;
  };
  const as = (who) => { const id = IDS[who]; f.session.set(sess[id.userId] ? Object.assign({}, id, { token: sess[id.userId] }) : id); return f; };
  return { f, as, admin: adapter.admin, storage, log, adapter, sess };
}

const SITE1 = '33333333-3333-4333-8333-111111111111', SITE2 = '33333333-3333-4333-8333-222222222222';

/** 정상 흐름: 가입 카마스터로 계약 등록 -> 승인 -> 확인 -> 출고요청(ON_SITE 또는 REMOTE_PROXY) -> 출고의뢰. */
async function toReleased(t, o) {
  o = o || {};
  const created = await t.as('cust').contracts.create({ manufacturerContractNo: o.mfr || 'HK-2026-0001', vehicleModel: '아이오닉 6', carmasterPhone: IDS.km.phone, trim: '프레스티지', color: '화이트', contractDate: '2026-09-30', carmasterName: '김카마', dealershipName: '울산 남구 영업소', memo: '메모' });
  await t.as('km').contracts.approve(created.contractId, { destinationType: o.destinationType || 'AFFILIATED_SHOP', consultationMemo: '상담' });
  await t.as('cust').contracts.confirm(created.contractId);
  const rr = o.proxy ? { deliverySiteId: SITE1, receiptMode: 'REMOTE_PROXY', proxyConsent: true } : { deliverySiteId: SITE2, receiptMode: 'ON_SITE' };
  await t.as('cust').contracts.releaseRequest(created.contractId, rr);
  const delivery = await t.as('km').contracts.releaseOrder(created.contractId, { memo: '출고' });
  return { contractId: created.contractId, deliveryId: delivery.deliveryId, serviceContractNo: created.serviceContractNo };
}
async function toArrived(t, ids) {
  t.admin.advance(ids.deliveryId, 'SHIPPED'); t.admin.advance(ids.deliveryId, 'IN_TRANSIT'); t.admin.advance(ids.deliveryId, 'ARRIVED');
}

module.exports = { VLP, root, doc, schemaValidator, checkAgainstOpenapi, IDS, setup, toReleased, toArrived, SITE1, SITE2, memoryStorage };
