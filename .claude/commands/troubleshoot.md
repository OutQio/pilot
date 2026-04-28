---
description: Diagnose a problem the user is hitting with the extension. Walks the symptom-to-fix table interactively.
argument-hint: "(describe the symptom, optional)"
---

Help the user diagnose: **$ARGUMENTS**

If they didn't describe the symptom yet, ask them: "Tell me what's
happening. Specifically: which step (Copy or Paste), what they see in the
extension popup, and any error message."

Then walk through this triage.

---

## 1. Verify the loaded version is current

The #1 cause of "weird behaviour" reports is a stale build of the
extension. Have them:
1. Open `chrome://extensions`
2. Find **Product Copier → Salla** and confirm the version shown
3. The latest released version is in `manifest.json` on the main branch.
   Ask them: "What version does Chrome show?"

If it doesn't match the latest:
- Tell them to click the 🔄 reload icon on the extension card
- If still stale, tell them: "Click **Details** on the extension card →
  scroll to **Source** → confirm the path matches the folder you cloned.
  If it points to a different folder (e.g. an old ZIP you unzipped
  somewhere else), click **Remove**, then **Load unpacked** again from
  the up-to-date folder."

If still stale after a clean re-load: have them toggle the extension off
and on at chrome://extensions to force a service-worker re-registration.

## 2. Match the symptom

Walk them through the likely causes by symptom:

### "Paste fails with `Cannot read properties of undefined`"
The service worker is stale and doesn't recognize the `aiRewrite` action.
Fix: full reload as in step 1. If it persists, toggle the extension off
and on.

### "The rewrite toggle is greyed out / disabled"
Either the Gemini key is missing, or rewrite rules aren't saved. Have them
check the Options page — both must be filled in. If they don't have rules,
suggest `/configure-store <their-store-url>`.

### "Rewrite happens but the style is off / not their brand voice"
The rewrite rules don't capture their voice well. Have them run
`/configure-store <their-store-url>` to re-derive from their actual
catalog.

### "Gallery images come out distorted / wrong orientation"
This was fixed in 5.4.9 (EXIF orientation now honoured + 2000 px dim cap).
If they're on 5.4.9+ and still see distortion, ask them to share the
service-worker console log filtered by `ProductCopier` so we can see what
`reencodeAsWebP` reported.

### "Image #2 looks identical to image #1 but un-cropped"
The DOM scraper emitted the same URL twice from different sources.
Already deduped in 5.4.9 — verify the version. If it persists, the source
page is producing extra duplicates the dedup doesn't catch; share the
SW console output.

### "Amazon: only 1 image extracted" (or 0)
The scraper's `#imageBlock_feature_div` whole-HTML scan needs to fire.
Verify they're on 5.4.9. If yes, ask them to run this in the Amazon page's
DevTools Console (filter by `ProductCopier`):
```js
(async () => {
  const r = await fetch(chrome.runtime.getURL('content_copy.js')).then(r => r.text());
  new Function(r)();
  console.log(window.__copiedProduct);
})();
```
Share the output.

### "Gemini returns `لم يُرجع JSON صالحاً`"
The model returned a shape `parseGeminiJson` couldn't recover. The full
raw response is logged in the SW console. Ask them to share it (filter
by `ProductCopier` — first 800 chars of the response are logged).

### "`Test API Key` button shows MAX_TOKENS with empty body"
The model is in thinking mode and burning the output budget on hidden
chain-of-thought. Already fixed (`thinkingConfig.thinkingBudget: 0`) in
5.3.0+. Verify their version.

### "Paste says `❌ يرجى الانتقال إلى صفحة إضافة منتج في سلة`"
They're not on a Salla domain. The extension only pastes to `*.salla.sa`
or `*.salla.com`. Confirm they have `https://s.salla.sa/products/new`
open in the **active tab** (not just an open tab in the background).

## 3. Capture diagnostics for anything else

If none of the above matches, have them:
1. Open `chrome://extensions` → Details → click **service worker** under
   Inspect views — that opens DevTools for the service worker
2. Filter the console by `ProductCopier`
3. Reproduce the issue
4. Share a screenshot of the filtered console + the SW build stamp line

With those two artifacts, almost any issue is diagnosable.

## 4. If the issue is a real bug

Have them open an issue at
https://github.com/OutQio/pilot/issues/new/choose — the bug template will
prompt them for the build stamp + filtered console output, which is what's
needed to reproduce.
