---
id: essentials
name: Essentials
icon: 🛡️
badgeIcon: shield
color: green
order: 0
personas: [essentials]
layout: board
# Its learners see no module ids (E1, EC1…): the map, the pages and the copy name modules by title.
numbered: false
# Each of the guide's messages is at most this many words: read at a glance.
maxWords: 100
# Its map: a page of the coordinator's sketchbook, left to right in three lines, each stop with its
# module's emoji and note (MapPage, SketchMap.vue).
map: sketch
classTitle: Resilience Champion
# The starting screen, before the first module (FirstRun.vue): the goal in two lines, then what
# they're starting, and why the course follows a trip.
welcome:
  title: Things go wrong. Your process shouldn't.
  goal: Follow one trip through crashes, outages and a declined card, and see why a process built on Temporal never loses its place.
  about:
    - title: What you're starting
      text: Eight short steps and three quick questions. In each one you run a trip, break it the way real systems break, and watch what it does. Nothing to code, nothing to install.
    - title: Why a trip?
      text: Everyone has booked one. Several companies, any of which can fail, and stopping halfway costs money. Orders and payments work the same way.
worker: uv run essentials-worker
agentUi: false
tiers:
  - name: Built to survive
    badge:
      name: Unbreakable
---

Why a process built on Temporal never loses its place, told as the story of a trip coordinator and a logbook. Nothing to code, nothing to type: you run a trip, break it in the ways real systems break, and watch it carry on.
