// CovenantGO runtime configuration.
// Flip DATA_SOURCE / AUTH_PROVIDER to "api" once the backend exists —
// no UI code needs to change.
export const CONFIG = {
  APP_NAME: 'CovenantGO',

  // Brand logo image, e.g. "icons/logo.png". Empty = text logo.
  LOGO_URL: '',

  // "static" = read bundled JSON in /data, "api" = call API_BASE_URL
  DATA_SOURCE: 'static',

  // "local" = demo accounts saved in this browser, "api" = backend auth
  AUTH_PROVIDER: 'local',

  // e.g. "https://api.covenantgo.com/v1"
  API_BASE_URL: '',

  SUPPORTED_COUNTRIES: ['US', 'MX'],

  // Subscription plans (Pricing tab). DEMO prices: change freely.
  // Subscribing is demo-only until real billing (e.g. Stripe) is connected.
  PLANS: [
    {
      id: 'vault',
      name: 'Footage Vault Unlimited',
      price: 99,
      tagline: 'Create anytime with our team’s footage.',
      features: ['Unlimited Footage Vault usage', 'Every new clip as it’s added', 'Repurpose clips in your TikTok GO posts', 'Learn course included'],
    },
    {
      id: 'days',
      name: 'Content Day Pass',
      price: 149,
      contentDaysPerWeek: 2,
      tagline: 'Get booked at hotels and experiences every week.',
      features: ['{n} content days a week', 'Priority requests at Featured partners', 'Earn rewards faster', 'Learn course included'],
    },
    {
      id: 'all',
      name: 'All Access',
      price: 199,
      popular: true,
      tagline: 'Everything CovenantGO offers, no limits.',
      features: ['Unlimited Footage Vault usage', 'Unlimited content days', 'Priority requests at Featured partners', 'Learn course included'],
    },
  ],

  // Texts + emails (opt-out). Sending happens on the backend (e.g. Twilio + SendGrid).
  MESSAGING: {
    inactivityDays: 7,            // "we miss you" teaser after this many days away
    avgMonthlyEarnings: 1240,     // DEMO figure for the teaser; replace with real data
    // Consent shown wherever we collect a phone number. Have counsel review before launch.
    smsDisclosure: 'By adding your phone number, you agree to receive recurring automated texts from CovenantGO about content days for you, rewards, and promotions. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help, or turn texts off anytime in Profile.',
    emailDisclosure: 'We’ll email you content days for you, rewards, and promotions. Unsubscribe anytime from any email or in Profile.',
  },

  // true = every listing shows a photo (MVP demo look).
  // false = only Featured (paid) partners get photos; others show a plain banner (the upsell).
  PHOTOS_FOR_ALL_LISTINGS: true,

  // TEMPORARY: shows a "Preview the app (demo)" button that skips sign-up.
  // Set to false before real launch.
  DEMO_MODE: true,

  // TikTok GO agencies for the sign-up picker.
  // TODO: replace the placeholders with the 14 official TikTok GO agency names.
  AGENCIES: [
    'Covenant Creative',
    ...Array.from({ length: 13 }, (_, i) => `TikTok GO Agency ${i + 2} (placeholder)`),
  ],
  NO_AGENCY: 'none',

  // Creators with no agency can opt in to hear from this agency (recruiting).
  RECRUITING_AGENCY: 'Covenant Creative',

  // Rewards contest. Hitting EITHER goal enters the creator for the prize.
  REWARDS: {
    prize: 'Win a Creator trip for two',
    prizeDetail: 'Flights + 3 nights at a featured partner resort. Demo prize, final prize and rules TBD.',
    contentDaysGoal: 5,
    postLinksGoal: 10,
  },

  // Platforms shown in the app. Add ids from PLATFORMS to turn more back on.
  ENABLED_PLATFORMS: ['tiktok'],

  PLATFORMS: [
    { id: 'tiktok', label: 'TikTok' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'snapchat', label: 'Snapchat' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'youtube', label: 'YouTube' },
    { id: 'x', label: 'X' },
  ],
};
