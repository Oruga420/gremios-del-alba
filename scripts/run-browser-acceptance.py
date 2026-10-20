#!/usr/bin/env python3
"""Supervise canonical A9 without changing scenarios or workload thresholds.

The deadline covers startup, functional scenarios, the full benchmark, and
teardown. On timeout only this invocation's child process tree is terminated.
The child's partial report is retained unchanged; a separate receipt records
the timeout and cleanup outcome. Exit 124 means timeout, never acceptance.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT_EXIT = 124


def stop_owned_tree(child):
    if child.poll() is not None:
        return {"status": "ALREADY_EXITED", "pid": child.pid, "exitCode": child.returncode}
    if os.name == "nt":
        # No executable-name matching: the PID belongs to the Popen we created.
        command = ["taskkill", "/PID", str(child.pid), "/T", "/F"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        evidence = {"command": command, "exitCode": result.returncode,
                    "stdout": result.stdout, "stderr": result.stderr}
    else:
        # Popen starts a new session below, so this group contains only our run.
        os.killpg(child.pid, signal.SIGKILL)
        evidence = {"signal": "SIGKILL", "processGroup": child.pid}
    try:
        child.wait(timeout=20)
        return {"status": "CHILD_EXITED", "pid": child.pid, "childExitCode": child.returncode,
                "termination": evidence}
    except subprocess.TimeoutExpired:
        return {"status": "FAILED", "pid": child.pid, "termination": evidence}


def find_reports(run_id, child_pid):
    matches = []
    for path in (ROOT / "docs" / "reports").glob("browser-*/results.json"):
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if report.get("supervisorRunId") == run_id and report.get("runnerPid") == child_pid:
            matches.append(str(path))
    return matches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    args, child_args = parser.parse_known_args()
    if args.timeout_seconds < 1:
        parser.error("--timeout-seconds must be positive")
    if child_args[:1] == ["--"]:
        child_args = child_args[1:]
    run_id = uuid.uuid4().hex
    directory = ROOT / "docs" / "reports"
    directory.mkdir(parents=True, exist_ok=True)
    receipt_path = directory / f"browser-supervisor-{run_id}.json"
    command = [sys.executable, str(ROOT / "scripts" / "browser-acceptance.py"), *child_args]
    environment = {**os.environ, "GUILDS_BROWSER_SUPERVISOR_RUN_ID": run_id}
    receipt = {"runId": run_id, "command": command, "timeoutSeconds": args.timeout_seconds,
               "startedAt": datetime.now(timezone.utc).isoformat(), "status": "RUNNING"}

    def persist():
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")

    persist()
    try:
        child = subprocess.Popen(command, cwd=ROOT, env=environment, start_new_session=os.name != "nt")
    except OSError as error:
        receipt.update(status="START_FAILED", error=str(error), exitCode=1)
        persist()
        return 1
    receipt["childPid"] = child.pid
    persist()
    try:
        code = child.wait(timeout=args.timeout_seconds)
        receipt.update(status="EXITED", exitCode=code)
    except subprocess.TimeoutExpired:
        receipt.update(status="TIMED_OUT", exitCode=TIMEOUT_EXIT)
        persist()  # Deadline evidence survives even a failure in tree cleanup.
        try:
            receipt["timeoutCleanup"] = stop_owned_tree(child)
        except Exception as error:
            receipt["timeoutCleanup"] = {"status": "FAILED", "error": str(error), "pid": child.pid}
        code = TIMEOUT_EXIT
    receipt["reports"] = find_reports(run_id, child.pid)
    receipt["finishedAt"] = datetime.now(timezone.utc).isoformat()
    persist()
    print(f"BROWSER_SUPERVISOR_{receipt['status']} exit={code} receipt={receipt_path}", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
