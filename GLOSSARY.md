# Glossary

**Temporal Quest**: the course site. A skill tree of short modules about Temporal, taken at your own pace, which live events walk as paths.

**Module**: the unit of learning. One concept, one action and one check, about 5 minutes. Avoid calling it an "exercise", which is what the old 30–45 minute units were called.

**Branch**: a topic area of the tree (Fundamentals, AI Agent, Architecture & Nexus, Payments, AI SDLC, Worker ops). Every branch except Fundamentals grows from Fundamentals, the **trunk**.

**Tier**: a row of modules within a branch. A tier unlocks the one above it.

**Prerequisite** (`requires`): the modules that should be done before a module. A prerequisite can be in another branch, and the map draws that as a dotted line.

**Check**: what passes a module. It is one of **code** (pytest on the learner's file), **world** (the runner asks Temporal whether something happened) or **quiz**.

**Challenge**: a run-based checkpoint every 3–4 modules, drawn on the map as a diamond node. The learner picks one of 3–4 variants of the code they just wrote and watches it run, live in the sandbox or from a recording. Exactly one variant is right. Avoid calling it a "quiz", which is a module's check of 1–2 questions with nothing run.

**Scenario**: a challenge's script (`scenario.py`), which drives one variant against Temporal and reports what happened. It makes the challenge's recordings and checks them.

**Save point**: the code and stack state a module starts from, built from the solved state of its prerequisites.

**Boss**: the scenario quiz that ends a branch. It has 8 HP, and the learner has 3 hearts. Beating it awards the branch's **class title**.

**Badge**: what marks something a learner has done: a **tier badge** for a tier finished, a **boss badge** (the class title) for a boss beaten, or a **skill badge** for how they learned (Clean Run, No Peeking, Flawless, Explorer, Cross-Team). Once earned, it's kept. Badges carry no XP.

**Test-out**: beating a boss before doing its branch's modules, which marks the branch complete.

**Path**: an ordered list of modules, used for a live event or a curated route. It is chosen by the learner's cohort or by `?path=`.

**Allowlist**: who may sign in. Each entry is an exact email or a domain rule (`@acme.com`), and belongs to a cohort.

**Cohort**: a group of learners, such as one live event or the built-in **On-demand** cohort. It has an optional path, an optional end date, and the daily allowance for its learners. It replaces the old "event code". Avoid calling it an "event", which is the name for a row in the activity log.

**Access request**: what a learner with a verified company email files when they aren't on the allowlist. An admin approves the one email or the whole domain, or rejects it. Until then the learner is **pending**.

**Allowance**: how much sandbox time a learner may use in any rolling 24 hours, 8 hours unless their cohort sets otherwise.

**Admin**: someone listed in `ADMIN_EMAILS`. Admins use `/admin`. The word replaces "instructor" for this role, but "instructor" still means the person running a live event.

**Journey**: a learner's record in the admin panel: modules passed and how long each took, failed checks, challenge picks, boss results and sandbox time.
