# CovenantGO texts & emails

Creators are **subscribed by default** and opt out in Profile → Notifications,
by replying **STOP** to a text, or with the unsubscribe link in any email.
Sending happens on the backend (e.g. **Twilio** for SMS, **SendGrid** or
**Postmark** for email). The app only stores preferences.

> **Before launch:** have counsel review the SMS consent wording
> (`CONFIG.MESSAGING.smsDisclosure`). US marketing texts fall under the TCPA
> and carrier (10DLC) rules; Mexico has its own rules. Store the consent time
> and the exact text shown (`notification_prefs.sms_consent_at` / `sms_consent_text`).

## Profile must be complete to book or use the vault

Before **Request a spot** or **Save to my clips**, the app checks for a valid
email **and** phone number. If either is missing, a "Complete your profile"
sheet appears. Saving it continues the action. Accounts created with
**Continue with TikTok** start without email/phone (TikTok doesn't share them),
so they'll see this the first time.

## Message types and triggers

| Type (pref key) | Channel | Trigger | Example |
|---|---|---|---|
| Content days for you (`matches`) | SMS + email | New content day matching the Creator's state/city and follower count | "3 new content days near Austin match your followers." |
| Prizes & rewards (`rewards`) | SMS + email | Contest launches, Creator is close to a goal, winners announced | "You're 2 posts away from a Creator trip for two 🏆" |
| Promotions (`promotions`) | SMS + email | Campaigns from CovenantGO or Featured partners | "Featured resorts in Tulum just added content days…" |
| Weekly updates when away (`reengagement`) | SMS + email | No app activity for `CONFIG.MESSAGING.inactivityDays` (7) days; max once a week | "We miss you! Creators earned $X on average last month." |
| Transactional (always sent) | SMS + email | Booking confirmed/declined, password reset | "You're confirmed for Poolside Golden Hour on Nov 18." |

Rules for every send:

1. Respect `notification_prefs` (channel **and** type must be on).
2. Text only if the Creator has a valid phone; email only if they have a valid email.
3. Quiet hours: no texts 9pm–9am in the Creator's local time.
4. Every text ends with "Reply STOP to opt out"; every email has an unsubscribe link.
5. Log each send in `message_log` (also used to cap the weekly teaser to once a week).

The "average earnings" figure in the teaser is `CONFIG.MESSAGING.avgMonthlyEarnings`
(a demo number). Replace it with real averages from TikTok GO commissions.
