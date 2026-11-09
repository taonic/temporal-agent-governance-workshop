# 02 · Map and navigation

Status: ready-for-human
Blocked by: 01
Spec: [../spec.md](../spec.md) (Map and navigation, Progression)

## What

- **The map is the home page**: hand-drawn SVG, the tree reading top down (trunk at the top), five coloured branches, tiers as rows, cross-branch prerequisites as dotted lines, fits one desktop screen with no pan or zoom. On phones it becomes a vertical accordion: branch, then tier, then modules.
- **Node card** on hover or tap: title, teaser, time, XP, prerequisites, status, Enter. Locked nodes warn but can still be entered.
- **Module top bar**: breadcrumb, mini-map and Next (follows the path if one is active, otherwise branch order). Remove the Previous / picker / Next bar.
- **XP, levels and title** (spec numbers) stored in localStorage for now. Shows an XP animation on pass and a class-unlock animation on boss win. Sound is off by default.
- **Paths**: `?path=` highlights the route on the map and drives Next.
- Keeps the loan-origination design tokens in light and dark.

## Done when

The whole workshop can be done from the map alone, with no picker. `?path=agent-governance-4h` reproduces today's order. XP survives a reload. e2e covers map → module → pass → Next.

## Comments

**2026-11-07 · implemented, awaiting review (not committed, branch `temporal-quest`).** Built on 01.

- The map is the home page (`MapPage.vue`, `SkillMap.vue`), with every branch, tier and boss, and the content of other issues on it as coming-soon nodes: a boss per branch (`boss/boss.md`), four Payments, three AI SDLC and four Worker ops modules, and the Fundamentals building blocks (now a chain, F8 → F13).
- Cross-branch prerequisites are chips on the node instead of dotted lines: lines across branches crossed the other columns.
- `#/module/<id>` opens the exercise that has the module, at its first beat. Per-module pages wait for per-module checks (03).
- The top bar: Map, breadcrumb, mini-map, Next and an XP pill. The picker and Previous are gone.
- XP: moving past a module's last beat completes it, and so does the exercise's check for its last one.
- Checked in screenshots at 1920×1080, 1440×900, 1366×768, 1100×800 and 390×844, in light and dark, with and without a path.
- e2e `@public`: the home, card, every-exercise and Next/path tests pass against the dev server (the 5 failures are local-only, as in 01). `coursePages` now reads the map's nodes.
