/**
 * ALEPH T04 - State Machine & Contracts
 * Manages reading status, error classifications, and schema validation.
 */

export const ERROR_CODES = Object.freeze([
  'timeout',
  'auth',
  'rate_limit',
  'offline',
  'schema_error'
]);

export const ERROR_DETAILS = Object.freeze({
  none: {
    title: '정상 작동 (Normal)',
    description: '공개 데이터 원천으로부터 최신 관측값을 정상적으로 수신하였습니다.',
    actionGuide: '데이터가 주기적으로 자동 갱신됩니다.'
  },
  timeout: {
    title: '응답 지연 (Timeout)',
    description: '외부 관측 서버 응답이 허용 제한 시간(1.5초)을 초과하였습니다. 서버 과부하 또는 네트워크 지연이 발생했습니다.',
    actionGuide: '네트워크 연결을 확인한 후 [다시 시도]를 누르거나 잠시 후 갱신하세요.'
  },
  auth: {
    title: '원천 접근 거절 (Unauthorized 401/403)',
    description: '외부 원천 서버로부터 401/403 접근 거절 응답이 수신되었습니다. 원천 서버의 접근 정책이 일시적으로 변경되었을 수 있습니다.',
    actionGuide: '원천 서버 상태를 점검 중입니다. 마지막으로 확인된 정상값이 보존됩니다.'
  },
  rate_limit: {
    title: '호출 한도 초과 (Rate Limit 429)',
    description: '외부 원천 API의 단시간 호출 허용 한도를 초과했습니다 (HTTP 429 Too Many Requests).',
    actionGuide: '요청 쿨다운이 필요합니다. 1~2분 후 [다시 시도] 버튼을 눌러주세요.'
  },
  offline: {
    title: '오프라인 단절 (Network Offline)',
    description: '브라우저 또는 장치가 인터넷 네트워크에 연결되어 있지 않습니다.',
    actionGuide: 'Wi-Fi 또는 유선 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  },
  schema_error: {
    title: '형식 불일치 (Schema Drift / Invalid Format)',
    description: '외부 원천에서 응답이 왔으나 필수 필드 누락 또는 데이터 형식이 표준 스키마와 일치하지 않습니다.',
    actionGuide: '원천 데이터의 스키마 변경 여부를 확인해야 합니다. 기존 정상값이 유지됩니다.'
  }
});

export const NORMALIZED_KEYS = Object.freeze([
  'signal_id',
  'normalized_value',
  'unit',
  'source_name',
  'source_url',
  'source_time',
  'fetched_at',
  'record_timezone',
  'record_date'
]);

/**
 * Returns date string in YYYY-MM-DD format for Asia/Seoul timezone.
 */
export function kstDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('fetched_at must be a valid ISO-8601 date-time');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/**
 * Validates normalized reading according to normalized-reading.schema.json
 */
export function validateNormalizedReading(reading) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) {
    throw new TypeError('normalized reading must be an object');
  }

  const actualKeys = Object.keys(reading).sort();
  const expectedKeys = [...NORMALIZED_KEYS].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((k, i) => k !== expectedKeys[i])) {
    throw new TypeError(`normalized reading keys must be exactly: ${NORMALIZED_KEYS.join(', ')}`);
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id) || reading.signal_id.length > 100) {
    throw new TypeError('signal_id is invalid');
  }
  if (typeof reading.normalized_value !== 'number' || !Number.isFinite(reading.normalized_value)) {
    throw new TypeError('normalized_value must be a finite number');
  }
  for (const field of ['unit', 'source_name']) {
    if (typeof reading[field] !== 'string' || reading[field].trim() === '') {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(reading.source_url);
  } catch {
    throw new TypeError('source_url must be an absolute URL');
  }
  if (sourceUrl.protocol !== 'https:') {
    throw new TypeError('source_url must use HTTPS');
  }

  if (reading.source_time !== null && Number.isNaN(new Date(reading.source_time).getTime())) {
    throw new TypeError('source_time must be a valid date-time or null');
  }
  if (Number.isNaN(new Date(reading.fetched_at).getTime())) {
    throw new TypeError('fetched_at must be a valid date-time');
  }
  if (reading.record_timezone !== 'Asia/Seoul') {
    throw new TypeError('record_timezone must be Asia/Seoul');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reading.record_date) || reading.record_date !== kstDate(reading.fetched_at)) {
    throw new TypeError('record_date must be the Asia/Seoul date derived from fetched_at');
  }

  return true;
}

/**
 * Validates status object against reading-status.schema.json
 */
export function validateStatus(status) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
  if (status.freshness === 'fresh') return status.error_code === 'none';
  if (status.freshness === 'stale') return ERROR_CODES.includes(status.error_code);
  return false;
}
