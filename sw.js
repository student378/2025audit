// Service Worker — 감사 지적사항 현황판 v3
const CACHE_NAME = 'audit-v3';
const CORE = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN  = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// ── 설치: 핵심 파일만 반드시 캐싱, CDN은 실패해도 무시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE))
      .then(() => caches.open(CACHE_NAME)
        .then(cache => Promise.allSettled(CDN.map(url => cache.add(url)))))
  );
  self.skipWaiting();
});

// ── 활성화: 구버전 캐시 전체 삭제
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── fetch: 캐시 우선 → 네트워크 → 오프라인 폴백
self.addEventListener('fetch', e => {
  // POST, chrome-extension 등 제외
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
