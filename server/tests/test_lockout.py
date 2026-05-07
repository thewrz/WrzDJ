"""Tests for login lockout logic with escalating cooldowns."""

import time
from unittest.mock import patch

from app.core.lockout import LockoutManager


class TestLockoutManager:
    def _make_manager(self) -> LockoutManager:
        return LockoutManager()

    def test_no_lockout_initially(self):
        mgr = self._make_manager()
        locked, remaining = mgr.is_locked_out("1.2.3.4", "alice")
        assert locked is False
        assert remaining == 0

    def test_no_lockout_below_threshold(self):
        mgr = self._make_manager()
        for _ in range(4):  # Below THRESHOLD_1 of 5
            mgr.record_failure("1.2.3.4", "alice")

        locked, _ = mgr.is_locked_out("1.2.3.4", "alice")
        assert locked is False

    def test_5_failures_trigger_5min_lockout(self):
        mgr = self._make_manager()
        for _ in range(5):
            result = mgr.record_failure("1.2.3.4", "alice")

        is_locked, seconds = result
        assert is_locked is True
        assert seconds == 5 * 60

        locked, remaining = mgr.is_locked_out("1.2.3.4", "alice")
        assert locked is True
        assert remaining > 0

    def test_10_failures_trigger_30min_lockout(self):
        mgr = self._make_manager()
        for _ in range(10):
            result = mgr.record_failure("1.2.3.4", "alice")

        is_locked, seconds = result
        assert is_locked is True
        assert seconds == 30 * 60

    def test_lockout_expires(self):
        mgr = self._make_manager()
        for _ in range(5):
            mgr.record_failure("1.2.3.4", "alice")

        # Time-travel past the lockout period
        now = time.time()
        with patch("app.core.lockout.time") as mock_time:
            mock_time.time.return_value = now + 5 * 60 + 1
            locked, _ = mgr.is_locked_out("1.2.3.4", "alice")
            assert locked is False

    def test_ip_and_username_tracked_separately(self):
        mgr = self._make_manager()
        # Lock out IP
        for _ in range(5):
            mgr.record_failure("1.2.3.4", None)

        # Different IP, same username should not be locked by IP
        locked_by_ip, _ = mgr.is_locked_out("5.6.7.8", None)
        assert locked_by_ip is False

        # But original IP is locked
        locked, _ = mgr.is_locked_out("1.2.3.4", None)
        assert locked is True

    def test_username_lockout_independent_of_ip(self):
        mgr = self._make_manager()
        # Lock out username from different IPs
        for _ in range(5):
            mgr.record_failure(None, "bob")

        locked, _ = mgr.is_locked_out(None, "bob")
        assert locked is True

        # Different username, not locked
        locked, _ = mgr.is_locked_out(None, "carol")
        assert locked is False

    def test_success_clears_lockout(self):
        mgr = self._make_manager()
        for _ in range(5):
            mgr.record_failure("1.2.3.4", "alice")

        locked, _ = mgr.is_locked_out("1.2.3.4", "alice")
        assert locked is True

        mgr.record_success("1.2.3.4", "alice")

        locked, _ = mgr.is_locked_out("1.2.3.4", "alice")
        assert locked is False

    def test_username_case_insensitive(self):
        mgr = self._make_manager()
        for _ in range(5):
            mgr.record_failure("1.2.3.4", "Alice")

        locked, _ = mgr.is_locked_out("1.2.3.4", "alice")
        assert locked is True

    def test_cleanup_removes_old_expired_entries(self):
        # Record 4 failures — one below the lockout threshold of 5.
        # If the entry survives into the future, a 5th failure will trigger a lockout.
        # If cleanup erases it, the 5th failure starts a fresh count → no lockout.
        mgr = self._make_manager()
        for _ in range(4):
            mgr.record_failure("1.2.3.4", "alice")

        now = time.time()
        with patch("app.core.lockout.time") as mock_time:
            # Jump 1 hour + 2 seconds into the future.  Two conditions are now met:
            # (a) the entry has no active lockout (count=4 never triggered one), so
            #     lockout_until == 0 < now → expired condition satisfied
            # (b) now - first_failure > CLEANUP_INTERVAL (1 h) → "old" condition satisfied
            # (c) now - _last_cleanup >> 60 → cleanup will actually execute
            # is_locked_out() runs _cleanup_old_entries() internally before checking.
            future = now + 3602
            mock_time.time.return_value = future
            locked, remaining = mgr.is_locked_out("1.2.3.4", "alice")
            assert locked is False
            assert remaining == 0

            # Now record one more failure.  If cleanup ran and removed the stale entry,
            # this is the very first failure — count=1, no lockout.
            # If cleanup did NOT run, count would become 5 and trigger a 5-minute lockout.
            is_now_locked, lockout_seconds = mgr.record_failure("1.2.3.4", "alice")

        assert is_now_locked is False, "cleanup erased old entry; count must restart at 1"
        assert lockout_seconds == 0

    def test_record_failure_resets_after_lockout_expires(self):
        mgr = self._make_manager()
        for _ in range(5):
            mgr.record_failure("1.2.3.4", "alice")

        now = time.time()
        with patch("app.core.lockout.time") as mock_time:
            # Jump past the 5min lockout
            mock_time.time.return_value = now + 5 * 60 + 1
            # Next failure should reset the count
            result = mgr.record_failure("1.2.3.4", "alice")

        # After reset, one failure — no lockout yet
        is_locked, _ = result
        assert is_locked is False
