(() => {
  const cfg = window.SS_CONFIG || {};

  const DEFAULT_IMAGE_SECONDS = Number.isFinite(cfg.defaultDuration) ? cfg.defaultDuration : 10;
  const FADE_MS = Math.max(0, parseInt(cfg.transitionMs ?? 500, 10));
  const REFRESH_MIN = Math.max(1, parseInt(cfg.refreshMinutes ?? 10, 10));

  // Fade out video slightly before end to hide freeze
  const VIDEO_OUTRO_LEAD_MS = Math.min(800, Math.max(150, Math.floor(FADE_MS * 0.75)));
  const VIDEO_FAILSAFE_MS = Math.max(1500, DEFAULT_IMAGE_SECONDS * 1000);

  document.documentElement.style.setProperty("--fade-ms", `${FADE_MS}ms`);
  document.documentElement.style.setProperty("--fit", cfg.objectFit || "contain");
  document.documentElement.style.setProperty("--bg", cfg.bg || "#000");

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

  function bust(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_cb=${Date.now()}`;
  }

  function isActiveNow(it) {
    const now = new Date();
    return (
      it.enabled !== false &&
      (!it.start || new Date(it.start) <= now) &&
      (!it.end || now <= new Date(it.end))
    );
  }

  function inferType(item) {
    return /\.(mp4|webm|ogg|mov|m4v)$/i.test(item.url || "")
      ? "video"
      : "image";
  }

  async function fetchManifest() {
    const base = cfg.imagesManifest || "images.json";
    const res = await fetch(bust(base), { cache: "no-store" });
    if (!res.ok) throw new Error("Manifest fetch failed");
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  }

  function hideMedia(t) {
    t.img.classList.add("media-hidden");
    t.img.removeAttribute("src");

    try { t.vid.pause(); } catch {}
    t.vid.classList.add("media-hidden");
    t.vid.removeAttribute("src");
    try { t.vid.load(); } catch {}
  }

  async function prepareImage(t, item) {
    hideMedia(t);

    const img = new Image();
    img.src = bust(item.url);
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });

    t.img.src = item.url;
    t.img.classList.remove("media-hidden");
    if (t.img.decode) try { await t.img.decode(); } catch {}
  }

  async function prepareVideo(t, item) {
    hideMedia(t);

    t.vid.muted = true;
    t.vid.playsInline = true;
    t.vid.loop = false;
    t.vid.preload = "auto";
    t.vid.src = bust(item.url);
    t.vid.currentTime = 0;
    t.vid.classList.remove("media-hidden");

    await new Promise((res, rej) => {
      const ok = () => { cleanup(); res(); };
      const err = () => { cleanup(); rej(); };
      const cleanup = () => {
        t.vid.removeEventListener("canplay", ok);
        t.vid.removeEventListener("error", err);
      };
      t.vid.addEventListener("canplay", ok);
      t.vid.addEventListener("error", err);
      t.vid.load();
    });

    try { await t.vid.play(); } catch {}
  }

  async function crossfade(incoming, outgoing) {
    incoming.wrap.style.zIndex = "2";
    outgoing.wrap.style.zIndex = "1";

    incoming.wrap.classList.remove("visible");
    void incoming.wrap.offsetHeight;

    incoming.wrap.classList.add("visible");
    outgoing.wrap.setAttribute("aria-hidden", "true");
    incoming.wrap.setAttribute("aria-hidden", "false");

    if (FADE_MS) await new Promise(r => setTimeout(r, FADE_MS));

    outgoing.wrap.classList.remove("visible");
    hideMedia(outgoing);
  }

  function scheduleImage(item) {
    clearTimeout(timer);
    const s = item.durationSeconds || DEFAULT_IMAGE_SECONDS;
    timer = setTimeout(showNext, s * 1000);
  }

  function scheduleVideo(t, item) {
    clearTimeout(timer);

    const fire = () => showNext();

    if (item.durationSeconds) {
      timer = setTimeout(fire, item.durationSeconds * 1000);
      return;
    }

    const plan = () => {
      const d = t.vid.duration;
      if (!isFinite(d) || d <= 0.5) {
        timer = setTimeout(fire, VIDEO_FAILSAFE_MS);
        return;
      }
      timer = setTimeout(
        fire,
        Math.max(500, d * 1000 - VIDEO_OUTRO_LEAD_MS)
      );
    };

    if (isFinite(t.vid.duration)) plan();
    else t.vid.addEventListener("loadedmetadata", plan, { once: true });

    setTimeout(fire, VIDEO_FAILSAFE_MS * 2);
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
      if (kind === "video") await prepareVideo(incoming, item);
      else await prepareImage(incoming, item);

      await crossfade(incoming, outgoing);
      usingA = !usingA;

      if (kind === "video") scheduleVideo(incoming, item);
      else scheduleImage(item);

    } catch {
      timer = setTimeout(showNext, 800);
    }
  }

  async function loadAndStart() {
    try {
      const manifest = await fetchManifest();
      items = manifest.filter(isActiveNow);

      idx = -1;
      usingA = true;
      hideMedia(A);
      hideMedia(B);

      if (items.length) showNext();
    } catch {}
  }

  function repollManifest() {
    if (repoll) clearInterval(repoll);
    repoll = setInterval(loadAndStart, REFRESH_MIN * 60 * 1000);
  }

  loadAndStart();
  repollManifest();
})();
