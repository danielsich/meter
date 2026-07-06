# Compliance operating notes

Internal record for the operator. Not legal advice; final legal sign-off remains
advisable. This file documents the manual routines that the public legal pages
(`public/privacy.html`, `public/imprint.html`) promise, so they are actually
carried out.

## Email retention routine (six-month deletion)

The privacy policy promises: *ordinary inquiries are deleted no later than six
months after the matter is closed, unless a longer period is required to assert,
exercise or defend legal claims, or to comply with statutory retention
obligations.*

To honour that, the operator performs the following, at least **quarterly** (a
calendar reminder is the simplest trigger):

1. In the `contact@danielsi.ch` Proton Mail mailbox, review conversations whose
   last message is **older than six months**.
2. For each, decide:
   - **Ordinary inquiry, closed** → delete the thread (and empty Trash, since
     Proton retains Trash until purged).
   - **Legal hold / statutory retention** (e.g. a dispute, a tax-relevant
     matter) → keep, and note why. Re-evaluate at the next review.
3. Apply the same rule to any local/offline copies (none are kept by default).

Retention starts from when the **matter is closed**, not from receipt. There is
no automated deletion; Proton offers no per-conversation TTL, so this review is
the control that makes the promise real.

If the contact mailbox provider ever changes, update both this routine and the
"Contacting us by email" section of `public/privacy.html`.

## HIPAA applicability decision

**Decision: HIPAA does not apply to meter.**

- The operator is **not a HIPAA covered entity** (not a health plan, health-care
  clearinghouse, or health-care provider transmitting health information in
  connection with a covered transaction) and **not a business associate** of any
  covered entity.
- meter processes **no Protected Health Information (PHI)**. The deployed data is
  synthetic; user-loaded clockwork exports (coding-activity minutes/prompts) are
  read only in the visitor's browser and are not health data.
- meter must **not** be advertised or labelled as "HIPAA compliant."

**Reassess if health data is ever introduced.** If the product is extended to
handle any health/medical information, revisit before shipping:

- HIPAA covered-entity / business-associate status and whether **BAAs** are
  required with any processors;
- the **FTC Health Breach Notification Rule** for non-HIPAA health apps
  (<https://www.ftc.gov/business-guidance/resources/health-breach-notification-rule-basics-businesses>);
- applicable **US state health-privacy laws** (e.g. Washington My Health My Data,
  and comparable state statutes);
- under GDPR, health data is a **special category** (Art. 9) requiring an
  explicit legal basis and a fresh DPIA.

## When to re-audit generally

Re-run the compliance review before adding: analytics, embeds, payments,
advertising, sponsors, user accounts, real published activity data, cookies or
other device storage, or any consumer-facing service.
