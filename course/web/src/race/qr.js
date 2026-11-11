// A QR code as an SVG string: one path, dark modules on a light ground, with a quiet zone.
import qrcode from "qrcode-generator";

export function qrSvg(text, { margin = 2, dark = "#111", light = "#fff", label = "QR code" } = {}) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  const safe = String(label).replace(/[<>&"]/g, "");
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${safe}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

export const joinUrl = (code, origin = window.location.origin) => `${origin}/join/${code}`;
export const raceUrl = (slug, origin = window.location.origin) => `${origin}/race/${slug}`;
