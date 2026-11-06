// Service Worker standar Blip PWA
const CACHE_NAME = 'blip-cache-v2';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // JANGAN PERNAH cegat request API atau WebSocket
    if (event.request.url.includes('/api/') || event.request.url.includes(':8088') || event.request.url.includes('/app/')) {
        return;
    }

    // Hanya tangani GET untuk aset statis dengan bypass error
    if (event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
    }
});
