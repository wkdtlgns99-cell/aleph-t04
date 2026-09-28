import json
import os
import re
from datetime import datetime

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')

def load_fixture(name):
    path = os.path.join(FIXTURES_DIR, name)
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def run_tests():
    print("=== ALEPH T04 Automated Contract & Fixture Verification ===")
    
    # 1. Check all 9 fixture files exist
    expected_files = [
        "auth-401.json", "normal-d1-a.json", "normal-d1-b.json", "normal-d2.json",
        "offline.json", "rate-429.json", "recover-d2.json", "schema-break.json", "timeout.json"
    ]
    for ef in expected_files:
        p = os.path.join(FIXTURES_DIR, ef)
        assert os.path.exists(p), f"Missing fixture file: {ef}"
    print("[PASS] All 9 fixture files present.")

    # 2. Replay implementation in Python matching JS
    class ReplayState:
        def __init__(self):
            self.daily_readings = []
            self.current_reading = None
            self.status = None
            self.last_delta = None

        def apply_success(self, payload, meta):
            existing_idx = next((i for i, r in enumerate(self.daily_readings) 
                                 if r['signal_id'] == payload['signal_id'] and r['record_date'] == payload['record_date']), None)
            row = {
                'record_id': f"demo-{payload['signal_id']}-{payload['record_date']}",
                'signal_id': payload['signal_id'],
                'record_date': payload['record_date'],
                'normalized_value': payload['normalized_value'],
                'unit': payload['unit'],
                'first_fetched_at': self.daily_readings[existing_idx]['first_fetched_at'] if existing_idx is not None else payload['fetched_at'],
                'last_fetched_at': payload['fetched_at'],
                'reading': payload
            }
            if existing_idx is not None:
                self.daily_readings[existing_idx] = row
            else:
                self.daily_readings.append(row)
            self.daily_readings.sort(key=lambda r: r['record_date'])
            self.current_reading = payload
            self.status = {'freshness': 'fresh', 'error_code': 'none'}

            # Comparison
            prev_rows = [r for r in self.daily_readings if r['signal_id'] == payload['signal_id'] and r['record_date'] < payload['record_date']]
            if prev_rows:
                prev = prev_rows[-1]
                self.last_delta = abs(payload['normalized_value'] - prev['normalized_value'])
            else:
                self.last_delta = None

        def apply_error(self, err_code, meta):
            self.status = {'freshness': 'stale', 'error_code': err_code}

        def run(self, f):
            mode = f['transport'].get('mode')
            status = f['transport'].get('status')
            meta = {'fixture_id': f['fixture_id']}

            if mode == 'timeout':
                self.apply_error('timeout', meta)
            elif mode == 'offline':
                self.apply_error('offline', meta)
            elif status in [401, 403]:
                self.apply_error('auth', meta)
            elif status == 429:
                self.apply_error('rate_limit', meta)
            elif status and 200 <= status < 300:
                payload = f.get('payload')
                if not payload or not isinstance(payload.get('normalized_value'), (int, float)):
                    self.apply_error('schema_error', meta)
                else:
                    self.apply_success(payload, meta)
            else:
                self.apply_error('schema_error', meta)

    # Test Success Sequence
    state = ReplayState()
    for name in ["normal-d1-a.json", "normal-d1-b.json", "normal-d2.json"]:
        f = load_fixture(name)
        state.run(f)
        exp = f['expected']
        assert state.status['freshness'] == exp['freshness']
        assert state.status['error_code'] == exp['error_code']
        assert len(state.daily_readings) == exp['row_count']
        assert state.current_reading['normalized_value'] == exp['stored_value']
        if exp['delta'] is not None:
            assert state.last_delta == exp['delta']
    print("[PASS] Success sequence (D1-A -> D1-B -> D2) passed all assertions.")

    # Test 5 Failures
    failures = [
        ("timeout.json", "timeout"),
        ("auth-401.json", "auth"),
        ("rate-429.json", "rate_limit"),
        ("offline.json", "offline"),
        ("schema-break.json", "schema_error"),
    ]
    for fname, exp_err in failures:
        s = ReplayState()
        s.run(load_fixture("normal-d1-a.json"))
        s.run(load_fixture("normal-d1-b.json"))
        assert s.current_reading['normalized_value'] == 105
        
        # Apply failure
        s.run(load_fixture(fname))
        assert s.status['freshness'] == 'stale', f"Failed freshness for {fname}"
        assert s.status['error_code'] == exp_err, f"Failed error code for {fname}"
        assert s.current_reading['normalized_value'] == 105, f"Last good value not preserved for {fname}"
        assert len(s.daily_readings) == 1, f"Row count changed for {fname}"
    print("[PASS] All 5 failure fixtures preserved last good value (105) and showed stale / expected error.")

    # Test Recovery
    s = ReplayState()
    s.run(load_fixture("normal-d1-a.json"))
    s.run(load_fixture("normal-d1-b.json"))
    s.run(load_fixture("timeout.json"))
    assert s.status['freshness'] == 'stale'
    s.run(load_fixture("recover-d2.json"))
    assert s.status['freshness'] == 'fresh'
    assert s.status['error_code'] == 'none'
    assert len(s.daily_readings) == 2
    assert s.current_reading['normalized_value'] == 120
    assert s.last_delta == 15
    print("[PASS] Recovery sequence (D1-A -> D1-B -> TIMEOUT -> RECOVER-D2) passed all assertions.")

    print("\nALL DETERMINISTIC REPLAY CONTRACT TESTS PASSED PERFECTLY!")

if __name__ == '__main__':
    run_tests()
