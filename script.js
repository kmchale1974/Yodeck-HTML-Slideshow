(() => {
  const cfg = window.SS_CONFIG || {};

  // Defaults
  const DEFAULT_IMAGE_SECONDS = Number.isFinite(cfg.defaultDuration) ? cfg.defaultDuration : 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs ?? 500, 10));
  const REFRESH_MIN = Math.max(1, parseInt(cfg.refreshMinutes ?? 10, 10));

  // ✅ TIGHTER VIDEO OUTRO:
  // Start transition BEFORE the last-frame freeze becomes visible.
  // Tune this if needed: higher = starts earlier (hides freeze better).
  const VIDEO_OUTRO_LEAD_MS = Math.min(1400, Math.max(350, Math.floor(FADE_MS * 1.2)));

  // Failsafe if duration never becomes usable
  const VIDEO_FAILSAFE_MS = Math.max(2500, DEFAULT_IMAGE_SECONDS * 1000);

  // Apply CSS vars
  document.documentElement.style.setProperty("--fade-ms", `${FADE_MS}ms`);
  document.documentElement.style.setProperty("--fit", cfg.objectFit || "contain");
  document.documentElement.style.setProperty("--bg", cfg.bg || "#000");

  const statusEl = document.getElementById("status");
  function logStatus(msg) { if (statusEl) statusEl.textContent = msg || ""; }

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
    target.img.classList.add("media-hidden");
    target.img.removeAttribute("src");
    target.img.alt = "";

    try { target.vid.pause(); } catch {}
    target.vid.classList.add("media-hidden");
    target.vid.removeAttribute("src");
    try { target.vid.load(); } catch {}
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

  async function prepareVideo(target, item) {
    hideMedia(target);

    const src = String(item.url || "");
    if (!src) throw new Error("Missing video url");

    target.vid.classList.remove("media-hidden");
    target.vid.muted = true;
    target.vid.playsInline = true;
    target.vid.loop = false;
    target.vid.preload = "auto";

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

    try { await target.vid.play(); } catch {}
  }

  function forceTransitionFrame(el) { void el.offsetHeight; }

  async function crossfade(incoming, outgoing) {
    incoming.wrap.style.zIndex = "2";
    outgoing.wrap.style.zIndex = "1";

    incoming.wrap.classList.remove("visible");
    forceTransitionFrame(incoming.wrap);

    incoming.wrap.classList.add("visible");
    incoming.wrap.setAttribute("aria-hidden", "false");
    outgoing.wrap.setAttribute("aria-hidden", "true");

    if (FADE_MS > 0) await new Promise(r => setTimeout(r, FADE_MS));

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

  // ✅ VIDEO: fire when remaining time <= lead (timeupdate), not at ended
  function scheduleNextForVideo(target, item) {
    clearTimeout(timer);

    const v = target.vid;
    let fired = false;

    const cleanup = () => {
      try { v.removeEventListener("timeupdate", onTimeUpdate); } catch {}
      try { v.removeEventListener("ended", onEnded); } catch {}
      try { v.removeEventListener("error", onEnded); } catch {}
      try { v.removeEventListener("loadedmetadata", onMeta); } catch {}
    };

    const fireOnce = () => {
      if (fired) return;
      fired = true;
      cleanup();
      showNext();
    };

    const onEnded = () => fireOnce();

    const leadSec = VIDEO_OUTRO_LEAD_MS / 1000;

    const onTimeUpdate = () => {
      // Need usable duration and currentTime
      const d = v.duration;
      if (!isFinite(d) || d <= 0.5) return;

      const remaining = d - v.currentTime;
      if (remaining <= leadSec) fireOnce();
    };

    const onMeta = () => {
      // Once metadata exists, timeupdate will do the early trigger.
      // But also set an absolute timeout as a safety net.
      const d = v.duration;
      if (isFinite(d) && d > 0.5) {
        const ms = Math.max(800, Math.floor(d * 1000) - VIDEO_OUTRO_LEAD_MS);
        timer = setTimeout(fireOnce, ms);
      } else {
        timer = setTimeout(fireOnce, VIDEO_FAILSAFE_MS);
      }
    };

    // Respect explicit durationSeconds override, if present
    if (Number.isFinite(item.durationSeconds) && item.durationSeconds > 0) {
      timer = setTimeout(fireOnce, Math.max(1000, item.durationSeconds * 1000));
      return;
    }

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded, { once: true });
    v.addEventListener("error", onEnded, { once: true });
    v.addEventListener("loadedmetadata", onMeta, { once: true });

    // If metadata already loaded, schedule immediately
    if (isFinite(v.duration) && v.duration > 0.5) onMeta();
    else timer = setTimeout(fireOnce, VIDEO_FAILSAFE_MS);
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

      if (kind === "video") await prepareVideo(incoming, item);
      else await prepareImage(incoming, item);

      await crossfade(incoming, outgoing);

      usingA = !usingA;

      if (kind === "video") scheduleNextForVideo(incoming, item);
      else scheduleNextForImage(item);

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
      items = sortItems(manifest.filter(isActiveNow));

      idx = -1;
      usingA = true;

      A.wrap.classList.remove("visible"); A.wrap.setAttribute("aria-hidden", "true"); hideMedia(A);
      B.wrap.classList.remove("visible"); B.wrap.setAttribute("aria-hidden", "true"); hideMedia(B);

      if (!items.length) {
        logStatus("No active items");
        return;
      }

      showNext();
    } catch (err) {
      console.error(err);
      logStatus("Manifest error:\n" + (err?.message || String(err)));
    }
  }

  function scheduleRepoll() {
    if (repoll) clearInterval(repoll);
    repoll = setInterval(loadAndStart, REFRESH_MIN * 60 * 1000);
  }

  loadAndStart();
  scheduleRepoll();
})();
