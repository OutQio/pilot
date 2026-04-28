# Security Policy

## Supported versions

Only the latest released version on `main` is supported. We don't backport
security fixes to older builds — instead, we ship a patch and expect users
to reload the unpacked extension.

## Reporting a vulnerability

**Don't open a public issue for security problems.** Instead:

1. Email the repo owner via the GitHub profile contact:
   <https://github.com/OutQio>
2. Or use GitHub's private advisory flow:
   <https://github.com/OutQio/pilot/security/advisories/new>

Please include:
- A clear description of the issue
- Steps to reproduce (if applicable)
- The version where you saw it (`manifest.json` `version` or the build
  stamp in the SW console)

You can expect an initial response within a few days. Coordinated disclosure
is appreciated — we'll work with you on a timeline before any public details.

## Scope

In scope:
- The Chrome extension code in this repo (`background.js`, `content_copy.js`,
  `paste_salla.js`, `popup.*`, `options.*`)
- The CI workflows in `.github/workflows/`

Out of scope:
- Third-party services we depend on (Google Gemini API, Salla's web app,
  Chrome's MV3 implementation). Report those upstream.
- Issues that require a malicious extension being installed alongside ours
  (we can't defend against full-trust code in the same browser).

## What we treat as a vulnerability

- Anything that could leak the user's Gemini API key off-machine
- XSS / DOM injection in the popup or options page
- Code execution in a content script triggered by a malicious source page
  beyond what `content_copy.js` already runs
- A bypass of the `isSallaTab` guard that lets us paste into a non-Salla page

## What we don't treat as a vulnerability

- Behaviour that requires the user to deliberately enter a hostile API key
- Spammy product pages that produce wrong scrape results — file a bug report
- Service-worker staleness after a code update — that's a Chrome behaviour,
  not a vuln; reload the extension card
