/* نُور المُصحف — ورش عن نافع | Service Worker v6
   يحذف تلقائيًا كل ذاكرات النسخ القديمة (حفص) عند التفعيل. */
const VER = 'v6';
const SHELL = `noor-warsh-shell-${VER}`;
const DATA  = `noor-warsh-data-${VER}`;
const MEDIA = `noor-warsh-media-${VER}`;
const KEEP  = [SHELL, DATA, MEDIA, 'noor-warsh-full-v3'];
const SHELL_ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

const DATA_HOSTS  = ['quran-json.risanb.com', 'quran-json.risan.workers.dev', 'api.alquran.cloud', 'cdn.jsdelivr.net', 'raw.githubusercontent.com'];
const MEDIA_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const isMediaHost = h => MEDIA_HOSTS.includes(h);
const isAudioHost = h => /^server\d+\.mp3quran\.net$/.test(h);
const isDataHost  = h => DATA_HOSTS.includes(h) || h === 'mp3quran.net' || h === 'www.mp3quran.net';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache, max = 90) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* الصوت: اتركه للمتصفح مباشرة حتى يستخدم HTTP Range والبث التدريجي.
     لا نخزّن ملفات MP3 ولا نحولها إلى تنزيل كامل داخل Service Worker. */
  if (isAudioHost(url.hostname)) return;

  /* الخطوط فقط: يمكن تخزينها مؤقتًا دون التأثير على بث الصوت. */
  if (isMediaHost(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(req);
      if (hit) {
        if (req.headers.has('range')) {
          if (hit.type !== 'opaque') return rangeResponse(req, hit);
          return fetch(req).catch(() => hit);
        }
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(req, res.clone());
          trim(cache);
        }
        return res;
      } catch (_) {
        return new Response(null, { status: 504 });
      }
    })());
    return;
  }

  /* واجهات البيانات (نص ورش + قائمة القرّاء): ذاكرة فورية + تحديث بالخلفية */
  if (isDataHost(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => {
        if (r && r.ok) cache.put(req, r.clone());
        return r;
      }).catch(() => null);
      return hit || (await net) || new Response('{"error":"offline"}', {
        status: 503, headers: { 'Content-Type': 'application/json' }
      });
    })());
    return;
  }

  /* غلاف التطبيق */
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cp = res.clone();
        caches.open(SHELL).then(c => c.put(req, cp));
        return res;
      } catch (_) {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate')
          return (await caches.match('./index.html')) || (await caches.match('./'));
        return new Response(null, { status: 504 });
      }
    })());
  }
});