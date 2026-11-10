// How a badge looks, drawn in code as an SVG string: a hexagon in its branch's colour (a tier or
// boss badge) or a gold coin (a skill badge), with a hand-drawn two-tone icon. A tier badge has
// its Roman numeral; a boss badge a crown, and its class title on a ribbon. A locked badge is a
// dashed grey outline with a faded icon. Below 48px only the shape, the icon and a crown are
// drawn. Colours are the site's tokens (styles.css), so it follows the theme.
//
// Plain strings, not components: the map embeds them in its own SVG, and the content build reads
// ICON_NAMES to check branch.md and badges.yaml.

// Each icon in a 40×40 box: `ink` for its lines and solid parts, `tint` for its fills.
const heart = (cx, cy, s, fill, ink) =>
  `<path d="M${cx} ${cy + s * 0.9} C${cx - s * 1.5} ${cy} ${cx - s * 0.9} ${cy - s * 1.05} ${cx} ${cy - s * 0.35} C${cx + s * 0.9} ${cy - s * 1.05} ${cx + s * 1.5} ${cy} ${cx} ${cy + s * 0.9} Z" fill="${fill}" stroke="${ink}" stroke-width="1.8"/>`;

function gearPath() {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    for (const [d, r] of [[-0.24, 11], [-0.17, 15], [0.17, 15], [0.24, 11]]) points.push(`${(20 + r * Math.cos(a + d)).toFixed(1)} ${(20 + r * Math.sin(a + d)).toFixed(1)}`);
  }
  return `M${points.join(" L")} Z`;
}
const GEAR = gearPath();

const ICONS = {
  sprout: (ink, tint) => `
    <path d="M20 35 V20" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M20 24 C11 24 6 18 6 10 C14 10 20 15 20 24 Z" fill="${tint}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M20 20 C20 11 26 5 35 5 C35 13 29 20 20 20 Z" fill="${tint}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M10 35 H30" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`,
  robot: (ink, tint) => `
    <path d="M20 12 V6" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="5" r="2.6" fill="${ink}"/>
    <rect x="4" y="18" width="4" height="9" rx="1.5" fill="${ink}"/><rect x="32" y="18" width="4" height="9" rx="1.5" fill="${ink}"/>
    <rect x="8" y="12" width="24" height="21" rx="6" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <circle cx="15" cy="21" r="2.8" fill="${ink}"/><circle cx="25" cy="21" r="2.8" fill="${ink}"/>
    <path d="M15 28 H25" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`,
  columns: (ink, tint) => `
    <path d="M4 14 L20 5 L36 14 Z" fill="${tint}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="9" y="17" width="4.5" height="13" fill="${tint}" stroke="${ink}" stroke-width="2"/>
    <rect x="17.75" y="17" width="4.5" height="13" fill="${tint}" stroke="${ink}" stroke-width="2"/>
    <rect x="26.5" y="17" width="4.5" height="13" fill="${tint}" stroke="${ink}" stroke-width="2"/>
    <path d="M6 15.5 H34 M6 31.5 H34" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M3 35.5 H37" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/>`,
  card: (ink, tint) => `
    <rect x="3" y="8" width="34" height="24" rx="4" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <rect x="3" y="13" width="34" height="5" fill="${ink}"/>
    <rect x="8" y="22" width="8" height="6" rx="1.5" fill="none" stroke="${ink}" stroke-width="1.8"/>
    <path d="M21 25 H32" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`,
  pipeline: (ink, tint) => `
    <path d="M11 11 V29 M11 15 C11 22 18 21 26 21" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="11" cy="8" r="4.5" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <circle cx="11" cy="32" r="4.5" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <circle cx="30" cy="21" r="4.5" fill="${ink}" stroke="${ink}" stroke-width="2.4"/>`,
  gear: (ink, tint) => `
    <path d="${GEAR}" fill="${tint}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="20" cy="20" r="4.8" fill="none" stroke="${ink}" stroke-width="2.4"/>`,
  bolt: (ink, tint) => `
    <path d="M24 3 L9 22 H19 L15 37 L31 16 H21 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>`,
  "closed-eye": (ink, tint) => `
    <path d="M5 17 C11 27 29 27 35 17" fill="${tint}" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M10 23 L7 28 M16 25.5 L15 31 M24 25.5 L25 31 M30 23 L33 28" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M14 11 Q20 8 26 11" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" opacity=".55"/>`,
  hearts: (ink, tint, locked) =>
    [8, 20, 32].map((x, i) => heart(x, i === 1 ? 17 : 23, 8.4, locked ? tint : "var(--heart)", locked ? ink : "color-mix(in srgb, var(--heart) 70%, black)")).join(""),
  compass: (ink, tint) => `
    <circle cx="20" cy="20" r="16" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <path d="M20 4 V7.5 M20 32.5 V36 M4 20 H7.5 M32.5 20 H36" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>
    <path d="M26 9 L22.5 22.5 L14 31 L17.5 17.5 Z" fill="var(--paper)" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M26 9 L22.5 22.5 L17.5 17.5 Z" fill="${ink}"/>
    <circle cx="20" cy="20" r="1.8" fill="var(--paper)"/>`,
  link: (ink) => `
    <g transform="rotate(-45 20 20)">
      <rect x="2" y="13" width="20" height="14" rx="7" fill="none" stroke="${ink}" stroke-width="3.2"/>
      <rect x="18" y="13" width="20" height="14" rx="7" fill="none" stroke="${ink}" stroke-width="3.2"/>
    </g>`,
};

export const ICON_NAMES = Object.keys(ICONS);
// Below this, a badge drops its numeral and ribbon: they'd be unreadable.
export const SMALL = 48;

const colorOf = (color) => (color ? `var(--branch-${color})` : "var(--gold)");
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// An icon on its own (a heading, a label), in a branch's colour, or gold without one.
export function iconSvg(name, size = 16, color = null) {
  const col = colorOf(color);
  const body = ICONS[name]?.(`color-mix(in srgb, ${col} 72%, var(--text))`, `color-mix(in srgb, ${col} 30%, var(--paper))`, false) ?? "";
  return `<svg class="badge-icon" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
}

// A pointy-top hexagon centred at (cx, cy).
function hex(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

let uid = 0;

// A badge, drawn in a 120×136 box scaled to `size` wide. `badge` is one of course.badges:
// { kind: "tier" | "boss" | "skill", icon, color, numeral, name }.
export function medalSvg(badge, { earned = false, size = 96, label = null } = {}) {
  const id = `badge-${++uid}`;
  const locked = !earned;
  const small = size < SMALL;
  const skill = badge.kind === "skill";
  const col = colorOf(skill ? null : badge.color);
  const hi = skill ? "var(--gold-hi)" : `color-mix(in srgb, ${col} 55%, white)`;
  const ink = locked ? "var(--faint)" : `color-mix(in srgb, ${col} 72%, var(--text))`;
  const tint = locked ? "var(--mist)" : `color-mix(in srgb, ${col} 32%, var(--paper))`;
  const numeral = !small && badge.kind === "tier" ? badge.numeral : null;
  const ribbon = !small && badge.kind === "boss" ? badge.name : null;

  const outer = locked
    ? `fill="var(--mist)" stroke="var(--line-strong)" stroke-width="2.5" stroke-dasharray="6 5"`
    : `fill="url(#${id})" stroke="color-mix(in srgb, ${col} 70%, black)" stroke-width="2"`;
  const inner = locked
    ? `fill="none" stroke="var(--line)" stroke-width="1.5"`
    : `fill="color-mix(in srgb, ${col} 14%, var(--paper))" stroke="color-mix(in srgb, ${col} 40%, white)" stroke-width="${skill ? 2 : 1.5}"${skill ? ' stroke-dasharray="2 3"' : ""}`;
  const shape = skill
    ? `<circle cx="60" cy="72" r="52" ${outer}/>` +
      (locked ? "" : `<circle cx="60" cy="72" r="47.5" fill="none" stroke="color-mix(in srgb, ${col} 60%, black)" stroke-width="3" stroke-dasharray="1.4 2.4" opacity=".45"/>`) +
      `<circle cx="60" cy="72" r="40" ${inner}/>`
    : `<polygon points="${hex(60, 72, 54)}" ${outer}/><polygon points="${hex(60, 72, 42)}" ${inner}/>`;

  const cy = numeral ? 61 : 70;
  const scale = small ? 1.45 : 1.1;
  const icon = `<g transform="translate(${60 - 20 * scale} ${cy - 20 * scale}) scale(${scale})"${locked ? ' opacity=".55"' : ""}>${ICONS[badge.icon]?.(ink, tint, locked) ?? ""}</g>`;
  const num = numeral
    ? `<text x="60" y="95" text-anchor="middle" font-size="13" font-weight="800" letter-spacing="1.5" fill="${ink}" font-family="Georgia, serif">${numeral}</text>`
    : "";
  const crown =
    badge.kind === "boss"
      ? `<path d="M40 22 L44 6 L53 16 L60 2 L67 16 L76 6 L80 22 Z" fill="${locked ? "var(--mist)" : "var(--gold-hi)"}" stroke="${locked ? "var(--line-strong)" : "color-mix(in srgb, var(--gold) 70%, black)"}" stroke-width="1.6" stroke-linejoin="round"/>`
      : "";
  const rib = ribbon
    ? `<path d="M2 104 h116 l-6 9 l6 9 h-116 l6 -9 z" fill="${locked ? "var(--line)" : col}" stroke="${locked ? "var(--line-strong)" : `color-mix(in srgb, ${col} 70%, black)`}" stroke-width="1.2"/>` +
      `<text x="60" y="114" text-anchor="middle" dominant-baseline="middle" font-size="${ribbon.length > 17 ? 8.6 : 9.6}" font-weight="700" fill="${locked ? "var(--faint)" : "white"}" letter-spacing=".3">${escape(ribbon.toUpperCase())}</text>`
    : "";
  const a11y = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  return `<svg class="badge-medal${locked ? " is-locked" : ""}" width="${size}" height="${(size * 136) / 120}" viewBox="0 0 120 136" ${a11y}>
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${col}"/></linearGradient></defs>
${shape}${crown}${icon}${num}${rib}</svg>`;
}
