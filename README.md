# Pilot

Internal tool for our data entry team to add products to our Salla store end-to-end.

## Current state (v5.0.0)

A Chrome extension — **Product Copier → Salla (AI)** — that:
1. Scrapes product data (title, description, images, variants) from any e-commerce page
2. Uses Google Gemini to clean and structure the extracted data
3. Pastes the result into Salla's Add Product form

## Project structure

```
manifest.json       Chrome MV3 manifest
background.js       Service worker — Gemini API calls, rewrite rules
content_copy.js     Injected into source pages — scrapes product data
paste_salla.js      Injected into Salla — fills the Add Product form
popup.html/js/css   Extension popup UI (Copy / Paste buttons)
options.html/js/css Settings page (Gemini API key, rewrite rules)
icons/              Extension icons
```

## Setup

1. Clone this repo
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Click the extension icon → **Options** → paste your Gemini API key
   ([get one from Google AI Studio](https://aistudio.google.com/app/apikey))

## Workflow

- `main` — stable, matches what's loaded in Chrome
- Feature branches — `feat/<thing>`, merge via PR

## Roadmap

Evolve from a single extension into a full product onboarding platform:
- Web dashboard for the data entry team (review/approve queue)
- Bulk import (CSV/Excel, supplier sheets)
- Data quality scoring + validation rules
- Multi-user workflow with roles and audit trail
- Direct Salla API integration (skip the form-fill step)
