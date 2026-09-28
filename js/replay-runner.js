/**
 * ALEPH T04 - Deterministic Replay Studio & Test Fixture Runner
 * Directly implements public-contract.json and adapter-reset.example.js.
 */

import { applySuccessfulReading, applyError, createInitialState, comparisonFor } from './storage.js';

export const FIXTURES = {
  'T04-NORMAL-D1-A': {
    fixture_id: 'T04-NORMAL-D1-A',
    contract_version: '1.1.0',
    description_ko: '가상 1일차 첫 정상 조회: 새 일별 행을 만든다.',
    virtual_now: '2026-08-24T00:00:00.000Z',
    transport: {
      mode: 'http',
      status: 200,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json' }
    },
    payload: {
      signal_id: 'aleph-demo-index',
      normalized_value: 100,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-23T23:59:00.000Z',
      fetched_at: '2026-08-24T00:00:00.000Z',
      record_timezone: 'Asia/Seoul',
      record_date: '2026-08-24'
    },
    expected: {
      freshness: 'fresh',
      error_code: 'none',
      row_count: 1,
      stored_value: 100,
      delta: null,
      preserve_last_good: true,
      record_date: '2026-08-24'
    }
  },
  'T04-NORMAL-D1-B': {
    fixture_id: 'T04-NORMAL-D1-B',
    contract_version: '1.1.0',
    description_ko: '가상 1일차 두 번째 정상 조회: 같은 날짜의 기존 행을 갱신한다.',
    virtual_now: '2026-08-24T09:00:00.000Z',
    transport: {
      mode: 'http',
      status: 200,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json' }
    },
    payload: {
      signal_id: 'aleph-demo-index',
      normalized_value: 105,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: null,
      fetched_at: '2026-08-24T09:00:00.000Z',
      record_timezone: 'Asia/Seoul',
      record_date: '2026-08-24'
    },
    expected: {
      freshness: 'fresh',
      error_code: 'none',
      row_count: 1,
      stored_value: 105,
      delta: null,
      preserve_last_good: true,
      same_record_id_as: 'T04-NORMAL-D1-A',
      record_date: '2026-08-24'
    }
  },
  'T04-NORMAL-D2': {
    fixture_id: 'T04-NORMAL-D2',
    contract_version: '1.1.0',
    description_ko: '가상 2일차 정상 조회: 새 행과 전일 대비 +15를 만든다.',
    virtual_now: '2026-08-25T00:00:00.000Z',
    transport: {
      mode: 'http',
      status: 200,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json' }
    },
    payload: {
      signal_id: 'aleph-demo-index',
      normalized_value: 120,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-24T23:59:00.000Z',
      fetched_at: '2026-08-25T00:00:00.000Z',
      record_timezone: 'Asia/Seoul',
      record_date: '2026-08-25'
    },
    expected: {
      freshness: 'fresh',
      error_code: 'none',
      row_count: 2,
      stored_value: 120,
      delta: 15,
      preserve_last_good: true,
      record_date: '2026-08-25'
    }
  },
  'T04-TIMEOUT': {
    fixture_id: 'T04-TIMEOUT',
    contract_version: '1.1.0',
    description_ko: '제한시간보다 늦은 응답: 마지막 정상값을 보존하고 timeout을 기록한다.',
    virtual_now: '2026-08-24T10:00:00.000Z',
    transport: {
      mode: 'timeout',
      status: null,
      delay_ms: 5000,
      deadline_ms: 1500,
      headers: {}
    },
    payload: null,
    expected: {
      freshness: 'stale',
      error_code: 'timeout',
      row_count: 1,
      stored_value: 105,
      delta: null,
      preserve_last_good: true
    }
  },
  'T04-AUTH-401': {
    fixture_id: 'T04-AUTH-401',
    contract_version: '1.1.0',
    description_ko: '외부 출처가 인증을 거절한 응답: auth를 기록한다.',
    virtual_now: '2026-08-24T10:01:00.000Z',
    transport: {
      mode: 'http',
      status: 401,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json' }
    },
    payload: { message: 'unauthorized synthetic fixture' },
    expected: {
      freshness: 'stale',
      error_code: 'auth',
      row_count: 1,
      stored_value: 105,
      delta: null,
      preserve_last_good: true
    }
  },
  'T04-RATE-429': {
    fixture_id: 'T04-RATE-429',
    contract_version: '1.1.0',
    description_ko: '외부 출처의 호출 제한 응답: rate_limit과 Retry-After 관측값을 기록한다.',
    virtual_now: '2026-08-24T10:02:00.000Z',
    transport: {
      mode: 'http',
      status: 429,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json', 'retry-after': '60' }
    },
    payload: { message: 'rate limited synthetic fixture' },
    expected: {
      freshness: 'stale',
      error_code: 'rate_limit',
      row_count: 1,
      stored_value: 105,
      delta: null,
      preserve_last_good: true
    }
  },
  'T04-OFFLINE': {
    fixture_id: 'T04-OFFLINE',
    contract_version: '1.1.0',
    description_ko: '네트워크 연결 중단: 마지막 정상값을 보존하고 offline을 기록한다.',
    virtual_now: '2026-08-24T10:03:00.000Z',
    transport: {
      mode: 'offline',
      status: null,
      delay_ms: 0,
      deadline_ms: 1500,
      headers: {}
    },
    payload: null,
    expected: {
      freshness: 'stale',
      error_code: 'offline',
      row_count: 1,
      stored_value: 105,
      delta: null,
      preserve_last_good: true
    }
  },
  'T04-SCHEMA-BREAK': {
    fixture_id: 'T04-SCHEMA-BREAK',
    contract_version: '1.1.0',
    description_ko: 'HTTP 성공이지만 필수값 형식이 바뀐 응답: schema_error를 기록한다.',
    virtual_now: '2026-08-24T10:04:00.000Z',
    transport: {
      mode: 'http',
      status: 200,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json' }
    },
    payload: {
      signal_id: 'aleph-demo-index',
      normalized_value: '105', // string violates number constraint
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: null,
      fetched_at: '2026-08-24T10:04:00.000Z',
      record_timezone: 'Asia/Seoul',
      record_date: '2026-08-24'
    },
    expected: {
      freshness: 'stale',
      error_code: 'schema_error',
      row_count: 1,
      stored_value: 105,
      delta: null,
      preserve_last_good: true
    }
  },
  'T04-RECOVER-D2': {
    fixture_id: 'T04-RECOVER-D2',
    contract_version: '1.1.0',
    description_ko: '오류 뒤 가상 2일차 재시도 성공: fresh/none으로 회복하고 전일 대비 +15를 만든다.',
    virtual_now: '2026-08-25T00:00:00.000Z',
    transport: {
      mode: 'http',
      status: 200,
      delay_ms: 20,
      deadline_ms: 1500,
      headers: { 'content-type': 'application/json' }
    },
    payload: {
      signal_id: 'aleph-demo-index',
      normalized_value: 120,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-24T23:59:00.000Z',
      fetched_at: '2026-08-25T00:00:00.000Z',
      record_timezone: 'Asia/Seoul',
      record_date: '2026-08-25'
    },
    expected: {
      freshness: 'fresh',
      error_code: 'none',
      row_count: 2,
      stored_value: 120,
      delta: 15,
      preserve_last_good: true,
      record_date: '2026-08-25'
    }
  }
};

/**
 * Replays a fixture against state according to official contract.
 */
export function runFixture(inputState, fixture) {
  const meta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    retry_after_seconds: fixture.transport?.headers?.['retry-after']
      ? Number(fixture.transport.headers['retry-after'])
      : null,
    isReplay: true
  };

  if (fixture.transport.mode === 'timeout') return applyError(inputState, 'timeout', meta);
  if (fixture.transport.mode === 'offline') return applyError(inputState, 'offline', meta);
  if (fixture.transport.status === 401 || fixture.transport.status === 403) {
    return applyError(inputState, 'auth', meta);
  }
  if (fixture.transport.status === 429) return applyError(inputState, 'rate_limit', meta);
  if (fixture.transport.status >= 200 && fixture.transport.status < 300) {
    try {
      return applySuccessfulReading(inputState, fixture.payload, meta);
    } catch (e) {
      return applyError(inputState, 'schema_error', meta);
    }
  }
  return applyError(inputState, 'schema_error', meta);
}

/**
 * Executes a sequence of fixture IDs starting from a reset state.
 */
export function executeSequence(fixtureIds, startingState = null) {
  let state = startingState ? JSON.parse(JSON.stringify(startingState)) : createInitialState();
  const stepLogs = [];

  for (const fId of fixtureIds) {
    const fixture = FIXTURES[fId];
    if (!fixture) throw new Error(`Unknown fixture ID: ${fId}`);

    state = runFixture(state, fixture);

    const stepResult = {
      fixture_id: fId,
      freshness: state.status.freshness,
      error_code: state.status.error_code,
      row_count: state.daily_readings.length,
      current_value: state.current_reading?.normalized_value ?? null,
      last_delta: state.last_delta,
      expected: fixture.expected,
      passed: true,
      details: []
    };

    // Verify expectations
    if (stepResult.freshness !== fixture.expected.freshness) {
      stepResult.passed = false;
      stepResult.details.push(`신선도 불일치: 기대 ${fixture.expected.freshness} vs 실제 ${stepResult.freshness}`);
    }
    if (stepResult.error_code !== fixture.expected.error_code) {
      stepResult.passed = false;
      stepResult.details.push(`오류코드 불일치: 기대 ${fixture.expected.error_code} vs 실제 ${stepResult.error_code}`);
    }
    if (stepResult.row_count !== fixture.expected.row_count) {
      stepResult.passed = false;
      stepResult.details.push(`행 개수 불일치: 기대 ${fixture.expected.row_count} vs 실제 ${stepResult.row_count}`);
    }
    if (stepResult.current_value !== fixture.expected.stored_value) {
      stepResult.passed = false;
      stepResult.details.push(`저장값 불일치: 기대 ${fixture.expected.stored_value} vs 실제 ${stepResult.current_value}`);
    }
    if (fixture.expected.delta !== undefined && fixture.expected.delta !== null) {
      if (stepResult.last_delta !== fixture.expected.delta) {
        stepResult.passed = false;
        stepResult.details.push(`변화량 불일치: 기대 ${fixture.expected.delta} vs 실제 ${stepResult.last_delta}`);
      }
    }

    stepLogs.push(stepResult);
  }

  return { finalState: state, stepLogs };
}
