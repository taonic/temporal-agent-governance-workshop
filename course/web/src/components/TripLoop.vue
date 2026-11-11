<script setup>
// Essentials' idea in one picture, on its starting screen (FirstRun.vue): a trip books its flight
// and hotel, the power goes out (the steps go dark, the logbook stays lit: Temporal keeps it),
// and when it's back the trip carries on from the card, booking nothing twice.
//
// CSS only (styles.css, "Trip loop"): it plays twice, then rests on its last frame, which is also
// what's shown when the system asks for less motion. Its parts' resting styles are that last
// frame; the keyframes start from the trip's beginning.
const STEPS = [
  { n: 1, icon: "✈️", name: "Flight" },
  { n: 2, icon: "🏨", name: "Hotel" },
  { n: 3, icon: "💳", name: "Card" },
];
const CAPTIONS = ["A trip books, one step at a time.", "The power goes out. The logbook is safe.", "Power's back: it carries on from the card.", "Booked. Nothing done twice."];
</script>

<template>
  <figure
    class="trip-loop"
    role="img"
    aria-label="A trip books its flight and its hotel. The power goes out, but the logbook is kept safe. When the power is back, the trip carries on from the card, and it's booked, with nothing done twice."
  >
    <div class="tl-stage">
      <ol class="tl-steps">
        <li v-for="s in STEPS" :key="s.n" :class="['tl-step', `tl-step-${s.n}`]">
          <span class="tl-icon">{{ s.icon }}</span>
          <span class="tl-name">{{ s.name }}</span>
          <span :class="['tl-tick', `tl-show-${s.n}`]">✓</span>
          <span v-if="s.n === 3" class="tl-wait">…</span>
        </li>
      </ol>
      <div class="tl-dark"><span class="tl-bolt">⚡</span></div>
    </div>
    <div class="tl-logbook">
      <span class="tl-log-label"><span class="tl-icon">📒</span> Logbook, kept by Temporal</span>
      <span v-for="s in STEPS" :key="s.n" :class="['tl-entry', `tl-show-${s.n}`]">{{ s.name.toLowerCase() }} ✓</span>
    </div>
    <figcaption class="tl-captions">
      <span v-for="(c, i) in CAPTIONS" :key="i" :class="['tl-caption', `tl-caption-${i + 1}`]">{{ c }}</span>
    </figcaption>
  </figure>
</template>
