---
description: Walk a non-technical user through first-time setup of the Product Copier Chrome extension end-to-end.
argument-hint: "(no arguments)"
---

You are helping a non-technical store owner set up the Product Copier
Chrome extension on their machine. They have **no** background in
extensions, JavaScript, or Chrome's developer tools. Speak plain English,
ask one thing at a time, and **always wait for confirmation** before moving
on. Don't assume anything.

Run this checklist top to bottom. After each numbered step, ask "Done? Ready
for the next step?" and wait for the user's reply.

---

## Step 1 — Confirm they have what they need

Before anything else, make sure they have:
- Google Chrome (any recent version is fine)
- A Google account (free Gemini API keys live behind one)
- The extension folder downloaded (cloned or unzipped to a known path)

If they don't have the folder yet, tell them:
> "Download the repo as a ZIP from
> https://github.com/OutQio/pilot — click the green
> `<> Code` button → Download ZIP → unzip it. Tell me the folder path
> once it's done."

## Step 2 — Load the extension into Chrome

Walk them through this exact sequence:
1. Open a new Chrome tab and go to `chrome://extensions`
2. In the top-right of that page, **toggle Developer mode ON**
3. Three buttons appear at the top-left — click **Load unpacked**
4. Navigate to the extension folder they downloaded → click **Select**
5. The extension card should appear with the name **Product Copier → Salla
   (AI)** and a version number

Ask them: "What does the version number say under the extension name?"
The answer should be **5.4.9** or higher. If it's lower, they downloaded an
old release — direct them to download fresh from the green Code button on
the GitHub page.

## Step 3 — Get a Gemini API key

Tell them:
> "Open https://aistudio.google.com/app/apikey in a new tab, sign in
> with your Google account if needed, and click **Create API key**. Copy
> the key (starts with `AIzaSy...`). It's free up to a generous limit and
> only costs anything if you process thousands of products a day."

Wait for them to confirm they have the key. **Don't ask them to paste it
to you.** They paste it into the extension, not into chat.

## Step 4 — Save the key in the extension

Tell them:
1. Click the extension's puzzle-piece icon in Chrome's toolbar →
   **Product Copier → Salla**
2. Click the **⚙️ gear icon** in the top right of the popup
3. The Options page opens in a new tab
4. Paste their API key into the **Gemini API Key** field
5. Click **🧪 اختبار** (Test) — it should turn green and say
   `✅ مفتاح Gemini يعمل! تم الحفظ.`

If it says anything else, ask them to copy/paste the error message and I'll
diagnose.

## Step 5 — (Optional) Configure rewrite rules for their store

Ask: "Do you want to use AI to rewrite product titles and descriptions in
your store's voice? It's optional — you can always toggle it off when
pasting." If yes, suggest they run `/configure-store <their-store-url>` to
have me derive the rules automatically.

## Step 6 — Test it works

Tell them to:
1. Open any product page on Amazon, eBay, or any e-commerce site
2. Click the extension icon → click the big purple **نسخ من هذه الصفحة**
   button
3. They should see a green "✅ تم النسخ!" message with an image count and
   a description checkmark

If it works, congratulate them and explain the next time they want to add
a product to Salla, they:
1. Open the source product page → click the extension → Copy
2. Open `https://s.salla.sa/products/new` → click the extension → Paste
3. Salla's form fills in; review and click Salla's Save button

If it doesn't work, run `/troubleshoot` and walk through the symptom-to-fix
table with them.
