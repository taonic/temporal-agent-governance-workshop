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
  shield: (ink, tint) => `
    <path d="M20 4 L34 9 V19 C34 27.5 28 33.5 20 36.5 C12 33.5 6 27.5 6 19 V9 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M13.5 19.5 L18 24 L27 14.5" fill="none" stroke="${ink}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
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
  // Essentials' module badges (quests/badges.yaml): one for each thing a trip on Temporal survives.
  logbook: (ink, tint) => `
    <path d="M8 5 H30 A2 2 0 0 1 32 7 V35 H10 A3 3 0 0 1 7 32 V6 A1 1 0 0 1 8 5 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M7 31 A3 3 0 0 1 10 28 H32" fill="none" stroke="${ink}" stroke-width="2.2"/>
    <path d="M13 12 H26 M13 17 H26 M13 22 H21" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M26 5 V14 L29 11.5 L32 14 V5" fill="${ink}"/>`,
  wrench: (ink, tint) => `
    <path d="M27 5 A8 8 0 0 0 20.5 15.8 L6.5 29.8 A3 3 0 0 0 10.7 34 L24.7 20 A8 8 0 0 0 35.5 13.5 L30.5 15.5 L26 14 L24.5 9.5 L27 5 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="9" cy="31.5" r="1.6" fill="${ink}"/>`,
  umbrella: (ink, tint) => `
    <path d="M4 20 A16 14 0 0 1 36 20 Q32 17 28 20 Q24 17 20 20 Q16 17 12 20 Q8 17 4 20 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M20 6 V3 M20 20 V32 A3 3 0 0 1 14 32" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M8 27 L6 31 M31 26 L29 30 M34 33 L33 35" stroke="${ink}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`,
  moon: (ink, tint) => `
    <path d="M24 5 A15 15 0 1 0 35 26 A12 12 0 1 1 24 5 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M30 6 L31.2 9 L34 10 L31.2 11 L30 14 L28.8 11 L26 10 L28.8 9 Z" fill="${ink}"/>`,
  plug: (ink, tint) => `
    <path d="M14 4 V11 M26 4 V11" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M9 11 H31 V18 A11 11 0 0 1 20 29 A11 11 0 0 1 9 18 Z" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M20 29 V33 Q20 37 24 37 H30" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M21.5 14 L17.5 20 H22 L18.5 25" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  hourglass: (ink, tint) => `
    <path d="M9 4 H31 M9 36 H31" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M11 4 V9 C11 15 18 17 18 20 C18 23 11 25 11 31 V36 H29 V31 C29 25 22 23 22 20 C22 17 29 15 29 9 V4" fill="${tint}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M14 33 C15 29 18 28 20 27 C22 28 25 29 26 33 Z M15.5 10 H24.5 C23 13 21 14 20 15.5 C19 14 17 13 15.5 10 Z" fill="${ink}"/>`,
  stamp: (ink, tint) => `
    <circle cx="20" cy="8" r="5" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <path d="M17 13 L16 20 H24 L23 13" fill="${tint}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="6" y="20" width="28" height="7" rx="2" fill="${tint}" stroke="${ink}" stroke-width="2.4"/>
    <path d="M5 33 H35" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M14 23.5 L17.5 25 L26 22" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  undo: (ink, tint) => `
    <path d="M12 12 H25 A10 10 0 0 1 25 32 H11" fill="none" stroke="${ink}" stroke-width="4.6" stroke-linecap="round"/>
    <path d="M12 12 H25 A10 10 0 0 1 25 32 H11" fill="none" stroke="${tint}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M15 4 L5 12 L15 20 Z" fill="${ink}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`,
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
  // An earned medal's shine: a band of light, clipped to its shape, waiting off to its left. CSS
  // sweeps it across (.badge-shine: the earn moment, and hovering it on the badges page).
  const clip = skill ? `<circle cx="60" cy="72" r="52"/>` : `<polygon points="${hex(60, 72, 54)}"/>`;
  const shine =
    !locked && !small
      ? `<g clip-path="url(#${id}-clip)"><polygon class="badge-shine" points="-46,0 -14,0 -44,136 -76,136" fill="url(#${id}-shine)"/></g>`
      : "";
  const shineDefs =
    !locked && !small
      ? `<clipPath id="${id}-clip">${clip}</clipPath><linearGradient id="${id}-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset=".5" stop-color="white" stop-opacity=".75"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>`
      : "";
  const a11y = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  return `<svg class="badge-medal${locked ? " is-locked" : ""}" width="${size}" height="${(size * 136) / 120}" viewBox="0 0 120 136" ${a11y}>
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${col}"/></linearGradient>${shineDefs}</defs>
${shape}${crown}${icon}${num}${shine}${rib}</svg>`;
}
