/**
 * Centralised frontend configuration.
 * All VITE_* values can be overridden in a .env file at the project root.
 */
export const CONFIG = {
  /** Set VITE_USE_MOCK_DATA=true in .env to use generated mock data instead of the real backend. */
  USE_MOCK_DATA: import.meta.env.VITE_USE_MOCK_DATA === 'true',

  /** Backend base URL — default proxied through Vite dev-server (/api → localhost:8000). */
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '',

  /** Prediction endpoint (relative — resolved against API_BASE_URL or Vite proxy). */
  API_ENDPOINT: import.meta.env.VITE_API_ENDPOINT || '/api/v1/predict',

  /** Health endpoint. */
  HEALTH_ENDPOINT: import.meta.env.VITE_HEALTH_ENDPOINT || '/health',

  DEBUG_MODE: import.meta.env.VITE_DEBUG_MODE === 'true',

  /** How often (ms) to poll alarms. */
  ALARM_POLL_INTERVAL_MS: parseInt(import.meta.env.VITE_ALARM_POLL_INTERVAL_MS ?? '5000', 10),

  LONGITUDE_OFFSET: 0,

  OCEAN_KEYWORDS: ['ocean', 'sea', 'water', 'deep'],
  LAND_KEYWORDS:  ['land', 'continent', 'terrain', 'earth', 'ground'],

  ENABLE_COLOR_FALLBACK: true,

  /**
   * Target depths (metres) — must mirror backend constants.
   * Source: BackendProd/backend/app/core/config.py TARGET_DEPTHS
   */
  TARGET_DEPTHS: [5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000] as number[],

  /**
   * Years for which the model has data.
   * Source: backend AVAILABLE_YEARS
   */
  AVAILABLE_YEARS: [2000, 2001, 2002, 2003, 2004, 2005] as number[],

  /**
   * Canonical date used for all predictions (latest available).
   * The backend needs a full YYYY-MM-DD date.
   */
  DEFAULT_DATE: import.meta.env.VITE_DEFAULT_DATE || '2005-06-15',

  /**
   * Model grid bounds (from backend config.py).
   * lat: 5.125 – 29.875  |  lon: 45.125 – 104.875
   */
  GRID: {
    LAT_MIN: 5.125,
    LAT_MAX: 29.875,
    LON_MIN: 45.125,
    LON_MAX: 104.875,
  },

  /** Arabian Sea centre coordinates (used for focus button). */
  ARABIAN_SEA: { lat: 15.0, lon: 63.0, label: 'Arabian Sea' },

  /** Bay of Bengal centre coordinates (used for focus button). */
  BAY_OF_BENGAL: { lat: 13.0, lon: 86.0, label: 'Bay of Bengal' },
} as const;
