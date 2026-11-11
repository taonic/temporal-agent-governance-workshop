// A race as it stands, polled from the runner (GET /api/race/state): for the race screen, and for
// a racer's lobby and pill. The runner's clock, not this machine's, decides when the gun goes:
// `offset` is the difference, measured on each poll.
import { reactive } from "vue";

export const live = reactive({ slug: null, state: null, offset: 0, error: "", loaded: false });

let timer = 0;
let every = 2000;

export const serverNow = () => Date.now() + live.offset;

async function poll() {
  clearTimeout(timer);
  const slug = live.slug;
  if (!slug) return;
  const sent = Date.now();
  try {
    const res = await fetch(`/api/race/state?race=${encodeURIComponent(slug)}`, { credentials: "same-origin", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    if (slug !== live.slug) return;
    const back = Date.now();
    live.offset = data.now - (sent + back) / 2;
    live.state = data;
    live.error = "";
  } catch (err) {
    live.error = err.status === 404 ? "There's no race here." : "Can't reach the race right now. Retrying…";
  } finally {
    live.loaded = true;
    if (slug === live.slug) timer = setTimeout(poll, document.visibilityState === "hidden" ? Math.max(every, 8000) : every);
  }
}

export function watchRace(slug, ms = 2000) {
  every = ms;
  if (live.slug === slug) return;
  live.slug = slug;
  live.state = null;
  live.loaded = false;
  poll();
}

export function stopRace() {
  clearTimeout(timer);
  live.slug = null;
}

export const refreshRace = () => poll();

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// "41:07", or "1:02:15" for an hour or more.
export function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
