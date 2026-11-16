# Recruiting Hub

A point-and-click app for Covenant Creative's TikTok LIVE and TikTok Go creator recruiting.
It replaces running scripts from the terminal: anyone on the team can import lists, check
creator data, send outreach in safe batches, and track results, without touching code.

## Start it

- **Windows:** double-click `Start Recruiting Hub.bat`. Keep the black window open while you work.
- **Any computer:** `node recruiting/server.mjs`, then open http://localhost:5190

It needs Node.js 22.13 or newer (nodejs.org). Nothing else has to be installed.
All data is saved in `recruiting/data/recruiting.db`. Back up that file; it is not in git.

## What each page does

| Page | What it's for |
| --- | --- |
| **Dashboard** | Today's numbers: ready to message, messages sent vs. the daily limit, API checks vs. the plan limit, premium invites left, pipeline, hours, top Go sellers |
| **Creators** | Import lists (CSV, Google Sheets paste, or plain handles), search and filter, edit a creator, set status, flag multi-account risk, export |
| **Outreach** | Build a batch (max 350), start it, send, mark it done. The hub enforces the daily cap (1,500) and the wait between batches (60 min), and has a **Pause all sending** switch |
| **Go sales** | Go videos and sales per creator per month, leaderboards, and rewards (dining voucher, hotel stay…) with planned/sent tracking |
| **Revenue** | Monthly agency revenue, diamonds vs. benchmark, revenue share % |
| **Hours** | Log work time, see the week against the 10-hour limit, export for payroll |
| **Activity** | Who did what and when |
| **Settings** | Limits, invite rules, the creator data API, how messages are sent, sample data |

## Rules built in

- **Invite type:** regular if followers ≤ 200K **and** highest monthly diamonds (past 6 months) ≤ 200K; otherwise premium.
  Premium creators never go into batches. Setting one to "Invited" uses up a premium invite, and the hub
  refuses once none are left.
- **Batches only include** creators with status New, a regular invite, no multi-account flag, and a US account.
  Flagged and non-US creators show up under "Needs review".
- A creator in an open batch can't be put in another batch, so no one gets messaged twice.

## Creator data API

Until the provider is chosen, **Check data** runs in demo mode and fills in made-up numbers.
To connect the real one: Settings → Creator data API → Real API. Enter the address with `{handle}`
where the username goes, the key, and where each number sits in the response (e.g. `data.followers`).
Use **Test lookup** to see the raw response. The daily check limit (2,200 on the Pro plan) is enforced.

## Connecting the existing DM script

Settings → Sending → **Run a script**, command e.g. `python send_dms.py {file}`.
The hub writes the batch to a CSV (`handle,name,phone,program,league,region`) and passes its path as `{file}`
(also in the `BATCH_FILE` environment variable; the message is in `MESSAGE_TEMPLATE`).

For per-creator results, have the script print one line per creator:

```
SENT some_handle
FAIL other_handle
```

Without those lines, a clean exit counts as all sent and an error counts as none sent.
If the output mentions spam, rate limits, captchas or a restricted account, the hub stops the script
and pauses all sending until someone turns it back on.

Not ready to connect the script? Leave it on **Download the list**: download each batch's CSV,
send however you do today, then click **Mark done** and paste any handles that failed.

## Using it on your phone

The hub keeps running on the computer; your phone opens it over the network.

1. On the computer, double-click **`Start Recruiting Hub (phone access).bat`**.
   If Windows asks whether Node.js may use the network, allow it on **private networks**.
2. On the computer, go to **Settings → Phone access** and set a passcode (6+ characters).
   That card also shows the address to open on your phone, like `http://192.168.0.190:5190`.
3. On your phone (same Wi-Fi), open that address, enter your name and the passcode.
4. Tap Share → **Add to Home Screen** so it opens like an app. Phones stay signed in for 90 days.

**Away from home:** install the free [Tailscale](https://tailscale.com) app on the computer and the phone,
signed in to the same account. The Phone access card then also lists a `100.x.x.x` address that works from anywhere.

Notes:
- The computer must be on and the hub window open.
- The computer itself never asks for the passcode. Changing the passcode signs out every phone;
  **Sign out all devices** does the same without changing it.
- The script command and script folder can only be changed on the computer, not from a phone.
- Wrong passcodes are limited to 8 tries per 15 minutes.
