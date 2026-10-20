"""Acceptance lifecycle regressions; no browser, server or provider calls."""
import argparse
import asyncio
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("browser_acceptance", SCRIPTS / "browser-acceptance.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
supervisor_spec = importlib.util.spec_from_file_location("browser_supervisor", SCRIPTS / "run-browser-acceptance.py")
supervisor = importlib.util.module_from_spec(supervisor_spec)
supervisor_spec.loader.exec_module(supervisor)


class AcceptanceLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root_patch = patch.object(harness, "ROOT", Path(self.temp.name))
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.cleanup_bridge = patch.object(harness, "bounded_cleanup_call", side_effect=lambda target, method, *args: getattr(target, method)(*args))
        self.cleanup_bridge.start()
        self.addCleanup(self.cleanup_bridge.stop)
        self.runner = harness.BrowserAcceptance(argparse.Namespace(url="http://127.0.0.1:4173", capture_only=False))
        self.runner.report["scenarios"] = [
            {**definition, "status": "PASS", "checks": [{"ok": True, "description": "observed"}]}
            for definition in self.runner.required
        ]
        self.runner.report["cleanup"] = "COMPLETE"

    def finish(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = self.runner.finish()
        report = json.loads((self.runner.directory / "results.json").read_text())
        return code, output.getvalue(), report

    def test_complete_run_passes(self):
        code, output, report = self.finish()
        self.assertEqual(code, 0)
        self.assertEqual(report["status"], "PASS")
        self.assertIn("BROWSER_ACCEPTANCE_OK", output)

    def test_fatal_error_cannot_pass_sixteen_green_scenarios(self):
        self.runner.report["fatalError"] = "Driver shutdown failed"
        code, output, report = self.finish()
        self.assertEqual(code, 1)
        self.assertEqual(report["status"], "FAIL")
        self.assertNotIn("BROWSER_ACCEPTANCE_OK", output)

    def test_empty_fatal_exception_message_still_fails(self):
        self.runner.report["fatalError"] = ""
        self.assertEqual(self.finish()[0], 1)

    def test_pending_or_failed_cleanup_cannot_pass(self):
        for state in ("PENDING", "FAILED"):
            with self.subTest(state=state):
                self.runner.report["cleanup"] = state
                code, output, report = self.finish()
                self.assertEqual(code, 1)
                self.assertEqual(report["status"], "FAIL")
                self.assertNotIn("BROWSER_ACCEPTANCE_OK", output)

    def test_missing_or_failed_scenario_still_fails(self):
        self.runner.report["scenarios"].pop()
        self.assertEqual(self.finish()[0], 1)

    def test_close_persists_evidence_before_call_and_records_success(self):
        browser = Mock()
        def during_close():
            report = json.loads((self.runner.directory / "results.json").read_text())
            self.assertEqual(report["cleanup"], "PENDING")
            self.assertEqual(len(report["scenarios"]), 16)
            self.assertEqual(report["browserCleanup"][-1]["status"], "PENDING")
        browser.close.side_effect = during_close
        self.runner.browser = browser
        self.runner.close_browser("functional-before-performance")
        self.assertEqual(self.runner.report["cleanup"], "COMPLETE")
        self.assertIsNone(self.runner.browser)
        self.assertEqual(self.finish()[0], 0)

    def test_later_close_does_not_erase_earlier_failed_cleanup(self):
        self.runner.browser = Mock()
        self.runner.browser.close.side_effect = RuntimeError("close failed")
        with self.assertRaisesRegex(RuntimeError, "close failed"):
            self.runner.close_browser("functional-before-performance")
        self.runner.browser = Mock()
        self.runner.close_browser("final")
        self.assertEqual(self.runner.report["cleanup"], "FAILED")
        self.assertEqual(self.finish()[0], 1)

    def test_owned_voice_and_context_close_before_browser(self):
        calls = []
        page = Mock()
        page.is_closed.return_value = False
        page.evaluate.side_effect = lambda source: calls.append(("voice", source))
        closed_page = Mock()
        closed_page.is_closed.return_value = True
        context = Mock(pages=[page, closed_page])
        context.close.side_effect = lambda: calls.append(("context", None))
        browser = Mock()
        browser.close.side_effect = lambda: calls.append(("browser", None))
        self.runner.context, self.runner.browser = context, browser
        self.runner.close_browser("final")
        self.assertEqual([name for name, _ in calls], ["voice", "context", "browser"])
        self.assertEqual(calls[0][1], "() => window.guildVoice?.destroy?.()")
        closed_page.evaluate.assert_not_called()
        self.assertEqual(self.runner.report["cleanup"], "COMPLETE")

    def test_context_close_failure_is_retained_and_cannot_pass(self):
        self.runner.context = Mock(pages=[])
        self.runner.context.close.side_effect = RuntimeError("context failed")
        self.runner.browser = Mock()
        with self.assertRaisesRegex(RuntimeError, "context failed"):
            self.runner.close_browser("final")
        self.assertEqual(self.runner.report["browserCleanup"][-1]["phase"], "close-context")
        self.assertEqual(self.finish()[0], 1)

    def test_exact_living_builder_group_does_not_repeat_moving_drag(self):
        self.runner.page = Mock()
        self.runner.page.evaluate.return_value = True
        self.runner.select_entities = Mock()
        self.runner.current = {"checks": []}
        self.runner.retain_or_select_builders(["u85", "u86"])
        self.runner.select_entities.assert_not_called()
        self.assertTrue(self.runner.current["checks"][-1]["ok"])

    def test_changed_builder_selection_requires_ui_and_exact_recheck(self):
        self.runner.page = Mock()
        self.runner.page.evaluate.side_effect = [False, True]
        self.runner.select_entities = Mock()
        self.runner.current = {"checks": []}
        self.runner.retain_or_select_builders(["u85", "u86"])
        self.runner.select_entities.assert_called_once_with(["u85", "u86"])
        self.assertTrue(self.runner.current["checks"][-1]["ok"])

    def test_incomplete_builder_selection_after_ui_is_still_failure(self):
        self.runner.page = Mock()
        self.runner.page.evaluate.return_value = False
        self.runner.select_entities = Mock()
        self.runner.current = {"checks": []}
        with self.assertRaises(harness.AcceptanceFailure):
            self.runner.retain_or_select_builders(["u85", "u86"])

    def test_unexpected_token_is_blocked_and_prevents_green(self):
        route = Mock()
        route.request.url = "http://127.0.0.1:4173/api/voice/token"
        route.request.method = "POST"
        self.runner.block_voice_token(route)
        route.fulfill.assert_called_once()
        self.assertEqual(route.fulfill.call_args.kwargs["status"], 403)
        route.continue_.assert_not_called()
        self.assertEqual(len(self.runner.report["unexpectedVoiceTokenRequests"]), 1)
        self.assertEqual(self.finish()[0], 1)

    def test_capture_only_cannot_hide_failed_cleanup(self):
        self.runner.args.capture_only = True
        self.runner.report["cleanup"] = "FAILED"
        code, output, report = self.finish()
        self.assertEqual(code, 1)
        self.assertNotIn("BROWSER_CAPTURE_OK", output)


class BrowserLaunchTests(unittest.TestCase):
    def test_default_and_explicit_system_do_not_request_gpu_override(self):
        for args in (argparse.Namespace(), argparse.Namespace(gpu_preference="system")):
            options = harness.browser_launch_options(args)
            self.assertEqual(options["args"], [])
            self.assertEqual(options["channel"], "chrome")
            self.assertTrue(options["headless"])

    def test_high_performance_is_explicit_and_preserves_headed_channel(self):
        options = harness.browser_launch_options(argparse.Namespace(
            gpu_preference="high-performance", headed=True, browser_channel="chromium"))
        self.assertEqual(options["args"], ["--force-high-performance-gpu"])
        self.assertFalse(options["headless"])
        self.assertEqual(options["channel"], "chromium")

    def test_headless_shell_has_no_named_channel(self):
        self.assertNotIn("channel", harness.browser_launch_options(argparse.Namespace(browser_channel="headless-shell")))

    def test_invalid_gpu_choice_is_not_silently_defaulted(self):
        with self.assertRaises(ValueError):
            harness.browser_launch_options(argparse.Namespace(gpu_preference="unknown"))


class BoundedCleanupTests(unittest.TestCase):
    def test_close_acknowledgement_can_complete(self):
        async def close():
            return "closed"
        target = SimpleNamespace(_impl_obj=SimpleNamespace(close=close), _sync=asyncio.run)
        self.assertEqual(harness.bounded_cleanup_call(target, "close", timeout=.1), "closed")

    def test_stalled_close_is_cancelled_and_raises_timeout(self):
        cancelled = []
        async def close():
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.append(True)
        target = SimpleNamespace(_impl_obj=SimpleNamespace(close=close), _sync=asyncio.run)
        with self.assertRaises(TimeoutError):
            harness.bounded_cleanup_call(target, "close", timeout=.01)
        self.assertEqual(cancelled, [True])


class SupervisorTests(unittest.TestCase):
    def invoke(self, child, *arguments):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(supervisor, "ROOT", Path(directory)), \
                 patch.object(sys, "argv", ["run-browser-acceptance.py", *arguments]), \
                 patch.object(supervisor.subprocess, "Popen", return_value=child) as launch, \
                 patch.object(supervisor, "stop_owned_tree", return_value={"status": "CHILD_EXITED"}) as stop, \
                 contextlib.redirect_stdout(io.StringIO()):
                code = supervisor.main()
                receipts = list((Path(directory) / "docs/reports").glob("browser-supervisor-*.json"))
                receipt = json.loads(receipts[0].read_text())
                return code, receipt, launch.call_args, stop.call_args

    def test_normal_exit_preserves_flags_and_never_terminates_tree(self):
        child = Mock(pid=43210)
        child.wait.return_value = 0
        code, receipt, launch, stop = self.invoke(child, "--headed", "--benchmark-seconds", "120")
        self.assertEqual(code, 0)
        self.assertEqual(receipt["status"], "EXITED")
        self.assertIsNone(stop)
        child.wait.assert_called_once_with(timeout=600)
        self.assertEqual(launch.args[0][-3:], ["--headed", "--benchmark-seconds", "120"])

    def test_timeout_is_distinct_and_only_passes_owned_child_to_cleanup(self):
        child = Mock(pid=43210)
        child.wait.side_effect = subprocess.TimeoutExpired("owned runner", 600)
        code, receipt, _, stop = self.invoke(child)
        self.assertEqual(code, 124)
        self.assertEqual(receipt["status"], "TIMED_OUT")
        self.assertEqual(stop.args, (child,))

    def test_already_exited_child_is_never_killed(self):
        child = Mock(pid=43210, returncode=1)
        child.poll.return_value = 1
        with patch.object(supervisor.subprocess, "run") as terminate:
            result = supervisor.stop_owned_tree(child)
        terminate.assert_not_called()
        self.assertEqual(result["status"], "ALREADY_EXITED")

    def test_windows_termination_targets_only_owned_pid_tree(self):
        child = Mock(pid=43210, returncode=1)
        child.poll.return_value = None
        completed = subprocess.CompletedProcess([], 0, "terminated", "")
        with patch.object(supervisor.os, "name", "nt"), \
             patch.object(supervisor.subprocess, "run", return_value=completed) as terminate:
            result = supervisor.stop_owned_tree(child)
        self.assertEqual(terminate.call_args.args[0], ["taskkill", "/PID", "43210", "/T", "/F"])
        child.wait.assert_called_once_with(timeout=20)
        self.assertEqual(result["status"], "CHILD_EXITED")


if __name__ == "__main__":
    unittest.main()
