(() => {
  const cfg = window.SS_CONFIG || {};

  // Defaults
  const DEFAULT_IMAGE_SECONDS = cfg.defaultDuration || 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs || 500, 10));
  const VIDEO_START_TIMEOUT_MS = 2500; // grace period for Pi/Chromium to actually start video

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

  // Cache-bust helper (works for relative URLs too)
  function bust(url) {
    const u = new URL(url, location.href);
    u.searchParams.set('_cb', Date.now().toString());
    return u.toString();
  }

  async function fetchManifest() {
    const base = cfg.imagesManifest || 'images.json';
    const url = bust(base);
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
    target.img.classList.add('media-hidden');
    target.img.removeAttribute('src');

    try { target.vid.pause(); } catch {}
    target.vid.classList.add('media-hidden');
    target.vid.removeAttribute('src');
    target.vid.load?.();
  }

  async function prepareImage(target, item) {
    hideMedia(target);

    const rawSrc = item.url;
    const src = bust(rawSrc);

    target.img.classList.remove('media-hidden');

    // Preload + decode before showing
    const preload = new Image();
    preload.src = src;

    await new Promise((resolve, reject) => {
      preload.onload = resolve;
      preload.onerror = () => reject(new Error('Image load failed: ' + rawSrc));
    });

    // Set real element (also cache-busted)
    target.img.src = src;
    target.img.alt = item.alt || item.title || '';

    if (target.img.decode) {
      try { await target.img.decode(); } catch {}
    }

    return src;
  }

  function waitForVideoStart(v, timeoutMs) {
    // We want "actually playing", not just canplay.
    return new Promise((resolve, reject) => {
      let done = false;
      let lastT = -1;

      const cleanup = () => {
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('error', onError);
        clearInterval(poll);
        clearTimeout(to);
      };

      const finishOk = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const finishErr = (msg) => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error(msg));
      };

      const onPlaying = () => finishOk();
      const onError = () => finishErr('Video error event');

      v.addEventListener('playing', onPlaying, { once: true });
      v.addEventListener('error', onError, { once: true });

      // Poll: some builds don’t reliably emit 'playing'
      const poll = setInterval(() => {
        if (v.readyState >= 2 && !v.paused) {
          // If time advances, we’re truly playing
          const t = v.currentTime || 0;
          if (lastT >= 0 && t > lastT + 0.01) finishOk();
          lastT = t;
        }
      }, 150);

      const to = setTimeout(() => finishErr('Video did not start within timeout'), timeoutMs);
    });
  }

  async function prepareVideo(target, item) {
    hideMedia(target);

    const src = item.url;

    // Cache-bust video the same way we do for image preloads
    const busted = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();

    target.vid.classList.remove('media-hidden');

    const busted = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    target.vid.src = busted;
    target.vid.currentTime = 0;
    target.vid.muted = true;
    target.vid.playsInline = true;
    target.vid.loop = false;

    await new Promise((resolve, reject) => {
      const onCanPlay = () => { cleanup(); resolve(); };
      const onErr = () => {
        const err = target.vid.error ? `${target.vid.error.code}` : 'unknown';
        cleanup();
        reject(new Error('Video load failed (' + err + '): ' + src));
      };
      const cleanup = () => {
        target.vid.removeEventListener('canplay', onCanPlay);
        target.vid.removeEventListener('error', onErr);
      };
      target.vid.addEventListener('canplay', onCanPlay, { once: true });
      target.vid.addEventListener('error', onErr, { once: true });
      target.vid.load();
    });

    try { await target.vid.play(); } catch {}

    return src;
  }

  function forceTransitionFrame(el) {
    void el.offsetHeight;
  }

  async function crossfade(incoming, outgoing) {
    incoming.wrap.style.zIndex = '2';
    outgoing.wrap.style.zIndex = '1';

    incoming.wrap.classList.remove('visible');
    forceTransitionFrame(incoming.wrap);

    incoming.wrap.classList.add('visible');
    incoming.wrap.setAttribute('aria-hidden', 'false');
    outgoing.wrap.setAttribute('aria-hidden', 'true');

    if (FADE_MS > 0) {
      await new Promise(r => setTimeout(r, FADE_MS));
    }
    outgoing.wrap.classList.remove('visible');

    // Cleanup outgoing after fade completes
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

      // Prepare fully BEFORE fade
      if (kind === 'video') {
        await prepareVideo(incoming, item);
      } else {
        await prepareImage(incoming, item);
      }

      await crossfade(incoming, outgoing);

      usingA = !usingA;

      if (kind === 'video') scheduleNextForVideo(incoming, item);
      else scheduleNextForImage(item);

    } catch (e) {
      console.warn(e.message || e);
      logStatus('Skipped failed media');

      // Make sure we don't get stuck showing a black video element
      try { incoming.vid.pause(); } catch {}
      incoming.vid.classList.add('media-hidden');
      incoming.vid.removeAttribute('src');
      incoming.vid.load?.();

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

      A.wrap.classList.remove('visible'); A.wrap.setAttribute('aria-hidden', 'true'); hideMedia(A);
      B.wrap.classList.remove('visible'); B.wrap.setAttribute('aria-hidden', 'true'); hideMedia(B);

      showNext();
    } catch (err) {
      console.error(err);
      logStatus('Manifest error');
    }
  }

  function scheduleRepoll() {
    const minutes = Math.max(1, cfg.refreshMinutes || 10);
    setInterval(() => loadAndStart(), minutes * 60 * 1000);
  }

  loadAndStart();
  scheduleRepoll();
})();
