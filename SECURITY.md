# Security policy

## Reporting a vulnerability

Report privately to **mike@everythingvirtually.com**. Please do not open a
public issue for a security problem.

Include what you did, what happened, and what you expected. A proof of concept
helps but is not required. You will get an acknowledgement; if the report is
valid you will be told when a fix ships, and credited unless you would rather
not be.

## What is in scope

Sumcheck runs entirely in the browser and makes no network requests, so the
interesting surface is small and specific:

- **Anything that causes a network request at runtime.** The extension is built
  to make none. One would be a serious bug, not a feature.
- **Escaping the sanitizer.** Converted documents are untrusted input.
  `src/core/sanitize.js` is the single chokepoint every adapter's HTML passes
  through; script execution or markup injection reaching the app page or the
  emitted HTML is in scope.
- **Reading data the user did not offer.** The manifest requests no host
  permissions; site access is optional and per-origin. Anything that reads a
  page without an explicit user action is in scope.
- **Anything that writes a converted value the source document does not
  contain.** Silently altering a figure is the failure this project exists to
  prevent.

## What is out of scope

- OCR misreading a document. It is a statistical process; the flags exist
  because it is imperfect, and a misread that produces a different *real* word
  is undetectable by any automated check. See "When to trust the output" in the
  README.
- Vulnerabilities in bundled third-party components — report those upstream. We
  will pick up the fix; `THIRD_PARTY_NOTICES.md` lists versions.
