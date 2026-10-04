// PWA-24: 알림 → 딥링크 주소, 안전한 대상만, 한 번만 적용
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP } = require('./_load');
const P = VLP.pushLink;

test('알림 → 역할별 화면 주소', () => {
  assert.equal(P.urlFor({ refType: 'contract', refId: 'c-1' }, 'customer'), 'customer.html?open=contract%3Ac-1');
  assert.equal(P.urlFor({ refType: 'delivery', refId: 'd_2' }, 'karmaster'), 'karmaster.html?open=delivery%3Ad_2');
  assert.equal(P.urlFor(null, 'karmaster'), 'karmaster.html');
  assert.equal(P.urlFor({ refType: 'contract', refId: '../x' }, 'customer'), 'customer.html'); // 이상한 값은 첫 화면
});
test('open 파라미터 해석: 형식이 틀리면 무시', () => {
  assert.deepEqual(P.parseOpen('?open=contract:abc'), { refType: 'contract', refId: 'abc' });
  assert.equal(P.parseOpen('?open=javascript:alert(1)'), null);
  assert.equal(P.parseOpen(''), null);
});
test('applyDeep: 계약/배송 ID 모두 찾고, 한 번만 적용', () => {
  const items = [{ contractId: 'c1', deliveryId: 'd1' }, { contractId: 'c2' }];
  P._reset(); const open = {};
  assert.equal(P.applyDeep(items, open, '?open=delivery:d1'), 'c1'); assert.equal(open.c1, true);
  assert.equal(P.applyDeep(items, open, '?open=contract:c2'), null); // 이미 처리됨
  P._reset(); assert.equal(P.applyDeep(items, {}, '?open=contract:nope'), null);
});
test('safeTarget: 다른 출처 주소는 거부', () => {
  assert.equal(P.safeTarget('customer.html?open=contract:c1', 'https://a.test/'), 'customer.html?open=contract:c1');
  assert.equal(P.safeTarget('https://evil.test/x', 'https://a.test/'), null);
});
