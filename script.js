(() => {
  const cfg = window.SS_CONFIG || {};

  // Defaults (make sure dur default is 10 unless overridden by URL)
  const DEFAULT_IMAGE_SECONDS = cfg.defaultDuration || 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs || 500, 10));

  document.documentElement.style.setProperty('--fade-ms', `${FADE_MS}ms`);
  document.documentElement.style.setProperty('--fit', cfg.objectFit || 'contain');
  document.documentElement.style.setProperty('--bg', cfg.bg || '#000');

  const statusEl = document.getElementById('status');

  const A = {
    wrap: document.getElementById('slideA'),
    img: document.getElementById('imgA'),
    vid: document.getElementById('vidA'),
    cap: document.getElementById('capA'),
  };
  const B = {
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
    if (statusEl) statusEl.textContent = msg;
  }

  function isActiveNow(it) {
    const now = new Date();
    const startOk = !it.start || (new Date(it.start) <= now);
    const endOk = !it.end || (now <= new Date(it.end));
    const enabled = it.enabled !== false;
    return enabled && startOk && endOk;
  }

  // Order: no-expiry first, then soonest-expiring → latest
  function sortItems(arr) {
    return arr.slice().sort((x, y) => {
      const xe = x.end ? new Date(x.end) : null;
      const ye = y.end ? new Date(y.end) : null;

      const xt = (x.title || '').toLowerCase();
      const yt = (y.title || '').toLowerCase();

      if (!xe && !ye) return xt.localeCompare(yt);
      if (!xe && ye) return -1;
      if (xe && !ye) return 1;

      const d = xe.getTime() - ye.getTime();
      if (d !== 0) return d;

      const xs = x.start ? new Date(x.start).getTime() : 0;
      const ys = y.start ? new Date(y.start).getTime() : 0;
      if (xs !== ys) return xs - ys;

      return xt.localeCompare(yt);
    });
  }

  function inferType(item) {
    const url = (item.url || '').toLowerCase().split('?')[0];
    if (/\.(mp4|webm|ogg|mov)$/i.test(url)) return 'video';
    return 'image';
  }

  async function fetchManifest() {
    const base = cfg.imagesManifest || 'images.json';
    const url = base + (base.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Manifest fetch failed: ' + res.status);
    const json = await res.json();
    return Array.isArray(json) ? json : (json.items || []);
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

  function hideMedia(target) {
    // Hide both, pause video
    target.img.classList.add('media-hidden');
    target.img.removeAttribute('src');

    try { target.vid.pause(); } catch {}
    target.vid.classList.add('media-hidden');
    target.vid.removeAttribute('src');
    target.vid.load?.();
  }

  async function prepareImage(target, item) {
    hideMedia(target);

    const src = item.url;
    target.img.classList.remove('media-hidden');

    // Preload + decode before showing
    const preload = new Image();
    preload.src = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();

    await new Promise((resolve, reject) => {
      preload.onload = resolve;
      preload.onerror = () => reject(new Error('Image load failed: ' + src));
    });

    // Set real element only after preload succeeded
    target.img.src = src;
    target.img.alt = item.alt || item.title || '';

    // decode() helps eliminate flash on some browsers
    if (target.img.decode) {
      try { await target.img.decode(); } catch {}
    }

    return src;
  }

  async function prepareVideo(target, item) {
    hideMedia(target);

    const src = item.url;
    target.vid.classList.remove('media-hidden');

    // Set source and wait until we can play a frame
    target.vid.src = src;
    target.vid.currentTime = 0;
    target.vid.muted = true;
    target.vid.playsInline = true;
    target.vid.loop = false;

    await new Promise((resolve, reject) => {
      const onCanPlay = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error('Video load failed: ' + src)); };
      const cleanup = () => {
        target.vid.removeEventListener('canplay', onCanPlay);
        target.vid.removeEventListener('error', onErr);
      };
      target.vid.addEventListener('canplay', onCanPlay, { once: true });
      target.vid.addEventListener('error', onErr, { once: true });
      target.vid.load();
    });

    // Start playback (muted autoplay usually OK in browsers and on players)
    try { await target.vid.play(); } catch {}

    return src;
  }

  function forceTransitionFrame(el) {
    // Ensure the browser “sees” opacity 0 before we add visible
    void el.offsetHeight;
  }

  async function crossfade(incoming, outgoing) {
    // Keep outgoing visible until fade completes
    incoming.wrap.style.zIndex = '2';
    outgoing.wrap.style.zIndex = '1';

    // Start incoming hidden, then fade in
    incoming.wrap.classList.remove('visible');
    forceTransitionFrame(incoming.wrap);

    incoming.wrap.classList.add('visible');
    incoming.wrap.setAttribute('aria-hidden', 'false');
    outgoing.wrap.setAttribute('aria-hidden', 'true');

    // After fade, hide outgoing & stop its video to prevent “ghost frame” flashes
    if (FADE_MS > 0) {
      await new Promise(r => setTimeout(r, FADE_MS));
    }
    outgoing.wrap.classList.remove('visible');

    // Important: only cleanup outgoing media AFTER fade completes
    try { outgoing.vid.pause(); } catch {}
    outgoing.vid.removeAttribute('src');
    outgoing.vid.load?.();
    outgoing.img.removeAttribute('src');
  }

  function scheduleNextForImage(item) {
    const sec = item.durationSeconds || DEFAULT_IMAGE_SECONDS;
    const ms = Math.max(1000, sec * 1000);
    clearTimeout(timer);
    timer = setTimeout(showNext, ms);
  }

  function scheduleNextForVideo(target, item) {
    clearTimeout(timer);

    // If naming convention overrides duration for a video, respect it
    if (item.durationSeconds) {
      timer = setTimeout(showNext, Math.max(1000, item.durationSeconds * 1000));
      return;
    }

    const v = target.vid;

    const startTimer = () => {
      const d = v.duration;
      if (!isFinite(d) || d <= 0.5) {
        timer = setTimeout(showNext, DEFAULT_IMAGE_SECONDS * 1000);
      } else {
        timer = setTimeout(showNext, d * 1000);
      }
    };

    if (isFinite(v.duration) && v.duration > 0.5) startTimer();
    else v.addEventListener('loadedmetadata', startTimer, { once: true });
  }

  async function showNext() {
    if (!items.length) return;
    clearTimeout(timer);

    idx = (idx + 1) % items.length;
    const item = items[idx];
    const kind = inferType(item);

    const incoming = usingA ? A : B;
    const outgoing = usingA ? B : A;

    try {
      setCaption(incoming, item);

      // Prepare media fully BEFORE any fade begins
      if (kind === 'video') {
        await prepareVideo(incoming, item);
      } else {
        await prepareImage(incoming, item);
      }

      // Now crossfade smoothly
      await crossfade(incoming, outgoing);

      // Schedule next
      usingA = !usingA;

      if (kind === 'video') scheduleNextForVideo(incoming, item);
      else scheduleNextForImage(item);

    } catch (e) {
      console.warn(e.message || e);
      logStatus('Skipped failed media');

      // Avoid rapid-fire loops when something fails
      clearTimeout(timer);
      timer = setTimeout(showNext, 800);
    }
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      items = sortItems(manifest.filter(isActiveNow));

      if (!items.length) {
        logStatus('No active items');
        A.wrap.classList.remove('visible');
        B.wrap.classList.remove('visible');
        hideMedia(A); hideMedia(B);
        return;
      }

      logStatus(`Loaded ${items.length} items`);
      idx = -1;
      usingA = true;

      // Clear both layers
      A.wrap.classList.remove('visible'); A.wrap.setAttribute('aria-hidden', 'true'); hideMedia(A);
      B.wrap.classList.remove('visible'); B.wrap.setAttribute('aria-hidden', 'true'); hideMedia(B);

      showNext();
    } catch (err) {
      console.error(err);
      logStatus('Manifest error');
    }
  }

  // Repoll manifest without hard-resetting the player mid-fade
  function scheduleRepoll() {
    const minutes = Math.max(1, cfg.refreshMinutes || 10);
    setInterval(() => loadAndStart(), minutes * 60 * 1000);
  }

  loadAndStart();
  scheduleRepoll();
})();
