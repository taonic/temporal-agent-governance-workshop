# 04c · Access requests

Status: ready-for-human
Blocked by: 04a
Spec: [../spec.md](../spec.md) (Accounts, cost and events)

The portal is for on-demand training as well as workshops. Someone whose company isn't on the allowlist can ask to be let in.

## What

- **Personal email addresses are turned away.** A fixed list in code covers the common free-mail domains: gmail/googlemail, outlook/hotmail/live/msn, yahoo, icloud/me/mac, proton/protonmail, aol, gmx, mail.ru, yandex, qq, 163/126, zoho. Such an email gets "Please use your company email", and no code is sent. An **exact email entry on the allowlist overrides this**, so a workshop attendee registered with Gmail still gets in.
- **The email is verified before the request.** A company email that isn't on the allowlist still gets a code. Only after entering the code does the learner see the access-request form: name and role (the same fields as 04a's profile), with the company inferred from the domain. This way nobody can file a request for an email they don't own.
- **Pending.** A verified learner with an open request gets a session in a `pending` state. They see the public map (04e) with a banner, "Request pending: we'll email you", and nothing else.
- **Approving or rejecting.** `/admin` gains a **Requests** tab: pending requests with name, role, company, email and date, and a reject or approve choice.
  - **Approve this email** is the default. It adds the exact email.
  - **Approve all of @domain** adds a domain rule.
  - **Reject** takes an optional reason.

  Approved entries go into a built-in **On-demand** cohort, which has no end date and the default allowance. An admin can move them to another cohort later. The tab has an **Export CSV** button.
- **Notifications** go through Resend.
  - **New request:** every `ADMIN_EMAILS` address gets an email with a link to the Requests tab.
  - **Approved:** the requester gets "You're in: sign in at temporalquest.dev".
  - **Rejected:** the requester gets an email with the reason, if one was given.

## Done when

A Gmail address is asked for a company email unless an admin listed it exactly. An unlisted company email verifies, files a request and sees the pending banner. The admin is emailed, approves it for that email only, and the learner is emailed and can start a sandbox. Approving by domain lets a second address on that domain straight in. Unit tests cover the free-mail check and the exact-entry override. An e2e test runs a request through approval, using 04a's e2e code for sign-in and checking the notification is attempted (not delivered).

## Comments

- 2026-11-10: Implemented with 04a, not committed. Awaiting review.
  - **Free-mail list:** `PERSONAL_DOMAINS` in `accounts.mjs`.
  - **Re-requests:** a learner whose request was approved and who was later taken off the allowlist can ask again. A rejected request stands.
  - **Domain approval:** "Approve all of @domain" is refused for a personal domain.
  - **e2e emails:** e2e addresses never get email, including the admin notifications sent to `e2e+admin@…`.
  - **Verified:** an e2e test runs a request through approval. A real notification wasn't verified (no Resend domain yet).
