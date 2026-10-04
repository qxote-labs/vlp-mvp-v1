// 미가입 카마스터 확인번호(PIN)·세션·자동 연결·휴면·정식 가입 복원, 그리고 앱 안 알림 규칙.
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, setup, IDS } = require('./_helpers');

const code = async (p) => { try { await p; return null; } catch (e) { return e.status + ':' + e.code + (e.details && e.details.subcode ? ':' + e.details.subcode : ''); } };
const NF = '404:VLP-RES-404', VAL = '422:VLP-VAL-422';
const PIN = '246810';
const DAY = 86400e3;
const reg = (t, no, who) => t.as(who || 'cust').contracts.create({ manufacturerContractNo: no, vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
const claim = (t, token, extra) => t.as('kmNew').access.claim(Object.assign({ phone: IDS.kmNew.phone, claimToken: token, pin: PIN, pinConfirm: PIN }, extra));

test('claim: 확인번호 형식·처음 정할 때 재입력이 필요하다 (조회번호는 소모되지 않는다)', async () => {
  const t = setup(); const c = await reg(t, 'A-1');
  assert.equal(await code(claim(t, c.claimToken, { pin: '12', pinConfirm: '12' })), VAL + ':PIN_FORMAT');
  assert.equal(await code(claim(t, c.claimToken, { pinConfirm: '111111' })), VAL + ':PIN_SETUP_CONFIRM');
  assert.equal(await code(t.as('kmNew').access.claim({ phone: IDS.kmNew.phone, claimToken: c.claimToken })), VAL + ':PIN_FORMAT'); // pin 없음
  const g = await claim(t, c.claimToken);
  assert.equal(g.status, 'ACTIVE'); assert.ok(g.sessionToken);
});

test('계정이 생기면 세션 토큰이 없는 요청은 401, 남의 세션 토큰도 401', async () => {
  const t = setup(); const c = await reg(t, 'A-2'); await claim(t, c.claimToken);
  const bare = Object.assign({}, IDS.kmNew); // 고정 토큰(세션 아님)
  t.f.session.set(bare);
  assert.equal(await code(t.f.contracts.list()), '401:VLP-AUTH-401');
  t.f.session.set(Object.assign({}, bare, { token: 'x'.repeat(48) }));
  assert.equal(await code(t.f.contracts.get(c.contractId)), '401:VLP-AUTH-401');
  assert.equal((await t.as('kmNew').contracts.get(c.contractId)).masked, true);   // 올바른 세션이면 열린다
  // 같은 세션 토큰을 다른 전화번호 신원에 붙여도 거부
  const other = { userId: 'km-x', role: 'karmaster', phone: '010-7777-7777', token: t.sess[IDS.kmNew.userId] };
  t.f.session.set(other);
  assert.notEqual(await code(t.f.contracts.get(c.contractId)), null);
});

test('이미 정한 확인번호가 틀리면 claim 거부(404)이고 시도 횟수에 합산된다', async () => {
  const t = setup({ config: { claimMaxAttempts: 3 } }); const c = await reg(t, 'A-3'); await claim(t, c.claimToken);
  const c2 = await reg(t, 'A-3b', 'cust2'); // 이미 계정이 있으므로 자동 연결 -> 조회번호 없음
  assert.equal(c2.claimToken, null);
  // 다른 사람이 확인번호를 모르면서 claim 시도 (조회번호가 필요한 건이 없으니 어떤 값이든 실패)
  for (let i = 0; i < 3; i++) assert.equal(await code(claim(t, '1234567' + i, { pin: '000000', pinConfirm: undefined })), NF);
  assert.equal(await code(t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN })), '429:VLP-RATE-429'); // 잠금 공유
  t.admin.advanceTime(16 * 60e3);
  assert.ok((await t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN })).sessionToken);
});

test('확인번호 로그인: 맞으면 새 세션, 틀리면 404, 계정이 없으면 404', async () => {
  const t = setup(); const c = await reg(t, 'A-4'); await claim(t, c.claimToken);
  assert.equal(await code(t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: '999999' })), NF);
  const s = await t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN });
  assert.ok(s.sessionToken && s.expiresAt);
  const t2 = setup();
  assert.equal(await code(t2.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN })), NF);
});

test('확인된 카마스터는 이후 고객의 계약이 조회번호 없이 자동 연결되고 알림을 받는다', async () => {
  const t = setup(); const c = await reg(t, 'B-1'); await claim(t, c.claimToken);
  const c2 = await reg(t, 'B-2', 'cust2');
  assert.equal(c2.claimToken, null); assert.equal(c2.carmasterMatched, true); assert.equal(c2.grantId, null);
  const view = await t.as('kmNew').contracts.get(c2.contractId);
  assert.equal(view.masked, true);                                                  // 승인 전 마스킹은 동일
  const n = await t.as('kmNew').notifications.list();
  assert.ok(n.items.some(x => /새 계약/.test(x.text)) && n.unreadCount >= 1);
});

test('미가입(조회번호 전) 카마스터에게는 앱 알림이 가지 않고, 고객에게는 승인·거절 알림이 간다', async () => {
  const t = setup(); const c = await reg(t, 'C-1');
  assert.equal(t.admin.state().notifications.filter(n => n.toRole === 'karmaster').length, 0);
  await claim(t, c.claimToken);
  await t.as('kmNew').contracts.reject(c.contractId, { reasonCode: 'WRONG_INFO' });
  const mine = await t.as('cust').notifications.list();
  assert.ok(mine.items.some(x => /승인하지 않았습니다/.test(x.text)));
  assert.equal((await t.as('cust2').notifications.list()).items.length, 0);       // 남의 알림은 보이지 않는다
  const id = mine.items[0].notificationId;
  assert.equal(await code(t.as('cust2').notifications.read(id)), NF);
  const r = await t.as('cust').notifications.read(id); assert.equal(r.read, true);
  assert.equal((await t.as('cust').notifications.list({ unread: true })).items.some(x => x.notificationId === id), false);
});

test('미확인 리마인드와 만료 임박 알림은 설정 시간에 한 번씩만 쌓인다', async () => {
  const t = setup(); await reg(t, 'D-1');
  t.admin.advanceTime(25 * 3600e3);
  let n = await t.as('cust').notifications.list();
  assert.equal(n.items.filter(x => /아직 확인하지 않았어요/.test(x.text)).length, 1);
  t.admin.advanceTime(1 * 3600e3);
  await t.as('cust').notifications.list();
  t.admin.advanceTime(20 * 3600e3);                                              // 만료 6시간 전(42시간째) 이후
  n = await t.as('cust').notifications.list();
  assert.equal(n.items.filter(x => /곧 만료/.test(x.text)).length, 1);
  assert.equal(n.items.filter(x => /아직 확인하지 않았어요/.test(x.text)).length, 1);
});

test('휴면: 마지막 계약 종료 후 유예 기간이 지나면 접근 불가, 진행 중 계약이 있으면 유지된다', async () => {
  const t = setup({ config: { unregisteredGraceDays: 30 } });
  const c = await reg(t, 'E-1'); await claim(t, c.claimToken);
  t.admin.advanceTime(40 * DAY);                                                 // 승인 대기(만료 전)까지는 진행 중 -> 먼저 만료시킨다
  // 48시간 만료 후 유예 30일: 만료 시점(+2일) + 30일 = 32일째 이후
  assert.equal(await code(t.as('kmNew').contracts.list()), '401:VLP-AUTH-401');  // 이미 휴면 -> 세션 없음
  assert.match(await code(t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN })), /^409/);
});

test('유예 기간 안에서는 접근이 유지되고, 진행 중 계약이 있으면 휴면이 되지 않는다', async () => {
  const t = setup(); const c = await reg(t, 'E-2'); await claim(t, c.claimToken);
  await t.as('kmNew').contracts.approve(c.contractId, { destinationType: 'DEALERSHIP' });  // 승인됨(인도 미종결) = 진행 중
  t.admin.advanceTime(200 * DAY);
  assert.equal(await code(t.as('kmNew').contracts.list()), '401:VLP-AUTH-401');   // 세션(12시간)은 만료 -> 다시 로그인
  await t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN });
  assert.equal((await t.as('kmNew').contracts.list()).items.length, 1);           // 진행 중 계약이 있어 오래돼도 휴면 아님
  const t2 = setup(); const d = await reg(t2, 'E-3'); await claim(t2, d.claimToken);
  await t2.as('kmNew').contracts.reject(d.contractId, { reasonCode: 'OTHER' });
  t2.admin.advanceTime(29 * DAY);
  await t2.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN });
  assert.equal((await t2.as('kmNew').contracts.list()).items.length, 1);          // 유예 중
  t2.admin.advanceTime(2 * DAY);
  assert.equal(await code(t2.as('kmNew').contracts.list()), '401:VLP-AUTH-401');  // 31일째: 휴면
});

test('휴면 뒤 새 조회번호로 돌아오면 새 계약만 보이고, 정식 가입하면 옛 기록이 돌아온다', async () => {
  const t = setup(); const old = await reg(t, 'F-1'); await claim(t, old.claimToken);
  await t.as('kmNew').contracts.reject(old.contractId, { reasonCode: 'OTHER' });
  t.admin.advanceTime(40 * DAY);
  const fresh = await reg(t, 'F-2', 'cust2');
  assert.ok(fresh.claimToken, '휴면이면 자동 연결하지 않고 조회번호를 발급한다');
  assert.equal(await code(claim(t, fresh.claimToken, { pinConfirm: '000000' })), VAL + ':PIN_SETUP_CONFIRM');  // 새로 정하므로 재입력 필요
  await claim(t, fresh.claimToken, { pin: '135790', pinConfirm: '135790' });
  const ids = (await t.as('kmNew').contracts.list()).items.map(x => x.contractId);
  assert.deepEqual(ids, [fresh.contractId]);                                       // 옛 기록은 안 보인다
  assert.equal(await code(t.as('kmNew').contracts.get(old.contractId)), NF);
  assert.equal(await code(t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN })), NF);               // 옛 확인번호는 폐기됨
  // 정식 가입(본인 확인 완료 가정)
  t.admin.registerKarmaster(IDS.kmNew.phone, '미가입', '울산');
  const km = Object.assign({}, IDS.kmNew); t.f.session.set(km);                   // 가입 카마스터는 별도 세션 없이 기존 방식
  const all = (await t.f.contracts.list()).items.map(x => x.contractId).sort();
  assert.deepEqual(all, [old.contractId, fresh.contractId].sort());                // 옛 기록 복원
});

test('확인번호·세션 토큰·조회번호 평문은 저장소·이벤트·알림 어디에도 없다', async () => {
  const t = setup(); const c = await reg(t, 'G-1'); const g = await claim(t, c.claimToken);
  await t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: PIN });
  const dump = JSON.stringify([t.admin.state(), t.admin.events(), t.admin.notifications(), t.storage._m]);
  for (const secret of [PIN, g.sessionToken, c.claimToken]) assert.ok(!dump.includes(secret), '평문 존재: ' + secret.length + '자');
});
