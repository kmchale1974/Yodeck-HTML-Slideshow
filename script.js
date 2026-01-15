(() => {
  const cfg = window.SS_CONFIG || {};

  // Defaults
  const DEFAULT_IMAGE_SECONDS = Number.isFinite(cfg.defaultDuration) ? cfg.defaultDuration : 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs ?? 500, 10));
  const REFRESH_MIN = Math.max(1, parseInt(cfg.refreshMinutes ?? 10, 10));

  // Apply CSS vars (optional, safe)
  document.documentElement.style.setProperty("--fade-ms", `${FADE_MS}ms`);
  document.documentElement.style.setProperty("--fit", cfg.objectFit || "contain");
  document.documentElement.style.setProperty("--bg", cfg.bg || "#000");

  const statusEl = document.getElementById("status");

  function logStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

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

  function isActiveNow(it) {
    const now = new Date();
    const enabled = it.enabled !== false;

    const startOk = !it.start || new Date(it.start) <= now;
    const endOk = !it.end || now <= new Date(it.end);

    return enabled && startOk && endOk;
  }

  // Order: no-expiry first, then soonest-expiring -> latest, then start, then title
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

    // Preload + decode before we show it
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

  async function prepareVideo(target, item) {
    hideMedia(target);

    const src = String(item.url || "");
    if (!src) throw new Error("Missing video url");

    target.vid.classList.remove("media-hidden");
    target.vid.muted = true;
    target.vid.playsInline = true;
    target.vid.loop = false;
    target.vid.preload = "auto";

    // IMPORTANT: set src, then load, then wait for canplay
    target.vid.src = bust(src);
    target.vid.currentTime = 0;

    await new Promise((resolve, reject) => {
      const onCanPlay = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error("Video load failed: " + src)); };
      const cleanup = () => {
        target.vid.removeEventListener("canplay", onCanPlay);
        target.vid.removeEventListener("error", onErr);
      };
      target.vid.addEventListener("canplay", onCanPlay);
      target.vid.addEventListener("error", onErr);
      target.vid.load();
    });

    // Start playback (muted autoplay allowed in most kiosk contexts)
    try { await target.vid.play(); } catch {}
  }

  function forceTransitionFrame(el) {
    // Force browser to apply initial state before transition
    void el.offsetHeight;
  }

  async function crossfade(incoming, outgoing) {
    // stacking order
    incoming.wrap.style.zIndex = "2";
    outgoing.wrap.style.zIndex = "1";

    // start incoming hidden
    incoming.wrap.classList.remove("visible");
    forceTransitionFrame(incoming.wrap);

    // fade in
    incoming.wrap.classList.add("visible");
    incoming.wrap.setAttribute("aria-hidden", "false");
    outgoing.wrap.setAttribute("aria-hidden", "true");

    // wait fade duration
    if (FADE_MS > 0) await new Promise(r => setTimeout(r, FADE_MS));

    // hide outgoing
    outgoing.wrap.classList.remove("visible");

    // cleanup outgoing media to prevent ghost frames
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

  function scheduleNextForVideo(target, item) {
    clearTimeout(timer);

    // Respect explicit duration override if present
    if (Number.isFinite(item.durationSeconds) && item.durationSeconds > 0) {
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
    else v.addEventListener("loadedmetadata", startTimer, { once: true });
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

      // Prepare the media completely before fading
      if (kind === "video") await prepareVideo(incoming, item);
      else await prepareImage(incoming, item);

      // Crossfade
      await crossfade(incoming, outgoing);

      // Flip buffer
      usingA = !usingA;

      // Schedule next
      if (kind === "video") scheduleNextForVideo(incoming, item);
      else scheduleNextForImage(item);

      logStatus(`Loaded ${items.length} items • showing ${idx + 1}/${items.length}`);

    } catch (e) {
      console.warn(e);
      logStatus(`Skipped failed media:\n${e?.message || String(e)}`);
      clearTimeout(timer);
      timer = setTimeout(showNext, 800);
    }
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      const active = manifest.filter(isActiveNow);
      items = sortItems(active);

      // Reset state
      idx = -1;
      usingA = true;

      // Clear both layers
      A.wrap.classList.remove("visible"); A.wrap.setAttribute("aria-hidden", "true"); hideMedia(A);
      B.wrap.classList.remove("visible"); B.wrap.setAttribute("aria-hidden", "true"); hideMedia(B);

      if (!items.length) {
        logStatus("No active items");
        return;
      }

      logStatus(`Loaded ${items.length} items`);
      showNext();

    } catch (err) {
      console.error(err);
      logStatus(
        "Manifest error:\n" +
        (err?.message || String(err)) +
        "\n\nmanifest=" + (cfg.imagesManifest || "images.json")
      );
    }
  }

  function scheduleRepoll() {
    if (repoll) clearInterval(repoll);
    repoll = setInterval(() => {
      // Repoll without forcing a hard crash; if it fails, slideshow keeps current cycle
      loadAndStart();
    }, REFRESH_MIN * 60 * 1000);
  }

  // Go
  logStatus("Loading…");
  loadAndStart();
  scheduleRepoll();
})();
