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
    cap:  document.getElementById('capA')
  };
  const b = {
    wrap: document.getElementById('slideB'),
    img:  document.getElementById('imgB'),
    vid:  document.getElementById('vidB'),
    cap:  document.getElementById('capB')
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
    // Supports either array or {items:[...]}
    return Array.isArray(json) ? json : (json.items || []);
  }

  function isActiveNow(it) {
    const now = new Date();
    const startOk = !it.start || (new Date(it.start) <= now);
    const endOk   = !it.end   || (now <= new Date(it.end));
    const enabled = it.enabled !== false;
    return enabled && startOk && endOk;
  }

  function sortItems(arr) {
    return arr.slice().sort((x, y) => {
      const xo = (typeof x.order === 'number') ? x.order : Number.MAX_SAFE_INTEGER;
      const yo = (typeof y.order === 'number') ? y.order : Number.MAX_SAFE_INTEGER;
      if (xo !== yo) return xo - yo;
      const xt = (x.title || '').toLowerCase();
      const yt = (y.title || '').toLowerCase();
      if (xt !== yt) return xt < yt ? -1 : 1;
      return (x.url || '').localeCompare(y.url || '');
    });
  }

  function isVideoItem(item) {
    const url = (item.url || '').toLowerCase();
    return url.endsWith('.mp4') || url.endsWith('.mov') || url.endsWith('.webm');
  }

  function addCacheBuster(url) {
    if (!url) return '';
    return url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
  }

  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(src);
      img.onerror = () => reject(new Error('Image load failed: ' + src));
      img.src = addCacheBuster(src);
    });
  }

  // For video we don't aggressively preload to avoid hammering the Pi / network.
  // We just ensure the URL is non-empty and let it start loading when shown.
  function preloadItem(item) {
    const src = item.url;
    if (!src) return Promise.reject(new Error('Missing url'));
    if (isVideoItem(item)) {
      // Could do more advanced video buffering, but this is enough for signage.
      return Promise.resolve(src);
    }
    return preloadImage(src);
  }

  function setSlide(target, item) {
    const isVideo = isVideoItem(item);
    const captionText = item.caption || item.title || '';

    if (isVideo) {
      // Hide image, show video
      target.img.classList.add('media-hidden');
      target.img.src = '';
      target.vid.classList.remove('media-hidden');
      target.vid.src = addCacheBuster(item.url);
      target.vid.currentTime = 0;
      // Autoplay, muted, loop are in markup; just kick it
      target.vid.play().catch(() => {});
    } else {
      // Hide video, show image
      try {
        target.vid.pause();
      } catch (e) {}
      target.vid.classList.add('media-hidden');
      target.vid.src = '';
      target.img.classList.remove('media-hidden');
      target.img.src = addCacheBuster(item.url);
      target.img.alt = item.alt || item.title || '';
    }

    if (cfg.showCaptions && captionText) {
      target.cap.textContent = captionText;
      target.cap.classList.remove('hidden');
    } else {
      target.cap.textContent = '';
      target.cap.classList.add('hidden');
    }
  }

  function pauseSlideMedia(target) {
    try {
      if (target.vid && !target.vid.classList.contains('media-hidden')) {
        target.vid.pause();
      }
    } catch (e) {}
  }

  async function showNext() {
    if (!items.length) return;

    idx = (idx + 1) % items.length;
    const item = items[idx];

    try {
      await preloadItem(item);
    } catch (e) {
      console.warn(e.message || e);
      logStatus('Skipped failed media');
      return showNext();
    }

    const incoming = usingA ? a : b;
    const outgoing = usingA ? b : a;

    setSlide(incoming, item);

    // Crossfade: fade in incoming, fade out outgoing
    incoming.wrap.classList.add('visible');
    incoming.wrap.setAttribute('aria-hidden', 'false');
    outgoing.wrap.classList.remove('visible');
    outgoing.wrap.setAttribute('aria-hidden', 'true');

    // Pause any video on outgoing slide to save resources
    pauseSlideMedia(outgoing);

    usingA = !usingA;

    const durMs = Math.max(
      1000,
      (item.durationSeconds || cfg.defaultDuration) * 1000
    );

    clearTimeout(timer);
    timer = setTimeout(showNext, durMs);
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      const filtered = manifest.filter(isActiveNow);
      items = sortItems(filtered);

      if (!items.length) {
        logStatus('No active media in manifest');
        // Hide both slides
        a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
        b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
        return;
      }

      logStatus('Loaded ' + items.length + ' items');
      idx = -1; usingA = true;

      // Ensure initial visibility
      a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
      b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
      pauseSlideMedia(a);
      pauseSlideMedia(b);

      showNext();
    } catch (err) {
      console.error(err);
      logStatus('Manifest error');
    }
  }

  function scheduleRepoll() {
    const mins = Math.max(1, cfg.refreshMinutes || 10);
    setInterval(() => {
      loadAndStart();
    }, mins * 60 * 1000);
  }

  function scheduleHardReloadAtMidnight() {
    if (!cfg.hardReloadAtMidnight) return;
    const now = new Date();
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
