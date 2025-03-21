const CACHE_NAME = "pwa-cache-v1.0.2";
const urlsToCache = ["/", "/index.html", "/images/pwa-icon-512x512.png"];

// 安裝 Service Worker 並快取靜態資源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 逐個快取資源，即使其中某些失敗也不影響其他的
      return Promise.all(
        urlsToCache.map((url) => {
          return cache.add(url).catch((error) => {
            console.error(`Failed to cache: ${url}`, error);
            // 繼續執行，不中斷整個過程
          });
        })
      );
    })
  );
});

// 攔截請求，回應快取內容
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// 更新快取（當 Service Worker 更新時）
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cache) => cache !== CACHE_NAME)
          .map((cache) => caches.delete(cache))
      );
    })
  );
});
