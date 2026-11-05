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
