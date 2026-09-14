// script.js (Pi-stable playback: image fades, video cuts, non-disruptive manifest refresh)
(() => {
  const cfg = window.SS_CONFIG || {};

  const DEFAULT_IMAGE_SECONDS = Number.isFinite(cfg.defaultDuration) ? cfg.defaultDuration : 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs ?? 500, 10));
  const TRANSITION_MODE = String(cfg.transitionMode || "smart").toLowerCase(); // smart | fade | cut
  const REFRESH_MIN = Math.max(1, parseInt(cfg.refreshMinutes ?? 10, 10));
  const VIDEO_FAILSAFE_MS = Math.max(5000, DEFAULT_IMAGE_SECONDS * 1000);
  const VIDEO_PREROLL_MS = 120;

  document.documentElement.style.setProperty("--fade-ms", `${FADE_MS}ms`);
  document.documentElement.style.setProperty("--fit", cfg.objectFit || "contain");
  document.documentElement.style.setProperty("--bg", cfg.bg || "#000");

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
  let pendingItems = null;
  let idx = -1;
  let usingA = true;
  let timer = null;
  let repoll = null;
  let activeUrl = null;

  function isActiveNow(it) {
    const now = new Date();
    const enabled = it.enabled !== false;
    const startOk = !it.start || new Date(it.start) <= now;
    const endOk = !it.end || now <= new Date(it.end);
    return enabled && startOk && endOk;
  }

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

  function normalizedActiveItems(manifest) {
    return sortItems(manifest.filter(isActiveNow));
  }

  function playlistSignature(list) {
    return JSON.stringify(list.map(it => ({
      url: it.url || "",
      start: it.start || "",
      end: it.end || "",
      durationSeconds: Number.isFinite(it.durationSeconds) ? it.durationSeconds : null,
      enabled: it.enabled !== false,
      title: it.title || ""
    })));
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

  function releaseVideo(v) {
    try { v.pause(); } catch {}
    v.classList.remove("media-pending");
    v.classList.add("media-hidden");
    v.removeAttribute("src");
    try { v.load(); } catch {}
  }

  function hideMedia(target) {
    target.img.classList.add("media-hidden");
    target.img.removeAttribute("src");
    target.img.alt = "";
    releaseVideo(target.vid);
  }

  async function prepareImage(target, item) {
    hideMedia(target);

    const src = String(item.url || "");
    if (!src) throw new Error("Missing image url");

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
    target.vid.classList.add("media-pending");
    target.vid.muted = true;
    target.vid.playsInline = true;
    target.vid.loop = false;
    target.vid.preload = "auto";
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

    try { await target.vid.play(); } catch {}
    await waitForVideoFrame(target.vid, 900);
    await new Promise(r => setTimeout(r, VIDEO_PREROLL_MS));
    target.vid.classList.remove("media-pending");
  }

  function forceTransitionFrame(el) { void el.offsetHeight; }

  function transitionMsFor(kind, previousKind) {
    if (TRANSITION_MODE === "cut") return 0;
    if (kind === "image" && previousKind === "image") return FADE_MS;
    return 0;
  }

  async function crossfade(incoming, outgoing, ms) {
    incoming.wrap.style.zIndex = "2";
    outgoing.wrap.style.zIndex = "1";

    incoming.wrap.classList.remove("visible");
    forceTransitionFrame(incoming.wrap);

    incoming.wrap.style.transitionDuration = `${ms}ms`;
    outgoing.wrap.style.transitionDuration = `${ms}ms`;
    incoming.wrap.classList.add("visible");
    incoming.wrap.setAttribute("aria-hidden", "false");
    outgoing.wrap.setAttribute("aria-hidden", "true");

    if (ms > 0) await new Promise(r => setTimeout(r, ms));

    outgoing.wrap.classList.remove("visible");
    hideMedia(outgoing);
  }

  function scheduleNextForImage(item) {
    const sec = Number.isFinite(item.durationSeconds) ? item.durationSeconds : DEFAULT_IMAGE_SECONDS;
    clearTimeout(timer);
    timer = setTimeout(showNext, Math.max(1000, sec * 1000));
  }

  function scheduleNextForVideo(target, item) {
    clearTimeout(timer);

    const v = target.vid;
    let fired = false;
    let failsafeTimer = null;

    const cleanup = () => {
      try { v.removeEventListener("ended", fireOnce); } catch {}
      try { v.removeEventListener("error", fireOnce); } catch {}
      if (failsafeTimer) clearTimeout(failsafeTimer);
      failsafeTimer = null;
    };

    const fireOnce = () => {
      if (fired) return;
      fired = true;
      cleanup();
      clearTimeout(timer);
      timer = null;

      // For Pi stability, never hold or fade a completed video frame.
      // Drop to black, release the decoder, then prepare the next item.
      target.wrap.classList.remove("visible");
      target.wrap.setAttribute("aria-hidden", "true");
      releaseVideo(v);
      showNext();
    };

    v.addEventListener("ended", fireOnce, { once: true });
    v.addEventListener("error", fireOnce, { once: true });

    if (Number.isFinite(item.durationSeconds) && item.durationSeconds > 0) {
      timer = setTimeout(fireOnce, Math.max(1000, item.durationSeconds * 1000));
    }

    const durationMs = isFinite(v.duration) && v.duration > 0.5
      ? Math.ceil(v.duration * 1000) + 1500
      : VIDEO_FAILSAFE_MS;

    failsafeTimer = setTimeout(fireOnce, Math.max(VIDEO_FAILSAFE_MS, durationMs));
  }

  function applyPendingPlaylist() {
    if (!pendingItems) return true;

    const next = pendingItems;
    pendingItems = null;

    if (!next.length) {
      items = [];
      idx = -1;
      activeUrl = null;
      A.wrap.classList.remove("visible"); A.wrap.setAttribute("aria-hidden", "true"); hideMedia(A);
      B.wrap.classList.remove("visible"); B.wrap.setAttribute("aria-hidden", "true"); hideMedia(B);
      showFallback(true);
      return false;
    }

    const currentIndex = activeUrl
      ? next.findIndex(it => String(it.url || "") === activeUrl)
      : -1;

    items = next;
    idx = currentIndex;
    showFallback(false);
    return true;
  }

  async function showNext() {
    clearTimeout(timer);
    timer = null;

    if (!applyPendingPlaylist()) return;
    if (!items.length) return;

    idx = (idx + 1) % items.length;
    const item = items[idx];
    const kind = inferType(item);
    const previousItem = idx === 0 ? items[items.length - 1] : items[idx - 1];
    const previousKind = previousItem ? inferType(previousItem) : "image";

    const incoming = usingA ? A : B;
    const outgoing = usingA ? B : A;

    try {
      setStatus("");
      setCaption(incoming, item);

      if (kind === "video") await prepareVideo(incoming, item);
      else await prepareImage(incoming, item);

      await crossfade(incoming, outgoing, transitionMsFor(kind, previousKind));

      activeUrl = String(item.url || "");
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
      items = normalizedActiveItems(manifest);
      pendingItems = null;
      idx = -1;
      usingA = true;
      activeUrl = null;

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

  async function repollManifest() {
    try {
      const manifest = await fetchManifest();
      const next = normalizedActiveItems(manifest);
      const baseline = pendingItems || items;

      if (playlistSignature(next) !== playlistSignature(baseline)) {
        // Do not tear down the current slide/video. Apply the new playlist
        // cleanly at the next normal slide boundary.
        pendingItems = next;
      }
    } catch (err) {
      console.warn("Manifest refresh failed:", err);
    }
  }

  function scheduleRepoll() {
    if (repoll) clearInterval(repoll);
    repoll = setInterval(repollManifest, REFRESH_MIN * 60 * 1000);
  }

  loadAndStart();
  scheduleRepoll();
})();
