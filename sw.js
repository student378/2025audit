// Service Worker — 감사 지적사항 현황판
// ⚠️ 배포할 때마다 아래 버전 문자열을 반드시 올리세요 (v8, v9, ...)
const CACHE_NAME = 'audit-v8';

// 오프라인 폴백 및 아이콘 등 자주 안 바뀌는 자산만 캐시 우선으로 미리 저장
const CORE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './og-image.png',
];
const CDN = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// ── 설치: 핵심 파일 캐싱 (CDN 실패는 무시)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE))
      .then(() => caches.open(CACHE_NAME)
        .then(cache => Promise.allSettled(CDN.map(url => cache.add(url)))))
  );
  self.skipWaiting();
});

// ── 활성화: 구버전 캐시 전체 삭제 + 열려 있는 탭도 즉시 새 워커가 제어
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHtmlRequest(request) {
  return request.mode === 'navigate' ||
         (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  // ── HTML 문서: 네트워크 우선 → 실패 시에만 캐시 (버전 번호를 잊어도 항상 최신 반영)
  if (isHtmlRequest(req)) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // ── 그 외 정적 자산(이미지·폰트·JS 등): 캐시 우선, 백그라운드로 최신본 갱신
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
