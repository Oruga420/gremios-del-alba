"""Redact local session/CSRF secrets without changing observed report outcomes."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "docs" / "reports"
ENTROPY = re.compile(r"[A-Za-z0-9._~=-]{24,}\Z")
COOKIE = re.compile(r"guild_session=[A-Za-z0-9._~-]{24,}")
CSRF = re.compile(r'(?i)(["\'](?:csrf|csrf_token|csrfToken)["\']\s*:\s*["\'])([A-Za-z0-9._~=-]{24,})(["\'])')
BEARER = re.compile(r"(?i)(Bearer\s+)[A-Za-z0-9._~=-]{24,}")
QUERY = re.compile(r"(?i)([?&](?:csrf|csrf_token|access_token|token)=)[A-Za-z0-9._~%=-]{24,}")


def scrub(value, key=""):
    count = 0
    if isinstance(value, dict):
        cleaned = {}
        for child_key, child in value.items():
            result, changed = scrub(child, child_key)
            cleaned[child_key] = result
            count += changed
        return cleaned, count
    if isinstance(value, list):
        cleaned = []
        for child in value:
            result, changed = scrub(child)
            cleaned.append(result)
            count += changed
        return cleaned, count
    if not isinstance(value, str):
        return value, 0
    normalized = re.sub(r"[-_]", "", key.casefold())
    if normalized in {"csrf", "csrftoken", "xguildcsrf", "cookieid", "accesstoken", "refreshtoken", "signedtoken"} and ENTROPY.fullmatch(value):
        return "<redacted>", 1
    value, changed = COOKIE.subn("guild_session=<redacted>", value)
    count += changed
    value, changed = CSRF.subn(lambda match: match[1] + "<redacted>" + match[3], value)
    count += changed
    value, changed = BEARER.subn(lambda match: match[1] + "<redacted>", value)
    count += changed
    value, changed = QUERY.subn(lambda match: match[1] + "<redacted>", value)
    count += changed
    return value, count


def main():
    observed_at = datetime.now(timezone.utc).isoformat()
    audit = []
    scanned = 0
    unreadable = []
    for path in sorted(REPORTS.rglob("*.json")):
        if path.name == "browser-redaction-audit.json":
            continue
        raw = path.read_bytes()
        try:
            original = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            unreadable.append(str(path.relative_to(ROOT)))
            continue
        scanned += 1
        cleaned, count = scrub(original)
        prior_markers = raw.count(b"<redacted>")
        if not count and not prior_markers:
            continue
        original_status = original.get("status") if isinstance(original, dict) else None
        if isinstance(cleaned, dict):
            cleaned["_redaction"] = {"observedAt": observed_at, "fieldsRedactedThisPass": count,
                "priorRedactionMarkers": prior_markers,
                "reason": "Local session and CSRF secret values removed; observed results, statuses, errors and byte digests preserved",
                "originalStatus": original_status}
            assert cleaned.get("status") == original_status
        data = (json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n").encode()
        path.write_bytes(data)
        audit.append({"path": str(path.relative_to(ROOT)), "valuesRedacted": count,
            "priorMarkersAnnotated": prior_markers, "statusPreserved": True,
            "originalSha256": hashlib.sha256(raw).hexdigest(), "redactedSha256": hashlib.sha256(data).hexdigest()})
    output = {"observedAt": observed_at, "scope": "All prior JSON reports under docs/reports only",
              "scannedJsonReports": scanned, "unreadableJsonReports": unreadable,
              "reports": audit, "valuesRedacted": sum(item["valuesRedacted"] for item in audit),
              "outcomesPreserved": True}
    (REPORTS / "browser-redaction-audit.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"BROWSER_REPORTS_REDACTED files={len(audit)} values={output['valuesRedacted']} outcomes=preserved")


if __name__ == "__main__":
    main()
