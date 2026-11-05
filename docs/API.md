# CovenantGo API contract

The app ships with static JSON in `/data`. When the backend is ready, set
`DATA_SOURCE: 'api'` and `AUTH_PROVIDER: 'api'` in `js/config.js`, point
`API_BASE_URL` at the server, and implement the endpoints below. The responses
must match the shapes in `/data/*.json`. The UI code doesn't change.

All authenticated requests send `Authorization: Bearer <token>`.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/signup` | `{ name, email, password, location: {country,state,city}, platforms: [{id,handle,followers}] }` | `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, user }` |
| POST | `/auth/logout` | — | `204` |
| GET | `/me` | — | `user` |
| PATCH | `/me` | partial `user` (`name`, `location`, `platforms`) | `user` |

`user` shape:

```json
{
  "id": "usr_…", "name": "…", "email": "…",
  "location": { "country": "US", "state": "Texas", "city": "Austin" },
  "platforms": [{ "id": "tiktok", "handle": "@me", "followers": 12000 }],
  "applications": [{ "contentDayId": "cd_001", "status": "pending", "appliedAt": "ISO-8601" }],
  "createdAt": "ISO-8601"
}
```

## Discovery

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/locations` | — | `{ countries: [{ code, name, states: [{ name, cities: [] }] }] }` |
| GET | `/partners` | — | `Partner[]` (see `data/partners.json`) |
| GET | `/partners/:id` | — | `Partner` |
| GET | `/content-days` | `q, country, state, city, platform, category, fromDate` | `ContentDay[]` with an embedded `partner` object |
| GET | `/content-days/:id` | — | `ContentDay` with an embedded `partner` |
| POST | `/content-days/:id/applications` | `{ note }` | `201` |
| GET | `/vault/clips` | `q, country, state, city, category` | `Clip[]` (see `data/vault-clips.json`) with an embedded `partner` |
| GET | `/vault/clips/:id` | — | `Clip` with an embedded `partner` |
| POST | `/vault/clips/:id/save` | — | toggles the clip in the user's `savedClips`; `204` |

Partners carry `listingTier` (`standard` | `featured`) and `photos[]`. The app
only shows photos on list and detail views for `featured` partners, which is the
paid upsell. `user.savedClips` is `[{ clipId, savedAt }]`.

## Partner ingestion (server-side only)

Keep the TikTok GO / hospitality-group feeds on the **server**, never in the
browser, because partner API keys must stay secret:

```
TikTok GO feed ─┐
Channel managers ├─► ingestion job (cron) ─► partners / content_days tables ─► /content-days API ─► app
Manual admin    ─┘
```

Every partner row has `source`, `tiktok_go_id`, and `synced_at` columns
(see `db/schema.sql`), so each feed can upsert its own records without
duplicating partners.
