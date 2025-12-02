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
    img:  document.getElementById('imgA'),
    vid:  document.getElementById('vidA'),
    cap:  document.getElementById('capA'),
  };
  const b = {
    wrap: document.getElementById('slideB'),
    img:  document.getElementById('imgB'),
    vid:  document.getElementById('vidB'),
    cap:  document.getElementById('capB'),
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
    const url  = base + (base.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    const res  = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Manifest fetch failed: ' + res.status);
    const json = await res.json();
    return Array.isArray(json) ? json : (json.items || []);
  }

  function isActiveNow(it) {
    const now = new Date();
    const startOk = !it.start || (new Date(it.start) <= now);
    const endOk   = !it.end   || (now <= new Date(it.end));
    const enabled = it.enabled !== false;
    return enabled && startOk && endOk;
  }

  // Sort:
  // 1) No end date → first, by title
  // 2) With end date → by end asc, then start asc, then title
  function sortItems(arr) {
    return arr.slice().sort((x, y) => {
      const xe = x.end ? new Date(x.end) : null;
      const ye = y.end ? new Date(y.end) : null;

      const xt = (x.title || '').toLowerCase();
      const yt = (y.title || '').toLowerCase();

      // Both have no end → sort by title
      if (!xe && !ye) {
        if (xt < yt) return -1;
        if (xt > yt) return 1;
        return 0;
      }

      // x has no end → x first
      if (!xe && ye) return -1;
      // y has no end → y first
      if (xe && !ye) return 1;

      // Both have end dates: soonest expiring first
      if (xe.getTime() !== ye.getTime()) {
        return xe.getTime() - ye.getTime();
      }

      // Tie-breaker: start date, then title
      const xs = x.start ? new Date(x.start) : null;
      const ys = y.start ? new Date(y.start) : null;

      if (xs && ys && xs.getTime() !== ys.getTime()) {
        return xs.getTime() - ys.getTime();
      }

      if (xt < yt) return -1;
      if (xt > yt) return 1;
      return 0;
    });
  }

  function inferType(item) {
    if (item.type === 'image' || item.type === 'video') return item.type;
    const url = (item.url || '').toLowerCase().split('?')[0];
    if (/\.(mp4|webm|ogg|mov)$/i.test(url)) return 'video';
    return 'image';
  }

  function resolveUrl(item) {
    return item.url;
  }

  function preloadItem(item) {
    const kind = inferType(item);
    const src  = resolveUrl(item);

    if (!src) {
      return Promise.reject(new Error('No URL for item'));
    }

    if (kind === 'image') {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload  = () => resolve(src);
        img.onerror = () => reject(new Error('Image load failed: ' + src));
        img.src     = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();
      });
    }

    // For video, we don't fully preload to avoid hammering the network.
    return Promise.resolve(src);
  }

  function showImage(target, item, src) {
    // Hide video
    try { target.vid.pause(); } catch (e) {}
    target.vid.classList.add('media-hidden');
    target.vid.removeAttribute('src');

    // Show image
    target.img.classList.remove('media-hidden');
    target.img.src = src;
    target.img.alt = item.alt || item.title || '';
  }

  function showVideo(target, item, src) {
    // Hide image
    target.img.classList.add('media-hidden');
    target.img.removeAttribute('src');

    // Show video
    target.vid.classList.remove('media-hidden');
    target.vid.src = src;
    target.vid.currentTime = 0;
    target.vid.muted = true;
    target.vid.loop = false;
    target.vid.playsInline = true;
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

  function scheduleForImage(item) {
    const durSec = item.durationSeconds || cfg.defaultDuration || 10;
    const durMs  = Math.max(1000, durSec * 1000);
    timer = setTimeout(showNext, durMs);
  }

  function scheduleForVideo(target, item) {
    const vid = target.vid;
    clearTimeout(timer);

    // If you ever encode a manual duration, this will respect it.
    if (item.durationSeconds) {
      const durMs = Math.max(1000, item.durationSeconds * 1000);
      timer = setTimeout(showNext, durMs);
      return;
    }

    function startTimerFromVideo() {
      if (!isFinite(vid.duration) || vid.duration <= 1) {
        // Fallback to default if duration missing
        const fallbackSec = cfg.defaultDuration || 10;
        timer = setTimeout(showNext, fallbackSec * 1000);
        return;
      }
      timer = setTimeout(showNext, vid.duration * 1000);
    }

    if (isFinite(vid.duration) && vid.duration > 1) {
      startTimerFromVideo();
    } else {
      const onMeta = () => {
        vid.removeEventListener('loadedmetadata', onMeta);
        startTimerFromVideo();
      };
      vid.addEventListener('loadedmetadata', onMeta);
    }
  }

  async function showNext() {
    if (!items.length) return;

    clearTimeout(timer);

    idx = (idx + 1) % items.length;
    const item = items[idx];
    const kind = inferType(item);
    const src  = resolveUrl(item);

    let loadedSrc;
    try {
      loadedSrc = await preloadItem(item);
    } catch (e) {
      console.warn(e.message || e);
      logStatus('Skipped failed media');
      if (items.length > 1) return showNext();
      return;
    }

    const incoming = usingA ? a : b;
    const outgoing = usingA ? b : a;

    if (kind === 'video') {
      showVideo(incoming, item, loadedSrc);
    } else {
      showImage(incoming, item, loadedSrc);
    }
    setCaption(incoming, item);

    // Crossfade layers
    incoming.wrap.classList.add('visible');
    incoming.wrap.setAttribute('aria-hidden', 'false');
    outgoing.wrap.classList.remove('visible');
    outgoing.wrap.setAttribute('aria-hidden', 'true');

    usingA = !usingA;

    // Schedule next slide
    if (kind === 'video') {
      scheduleForVideo(incoming, item);
    } else {
      scheduleForImage(item);
    }
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      const filtered = manifest.filter(isActiveNow);
      items = sortItems(filtered);

      if (!items.length) {
        logStatus('No active items in manifest');
        a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
        b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
        clearTimeout(timer);
        return;
      }

      logStatus('Loaded ' + items.length + ' items');
      idx = -1;
      usingA = true;
      clearTimeout(timer);

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
    const now  = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => location.reload(), ms);
  }

  // Kickoff
  loadAndStart();
  scheduleRepoll();
  scheduleHardReloadAtMidnight();
})();
