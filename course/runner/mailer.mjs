// Email, through Resend's HTTP API: sign-in codes, access requests' notifications, and feedback. A local
// runner without RESEND_API_KEY prints them to its console instead. The e2e tests' addresses
// never get email.
import { E2E_EMAIL } from "./accounts.mjs";

const escape = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(heading, body) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Temporal Quest</p>
<h1 style="margin:0 0 16px;font-size:20px">${heading}</h1>${body}
</div></body></html>`;
}

export function createMailer(config, { fetchImpl = fetch, log = console.log } = {}) {
  async function send({ to, subject, html, text, replyTo }) {
    const recipients = (Array.isArray(to) ? to : [to]).filter((address) => !E2E_EMAIL.test(address));
    if (!recipients.length) return;
    if (!config.resendApiKey) {
      log(`email to ${recipients.join(", ")}: ${subject}\n${text}`);
      return;
    }
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.mailFrom, to: recipients, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw Object.assign(new Error(`The email couldn't be sent (${res.status}). Try again in a minute.`), { status: 502, detail });
    }
  }

  return {
    send,

    signInCode(email, code) {
      return send({
        to: email,
        subject: `${code} is your Temporal Quest code`,
        text: `Your sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, ignore this email.`,
        html: page(
          "Your sign-in code",
          `<p style="margin:0 0 16px">Enter this code on the page you signed in from. It works for 10 minutes.</p>
<p style="margin:0 0 20px;font:600 32px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em">${escape(code)}</p>
<p style="margin:0;color:#6b7280;font-size:13px">If you didn't ask for it, ignore this email.</p>`,
        ),
      });
    },

    // To every admin: someone asks to be let in.
    accessRequested(admins, request, siteOrigin) {
      if (!admins.length) return Promise.resolve();
      const link = `${siteOrigin}/#/admin/requests`;
      const who = `${request.name} (${request.role}, ${request.company ?? request.email})`;
      return send({
        to: admins,
        subject: `Access request: ${request.name} at ${request.company ?? request.email}`,
        text: `${who} <${request.email}> asked for access to Temporal Quest.\n\nApprove or reject it: ${link}`,
        html: page(
          "New access request",
          `<p style="margin:0 0 16px"><strong>${escape(request.name)}</strong>, ${escape(request.role)}<br>${escape(request.email)}</p>
<p style="margin:0"><a href="${escape(link)}" style="display:inline-block;background:#16181d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Review the request</a></p>`,
        ),
      });
    },

    // To the learner: their request was decided.
    accessDecided(request, siteOrigin) {
      if (request.status === "approved") {
        return send({
          to: request.email,
          subject: "You're in: Temporal Quest",
          text: `Your request was approved. Sign in at ${siteOrigin} with ${request.email}.`,
          html: page(
            "You're in",
            `<p style="margin:0 0 16px">Your request for Temporal Quest was approved. Sign in with ${escape(request.email)}.</p>
<p style="margin:0"><a href="${escape(siteOrigin)}" style="display:inline-block;background:#16181d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Start the course</a></p>`,
          ),
        });
      }
      const reason = request.reason ? `\n\nThe reason given: ${request.reason}` : "";
      return send({
        to: request.email,
        subject: "Your Temporal Quest request",
        text: `Your request for Temporal Quest wasn't approved.${reason}`,
        html: page(
          "Your request wasn't approved",
          `<p style="margin:0">Your request for Temporal Quest wasn't approved.</p>${request.reason ? `<p style="margin:16px 0 0;color:#374151">${escape(request.reason)}</p>` : ""}`,
        ),
      });
    },

    // To FEEDBACK_EMAILS: someone sent feedback. Replying answers them.
    feedback(recipients, fb, siteOrigin) {
      if (!recipients.length) return Promise.resolve();
      const who = fb.name ? `${fb.name} <${fb.email}>` : fb.email;
      const about = [fb.role, fb.company].filter(Boolean).join(", ");
      const kind = fb.kind ? `[${fb.kind}] ` : "";
      const where = fb.where || "somewhere";
      const link = fb.context?.url ? `${siteOrigin}/${fb.context.url.replace(/^\//, "")}` : siteOrigin;
      const admin = `${siteOrigin}/#/admin/feedback`;
      const extra = [fb.context?.sandbox && `sandbox: ${fb.context.sandbox}`, fb.context?.viewport?.width && `window: ${fb.context.viewport.width}×${fb.context.viewport.height}`, fb.context?.userAgent]
        .filter(Boolean)
        .join(" · ");
      return send({
        to: recipients,
        replyTo: fb.email,
        subject: `${kind}Feedback from ${fb.name || fb.email}: ${where}`.slice(0, 200),
        text: `${who}${about ? ` (${about})` : ""} sent feedback${fb.kind ? ` (${fb.kind})` : ""}.\n\nWhere: ${where}\n${link}\n\n${fb.message}\n\n${extra}\n\nAll feedback: ${admin}\nReply to this email to answer them.`,
        html: page(
          `Feedback${fb.kind ? `: ${escape(fb.kind)}` : ""}`,
          `<p style="margin:0 0 4px"><strong>${escape(fb.name || fb.email)}</strong>${about ? `, ${escape(about)}` : ""}<br><span style="color:#6b7280">${escape(fb.email)}</span></p>
<p style="margin:0 0 16px;color:#6b7280;font-size:13px">On <a href="${escape(link)}" style="color:#374151">${escape(where)}</a></p>
<blockquote style="margin:0 0 20px;padding:12px 16px;background:#f6f7f9;border-left:3px solid #16181d;border-radius:4px;white-space:pre-wrap">${escape(fb.message)}</blockquote>
${extra ? `<p style="margin:0 0 20px;color:#6b7280;font-size:12px">${escape(extra)}</p>` : ""}<p style="margin:0"><a href="${escape(admin)}" style="display:inline-block;background:#16181d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">All feedback</a></p>
<p style="margin:16px 0 0;color:#6b7280;font-size:13px">Reply to this email to answer them.</p>`,
        ),
      });
    },
  };
}
