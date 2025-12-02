(() => {
  const cfg = window.SS_CONFIG || {};
  // Apply runtime CSS vars
  document.documentElement.style.setProperty('--fade-ms', String(cfg.transitionMs));
  document.documentElement.style.setProperty('--fit', cfg.objectFit);
  document.documentElement.style.setProperty('--bg', cfg.bg);
  document.documentElement.style.setProperty('--caption-bg', cfg.captionBg);
  document.documentElement.style.setProperty('--caption-color', cfg.captionColor);

  const statusEl = document.getElementById('status');

  const a = {
    wrap: document.getElementById('slideA'),
    img: document.getElementById('imgA'),
    vid: document.getElementById('vidA'),
    cap: document.getElementById('capA'),
  };
  const b = {
    wrap: document.getElementById('slideB'),
    img: document.getElementById('imgB'),
    vid: document.getElementById('vidB'),
    cap: document.getElementById('capB'),
  };

  let items = [];
  let idx = -1;
  let usingA = true;
  let timer = null;

  function logStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
  }

  async function fetchManifest() {
    const base = cfg.imagesManifest || 'images.json';
    const url = base + (base.includes('?') ? '&' : '?') + '_cb=' + Date.now();
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
    return arr.slice().sort((x, y) => {
      const xo = typeof x.order === 'number' ? x.order : Number.MAX_SAFE_INTEGER;
      const yo = typeof y.order === 'number' ? y.order : Number.MAX_SAFE_INTEGER;
      if (xo !== yo) return xo - yo;
      const xt = (x.title || '').toLowerCase();
      const yt = (y.title || '').toLowerCase();
      if (xt !== yt) return xt < yt ? -1 : 1;
      return (x.url || '').localeCompare(y.url || '');
    });
  }

  // --- media helpers --------------------------------------------------------

  function inferType(item) {
    if (item.type === 'image' || item.type === 'video') return item.type;
    const url = (item.url || '').toLowerCase().split('?')[0];
    if (/\.(mp4|webm|ogg|mov)$/i.test(url)) return 'video';
    return 'image';
  }

  function resolveUrl(item) {
    // Manifest already has a usable path (relative or absolute); use as-is.
    return item.url;
  }

  function preloadItem(item) {
    const kind = inferType(item);
    const src = resolveUrl(item);

    if (!src) {
      return Promise.reject(new Error('No URL for item'));
    }

    // For images, we preload with Image()
    if (kind === 'image') {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(src);
        img.onerror = () => reject(new Error('Image load failed: ' + src));
        img.src = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();
      });
    }

    // For video, we don't aggressively preload to avoid hammering bandwidth;
    // just trust the <video> element to buffer when we switch.
    return Promise.resolve(src);
  }

  function showImage(target, item, src) {
    target.vid.pause();
    target.vid.removeAttribute('src');
    target.vid.classList.add('media-hidden');

    target.img.classList.remove('media-hidden');
    target.img.src = src;
    target.img.alt = item.alt || item.title || '';
  }

  function showVideo(target, item, src) {
    target.img.classList.add('media-hidden');
    target.img.removeAttribute('src');

    target.vid.classList.remove('media-hidden');
    target.vid.src = src;
    target.vid.currentTime = 0;
    target.vid.muted = true;
    target.vid.loop = false;
    target.vid.playsInline = true;
    // Start playback; ignore failures (autoplay policies etc. — Yodeck should allow)
    target.vid.play().catch(() => {});
  }

  function setCaption(target, item) {
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
    const kind = inferType(item);
    const src = resolveUrl(item);

    try {
      await preloadItem(item);
    } catch (e) {
      console.warn(e.message || e);
      logStatus('Skipped failed media');
      // Avoid infinite recursion when everything is broken
      if (items.length > 1) return showNext();
      return;
    }

    const incoming = usingA ? a : b;
    const outgoing = usingA ? b : a;

    if (kind === 'video') {
      showVideo(incoming, item, src);
    } else {
      showImage(incoming, item, src);
    }
    setCaption(incoming, item);

    // Crossfade wrappers
    incoming.wrap.classList.add('visible');
    incoming.wrap.setAttribute('aria-hidden', 'false');
    outgoing.wrap.classList.remove('visible');
    outgoing.wrap.setAttribute('aria-hidden', 'true');

    usingA = !usingA;

    // Determine how long to keep this slide up
    let durSec = item.durationSeconds || cfg.defaultDuration;

    // If it's a video and no explicit duration given, use the video duration if we can
    if (kind === 'video' && !item.durationSeconds) {
      const v = incoming.vid;
      const d = v && isFinite(v.duration) ? v.duration : NaN;
      if (!isNaN(d) && d > 1) {
        durSec = d;
      }
    }

    const durMs = Math.max(1000, durSec * 1000);
    clearTimeout(timer);
    timer = setTimeout(showNext, durMs);
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      const filtered = manifest.filter(isActiveNow);
      items = sortItems(filtered);
      if (!items.length) {
        logStatus('No active items in manifest');
        // Hide both slides
        a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
        b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
        return;
      }
      logStatus('Loaded ' + items.length + ' items');
      idx = -1;
      usingA = true;
      a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
      b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
      showNext();
    } catch (err) {
      console.error(err);
      logStatus('Manifest error');
    }
  }

  function scheduleRepoll() {
    const minutes = Math.max(1, cfg.refreshMinutes || 10);
    setInterval(() => {
      loadAndStart();
    }, minutes * 60 * 1000);
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
  scheduleRepoll();
  scheduleHardReloadAtMidnight();
})();
