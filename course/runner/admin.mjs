// /api/admin/*: what /admin shows and does, for ADMIN_EMAILS only. Cohorts and the allowlist,
// access requests, learners and their journeys, the activity feed, and the sandboxes.
import { DEFAULT_ALLOWANCE_MINUTES, ROLES } from "./accounts.mjs";
import { deriveProgress } from "./activity.mjs";

const fail = (status, message) => Object.assign(new Error(message), { status });

// RFC 4180: quoted when needed, CRLF between rows.
export function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : "");

export function createAdmin({ accounts, activity, manager, mailer, readJson, sessionOf, siteOrigin, log = () => {} }) {
  const catalog = activity.catalog;

  function requireAdmin(req) {
    const session = sessionOf(req);
    if (!session) throw fail(401, "Sign in first.");
    if (!session.admin) throw fail(403, "This is for the course's admins.");
    return session;
  }

  // Each learner's row: who, where they are, how far they've got.
  function learnerRows({ cohortId } = {}) {
    return accounts.users({ cohortId }).map(({ user, access }) => {
      const progress = activity.progress(user.id, access.cohort?.path);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company: user.company,
        status: user.status,
        allowed: access.allowed,
        cohort: access.cohort ? { id: access.cohort.id, name: access.cohort.name } : null,
        admin: accounts.isAdmin(user.email),
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at,
        completed: progress.completed.length,
        xp: progress.xp,
        path: progress.path,
        where: activity.whereIs(user.id, progress.completed),
        sandboxMinutes: activity.sandboxMinutesToday(user.id),
        allowanceMinutes: access.cohort?.allowance_minutes ?? DEFAULT_ALLOWANCE_MINUTES,
      };
    });
  }

  // How a cohort is doing: passes per module (along its path, or every playable module), and per
  // challenge the first-try right rate and the most-picked wrong choice.
  function summary({ cohortId } = {}) {
    const users = accounts.users({ cohortId });
    const cohort = cohortId ? accounts.cohort(cohortId) : null;
    const pathModules = cohort?.path ? (catalog.paths.get(cohort.path)?.modules ?? []) : null;
    const moduleIds = pathModules ?? [...catalog.modules.values()].filter((m) => m.status === "ready" && m.kind !== "boss").map((m) => m.id);
    const passes = Object.fromEntries(moduleIds.map((id) => [id, 0]));
    const challenges = {};
    for (const { user } of users) {
      const progress = deriveProgress(activity.eventsOf(user.id), catalog);
      for (const id of progress.completed) if (id in passes) passes[id]++;
      for (const [id, picks] of Object.entries(progress.attempts)) {
        if (!picks.length) continue;
        const right = catalog.rightChoice(id);
        const stats = (challenges[id] ??= { tried: 0, firstTry: 0, wrong: {} });
        stats.tried++;
        if (picks[0] === right) stats.firstTry++;
        for (const pick of picks) if (pick !== right) stats.wrong[pick] = (stats.wrong[pick] ?? 0) + 1;
      }
    }
    return {
      learners: users.length,
      modules: moduleIds.map((id) => ({ id, title: catalog.modules.get(id)?.title ?? id, kind: catalog.modules.get(id)?.kind ?? "module", passed: passes[id] })),
      challenges: Object.entries(challenges).map(([id, s]) => {
        const [wrong, count] = Object.entries(s.wrong).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
        return {
          id,
          title: catalog.modules.get(id)?.title ?? id,
          tried: s.tried,
          firstTryRate: s.tried ? s.firstTry / s.tried : 0,
          mostPickedWrong: wrong ? { choice: wrong, label: catalog.choiceLabel(id, wrong), count } : null,
        };
      }),
    };
  }

  function journey(userId) {
    const user = accounts.user(userId);
    if (!user) throw fail(404, "No such learner.");
    const access = accounts.accessFor(user.email);
    const events = activity.eventsOf(userId);
    const progress = activity.progress(userId, access.cohort?.path);
    const times = activity.moduleTimes(userId);
    const passedAt = {};
    const failedChecks = {};
    const bosses = [];
    const sessions = [];
    let helperQuestions = 0;
    let modelCalls = 0;
    let open = null;
    for (const e of events) {
      const data = e.data ? JSON.parse(e.data) : {};
      if (e.type === "module_passed" && !(e.module_id in passedAt)) passedAt[e.module_id] = e.at;
      else if (e.type === "check_failed") failedChecks[e.module_id] = (failedChecks[e.module_id] ?? 0) + 1;
      else if (e.type === "boss_result") bosses.push({ moduleId: e.module_id, at: e.at, ...data });
      else if (e.type === "helper_question") helperQuestions++;
      else if (e.type === "model_calls") modelCalls += data.count ?? 0;
      else if (e.type === "sandbox_started") open = open ?? e.at;
      else if (["sandbox_stopped", "sandbox_gone"].includes(e.type) && open) {
        sessions.push({ from: open, to: e.at, minutes: Math.round((e.at - open) / 60_000) });
        open = null;
      }
    }
    if (open) sessions.push({ from: open, to: null, minutes: Math.round((Date.now() - open) / 60_000) });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company: user.company,
        status: user.status,
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at,
        allowed: access.allowed,
        cohort: access.cohort ? { id: access.cohort.id, name: access.cohort.name } : null,
        admin: accounts.isAdmin(user.email),
      },
      xp: progress.xp,
      path: progress.path,
      where: activity.whereIs(userId, progress.completed),
      passed: progress.completed.map((id) => ({
        id,
        title: catalog.modules.get(id)?.title ?? id,
        at: passedAt[id] ?? null,
        seconds: times[id] ?? 0,
        failedChecks: failedChecks[id] ?? 0,
      })),
      inProgress: Object.entries(times)
        .filter(([id]) => !progress.completed.includes(id))
        .map(([id, seconds]) => ({ id, title: catalog.modules.get(id)?.title ?? id, seconds, failedChecks: failedChecks[id] ?? 0 })),
      challenges: Object.entries(progress.attempts).map(([id, picks]) => ({
        id,
        title: catalog.modules.get(id)?.title ?? id,
        picks: picks.map((choice) => ({ choice, label: catalog.choiceLabel(id, choice), right: choice === catalog.rightChoice(id) })),
      })),
      bosses,
      sandbox: { sessions: sessions.slice(-20), minutesToday: activity.sandboxMinutesToday(userId) },
      helperQuestions,
      modelCalls,
      timeline: events.slice(-300).reverse().map((e) => ({ type: e.type, moduleId: e.module_id, data: e.data ? JSON.parse(e.data) : null, at: e.at })),
    };
  }

  function feed(url) {
    const cohortId = url.searchParams.get("cohort");
    const userId = url.searchParams.get("user");
    const type = url.searchParams.get("type");
    const before = Number(url.searchParams.get("before")) || null;
    const ids = cohortId ? accounts.users({ cohortId }).map(({ user }) => user.id) : null;
    const where = [];
    const args = [];
    const add = (clause, ...values) => {
      where.push(clause);
      args.push(...values);
    };
    if (ids) add(`e.user_id IN (${ids.map(() => "?").join(",") || "NULL"})`, ...ids);
    if (userId) add("e.user_id = ?", userId);
    if (type) add("e.type = ?", type);
    if (before) add("e.id < ?", before);
    const rows = accounts.db
      .prepare(
        `SELECT e.*, u.email, u.name FROM events e LEFT JOIN users u ON u.id = e.user_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.id DESC LIMIT 200`,
      )
      .all(...args);
    return {
      events: rows.map((e) => ({ id: e.id, userId: e.user_id, email: e.email, name: e.name, type: e.type, moduleId: e.module_id, data: e.data ? JSON.parse(e.data) : null, at: e.at })),
      types: accounts.db.prepare("SELECT DISTINCT type FROM events ORDER BY type").all().map((r) => r.type),
    };
  }

  function csv(res, name, rows) {
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    });
    res.end(toCsv(rows));
  }

  async function notify(promise, what) {
    try {
      await promise;
    } catch (err) {
      log(`${what} email failed: ${err.message}`);
    }
  }

  return {
    requireAdmin,
    routes: {
      "GET /api/admin/overview": async (req) => {
        requireAdmin(req);
        return {
          cohorts: accounts.cohorts(),
          pendingRequests: accounts.requests({ status: "pending" }).length,
          paths: [...catalog.paths.values()].map((p) => ({ id: p.id, title: p.title })),
          roles: ROLES,
        };
      },

      "POST /api/admin/cohorts": async (req) => {
        const { email } = requireAdmin(req);
        const cohort = accounts.saveCohort(await readJson(req), email);
        return { cohort };
      },

      "GET /api/admin/allowlist": async (req, _res, url) => {
        requireAdmin(req);
        return { entries: accounts.entries(Number(url.searchParams.get("cohort"))) };
      },

      "POST /api/admin/allowlist": async (req) => {
        const { email } = requireAdmin(req);
        const { cohortId, text } = await readJson(req);
        return accounts.addEntries(cohortId, text, email);
      },

      "DELETE /api/admin/allowlist": async (req, _res, url) => {
        const { email } = requireAdmin(req);
        accounts.removeEntry(Number(url.searchParams.get("id")), email);
        return { ok: true };
      },

      "GET /api/admin/requests": async (req) => {
        requireAdmin(req);
        return { requests: accounts.requests() };
      },

      "POST /api/admin/requests/decide": async (req) => {
        const { email } = requireAdmin(req);
        const { id, approve, scope, reason } = await readJson(req);
        const request = accounts.decide(id, { approve: Boolean(approve), scope, reason }, email);
        await notify(mailer.accessDecided(request, siteOrigin(req)), "decision");
        return { ok: true };
      },

      "GET /api/admin/requests.csv": async (req, res) => {
        requireAdmin(req);
        csv(res, "access-requests.csv", [
          ["name", "email", "role", "company", "status", "scope", "reason", "requested", "decided by", "decided"],
          ...accounts.requests().map((r) => [r.name, r.email, r.role, r.company, r.status, r.scope, r.reason, iso(r.createdAt), r.decidedBy, iso(r.decidedAt)]),
        ]);
      },

      "GET /api/admin/learners": async (req, _res, url) => {
        requireAdmin(req);
        const cohortId = url.searchParams.get("cohort") || null;
        return { learners: learnerRows({ cohortId }), summary: summary({ cohortId }) };
      },

      "GET /api/admin/learners.csv": async (req, res, url) => {
        requireAdmin(req);
        const rows = learnerRows({ cohortId: url.searchParams.get("cohort") || null });
        csv(res, "learners.csv", [
          ["name", "email", "role", "company", "cohort", "modules passed", "xp", "last active"],
          ...rows.map((r) => [r.name, r.email, r.role, r.company, r.cohort?.name, r.completed, r.xp, iso(r.where?.lastAt ?? r.lastSeenAt)]),
        ]);
      },

      "GET /api/admin/learner": async (req, _res, url) => {
        requireAdmin(req);
        return journey(url.searchParams.get("id"));
      },

      "POST /api/admin/learner": async (req) => {
        const { email } = requireAdmin(req);
        const { id, status, cohortId } = await readJson(req);
        if (status) accounts.setStatus(id, status, email);
        if (cohortId) accounts.moveToCohort(id, cohortId, email);
        return { ok: true };
      },

      "DELETE /api/admin/learner": async (req, _res, url) => {
        const { email } = requireAdmin(req);
        const id = url.searchParams.get("id");
        await manager.reset(id).catch((err) => log(`deleting a deleted learner's sandbox failed: ${err.message}`));
        accounts.deleteUser(id, email);
        return { ok: true };
      },

      "GET /api/admin/activity": async (req, _res, url) => {
        requireAdmin(req);
        return feed(url);
      },

      "GET /api/admin/sandboxes": async (req) => {
        requireAdmin(req);
        const sandboxes = await manager.listAll();
        return {
          max: manager.config.maxSandboxes,
          sandboxes: sandboxes.map((s) => {
            const user = accounts.user(s.learner);
            return { ...s, email: user?.email ?? null, name: user?.name ?? null };
          }),
        };
      },
    },
  };
}
