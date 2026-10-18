// The code tour: an exercise's code, a chunk at a time, each explained in a card over the
// editor (CodeTour.vue), which spotlights the chunk's lines (CodeEditor.vue). The guide offers it
// at the end of an exercise's briefing (ExerciseInstructions), and it can be skipped; the editor's
// "Code tour" button starts it again.
import { reactive } from "vue";

export const codeTour = reactive({
  open: false,
  exercise: null, // the exercise id it's touring
  stops: [],
  index: 0,
  // The current stop's lines as found in the file on show (the editor fills it in), or null.
  lines: null,
});

export function startCodeTour(exercise) {
  if (!exercise?.tour?.length) return;
  Object.assign(codeTour, { open: true, exercise: exercise.id, stops: exercise.tour, index: 0, lines: null });
}

export function stepCodeTour(delta) {
  if (!codeTour.open) return;
  const next = codeTour.index + delta;
  if (next < 0) return;
  if (next >= codeTour.stops.length) endCodeTour();
  else codeTour.index = next;
}

// Finished or skipped.
export function endCodeTour() {
  closeCodeTour();
}

export function closeCodeTour() {
  codeTour.open = false;
  codeTour.lines = null;
}

export function currentStop(exerciseId) {
  return codeTour.open && codeTour.exercise === exerciseId ? codeTour.stops[codeTour.index] ?? null : null;
}
