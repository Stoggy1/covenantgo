# CovenantGo

**CovenantGo** connects TikTok GO creators with **hotels, resorts, and things
to do** for **content days** across the United States and Mexico.

This is the MVP. It's an installable web app (PWA) hosted free on GitHub Pages
that you open on an iPhone and add to the home screen. It runs on static demo
data, and it's set up so a real API and database can be plugged in later.

> All partner names in `/data` are **fictional placeholders** for the demo.

## What the MVP does

- **Account creation**: name, email, password, home location (country/state/city), and social platforms (TikTok, Instagram, Snapchat, Facebook, YouTube, X) with handles and follower counts
- **Discover**: browse upcoming content days, search by keyword, filter by **Country → State → City** (USA and Mexico), platform, and category (Hotels & Resorts / Things to Do)
- **Content day details**: perks, deliverables, TikTok GO commission %, minimum followers, spots left
- **Request a spot**: eligibility check against the creator's follower count
- **My Days**: track requests
- **Profile**: edit location and platforms

## Run it locally

```bash
node tools/serve.mjs
```

Then open http://localhost:5173.

## Put it on GitHub and open it on iPhone

1. Create a repo on GitHub (e.g. `covenantgo`) and push this folder:
   ```bash
   git init && git add . && git commit -m "CovenantGo MVP"
   git branch -M main
   git remote add origin https://github.com/<you>/covenantgo.git
   git push -u origin main
   ```
2. On GitHub, go to **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. After about a minute the app is live at `https://<you>.github.io/covenantgo/`.
4. On the iPhone, open that link in **Safari**, tap **Share → Add to Home Screen**. It then opens full-screen like a native app.

Every push to `main` redeploys automatically. Bump `VERSION` in `sw.js` when you
deploy so installed phones pick up the new version.

## Project layout

```
index.html                 App shell + iOS home-screen tags
css/styles.css             Styles (mobile-first, safe-area aware)
js/config.js               ← switch static ↔ API here
js/app.js                  Screens + hash router
js/services/dataService.js Content days / partners / locations (static or API)
js/services/authService.js Sign up / login / profile (local demo or API)
js/services/http.js        Fetch wrapper with bearer token
data/*.json                Demo data (same shape the API must return)
tools/generate-sample-data.mjs  Regenerates demo data
db/schema.sql              PostgreSQL schema for users, platforms, partners, content days, applications
docs/API.md                REST contract the backend must implement
sw.js, manifest.webmanifest  Offline + installable app support
```

## Path to production

| Today (MVP) | Next |
|---|---|
| Accounts saved in the browser (`AUTH_PROVIDER: 'local'`) | Supabase Auth / Firebase / custom API, plus Sign in with Apple |
| Static JSON (`DATA_SOURCE: 'static'`) | Postgres (`db/schema.sql`) behind the API in `docs/API.md` |
| Hand-entered demo partners | Server-side ingestion job syncing TikTok GO listings and hospitality-group feeds |
| Follower counts typed by the creator | OAuth connect to TikTok / Instagram / etc. to verify handles and counts |

**Important:** the demo login only exists on the device that created it, and
it isn't secure. It's for showing the flow only. Don't collect real users' data
until the backend is in place.
