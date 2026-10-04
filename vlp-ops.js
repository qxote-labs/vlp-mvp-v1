/* vlp-ops.js — openapi.yaml의 operation 표 (facade·http 어댑터·목 서버가 공유).
 * 경로·메서드·역할·성공 코드를 한 곳에만 둔다. openapi와 어긋나면 tests/unit/ops-vs-openapi.test.js가 잡는다.
 * name = api-facade 메서드 이름. 필요한 인자는 path 변수(순서대로) -> body(있으면) -> query(있으면).
 */
(function (g) {
  'use strict';
  const C = ['customer'], K = ['karmaster'], S = ['shop'], A = ['admin'];
  const ALL4 = ['customer', 'karmaster', 'shop', 'admin'];
  const ops = [
    { name: 'contracts.create',  method: 'POST', path: '/lifecycle/contracts', roles: C, ok: 201, body: true, schema: 'ContractCreated' },
    { name: 'contracts.list',    method: 'GET',  path: '/lifecycle/contracts', roles: ALL4, ok: 200, query: true, schema: 'ContractPage' },
    { name: 'contracts.get',     method: 'GET',  path: '/lifecycle/contracts/{id}', roles: ALL4, ok: 200, schema: 'Contract' },
    { name: 'contracts.approve', method: 'POST', path: '/lifecycle/contracts/{id}/approve', roles: K, ok: 200, body: true, schema: 'Contract' },
    { name: 'contracts.reject',  method: 'POST', path: '/lifecycle/contracts/{id}/reject', roles: K, ok: 200, body: true, schema: 'Contract' },
    { name: 'contracts.confirm', method: 'POST', path: '/lifecycle/contracts/{id}/confirm', roles: C, ok: 200, schema: 'Contract' },
    { name: 'contracts.releaseRequest', method: 'POST', path: '/lifecycle/contracts/{id}/release-request', roles: C, ok: 200, body: true, schema: 'Contract' },
    { name: 'contracts.releaseOrder',   method: 'POST', path: '/lifecycle/contracts/{id}/release-order', roles: K, ok: 200, body: true, schema: 'Delivery' },
    { name: 'access.claim',   method: 'POST', path: '/lifecycle/access/claims', roles: K, ok: 200, body: true, schema: 'Grant' },
    { name: 'access.login',   method: 'POST', path: '/lifecycle/access/login', roles: K, ok: 200, body: true, schema: 'Session' },
    { name: 'access.grants',  method: 'GET',  path: '/lifecycle/access/grants', roles: K, ok: 200, query: true, schema: 'GrantPage' },
    { name: 'access.reissue', method: 'POST', path: '/lifecycle/access/grants/{id}/reissue', roles: C, ok: 200, schema: 'ContractCreated' },
    { name: 'deliveries.get',      method: 'GET', path: '/lifecycle/deliveries/{id}', roles: ALL4, ok: 200, schema: 'Delivery' },
    { name: 'deliveries.timeline', method: 'GET', path: '/lifecycle/deliveries/{id}/timeline', roles: ALL4, ok: 200, query: true, schema: 'TimelinePage' },
    { name: 'deliveries.location', method: 'GET', path: '/lifecycle/deliveries/{id}/location', roles: ALL4, ok: 200, schema: 'LocationView' },
    { name: 'deliveries.addAugmentation',     method: 'POST', path: '/lifecycle/deliveries/{id}/augmentations', roles: K, ok: 201, body: true, schema: 'Augmentation' },
    { name: 'deliveries.publishAugmentation', method: 'POST', path: '/lifecycle/deliveries/{id}/augmentations/{aid}/publish', roles: K, ok: 200, schema: 'Augmentation' },
    { name: 'deliveries.raiseException',      method: 'POST', path: '/lifecycle/deliveries/{id}/exceptions', roles: ['karmaster', 'admin'], ok: 201, body: true, schema: 'Exception' },
    { name: 'deliveries.resolveException',    method: 'POST', path: '/lifecycle/deliveries/{id}/exceptions/{eid}/resolve', roles: ['karmaster', 'admin'], ok: 200, schema: 'Exception' },
    { name: 'media.init',     method: 'POST', path: '/lifecycle/deliveries/{id}/media', roles: ['karmaster', 'shop'], ok: 201, body: true, schema: 'MediaInit' },
    { name: 'media.complete', method: 'POST', path: '/lifecycle/media/{mid}/complete', roles: ['karmaster', 'shop'], ok: 200, schema: 'Media' },
    { name: 'media.withdraw', method: 'POST', path: '/lifecycle/media/{mid}/withdraw', roles: ['karmaster', 'shop'], ok: 200, schema: 'Media' },
    { name: 'handover.get',             method: 'GET',  path: '/lifecycle/deliveries/{id}/handover', roles: ALL4, ok: 200, schema: 'Handover' },
    { name: 'handover.managerConfirm',  method: 'POST', path: '/lifecycle/deliveries/{id}/handover/manager-confirmation', roles: K, ok: 200, schema: 'Handover' },
    { name: 'handover.customerApprove', method: 'POST', path: '/lifecycle/deliveries/{id}/handover/customer-approval', roles: C, ok: 200, body: true, schema: 'Handover' },
    { name: 'handover.proxyReceipt',    method: 'POST', path: '/lifecycle/deliveries/{id}/handover/proxy-receipt', roles: S, ok: 200, body: true, schema: 'Handover' },
    { name: 'engagement.rate',     method: 'POST', path: '/lifecycle/ratings', roles: C, ok: 201, body: true, schema: 'Rating' },
    { name: 'engagement.points',   method: 'GET',  path: '/lifecycle/points', roles: C, ok: 200, schema: 'PointSummary' },
    { name: 'engagement.messages', method: 'GET',  path: '/lifecycle/threads/{id}/messages', roles: ALL4, ok: 200, query: true, schema: 'MessagePage' },
    { name: 'engagement.send',     method: 'POST', path: '/lifecycle/threads/{id}/messages', roles: ['customer', 'karmaster', 'shop'], ok: 201, body: true, schema: 'Message' },
    { name: 'notifications.list', method: 'GET',  path: '/lifecycle/notifications', roles: ALL4, ok: 200, query: true, schema: 'NotificationPage' },
    { name: 'notifications.read', method: 'POST', path: '/lifecycle/notifications/{id}/read', roles: ALL4, ok: 200, schema: 'Notification' },
    { name: 'admin.collectionStatus',   method: 'GET',  path: '/lifecycle/admin/collection-status', roles: A, ok: 200, query: true, schema: 'CollectionStatusPage' },
    { name: 'admin.recordSensitiveView', method: 'POST', path: '/lifecycle/admin/sensitive-views', roles: ['admin', 'karmaster', 'customer'], ok: 201, body: true, schema: 'SensitiveViewRecorded' },
  ];
  ops.forEach(o => {
    o.command = o.method !== 'GET';                       // 명령 = Idempotency-Key 필수
    o.pathParams = (o.path.match(/\{(\w+)\}/g) || []).map(s => s.slice(1, -1));
  });
  const byName = {}; ops.forEach(o => { byName[o.name] = o; });
  const api = { list: ops, byName };
  g.VLP = g.VLP || {};
  g.VLP.ops = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
