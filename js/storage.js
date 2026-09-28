/**
 * ALEPH T04 - Storage & Calculation Engine
 * Implements daily records, uniqueness per date, and day-over-day delta recalculation.
 */

import { validateNormalizedReading, validateStatus, ERROR_CODES, kstDate } from './state-machine.js';

const STORAGE_KEY_LIVE = 'aleph_t04_live_data_v1';
const STORAGE_KEY_REPLAY = 'aleph_t04_replay_data_v1';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function recordIdFor(reading, prefix = 'live') {
  return `${prefix}-${reading.signal_id}-${reading.record_date}`;
}

export function createInitialState(schemaVersion = 'aleph-t04-evaluation-state-v1') {
  return {
    schema_version: schemaVersion,
    daily_readings: [],
    current_reading: null,
    status: null,
    last_delta: null,
    last_comparison: {
      state: 'insufficient',
      direction: null,
      magnitude: null,
      unit: null
    },
    last_raw_response: null,
    last_run: null,
    sequence: 0
  };
}

/**
 * Calculates day-over-day comparison strictly based on preserved historical rows.
 */
export function comparisonFor(rows, current) {
  if (!current || !rows || rows.length === 0) {
    return { state: 'insufficient', direction: null, magnitude: null, unit: null };
  }

  const previous = rows
    .filter((row) => row.signal_id === current.signal_id && row.record_date < current.record_date)
    .sort((left, right) => right.record_date.localeCompare(left.record_date))[0];

  if (!previous) {
    return { state: 'insufficient', direction: null, magnitude: null, unit: null };
  }

  if (previous.unit !== current.unit) {
    return { state: 'unit_mismatch', direction: null, magnitude: null, unit: null };
  }

  const signed = Number((current.normalized_value - previous.normalized_value).toFixed(2));
  return {
    state: 'comparable',
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(signed),
    signed_delta: signed,
    previous_value: previous.normalized_value,
    previous_date: previous.record_date,
    unit: current.unit
  };
}

/**
 * Ingests a validated successful reading into state.
 */
export function applySuccessfulReading(inputState, reading, runMeta = {}) {
  validateNormalizedReading(reading);
  const state = clone(inputState || createInitialState());

  const prefix = runMeta.isReplay ? 'demo' : 'live';
  const existingIndex = state.daily_readings.findIndex(
    (row) => row.signal_id === reading.signal_id && row.record_date === reading.record_date
  );

  const existing = existingIndex >= 0 ? state.daily_readings[existingIndex] : null;
  const row = {
    record_id: existing ? existing.record_id : recordIdFor(reading, prefix),
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    reading: clone(reading)
  };

  if (existingIndex >= 0) {
    state.daily_readings[existingIndex] = row;
  } else {
    state.daily_readings.push(row);
  }

  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));

  state.current_reading = clone(reading);
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.last_comparison = comparisonFor(state.daily_readings, row);
  state.last_delta = state.last_comparison.magnitude;
  state.sequence = (state.sequence || 0) + 1;
  state.last_raw_response = runMeta.rawResponse || state.last_raw_response || null;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || reading.fetched_at,
    outcome: 'success',
    error_code: 'none',
    retry_after_seconds: null
  };

  return state;
}

/**
 * Ingests an error into state while rigorously preserving the last known good value.
 */
export function applyError(inputState, errorCode, runMeta = {}) {
  if (!ERROR_CODES.includes(errorCode)) {
    throw new TypeError(`unsupported error code: ${errorCode}`);
  }

  const state = clone(inputState || createInitialState());
  // CRITICAL REQUIREMENT T04-C17: Preserves state.current_reading and state.daily_readings
  state.status = { freshness: 'stale', error_code: errorCode };
  state.sequence = (state.sequence || 0) + 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || new Date().toISOString(),
    outcome: 'error',
    error_code: errorCode,
    retry_after_seconds: runMeta.retry_after_seconds ?? null
  };

  return state;
}

export class StorageManager {
  static loadLiveState() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_LIVE);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load live state:', e);
    }
    return createInitialState();
  }

  static saveLiveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY_LIVE, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save live state:', e);
    }
  }

  static loadReplayState() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_REPLAY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load replay state:', e);
    }
    return createInitialState();
  }

  static saveReplayState(state) {
    try {
      localStorage.setItem(STORAGE_KEY_REPLAY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save replay state:', e);
    }
  }

  static resetReplayState() {
    const fresh = createInitialState();
    this.saveReplayState(fresh);
    return fresh;
  }
}
