/**
 * ALEPH T04 - Data Service (Live Adapter)
 * Real dynamic data source: Daejeon weather via Open-Meteo API (Keyless HTTPS)
 */

import { kstDate, validateNormalizedReading } from './state-machine.js';

export const DAEJEON_WEATHER_API_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=36.3504&longitude=127.3845&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FSeoul';

export function getWeatherCondition(weatherCode) {
  switch (weatherCode) {
    case 0:
      return { text: '맑음', icon: '☀️' };
    case 1:
      return { text: '대체로 맑음', icon: '🌤️' };
    case 2:
      return { text: '구름 조금', icon: '⛅' };
    case 3:
      return { text: '흐림', icon: '☁️' };
    case 45:
    case 48:
      return { text: '안개', icon: '🌫️' };
    case 51:
    case 53:
    case 55:
      return { text: '이슬비', icon: '🌦️' };
    case 61:
    case 63:
    case 65:
      return { text: '비', icon: '🌧️' };
    case 71:
    case 73:
    case 75:
      return { text: '눈', icon: '❄️' };
    case 80:
    case 81:
    case 82:
      return { text: '소나기', icon: '🌦️' };
    case 95:
    case 96:
    case 99:
      return { text: '뇌우', icon: '⛈️' };
    default:
      return { text: '관측됨', icon: '🌡️' };
  }
}

/**
 * Fetches real dynamic weather data from Open-Meteo with network timeout and error classification.
 */
export async function fetchLiveDaejeonWeather(timeoutMs = 7000) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const err = new Error('네트워크 오프라인 상태입니다.');
    err.classifiedError = 'offline';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(DAEJEON_WEATHER_API_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json'
      }
    });
  } catch (netErr) {
    clearTimeout(timer);
    if (netErr.name === 'AbortError') {
      const err = new Error('외부 API 응답 제한시간을 초과했습니다.');
      err.classifiedError = 'timeout';
      throw err;
    }
    const err = new Error('네트워크 연결에 실패했습니다.');
    err.classifiedError = 'offline';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error(`외부 원천 접근 거절 (HTTP ${response.status})`);
    err.classifiedError = 'auth';
    throw err;
  }

  if (response.status === 429) {
    const err = new Error('외부 API 호출 제한 초과 (HTTP 429)');
    err.classifiedError = 'rate_limit';
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`외부 원천 오류 (HTTP ${response.status})`);
    err.classifiedError = 'schema_error';
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    const err = new Error('JSON 응답 파싱 실패');
    err.classifiedError = 'schema_error';
    throw err;
  }

  if (!data || !data.current || typeof data.current.temperature_2m !== 'number') {
    const err = new Error('기온 데이터 필드가 누락되었거나 비정상 형식입니다.');
    err.classifiedError = 'schema_error';
    throw err;
  }

  const now = new Date();
  const fetchedAtIso = now.toISOString();
  const kstToday = kstDate(fetchedAtIso);

  // Convert "2026-09-28T09:15" to valid RFC3339 with timezone "+09:00"
  let sourceTimeIso = null;
  if (data.current.time) {
    sourceTimeIso = data.current.time.includes('+') || data.current.time.endsWith('Z')
      ? data.current.time
      : `${data.current.time}:00+09:00`;
  }

  const normalized = {
    signal_id: 'daejeon-weather-temp',
    normalized_value: Number(data.current.temperature_2m.toFixed(1)),
    unit: '°C',
    source_name: 'Open-Meteo Daejeon Weather',
    source_url: DAEJEON_WEATHER_API_URL,
    source_time: sourceTimeIso,
    fetched_at: fetchedAtIso,
    record_timezone: 'Asia/Seoul',
    record_date: kstToday
  };

  validateNormalizedReading(normalized);

  const condition = getWeatherCondition(data.current.weather_code);

  return {
    reading: normalized,
    rawResponse: data,
    metadata: {
      latitude: data.latitude,
      longitude: data.longitude,
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      weatherCode: data.current.weather_code,
      conditionText: condition.text,
      conditionIcon: condition.icon
    }
  };
}
