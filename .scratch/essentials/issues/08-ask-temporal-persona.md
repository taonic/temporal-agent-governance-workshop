# 08 · Ask Temporal for non-developers

Status: done (2026-11-11), awaiting review
Blocked by: 01
Spec: [../spec.md](../spec.md) (Ask Temporal)

## What

The helper's prompt (`runner/helper.mjs`) knows the persona: for Non-developers, plain language, the coordinator-and-logbook story, no code unless asked, the docs still cited. Their questions use the runner's `KAPA_API_KEY`, and Ask Temporal's setup step never asks them to connect GitHub or Google.

## Done when

A Non-developer can ask a question without connecting anything, and gets a plain-language answer with links. Unit tests cover the prompt per persona.

## Comments

Built 2026-11-11. The page sends `context.persona`; `runner/helper.mjs` gives Essentials a plain-words prompt (the coordinator story, the engineers' words with their meanings, no code unless asked, docs still searched and cited, and what to do with "a process of my own"). Essentials asks only with the shared `KAPA_API_KEY`: without it the runner refuses with a plain 409 (no `verify` code) and the page shows Ask Temporal as off, so nobody is sent to connect GitHub or Google. Plain-language suggested questions per beat. Tests in helper.test.mjs.
