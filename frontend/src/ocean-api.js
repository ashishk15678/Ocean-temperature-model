import { CONFIG } from './config';
import { fetchMockProfile } from './mock-data';

export class OceanApiError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'OceanApiError';
    this.cause = cause;
  }
}

function endpoint(path) {
  return `${CONFIG.API_BASE_URL}${path}`;
}

/**
 * Normalise backend response to a consistent shape.
 * Backend returns `temperature_c`; internal code uses `temperature_celsius`.
 */
function normaliseProfile(data) {
  return {
    ...data,
    // alias so the rest of the codebase keeps using temperature_celsius
    temperature_celsius: data.temperature_celsius ?? data.temperature_c,
  };
}

/**
 * POST /api/v1/predict
 *
 * Accepts either:
 *   { latitude, longitude, date }          — real backend shape
 *   { latitude, longitude, target_month }  — legacy / mock shape (date derived)
 */
export async function fetchTemperatureProfile(
  { latitude, longitude, date, target_month },
  { signal } = {},
) {
  if (CONFIG.USE_MOCK_DATA) {
    if (CONFIG.DEBUG_MODE) console.log('🔵 mock:', { latitude, longitude, target_month });
    return fetchMockProfile({ latitude, longitude, target_month });
  }

  // Derive a full date from target_month ("YYYY-MM" → "YYYY-MM-15") if needed
  const isoDate = date ?? (target_month ? `${target_month}-15` : CONFIG.DEFAULT_DATE);

  if (CONFIG.DEBUG_MODE) console.log('🟢 predict:', { latitude, longitude, date: isoDate });

  let response;
  try {
    response = await fetch(endpoint(CONFIG.API_ENDPOINT), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude, longitude, date: isoDate }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new OceanApiError(
      `Couldn't reach the backend at ${CONFIG.API_ENDPOINT}. Is it running on :8000?`,
      err,
    );
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    throw new OceanApiError(
      `Backend returned ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  const data = await response.json();

  if (!Array.isArray(data.depths_m) || !(Array.isArray(data.temperature_c) || Array.isArray(data.temperature_celsius))) {
    throw new OceanApiError('Backend response is missing depths_m / temperature_c arrays.');
  }

  return normaliseProfile(data);
}

/**
 * GET /health
 * Returns { status, model_loaded, device }
 */
export async function fetchHealth({ signal } = {}) {
  let response;
  try {
    response = await fetch(endpoint(CONFIG.HEALTH_ENDPOINT), { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new OceanApiError('Health check failed — backend unreachable.', err);
  }

  if (!response.ok) {
    throw new OceanApiError(`Health check returned ${response.status}`);
  }

  return response.json(); // { status, model_loaded, device }
}

/**
 * GET /api/v1/model-info
 * Returns static model + grid metadata. Safe to cache forever.
 */
export async function fetchModelInfo({ signal } = {}) {
  let response;
  try {
    response = await fetch(endpoint('/api/v1/model-info'), { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new OceanApiError('Model-info fetch failed — backend unreachable.', err);
  }
  if (!response.ok) throw new OceanApiError(`model-info returned ${response.status}`);
  return response.json();
}
