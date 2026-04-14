# Purdue Diet Planner

A lightweight web app for building a daily eating schedule around Purdue Dining menus, hydration targets, and supplement timing.

## What it does

- Pulls menus from Purdue Dining's official live GraphQL API used by Menus Online.
- Uses Purdue-published nutrition facts, ingredients, and dietary traits when they are available.
- Flags menu items whose nutrition is still pending in Purdue's data instead of guessing.
- Builds meal timing, hydration checkpoints, and supplement timing from a simple profile.
- Runs without third-party npm packages.

## Run locally

```bash
cd /Users/rajeshiyer_1/purdue-diet-optimizer
npm start
```

Then open `http://localhost:3010`.

## Notes

- The app now reads Purdue's live menu API directly rather than scraping client-rendered HTML.
- If Purdue has not published nutrition for an item yet, the app shows the live menu item and labels its nutrition as pending.
- Supplement guidance is intentionally conservative and should be personalized with a clinician or registered dietitian.
