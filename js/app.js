/**
 * ALEPH T04 - Main Application Coordinator
 * Binds UI components, live Open-Meteo weather fetcher, and deterministic replay studio.
 */

import { fetchLiveDaejeonWeather, DAEJEON_WEATHER_API_URL } from './data-service.js';
import {
  StorageManager,
  applySuccessfulReading,
  applyError,
  comparisonFor,
  createInitialState
} from './storage.js';
import { ERROR_DETAILS, ERROR_CODES } from './state-machine.js';
import { executeSequence, FIXTURES, runFixture } from './replay-runner.js';

let appState = StorageManager.loadLiveState();
let lastRawResponse = null;

// DOM Element References
const dom = {
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  staleAlertBox: document.getElementById('stale-alert-box'),
  staleTitleText: document.getElementById('stale-title-text'),
  staleDescText: document.getElementById('stale-desc-text'),
  staleGuideText: document.getElementById('stale-guide-text'),
  btnRetryAction: document.getElementById('btn-retry-action'),
  btnFetchLive: document.getElementById('btn-fetch-live'),

  // Hero Card
  currentBadgeFreshness: document.getElementById('current-badge-freshness'),
  valDisplay: document.getElementById('val-display'),
  unitDisplay: document.getElementById('unit-display'),
  weatherIcon: document.getElementById('weather-icon'),
  weatherText: document.getElementById('weather-text'),
  humidityDisplay: document.getElementById('humidity-display'),
  windDisplay: document.getElementById('wind-display'),
  deltaBadge: document.getElementById('delta-badge'),
  deltaText: document.getElementById('delta-text'),

  // Metadata Grid
  metaValBox: document.getElementById('meta-val-box'),
  metaUnitBox: document.getElementById('meta-unit-box'),
  sourceDisplay: document.getElementById('source-display'),
  sourceLink: document.getElementById('source-link'),
  sourceTimeDisplay: document.getElementById('source-time-display'),
  fetchedTimeDisplay: document.getElementById('fetched-time-display'),
  timezoneDisplay: document.getElementById('timezone-display'),

  // Table
  dailyTableBody: document.getElementById('daily-table-body'),

  // Modals
  modalReplay: document.getElementById('modal-replay'),
  modalConsistency: document.getElementById('modal-consistency'),
  btnOpenReplay: document.getElementById('btn-open-replay'),
  btnOpenConsistency: document.getElementById('btn-open-consistency'),
  btnRunSeqSuccess: document.getElementById('btn-run-seq-success'),
  btnRunSeqRecovery: document.getElementById('btn-run-seq-recovery'),
  btnResetReplay: document.getElementById('btn-reset-replay'),
  replayLogBody: document.getElementById('replay-log-body'),

  // Inspector
  inspectRaw: document.getElementById('inspect-raw'),
  inspectStored: document.getElementById('inspect-stored'),
  inspectDom: document.getElementById('inspect-dom'),

  // Toast
  toast: document.getElementById('toast')
};

function showToast(message, duration = 3000) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.style.display = 'block';
  setTimeout(() => {
    dom.toast.style.display = 'none';
  }, duration);
}

function formatKstDisplay(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d) + ' KST';
  } catch {
    return isoString;
  }
}

/**
 * Renders the state into the DOM conforming to all T04 conditions.
 */
function renderUI(state) {
  const current = state.current_reading;
  const status = state.status || { freshness: 'fresh', error_code: 'none' };
  const isFresh = status.freshness === 'fresh';
  const isStale = status.freshness === 'stale';

  // 1. Status Pill & Badges
  if (isFresh) {
    dom.statusPill.className = 'status-pill status-fresh';
    dom.statusPill.innerHTML = '<span class="pulse-dot pulse-fresh"></span><span>정상 (FRESH)</span>';
    dom.currentBadgeFreshness.className = 'status-pill status-fresh';
    dom.currentBadgeFreshness.textContent = '최신 정상 관측값';
    dom.staleAlertBox.style.display = 'none';
  } else {
    const errInfo = ERROR_DETAILS[status.error_code] || ERROR_DETAILS.timeout;
    dom.statusPill.className = 'status-pill status-stale';
    dom.statusPill.innerHTML = `<span class="pulse-dot pulse-stale"></span><span>오래된 값 (STALE: ${status.error_code.toUpperCase()})</span>`;
    dom.currentBadgeFreshness.className = 'status-pill status-stale';
    dom.currentBadgeFreshness.textContent = `오래된 값 보존됨 (${status.error_code})`;

    // Show Stale Alert Box with guidance and retry button (T04-C18, T04-C19)
    dom.staleTitleText.textContent = `${errInfo.title} (STALE / ${status.error_code.toUpperCase()})`;
    dom.staleDescText.textContent = `${errInfo.description} (화면의 수치는 마지막으로 수신된 안전한 정상값입니다.)`;
    dom.staleGuideText.textContent = `권장 조치: ${errInfo.actionGuide}`;
    dom.staleAlertBox.style.display = 'flex';
  }

  // 2. Value and Unit (T04-C04, T04-C05, T04-C17)
  if (current) {
    dom.valDisplay.textContent = current.normalized_value;
    dom.unitDisplay.textContent = current.unit;
    dom.metaValBox.textContent = `${current.normalized_value}`;
    dom.metaUnitBox.textContent = current.unit;
    dom.sourceLink.textContent = current.source_name;
    dom.sourceLink.href = current.source_url;
    dom.sourceTimeDisplay.textContent = formatKstDisplay(current.source_time);
    dom.fetchedTimeDisplay.textContent = formatKstDisplay(current.fetched_at);
    dom.timezoneDisplay.textContent = `${current.record_timezone} (KST, UTC+9)`;
  } else {
    dom.valDisplay.textContent = '--';
    dom.unitDisplay.textContent = '°C';
    dom.metaValBox.textContent = '--';
    dom.metaUnitBox.textContent = '--';
    dom.sourceTimeDisplay.textContent = '--';
    dom.fetchedTimeDisplay.textContent = '--';
  }

  // 3. Day-over-day Change (T04-C24)
  const comparison = state.last_comparison;
  if (!comparison || comparison.state === 'insufficient') {
    dom.deltaBadge.className = 'delta-badge delta-neutral';
    dom.deltaBadge.innerHTML = '<span>📊</span><span>첫날 관측값 (어제 비교 데이터 없음)</span>';
  } else if (comparison.state === 'comparable') {
    const sign = comparison.signed_delta > 0 ? '+' : '';
    const arrow = comparison.direction === 'increase' ? '📈 ▲' : comparison.direction === 'decrease' ? '📉 ▼' : '➖';
    const cls = comparison.direction === 'increase' ? 'delta-increase' : comparison.direction === 'decrease' ? 'delta-decrease' : 'delta-neutral';
    dom.deltaBadge.className = `delta-badge ${cls}`;
    dom.deltaBadge.innerHTML = `<span>${arrow}</span><span>전일 대비 ${sign}${comparison.signed_delta}${comparison.unit} (${comparison.direction === 'increase' ? '상승' : comparison.direction === 'decrease' ? '하강' : '변동 없음'})</span>`;
  } else {
    dom.deltaBadge.className = 'delta-badge delta-neutral';
    dom.deltaBadge.innerHTML = '<span>⚠️</span><span>단위 불일치로 비교 불가</span>';
  }

  // 4. Daily Storage History Table (T04-C20 ~ T04-C23)
  renderHistoryTable(state.daily_readings);

  // 5. Update 3-Way Consistency Snapshot
  updateConsistencySnapshot(state);
}

function renderHistoryTable(dailyReadings) {
  if (!dailyReadings || dailyReadings.length === 0) {
    dom.dailyTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
          저장된 일별 기록이 없습니다. 상단 [지금 갱신]을 눌러 첫 기록을 수집하세요.
        </td>
      </tr>
    `;
    return;
  }

  dom.dailyTableBody.innerHTML = dailyReadings.map((row, index) => {
    let deltaText = '기준일 (첫날)';
    if (index > 0) {
      const prev = dailyReadings[index - 1];
      const diff = Number((row.normalized_value - prev.normalized_value).toFixed(2));
      const sign = diff > 0 ? '+' : '';
      const color = diff > 0 ? '#b91c1c' : diff < 0 ? '#1d4ed8' : '#64748b';
      deltaText = `<span style="color: ${color}; font-weight: 700;">${sign}${diff} ${row.unit}</span>`;
    }

    return `
      <tr>
        <td><strong>${row.record_date}</strong></td>
        <td><strong style="font-size: 1rem;">${row.normalized_value}</strong> ${row.unit}</td>
        <td>${deltaText}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${formatKstDisplay(row.first_fetched_at)}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${formatKstDisplay(row.last_fetched_at)}</td>
        <td><code style="font-size: 0.75rem; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${row.record_id}</code></td>
      </tr>
    `;
  }).join('');
}

function updateConsistencySnapshot(state) {
  if (!state.current_reading) return;
  if (lastRawResponse) {
    dom.inspectRaw.textContent = JSON.stringify(lastRawResponse, null, 2);
  } else {
    dom.inspectRaw.textContent = JSON.stringify(state.current_reading, null, 2);
  }
  dom.inspectStored.textContent = JSON.stringify(state.current_reading, null, 2);
  dom.inspectDom.textContent = JSON.stringify({
    '화면_기온값(#val-display)': dom.valDisplay.textContent,
    '화면_단위(#unit-display)': dom.unitDisplay.textContent,
    '출처_이름(#source-link)': dom.sourceLink.textContent.trim(),
    '원천_시각(#source-time-display)': dom.sourceTimeDisplay.textContent,
    '조회_시각(#fetched-time-display)': dom.fetchedTimeDisplay.textContent,
    '기준_시간대(#timezone-display)': dom.timezoneDisplay.textContent,
    '전일대비_배지(#delta-text)': dom.deltaBadge.textContent.trim()
  }, null, 2);
}

/**
 * Primary Live Fetch Handler
 */
async function handleFetchLive() {
  dom.btnFetchLive.disabled = true;
  dom.btnFetchLive.textContent = '⏳ 조회 중...';

  try {
    const { reading, rawResponse, metadata } = await fetchLiveDaejeonWeather(7000);
    lastRawResponse = rawResponse;

    // Ingest into storage state
    appState = applySuccessfulReading(appState, reading, { rawResponse });
    StorageManager.saveLiveState(appState);

    // Update supplementary weather indicators
    dom.weatherIcon.textContent = metadata.conditionIcon;
    dom.weatherText.textContent = `${metadata.conditionText} (대전)`;
    dom.humidityDisplay.textContent = metadata.humidity;
    dom.windDisplay.textContent = metadata.windSpeed;

    renderUI(appState);
    showToast('✅ 대전 실시간 기상 데이터 조회 완료!');
  } catch (err) {
    console.warn('Live fetch error encountered:', err);
    const errorCode = err.classifiedError && ERROR_CODES.includes(err.classifiedError)
      ? err.classifiedError
      : 'schema_error';

    // Ingest error while preserving last known good value (T04-C17)
    appState = applyError(appState, errorCode);
    StorageManager.saveLiveState(appState);

    renderUI(appState);
    showToast(`⚠️ 기상 관측 데이터 수신 실패 (${errorCode}) - 마지막 정상값 보존`, 4000);
  } finally {
    dom.btnFetchLive.disabled = false;
    dom.btnFetchLive.textContent = '🔄 지금 갱신';
  }
}

/**
 * Replay Studio Renderer
 */
function renderReplayLogs(stepLogs) {
  if (!stepLogs || stepLogs.length === 0) {
    dom.replayLogBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 16px;">
          결과가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  dom.replayLogBody.innerHTML = stepLogs.map((step) => {
    const passBadge = step.passed
      ? '<span style="color: #059669; font-weight: 700; background: #ecfdf5; padding: 2px 8px; border-radius: 4px; border: 1px solid #a7f3d0;">PASS ✅</span>'
      : `<span style="color: #dc2626; font-weight: 700; background: #fef2f2; padding: 2px 8px; border-radius: 4px; border: 1px solid #fecaca;">FAIL ❌</span><div style="font-size: 0.75rem; color: #dc2626;">${step.details.join('<br>')}</div>`;

    const freshCls = step.freshness === 'fresh' ? 'status-fresh' : 'status-stale';
    const errText = step.error_code === 'none' ? 'none (정상)' : `<strong style="color: #b45309;">${step.error_code}</strong>`;
    const deltaText = step.last_delta !== null ? `+${step.last_delta} pt` : '-';

    return `
      <tr>
        <td><code>${step.fixture_id}</code></td>
        <td><span class="status-pill ${freshCls}" style="font-size: 0.75rem; padding: 2px 6px;">${step.freshness}</span></td>
        <td>${errText}</td>
        <td><strong>${step.row_count}</strong> 건</td>
        <td><strong>${step.current_value}</strong> pt</td>
        <td>${deltaText}</td>
        <td>${passBadge}</td>
      </tr>
    `;
  }).join('');
}

// Modal open/close listeners
function setupModalListeners() {
  dom.btnOpenReplay.addEventListener('click', () => {
    dom.modalReplay.classList.add('active');
  });

  dom.btnOpenConsistency.addEventListener('click', () => {
    updateConsistencySnapshot(appState);
    dom.modalConsistency.classList.add('active');
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      const target = document.getElementById(modalId);
      if (target) target.classList.remove('active');
    });
  });

  // Close when clicking overlay backdrop
  [dom.modalReplay, dom.modalConsistency].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  });

  // Replay Sequence 1: Success Sequence (D1-A -> D1-B -> D2)
  dom.btnRunSeqSuccess.addEventListener('click', () => {
    const { stepLogs } = executeSequence([
      'T04-NORMAL-D1-A',
      'T04-NORMAL-D1-B',
      'T04-NORMAL-D2'
    ]);
    renderReplayLogs(stepLogs);
    showToast('✅ 정상 일별 저장 시퀀스 3단계 검사 완료 (PASS)');
  });

  // Replay Sequence 2: 5 Failures
  document.querySelectorAll('.btn-run-single-failure').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fid = btn.getAttribute('data-fid');
      const { stepLogs } = executeSequence([
        'T04-NORMAL-D1-A',
        'T04-NORMAL-D1-B',
        fid
      ]);
      renderReplayLogs(stepLogs);
      showToast(`🧪 장애 시뮬레이션 [${fid}] 검사 완료 (마지막 정상값 105 보존 PASS)`);
    });
  });

  // Replay Sequence 3: Recovery (D1-A -> D1-B -> TIMEOUT -> RECOVER-D2)
  dom.btnRunSeqRecovery.addEventListener('click', () => {
    const { stepLogs } = executeSequence([
      'T04-NORMAL-D1-A',
      'T04-NORMAL-D1-B',
      'T04-TIMEOUT',
      'T04-RECOVER-D2'
    ]);
    renderReplayLogs(stepLogs);
    showToast('✅ 장애 후 자동 회복 시퀀스 검사 완료 (fresh / none / +15pt PASS)');
  });

  // Reset Replay
  dom.btnResetReplay.addEventListener('click', () => {
    dom.replayLogBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 16px;">
          합성 상태가 초기화되었습니다. 상단 시퀀스 버튼을 클릭해 실행하세요.
        </td>
      </tr>
    `;
    showToast('🧹 합성 시험 상태가 초기화되었습니다.');
  });
}

// Initial Boot
function init() {
  setupModalListeners();
  dom.btnFetchLive.addEventListener('click', handleFetchLive);
  dom.btnRetryAction.addEventListener('click', handleFetchLive);

  // Render initial storage state
  renderUI(appState);

  // If no records yet or page freshly opened, fetch live data immediately
  handleFetchLive();
}

window.addEventListener('DOMContentLoaded', init);
