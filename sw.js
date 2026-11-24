/* نُور المُصحف — ورش عن نافع | Service Worker v3
   يحذف تلقائيًا كل ذاكرات النسخ القديمة (حفص) عند التفعيل. */
const VER = 'v3';
const SHELL = `noor-warsh-shell-${VER}`;
const DATA  = `noor-warsh-data-${VER}`;
const MEDIA = `noor-warsh-media-${VER}`;
const KEEP  = [SHELL, DATA, MEDIA, 'noor-warsh-full-v1'];
const SHELL_ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

const DATA_HOSTS  = ['api.alquran.cloud', 'cdn.jsdelivr.net', 'raw.githubusercontent.com'];
const MEDIA_HOSTS = ['everyayah.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const isMediaHost = h => MEDIA_HOSTS.includes(h) || /^server\d+\.mp3quran\.net$/.test(h);
const isDataHost  = h => DATA_HOSTS.includes(h) || (h === 'mp3quran.net');

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

async function rangeResponse(req, res) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return res;
  const buf = await res.clone().arrayBuffer();
  const total = buf.byteLength;
  if (!total) return res;
  const start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (isNaN(start) || start >= total)
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  end = Math.min(end, total - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206, statusText: 'Partial Content',
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* ملفات الصوت والخطوط: من الذاكرة أولًا + دعم التقديم/الترجيع */
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