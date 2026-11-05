// Service Worker standar Blip PWA
const CACHE_NAME = 'blip-cache-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Network first strategy
    if (event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
    }
});
