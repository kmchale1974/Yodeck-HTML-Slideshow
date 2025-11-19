(() => {
  const cfg = window.SS_CONFIG || {};
  // Apply runtime CSS vars
  document.documentElement.style.setProperty('--fade-ms', String(cfg.transitionMs || 800));
  document.documentElement.style.setProperty('--fit', cfg.objectFit || 'contain');
  document.documentElement.style.setProperty('--bg', cfg.bg || '#000000');
  document.documentElement.style.setProperty('--caption-bg', cfg.captionBg || 'rgba(0,0,0,0.4)');
  document.documentElement.style.setProperty('--caption-color', cfg.captionColor || '#ffffff');

  const statusEl = document.getElementById('status');
  const a = { wrap: document.getElementById('slideA'), img: document.getElementById('imgA'), cap: document.getElementById('capA') };
  const b = { wrap: document.getElementById('slideB'), img: document.getElementById('imgB'), cap: document.getElementById('capB') };

  let items = [];
  let idx = -1;
  let usingA = true;
  let timer = null;

  function logStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
  }

  // Normalize manifest URLs to real repo paths
  function resolveUrl(url) {
    if (!url) return '';
    // Absolute URL: use as-is
    if (/^https?:\/\//i.test(url)) return url;

    // Already a full repo-relative path (Admin/RAEC/Rec variants)
    if (url.startsWith('_Yodeck-HTML-Slideshow_')) return url;

    // Strip leading slashes
    url = url.replace(/^\/+/, '');

    // If manifest says "images/..." or just "foo.png", assume Admin images folder
    if (!url.startsWith('images/')) {
      // If it's just a filename like "foo.png", pretend it's "images/foo.png"
      if (!url.includes('/')) {
        url = 'images/' + url;
      }
    }

    // Final Admin path
    return '_Yodeck-HTML-Slideshow_Admin/' + url;
  }

  async function fetchManifest() {
    const url = cfg.imagesManifest;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Manifest fetch failed: ' + res.status);
    const json = await res.json();
    return Array.isArray(json) ? json : (json.items || []);
  }

  function isActiveNow(it) {
    const now = new Date();
    const startOk = !it.start || (new Date(it.start) <= now);
    const endOk = !it.end || (now <= new Date(it.end));
    const enabled = it.enabled !== false;
    return enabled && startOk && endOk;
  }

  function sortItems(arr) {
    // Priority: explicit order, then end date, then title, then URL for stable order
    return arr.slice().sort((x, y) => {
      const xo = (typeof x.order === 'number') ? x.order : Number.MAX_SAFE_INTEGER;
      const yo = (typeof y.order === 'number') ? y.order : Number.MAX_SAFE_INTEGER;
      if (xo !== yo) return xo - yo;

      const xe = x.end ? new Date(x.end).getTime() : Number.MAX_SAFE_INTEGER;
      const ye = y.end ? new Date(y.end).getTime() : Number.MAX_SAFE_INTEGER;
      if (xe !== ye) return xe - ye;

      const xt = (x.title || '').toLowerCase();
      const yt = (y.title || '').toLowerCase();
      if (xt !== yt) return xt < yt ? -1 : 1;

      return (x.url || '').localeCompare(y.url || '');
    });
  }

  function preload(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => reject(new Error('Image load failed: ' + src));
      img.src = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    });
  }

  function setSlide(target, item, src) {
    target.img.src = src;
    target.img.alt = item.alt || item.title || '';
    if (cfg.showCaptions && (item.caption || item.title)) {
      target.cap.textContent = item.caption || item.title;
      target.cap.classList.remove('hidden');
    } else {
      target.cap.textContent = '';
      target.cap.classList.add('hidden');
    }
  }

  async function showNext() {
    if (!items.length) return;
    idx = (idx + 1) % items.length;
    const item = items[idx];

    const src = resolveUrl(item.url);

    try {
      await preload(src);
    } catch (e) {
      console.warn(e.message);
      logStatus('Skipped failed image: ' + (item.title || item.url || ''));

      // Back off a bit and move on to the next slide instead of tight looping
      clearTimeout(timer);
      timer = setTimeout(showNext, Math.max(1000, (cfg.defaultDuration || 5) * 1000));
      return;
    }

    const incoming = usingA ? a : b;
    const outgoing = usingA ? b : a;

    setSlide(incoming, item, src);

    // Crossfade
    incoming.wrap.classList.add('visible');
    incoming.wrap.setAttribute('aria-hidden', 'false');
    outgoing.wrap.classList.remove('visible');
    outgoing.wrap.setAttribute('aria-hidden', 'true');

    usingA = !usingA;

    const durMs = Math.max(1000, (item.durationSeconds || cfg.defaultDuration || 8) * 1000);
    clearTimeout(timer);
    timer = setTimeout(showNext, durMs);
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      const filtered = manifest.filter(isActiveNow);
      items = sortItems(filtered);
      if (!items.length) {
        logStatus('No active images in manifest');
        return;
      }
      logStatus('Loaded ' + items.length + ' images');
      idx = -1; usingA = true;
      // Ensure initial visibility state
      a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
      b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
      showNext();
    } catch (err) {
      console.error(err);
      logStatus('Manifest error');
    }
  }

  function scheduleHardReloadAtMidnight() {
    if (!cfg.hardReloadAtMidnight) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0); // next local midnight
    const ms = next.getTime() - now.getTime();
    setTimeout(() => location.reload(), ms);
  }

  // Kickoff
  loadAndStart();
  // No in-page repoll; rely on Yodeck reloads or manual refresh
  scheduleHardReloadAtMidnight();
})();
