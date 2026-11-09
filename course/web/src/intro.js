// The welcome intro: the title screen a visitor lands on before the skill tree (WelcomeIntro.vue).
// It plays on arrival at the home page, at most once every INTRO_EVERY: a learner coming back
// through the day goes straight to the map. ?intro plays it regardless (to show it off); a
// browser driven by tests (navigator.webdriver) never sees it unless asked.
import { load, save } from "./store.js";

const INTRO_EVERY = 12 * 60 * 60 * 1000;

export function shouldShowIntro(route) {
  if (new URLSearchParams(window.location.search).has("intro")) return true;
  if (route.page !== "home" || navigator.webdriver) return false;
  return !(Date.now() - load("intro-seen-at", 0) < INTRO_EVERY);
}

export function markIntroSeen() {
  save("intro-seen-at", Date.now());
}

// A starfield flying toward the viewer, on a canvas that fills its parent. warp() pushes it to
// light speed, the stars stretching into streaks; stop() ends it. With reduced motion, it's still.
export function starfield(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext("2d");
  const TINTS = ["#ffffff", "#ffffff", "#ffffff", "#c7d2fe", "#ddd6fe", "#a5f3fc"];
  let width = 0;
  let height = 0;
  let stars = [];
  let speed = reduced ? 0 : 0.06; // depth units a second
  let target = speed;
  let raf = 0;
  let last = performance.now();

  const spawn = (z = Math.random()) => ({
    x: (Math.random() * 2 - 1) * 1.4,
    y: (Math.random() * 2 - 1) * 1.4,
    z: Math.max(0.04, z),
    tint: TINTS[Math.floor(Math.random() * TINTS.length)],
    twinkle: Math.random() * Math.PI * 2,
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(700, Math.round((width * height) / 2600));
    while (stars.length < count) stars.push(spawn());
    stars.length = count;
  }

  function project(star, z) {
    const f = Math.max(width, height) * 0.5;
    return [width / 2 + (star.x / z) * f, height / 2 + (star.y / z) * f];
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    speed += (target - speed) * Math.min(1, dt * 2.2);
    ctx.clearRect(0, 0, width, height);
    for (const star of stars) {
      star.z -= speed * dt;
      star.twinkle += dt * 3;
      let [x, y] = project(star, star.z);
      if (star.z <= 0.04 || x < -50 || x > width + 50 || y < -50 || y > height + 50) {
        Object.assign(star, spawn(1));
        [x, y] = project(star, star.z);
      }
      const near = 1 - star.z;
      const alpha = Math.min(1, near * 1.3) * (0.75 + Math.sin(star.twinkle) * 0.25);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ctx.fillStyle = star.tint;
      // The faster it goes, the longer the trail: where the star was a moment ago.
      const trail = speed * 0.09;
      if (trail > 0.004) {
        const [tx, ty] = project(star, Math.min(1.2, star.z + trail));
        ctx.lineWidth = 0.4 + near * 2.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 0.3 + near * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (!reduced || speed !== target) raf = requestAnimationFrame(frame);
  }

  // Still stars are drawn once, so again when the canvas changes size.
  const onResize = () => {
    resize();
    if (reduced) raf = requestAnimationFrame(frame);
  };
  resize();
  window.addEventListener("resize", onResize);
  raf = requestAnimationFrame(frame);

  return {
    warp() {
      if (reduced) return;
      target = 3.2;
    },
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    },
  };
}
