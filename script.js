(() => {
target.cap.textContent = '';
target.cap.classList.add('hidden');
}
}


async function showNext() {
if (!items.length) return;
idx = (idx + 1) % items.length;
const item = items[idx];


try {
await preload(item.url);
} catch (e) {
console.warn(e.message);
logStatus('Skipped failed image');
return showNext();
}


const incoming = usingA ? a : b;
const outgoing = usingA ? b : a;


setSlide(incoming, item);


// Crossfade
incoming.wrap.classList.add('visible');
incoming.wrap.setAttribute('aria-hidden', 'false');
outgoing.wrap.classList.remove('visible');
outgoing.wrap.setAttribute('aria-hidden', 'true');


usingA = !usingA;


const durMs = Math.max(1000, (item.durationSeconds || cfg.defaultDuration) * 1000);
clearTimeout(timer);
timer = setTimeout(showNext, durMs);
}


async function loadAndStart() {
try {
const manifest = await fetchManifest();
const filtered = manifest.filter(isActiveNow);
items = sortItems(filtered);
if (!items.length) {
logStatus('No active images in manifest');
return;
}
logStatus('Loaded ' + items.length + ' images');
idx = -1; usingA = true;
// Ensure initial visibility state
a.wrap.classList.remove('visible'); a.wrap.setAttribute('aria-hidden', 'true');
b.wrap.classList.remove('visible'); b.wrap.setAttribute('aria-hidden', 'true');
showNext();
} catch (err) {
console.error(err);
logStatus('Manifest error');
}
}


function scheduleRepoll() {
setInterval(() => {
// Re-pull manifest to pick up new/removed images without reloading the whole page
loadAndStart();
}, Math.max(1, cfg.refreshMinutes) * 60 * 1000);
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
