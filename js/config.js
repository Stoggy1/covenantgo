// CovenantGo runtime configuration.
// Flip DATA_SOURCE / AUTH_PROVIDER to "api" once the backend exists —
// no UI code needs to change.
export const CONFIG = {
  APP_NAME: 'CovenantGo',

  // Brand logo image, e.g. "icons/logo.png". Empty = text logo.
  LOGO_URL: '',

  // "static" = read bundled JSON in /data, "api" = call API_BASE_URL
  DATA_SOURCE: 'static',

  // "local" = demo accounts saved in this browser, "api" = backend auth
  AUTH_PROVIDER: 'local',

  // e.g. "https://api.covenantgo.com/v1"
  API_BASE_URL: '',

  SUPPORTED_COUNTRIES: ['US', 'MX'],

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
    prize: 'Win a creator trip for two',
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
