---
description: Walk a user through a copy + paste smoke test on a specific product URL. Use when verifying a fresh install or after a rewrite-rules change.
argument-hint: "<product-url>"
---

Test the extension end-to-end on this product: **$ARGUMENTS**

Talk the user through it step by step. After each step, ask them to share
the result (text, screenshot, or what they're seeing) before moving on.

---

## Step 1 — Open the product page in Chrome
Tell them: "Open `$ARGUMENTS` in a Chrome tab. Tell me when the page is
fully loaded."

## Step 2 — Run Copy
Tell them:
1. Click the extension's puzzle-piece icon → **Product Copier → Salla**
2. In the popup, click the big purple **نسخ من هذه الصفحة** button
3. Wait for the green "✅ تم النسخ!" message

Ask them: "What does the popup say after the copy finishes? Specifically:
- The number of images
- Whether the description checkmark is ✓ or ✗
- The product title shown in the preview card"

If `0 صورة` or no description, ask them to filter the page's DevTools
Console (F12 → Console) by `ProductCopier` and share what they see. Then
run `/troubleshoot`.

## Step 3 — Open Salla's add-product page
Tell them to open `https://s.salla.sa/products/new` in a new tab.

## Step 4 — Decide on rewrite
Ask: "Do you want to test with the rewrite toggle ON or OFF this time?"
- **ON**  → AI rewrites in the store's saved voice. Slower (~3-5 s for the
  Gemini call), but the title and description come out branded.
- **OFF** → original DOM-extracted text goes in as-is.

Tell them to flip the **✍️ إعادة كتابة بأسلوب متجرك** toggle accordingly,
then click **✅ لصق البيانات في سلة**.

## Step 5 — Verify the form filled in
Ask them to confirm:
- [ ] Title field has text (in Arabic if rewrite was ON)
- [ ] Description editor has formatted content (paragraphs + bullets if
      the source had them, or the rewrite produced them)
- [ ] Image uploader shows the right number of files
- [ ] Cover image (the first one) is square white-bg with a clear ~15%
      margin
- [ ] Gallery images preserve their original framing

If any of those is off, ask them to share a screenshot. If the rewrite ran
but the output doesn't match their store's voice, run
`/configure-store <their-store-url>` to refine the rules.

## Step 6 — (Optional) Save the product
Tell them: "If everything looks right, click Salla's own Save button to
finish creating the product. Don't worry — you can always edit or delete
it from your Salla dashboard."
