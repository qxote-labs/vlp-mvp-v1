/* sw.js — 서비스 워커 (PWA-04, 실행계획서 7.2)
 *  1) 앱 셸 캐시: 화면 HTML·CSS·JS·아이콘을 미리 캐시해 오프라인에서도 마지막 화면이 뜬다.
 *     같은 출처의 GET은 "네트워크 우선 -> 실패 시 캐시"라서 온라인에서는 항상 최신 파일을 쓴다(개발 중 오래된 파일에 속지 않는다).
 *  2) 조회 화면 캐시: /lifecycle/* GET 응답을 "마지막 상태"로 보관하고, 네트워크가 안 될 때 그 응답을
 *     X-VLP-From-Cache / X-VLP-Cached-At 헤더를 달아 돌려준다. 화면은 이 헤더로 "마지막 갱신 시각"을 보여준다.
 *     - 요청에 X-VLP-Scope(사용자 구분값)가 있을 때만 캐시한다. 다른 사용자의 응답이 섞이지 않게 키에 scope를 넣는다.
 *     - POST 등 명령은 절대 캐시·재생하지 않는다. 오프라인 쓰기는 IndexedDB 큐(PWA-18)가 맡는다.
 *     - 로그아웃 시 화면이 {type:'CLEAR_API_CACHE'}를 보내 조회 캐시를 비운다.
 */
const VERSION = 'v109';
const SHELL = 'vlp-shell-' + VERSION;
const API = 'vlp-api-' + VERSION;
const PRECACHE = [
  'index.html', 'app.html', 'manual.html', 'customer.html', 'karmaster.html', 'shop.html', 'admin.html', 'supervisor.html',
  'app.css', 'vlp-config.js', 'vlp-ops.js', 'status-map.js', 'api-facade.js', 'adapters/mock.js', 'adapters/http.js', 'vlp-boot.js',
  'vlp-rolebar.js', 'vlp-roles.js', 'app-entry.js', 'store.js', 'care-api.js', 'customer.js', 'karmaster.js', 'shop.js', 'admin.js',
  'push-link.js', 'vlp-screens.js', 'vlp-delivery.js', 'customer-care.js', 'customer-contracts.js', 'karmaster-contracts.js', 'admin-collection.js', 'upload-queue.js', 'vlp-chat.js', 'vlp-case.js', 'admin-console.js', 'admin-users.js', 'admin-conversations.js', 'vlp-capture.js', 'vlp-handover.js', 'shop-handover.js', 'shop-care.js',
  'manifest-app.webmanifest', 'manifest-customer.webmanifest', 'manifest-partner.webmanifest', 'manifest-admin.webmanifest',
  'icons/customer-192.png', 'icons/partner-192.png', 'icons/admin-192.png', 'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // 하나가 없다고 전체 설치가 실패하지 않도록 개별로 담는다
    await Promise.all(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, API];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('vlp-') && !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const t = event.data && event.data.type;
  if (t === 'CLEAR_API_CACHE') event.waitUntil(caches.delete(API));
  if (t === 'SKIP_WAITING') self.skipWaiting();
});

// ---- PWA-24 푸시 수신/클릭. 본문은 서버가 준 일반 문구만 보여 주고(계약 내용·토큰 없음), 눌렀을 때 딥링크로 연다.
//      제공자·서버가 정해지기 전에는 push 이벤트가 오지 않는다(설정 pushProvider/vapidPublicKey 비어 있음).
function safeUrl(u) { try { const x = new URL(u || 'index.html', self.registration.scope); return x.origin === self.location.origin ? x.href : new URL('index.html', self.registration.scope).href; } catch (e) { return new URL('index.html', self.registration.scope).href; } }
self.addEventListener('push', (event) => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const title = String(d.title || 'VLP 알림').slice(0, 60), body = String(d.body || '새 소식이 있어요').slice(0, 120);
  event.waitUntil(self.registration.showNotification(title, { body, tag: d.tag || 'vlp', data: { url: d.url || 'index.html' }, icon: 'icons/customer-192.png' }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = target.split('?')[0];
    const same = all.find((c) => c.url.split('?')[0] === page);
    if (same && same.navigate) { await same.navigate(target); return same.focus(); }
    return self.clients.openWindow(target);
  })());
});

const offlineJson = () => new Response(JSON.stringify({ code: 'VLP-OFFLINE', message: '오프라인이고 저장된 이전 상태가 없습니다' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

function apiCacheKey(url, scope) { const u = new URL(url); u.searchParams.set('__vlp_scope', scope); return new Request(u.toString()); }

async function handleApi(request) {
  const scope = request.headers.get('X-VLP-Scope');
  if (!scope) return fetch(request);                       // 사용자 구분이 없으면 캐시하지 않는다
  const key = apiCacheKey(request.url, scope);
  try {
    const res = await fetch(request);
    if (res.status === 200) {
      const body = await res.clone().arrayBuffer();
      const headers = new Headers(res.headers); headers.set('X-VLP-Cached-At', new Date().toISOString());
      const cache = await caches.open(API);
      await cache.put(key, new Response(body, { status: 200, headers }));
    }
    return res;
  } catch (err) {                                          // 네트워크 실패 -> 마지막 상태
    const cache = await caches.open(API);
    const hit = await cache.match(key);
    if (!hit) return offlineJson();
    const headers = new Headers(hit.headers); headers.set('X-VLP-From-Cache', '1');
    return new Response(await hit.arrayBuffer(), { status: 200, headers });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; }
    return new Response('오프라인입니다', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                        // 명령은 건드리지 않는다
  const url = new URL(req.url);
  if (url.pathname.startsWith('/lifecycle/')) { event.respondWith(handleApi(req)); return; }
  if (url.origin === self.location.origin) event.respondWith(networkFirst(req));
});
