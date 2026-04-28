---
name: Bug report
about: Something doesn't work as it should
title: "[bug] "
labels: bug
assignees: ''
---

## What happened

<!-- One paragraph: what you did, what you expected, what actually happened. -->

## Where

- Source page URL (or domain at minimum):
- Salla store you pasted into:
- Browser + version (e.g. Chrome 132 on macOS 14):

## Extension version

<!-- Run this in the chrome://extensions service-worker console after you
     reload the extension and reproduce, then paste the output: -->

```
[ProductCopier] background.js build X.Y.Z (...)
[ProductCopier] content_copy.js build X.Y.Z (...)
```

If they don't match `manifest.json`, that's the first thing to fix — see
the version-stamp invariant in [`CLAUDE.md`](../CLAUDE.md).

## Console output

<!-- Filter the SW console by `ProductCopier` (so PostHog/Intercom noise from
     Salla doesn't drown it out) and paste the relevant lines. -->

```
[paste console here]
```

## Steps to reproduce

1.
2.
3.

## What you expected to happen

## What actually happened

## Additional context

<!-- Screenshots, the rewrite rules you have configured, anything else
     that might help reproduce. DON'T paste your Gemini API key. -->
