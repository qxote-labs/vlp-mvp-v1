// facade가 쓰는 operation 표(vlp-ops.js)가 openapi.yaml과 어긋나지 않는지 본다. (1:1 대응, 역할, 성공 코드, 멱등 키)
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, doc } = require('./_helpers');

test('openapi의 모든 operation이 facade에 있고, facade에는 openapi에 없는 것이 없다', () => {
  const fromSpec = [];
  Object.entries(doc.paths).forEach(([p, ms]) => Object.keys(ms).filter(m => m !== 'parameters').forEach(m => fromSpec.push(m.toUpperCase() + ' ' + p)));
  const fromOps = VLP.ops.list.map(o => o.method + ' ' + o.path);
  assert.deepEqual(fromOps.slice().sort(), fromSpec.slice().sort());
  assert.equal(fromOps.length, 34);
});

test('역할(x-roles)·성공 코드·응답 스키마·Idempotency-Key 요구가 openapi와 같다', () => {
  VLP.ops.list.forEach(o => {
    const spec = doc.paths[o.path][o.method.toLowerCase()];
    assert.deepEqual(o.roles.slice().sort(), spec['x-roles'].slice().sort(), o.name + ' roles');
    const okCodes = Object.keys(spec.responses).filter(c => c.startsWith('2')).map(Number);
    assert.deepEqual(okCodes, [o.ok], o.name + ' ok status');
    const ref = spec.responses[o.ok].content['application/json'].schema.$ref.split('/').pop();
    assert.equal(ref, o.schema, o.name + ' schema');
    const needsKey = (spec.parameters || []).some(p => p.$ref && p.$ref.endsWith('IdempotencyKey'));
    assert.equal(o.command, needsKey, o.name + ' idempotency');
  });
});

test('x-status PROPOSED-ADD: 원본 3건(reject, media complete, sensitive-views) + 작업본 추가 3건(access login, notifications list/read)', () => {
  const added = [];
  Object.entries(doc.paths).forEach(([p, ms]) => Object.entries(ms).forEach(([m, s]) => { if (s && s['x-status'] === 'PROPOSED-ADD') added.push(m.toUpperCase() + ' ' + p); }));
  assert.deepEqual(added.sort(), ['GET /lifecycle/notifications', 'POST /lifecycle/access/login', 'POST /lifecycle/admin/sensitive-views', 'POST /lifecycle/contracts/{id}/reject', 'POST /lifecycle/media/{mid}/complete', 'POST /lifecycle/notifications/{id}/read']);
});
