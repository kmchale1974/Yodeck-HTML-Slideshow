// script.js (drop-in, cleaned + Pi-stability tweaks + fallback banner)
(() => {
  const cfg = window.SS_CONFIG || {};

  // ----------------------------
  // Config / Defaults
  // ----------------------------
  const DEFAULT_IMAGE_SECONDS = Number.isFinite(cfg.defaultDuration) ? cfg.defaultDuration : 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs ?? 500, 10));
  const REFRESH_MIN = Math.max(1, parseInt(cfg.refreshMinutes ?? 10, 10));

  // Start transition BEFORE video ends to hide last-frame freeze
  const VIDEO_OUTRO_LEAD_MS = Math.min(1400, Math.max(350, Math.floor(FADE_MS * 1.2)));

  // If video metadata/duration never becomes usable, advance anyway
  const VIDEO_FAILSAFE_MS = Math.max(2500, DEFAULT_IMAGE_SECONDS * 1000);

  // Give the video a moment to actually present frames before fading in
  const VIDEO_PREROLL_MS = Math.min(300, Math.max(80, Math.floor(FADE_MS * 0.4)));

  // Apply CSS vars used by style.css
  document.documentElement.style.setProperty("--fade-ms", `${FADE_MS}ms`);
  document.documentElement.style.setProperty("--fit", cfg.objectFit || "contain");
  document.documentElement.style.setProperty("--bg", cfg.bg || "#000");

  // Status: hidden unless error
  const statusEl = document.getElementById("status");
  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.display = msg ? "block" : "none";
  };
  setStatus("");

  const fallbackEl = document.getElementById("fallback");
  const showFallback = (show) => {
    if (!fallbackEl) return;
    fallbackEl.classList.toggle("hidden", !show);
  };

  // Cache-bust helper (use ONLY for manifest + image preload)
  function bust(url) {
    if (!url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_cb=${Date.now()}`;
  }

  const A = {
    wrap: document.getElementById("slideA"),
    img: document.getElementById("imgA"),
    vid: document.getElementById("vidA"),
    cap: document.getElementById("capA"),
  };
  const B = {
    wrap: document.getElementById("slideB"),
    img: document.getElementById("imgB"),
    vid: document.getElementById("vidB"),
    cap: document.getElementById("capB"),
  };

  let items = [];
  let idx = -1;
  let usingA = true;
  let timer = null;
  let repoll = null;

  // ----------------------------
  // Helpers
  // ----------------------------
  function isActiveNow(it) {
    const now = new Date();
    const enabled = it.enabled !== false;
    const startOk = !it.start || new Date(it.start) <= now;
    const endOk = !it.end || now <= new Date(it.end);
    return enabled && startOk && endOk;
  }

  // no-expiry first, then soonest expiring → latest, then start, then title
  function sortItems(arr) {
    return arr.slice().sort((x, y) => {
      const xe = x.end ? new Date(x.end) : null;
      const ye = y.end ? new Date(y.end) : null;

      const xt = (x.title || "").toLowerCase();
      const yt = (y.title || "").toLowerCase();

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
    const url = String(item.url || "").toLowerCase().split("?")[0];
    if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) return "video";
    return "image";
  }

  async function fetchManifest() {
    const base = cfg.imagesManifest || "images.json";
    const res = await fetch(bust(base), { cache: "no-store" });
    if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    return Array.isArray(json) ? json : (json.items || []);
  }

  function setCaption(target, item) {
    const text = item.caption || item.title || "";
    if (cfg.showCaptions && text) {
      target.cap.textContent = text;
      target.cap.classList.remove("hidden");
    } else {
      target.cap.textContent = "";
      target.cap.classList.add("hidden");
    }
  }

  function hideMedia(target) {
    // Image
    target.img.classList.add("media-hidden");
    target.img.removeAttribute("src");
    target.img.alt = "";

    // Video
    try { target.vid.pause(); } catch {}
    target.vid.classList.add("media-hidden");
    target.vid.removeAttribute("src");
    try { target.vid.load(); } catch {}
  }

  async function prepareImage(target, item) {
    hideMedia(target);

    const src = String(item.url || "");
    if (!src) throw new Error("Missing image url");

    // Preload with cache-bust, then set real src WITHOUT bust
    const preload = new Image();
    preload.src = bust(src);

    await new Promise((resolve, reject) => {
      preload.onload = resolve;
      preload.onerror = () => reject(new Error("Image load failed: " + src));
    });

    target.img.classList.remove("media-hidden");
    target.img.src = src;
    target.img.alt = item.alt || item.title || "";

    if (target.img.decode) {
      try { await target.img.decode(); } catch {}
    }
  }

  // Wait for a displayed frame (helps avoid "cut" into video)
  function waitForVideoFrame(v, timeoutMs = 900) {
    return new Promise((resolve) => {
      const start = Date.now();

      const tick = () => {
        if (v.videoWidth > 0 && v.readyState >= 2 && !v.paused) return resolve();
        if (Date.now() - start > timeoutMs) return resolve();
        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });
  }

  async function prepareVideo(target, item) {
    hideMedia(target);

    const src = String(item.url || "");
    if (!src) throw new Error("Missing video url");

    target.vid.classList.remove("media-hidden");
    target.vid.muted = true;
    target.vid.playsInline = true;
    target.vid.loop = false;
    target.vid.preload = "auto";

    // IMPORTANT: do NOT bust video URLs (Pi stability)
    target.vid.src = src;
    target.vid.currentTime = 0;

    await new Promise((resolve, reject) => {
      const onCanPlay = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error("Video load failed: " + src)); };
      const cleanup = () => {
        target.vid.removeEventListener("canplay", onCanPlay);
        target.vid.removeEventListener("error", onErr);
      };
      target.vid.addEventListener("canplay", onCanPlay, { once: true });
      target.vid.addEventListener("error", onErr, { once: true });
      target.vid.load();
    });

    // Start playback (muted autoplay)
    try { await target.vid.play(); } catch {}

    // Give it a moment to start presenting frames before we fade it in
    await waitForVideoFrame(target.vid, 900);
    if (VIDEO_PREROLL_MS > 0) await new Promise(r => setTimeout(r, VIDEO_PREROLL_MS));
  }

  function forceTransitionFrame(el) { void el.offsetHeight; }

  async function crossfade(incoming, outgoing) {
    incoming.wrap.style.zIndex = "2";
    outgoing.wrap.style.zIndex = "1";

    // Start incoming hidden, then fade in
    incoming.wrap.classList.remove("visible");
    forceTransitionFrame(incoming.wrap);

    incoming.wrap.classList.add("visible");
    incoming.wrap.setAttribute("aria-hidden", "false");
    outgoing.wrap.setAttribute("aria-hidden", "true");

    if (FADE_MS > 0) await new Promise(r => setTimeout(r, FADE_MS));

    // Now hide outgoing and clean it up AFTER fade completes
    outgoing.wrap.classList.remove("visible");

    try { outgoing.vid.pause(); } catch {}
    outgoing.vid.removeAttribute("src");
    try { outgoing.vid.load(); } catch {}
    outgoing.img.removeAttribute("src");
  }

  function scheduleNextForImage(item) {
    const sec = Number.isFinite(item.durationSeconds) ? item.durationSeconds : DEFAULT_IMAGE_SECONDS;
    const ms = Math.max(1000, sec * 1000);
    clearTimeout(timer);
    timer = setTimeout(showNext, ms);
  }

  // VIDEO: fire when remaining time <= lead (timeupdate), not at ended
  function scheduleNextForVideo(target, item) {
    clearTimeout(timer);

    const v = target.vid;
    let fired = false;

    const fireOnce = () => {
      if (fired) return;
      fired = true;
      cleanup();
      showNext();
    };

    const onEnded = () => fireOnce();
    const leadSec = VIDEO_OUTRO_LEAD_MS / 1000;

    const onTimeUpdate = () => {
      const d = v.duration;
      if (!isFinite(d) || d <= 0.5) return;

      const remaining = d - v.currentTime;
      if (remaining <= leadSec) fireOnce();
    };

    const onMeta = () => {
      const d = v.duration;
      if (isFinite(d) && d > 0.5) {
        const ms = Math.max(800, Math.floor(d * 1000) - VIDEO_OUTRO_LEAD_MS);
        timer = setTimeout(fireOnce, ms);
      } else {
        timer = setTimeout(fireOnce, VIDEO_FAILSAFE_MS);
      }
    };

    // ✅ cleanup DOES NOT clear the global timer (prevents races)
    const cleanup = () => {
      try { v.removeEventListener("timeupdate", onTimeUpdate); } catch {}
      try { v.removeEventListener("ended", onEnded); } catch {}
      try { v.removeEventListener("error", onEnded); } catch {}
      try { v.removeEventListener("loadedmetadata", onMeta); } catch {}
    };

    // Respect explicit duration override if present
    if (Number.isFinite(item.durationSeconds) && item.durationSeconds > 0) {
      timer = setTimeout(fireOnce, Math.max(1000, item.durationSeconds * 1000));
      // Absolute failsafe anyway
      setTimeout(fireOnce, Math.floor(VIDEO_FAILSAFE_MS * 1.5));
      return;
    }

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded, { once: true });
    v.addEventListener("error", onEnded, { once: true });
    v.addEventListener("loadedmetadata", onMeta, { once: true });

    // If metadata already loaded, schedule immediately; otherwise fallback
    if (isFinite(v.duration) && v.duration > 0.5) onMeta();
    else timer = setTimeout(fireOnce, VIDEO_FAILSAFE_MS);

    // ✅ True failsafe regardless of metadata weirdness
    setTimeout(fireOnce, Math.floor(VIDEO_FAILSAFE_MS * 1.5));
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
      setStatus(""); // hide error banner
      setCaption(incoming, item);

      // Prepare media first (avoid flash/cut), then fade
      if (kind === "video") await prepareVideo(incoming, item);
      else await prepareImage(incoming, item);

      await crossfade(incoming, outgoing);

      usingA = !usingA;

      if (kind === "video") scheduleNextForVideo(incoming, item);
      else scheduleNextForImage(item);

    } catch (e) {
      console.warn(e);
      setStatus(`Media error: ${e?.message || String(e)}`);
      clearTimeout(timer);
      timer = setTimeout(showNext, 800);
    }
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      items = sortItems(manifest.filter(isActiveNow));

      // Reset state
      idx = -1;
      usingA = true;

      // Clear both layers
      A.wrap.classList.remove("visible"); A.wrap.setAttribute("aria-hidden", "true"); hideMedia(A);
      B.wrap.classList.remove("visible"); B.wrap.setAttribute("aria-hidden", "true"); hideMedia(B);

      if (!items.length) {
        showFallback(true);
        return;
      }

      showFallback(false);
      showNext();
    } catch (err) {
      console.error(err);
      showFallback(true);
      setStatus("Manifest error: " + (err?.message || String(err)));
    }
  }

  function scheduleRepoll() {
    if (repoll) clearInterval(repoll);
    repoll = setInterval(loadAndStart, REFRESH_MIN * 60 * 1000);
  }

  // Go
  loadAndStart();
  scheduleRepoll();
})();
