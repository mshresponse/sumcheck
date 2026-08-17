# Privacy disclosure

For the **Privacy practices** tab. Chrome's policy updates effective
**1 August 2026** tightened Limited Use — data collection must be strictly
necessary to the declared single purpose, and all collection requires prominent
disclosure. Sumcheck collects nothing, so both are satisfied trivially; the
answers below say so explicitly rather than leaving fields blank.

---

## Data usage — collection disclosure

**Answer: none of the categories apply.** Leave every box unchecked.

The dashboard presents a list of data categories to disclose. Sumcheck collects,
transmits and stores **no** user data of any kind, so no category applies. The
categories as presented in the dashboard cover roughly: personally identifiable
information, health information, financial and payment information,
authentication information, personal communications, location, web history and
user activity, and website content.

> **Read the categories off the dashboard at submission time.** This list is
> from documentation, and the dashboard's exact wording and grouping change.
> The answer does not: nothing is collected, so nothing is checked.

The one that invites a second look is **website content** — Sumcheck does read
page content, and the content of files the user opens. It reads them *in order
to convert them, on the user's device, at the user's request*, and does not
collect, store or transmit them. Converted output exists in the tab until the
user downloads or discards it. "Collect" in this policy means gathering data off
the device; Sumcheck never does.

## Limited Use certifications

All three certifications can be affirmed. Verbatim wording is on the dashboard;
in substance they are that the developer does not sell or transfer user data to
third parties outside approved use cases, does not use or transfer it for
purposes unrelated to the item's single purpose, and does not use or transfer it
to determine creditworthiness or for lending.

Sumcheck transfers no user data anywhere, so each holds by construction rather
than by policy.

## Privacy policy

A publicly reachable privacy policy URL is **required** and is an open item —
see `CHECKLIST.md`. Suggested text:

```
Sumcheck does not collect, store or transmit any user data.

All document conversion happens locally in your browser. Files you convert,
pages you capture, and the resulting output never leave your device. The
extension makes no network requests while running, contains no analytics or
telemetry, and has no server component and no accounts.

Your conversion settings are stored locally in your browser (chrome.storage.local)
so they persist between sessions. A page you capture is held briefly in session
storage so the converter tab can read it, and is discarded within five minutes.
Neither is synced or transmitted.

Optional site access: if you use "Convert linked file", Chrome asks your
permission for that site so the file can be fetched and converted. That request
is made to the site hosting the file, by your browser, at your instruction —
nothing is sent to us, because there is no "us" to send it to.

Contact: <email>
```

Replace `<email>` before publishing.

## How the claim is enforced

Not a promise about a server — there is no server:

| claim | enforcement |
| --- | --- |
| no remote code | MV3 CSP `script-src 'self' 'wasm-unsafe-eval'`; `npm run check` fails on any remote `<script src>` |
| no runtime network requests | every dependency vendored in the package; verifiable by inspecting it |
| no analytics | no analytics dependency is bundled; `THIRD_PARTY_NOTICES.md` lists all 13 components |
| no broad site access | manifest declares no `host_permissions`; site access is optional and per-origin, asserted by `verify-extension.mjs` |

That last row is a test, not a claim: the harness asserts the shipped manifest
is **refused** when it tries to read a page without an explicit user gesture. If
the extension ever gained ambient host access, that check fails.
