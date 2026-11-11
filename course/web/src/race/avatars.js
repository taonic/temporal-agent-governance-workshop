// The Derby's racers: who can ride (creatures), the silks they wear, the horses' names and coats,
// and the pit-pass words. Shared by the site (the join page, the race screen) and the runner
// (runner/race.mjs checks what a racer picked against these), so no imports.

// The jockeys. Each rides as its emoji, as the jockey's head; the durian has no emoji, so it's
// drawn (Horse.vue).
export const CREATURES = [
  { id: "gecko", label: "Gecko", emoji: "🦎" },
  { id: "elephant", label: "Elephant", emoji: "🐘" },
  { id: "monkey", label: "Monkey", emoji: "🐒" },
  { id: "durian", label: "Durian", emoji: null },
  { id: "crab", label: "Crab", emoji: "🦀" },
  { id: "turtle", label: "Sea turtle", emoji: "🐢" },
  { id: "cat", label: "Tuk-tuk cat", emoji: "😼" },
  { id: "squid", label: "Squid", emoji: "🦑" },
  { id: "parrot", label: "Parrot", emoji: "🦜" },
  { id: "prawn", label: "Prawn", emoji: "🦐" },
  { id: "mango", label: "Mango", emoji: "🥭" },
  { id: "dolphin", label: "Dolphin", emoji: "🐬" },
  { id: "rooster", label: "Rooster", emoji: "🐓" },
  { id: "shark", label: "Shark", emoji: "🦈" },
  { id: "coconut", label: "Coconut", emoji: "🥥" },
  { id: "chilli", label: "Chilli", emoji: "🌶️" },
];

// One colour per racer in a race: told apart from the back of the room. `ink`: what reads on it.
export const SILKS = [
  { id: "scarlet", label: "Scarlet", color: "#e11d48", ink: "#fff" },
  { id: "tangerine", label: "Tangerine", color: "#f97316", ink: "#fff" },
  { id: "sunflower", label: "Sunflower", color: "#facc15", ink: "#1f2937" },
  { id: "lime", label: "Lime", color: "#84cc16", ink: "#1f2937" },
  { id: "emerald", label: "Emerald", color: "#059669", ink: "#fff" },
  { id: "turquoise", label: "Turquoise", color: "#14b8a6", ink: "#fff" },
  { id: "sky", label: "Sky", color: "#38bdf8", ink: "#0f172a" },
  { id: "royal", label: "Royal blue", color: "#2563eb", ink: "#fff" },
  { id: "indigo", label: "Indigo", color: "#4f46e5", ink: "#fff" },
  { id: "violet", label: "Violet", color: "#8b5cf6", ink: "#fff" },
  { id: "orchid", label: "Orchid", color: "#d946ef", ink: "#fff" },
  { id: "pink", label: "Bubblegum", color: "#f472b6", ink: "#1f2937" },
  { id: "chocolate", label: "Chocolate", color: "#7c4a21", ink: "#fff" },
  { id: "silver", label: "Silver", color: "#cbd5e1", ink: "#0f172a" },
  { id: "midnight", label: "Midnight", color: "#1e293b", ink: "#fff" },
  { id: "gold", label: "Gold", color: "#ca8a04", ink: "#fff" },
  { id: "maroon", label: "Maroon", color: "#881337", ink: "#fff" },
  { id: "coral", label: "Coral", color: "#fb7185", ink: "#1f2937" },
  { id: "mint", label: "Mint", color: "#6ee7b7", ink: "#0f172a" },
  { id: "navy", label: "Navy", color: "#1e3a8a", ink: "#fff" },
];

export const PATTERNS = [
  { id: "hoops", label: "Hoops" },
  { id: "stripes", label: "Stripes" },
  { id: "stars", label: "Stars" },
  { id: "diamonds", label: "Diamonds" },
  { id: "plain", label: "Plain" },
];

// The horse's coat, from the racer's id: not picked, so the field looks like a real one.
export const COATS = [
  { body: "#8b5a2b", mane: "#2b1a0e" }, // bay
  { body: "#b5652b", mane: "#7a3a12" }, // chestnut
  { body: "#d9d4cc", mane: "#8a857c" }, // grey
  { body: "#3a2f2a", mane: "#151110" }, // black
  { body: "#e0b469", mane: "#f6ecd3" }, // palomino
  { body: "#6e4b33", mane: "#1c130d" }, // brown
];
export const coatOf = (seed) => COATS[Math.abs(hash(String(seed))) % COATS.length];

// Horse names: Temporal and travel puns. The join page suggests one; the racer can reroll or write
// their own.
export const HORSE_NAMES = [
  "Retry Me Maybe",
  "Durable Dancer",
  "Never Loses Its Place",
  "Signal Sent",
  "Compensating Colt",
  "Exactly Once Upon a Time",
  "Heartbeat Hero",
  "Replay It Again",
  "Saga of the Seas",
  "Worker on Shift",
  "Idempotent Ivy",
  "Backoff Blaze",
  "Timer Twister",
  "Continue-As-Neigh",
  "The Logbook Kid",
  "Child Workflow",
  "Activity Ace",
  "Deterministic Dash",
  "Pending Approval",
  "Hold The Seat",
  "Long-Running Larry",
  "Phang Nga Flyer",
  "Patong Thunder",
  "Mango Sticky Speed",
  "Tuk-Tuk Turbo",
  "Andaman Express",
  "Queue Jumper",
  "Event History",
  "Schedule-To-Close",
  "Unbreakable",
];

export function suggestHorseName(taken = [], random = Math.random) {
  const free = HORSE_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : HORSE_NAMES;
  return pool[Math.floor(random() * pool.length)];
}

// Pit-pass words: a racer's way back in, on another device. "mango-gecko-42".
export const PIT_WORDS = [
  "mango", "papaya", "lychee", "coconut", "durian", "lime", "chilli", "basil", "lemongrass", "pineapple",
  "sunset", "lagoon", "reef", "island", "beach", "palm", "monsoon", "tide", "longtail", "lantern",
];

export function newPitPass(random = Math.random) {
  const word = PIT_WORDS[Math.floor(random() * PIT_WORDS.length)];
  const creature = CREATURES[Math.floor(random() * CREATURES.length)].id;
  return `${word}-${creature}-${10 + Math.floor(random() * 90)}`;
}

export const normalizePitPass = (raw) => String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");

// Join codes: one word and two digits, nothing that reads as another character (no 0/O, 1/I).
export const CODE_WORDS = ["DERBY", "CANTER", "SADDLE", "STAKES", "MANE", "TURF", "PACE", "STABLE", "HURDLE", "GATES", "TRACK", "MARE", "RACE", "SURGE", "BLAZE", "FAST", "SPEED", "TREK", "BEACH", "PALM"];
export function newJoinCode(random = Math.random) {
  const digit = () => "23456789"[Math.floor(random() * 8)];
  return `${CODE_WORDS[Math.floor(random() * CODE_WORDS.length)]}${digit()}${digit()}`;
}
export const normalizeCode = (raw) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

export const NAME_MAX = 16;
export const HORSE_MAX = 28;

export function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}

export const creatureOf = (id) => CREATURES.find((c) => c.id === id) ?? CREATURES[0];
export const silksOf = (id) => SILKS.find((s) => s.id === id) ?? SILKS[0];
