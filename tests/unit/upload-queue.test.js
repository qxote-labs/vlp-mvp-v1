// PWA-18: 연결이 끊겨도 사진이 사라지지 않고, 복구되면 장당 정확히 한 번만 등록된다(응답 유실 포함).
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, setup, toReleased, toArrived, IDS } = require('./_helpers');

async function arrivedDelivery(t, o) { const ids = await toReleased(t, o || { proxy: true }); toArrived(t, ids); return ids; }
const photo = (n) => 'data:image/jpeg;base64,' + Buffer.from('fake-photo-' + n).toString('base64');
const shots = () => VLP.config.get('requiredShotSlots');

test('연결 끊김: 3장 촬영 → 대기, 복구 후 3장 모두 한 번씩만 등록', async () => {
  const t = setup(); const ids = await arrivedDelivery(t);
  t.as('shop');
  const q = VLP.uploadQueue.create({ api: t.f, store: VLP.uploadQueue.memStore(), retryMs: 3600000, autoRun: false });
  t.adapter.admin.setOffline(true);
  for (let i = 0; i < 3; i++) await q.enqueue({ deliveryId: ids.deliveryId, purpose: 'REQUIRED_SHOT', slot: shots()[i], blob: photo(i), contentType: 'image/jpeg' });
  await q.run();
  let items = await q.list();
  assert.equal(items.length, 3); assert.ok(items.every(x => x.state === 'QUEUED') && /연결/.test(items[0].lastError));
  assert.equal(t.admin.state().media.length, 0, '오프라인인데 서버에 등록됨');
  t.adapter.admin.setOffline(false);
  await q.run();
  items = await q.list();
  assert.ok(items.every(x => x.state === 'DONE'), JSON.stringify(items.map(x => x.state)));
  const media = t.admin.state().media;
  assert.equal(media.length, 3); assert.ok(media.every(m => m.status === 'PUBLISHED'));
  assert.deepEqual(media.map(m => m.slot).sort(), shots().slice(0, 3).sort());
  assert.ok(items.every(x => x.blob == null), '완료 후 사진 본문이 기기에 남음');
});

test('응답 유실: 서버는 처리했는데 응답이 사라져도 같은 키로 다시 보내 중복 없이 완료', async () => {
  const t = setup(); const ids = await arrivedDelivery(t);
  t.as('shop');
  const q = VLP.uploadQueue.create({ api: t.f, store: VLP.uploadQueue.memStore(), retryMs: 3600000, autoRun: false });
  for (let i = 0; i < 3; i++) await q.enqueue({ deliveryId: ids.deliveryId, purpose: 'REQUIRED_SHOT', slot: shots()[i], blob: photo(i), contentType: 'image/jpeg' });
  // 단계마다 응답을 잃는다: 장당 init/complete 응답 유실을 번갈아 겪게 한다
  for (let round = 0; round < 12; round++) { t.adapter.admin.dropResponses(1); await q.run(); }
  t.adapter.admin.dropResponses(0); await q.run();
  const items = await q.list();
  assert.ok(items.every(x => x.state === 'DONE'), JSON.stringify(items.map(x => [x.state, x.lastError])));
  const media = t.admin.state().media;
  assert.equal(media.length, 3, '중복 등록: ' + media.length);
  assert.equal(new Set(media.map(m => m.slot)).size, 3);
  assert.equal(t.admin.state().events.filter(e => e.eventType === 'MediaPublished').length, 3, 'MediaPublished가 장당 1회가 아님');
});

test('4xx는 재시도하지 않고 실패로 남긴다, 다른 사람의 항목은 올리지 않는다', async () => {
  const t = setup(); const ids = await arrivedDelivery(t);
  t.as('shop');
  const q = VLP.uploadQueue.create({ api: t.f, store: VLP.uploadQueue.memStore(), retryMs: 3600000, autoRun: false });
  await q.enqueue({ deliveryId: ids.deliveryId, purpose: 'REQUIRED_SHOT', slot: 'NOT_A_SLOT', blob: photo(9), contentType: 'image/jpeg' });
  await q.run();
  let items = await q.list(); assert.equal(items[0].state, 'FAILED'); assert.equal(items[0].attempts, 1);
  await q.run(); items = await q.list(); assert.equal(items[0].attempts, 1, '실패 항목을 다시 시도함');
  // 소유자가 다르면 건드리지 않는다
  await q.enqueue({ deliveryId: ids.deliveryId, purpose: 'OTHER', blob: photo(1), contentType: 'image/jpeg' });
  t.adapter.admin.setOffline(true); await q.run(); t.adapter.admin.setOffline(false);
  t.as('km'); await q.run();
  assert.equal(t.admin.state().media.length, 0, '다른 사용자 세션으로 올림');
  t.as('shop'); await q.run();
  assert.equal(t.admin.state().media.length, 1);
});

test('이어올리기: 본문 업로드 단계에서 끊겨도 init을 다시 만들지 않는다', async () => {
  const t = setup(); const ids = await arrivedDelivery(t);
  t.as('shop');
  const q = VLP.uploadQueue.create({ api: t.f, store: VLP.uploadQueue.memStore(), retryMs: 3600000, autoRun: false });
  const orig = t.f.upload; let n = 0; t.f.upload = async (...a) => { if (n++ === 0) { const e = new Error('끊김'); e.network = true; throw e; } return orig(...a); };
  await q.enqueue({ deliveryId: ids.deliveryId, purpose: 'OTHER', blob: photo(5), contentType: 'image/jpeg' });
  await q.run(); await q.run();
  const it = (await q.list())[0]; assert.equal(it.state, 'DONE'); assert.equal(n, 2, '본문 업로드 시도 횟수');
  assert.equal(t.log.filter(l => l.op === 'media.init').length, 1, 'init을 다시 보냄');
  assert.equal(t.admin.state().media.length, 1);
});
