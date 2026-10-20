#!/usr/bin/env python3
"""A9: actual-browser acceptance for the local Gremios del Alba build.

Run from the project root after the contract's prerequisite gates. No server,
browser preference, dependency installation, native WebMCP flag, microphone
grant or vendor call is created by this program. ``--capture-only`` is an
explicit diagnostic and can never print the A9 green marker.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import traceback
from typing import Any, Callable
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen
from datetime import datetime, timezone

from browser_benchmark import install_phase_observer, observe_workload, validate_workload


ROOT = Path(__file__).resolve().parents[1]
INVENTORY = Path(__file__).with_name("browser-scenarios.json")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    text = re.sub(r"guild_session=[a-f0-9]{64}", "guild_session=<redacted>", text)
    path.write_text(text + "\n", encoding="utf-8")


class AcceptanceFailure(AssertionError):
    pass


def browser_launch_options(args: argparse.Namespace) -> dict[str, Any]:
    channel = getattr(args, "browser_channel", "chrome")
    preference = getattr(args, "gpu_preference", "system")
    if preference not in {"system", "high-performance"}:
        raise ValueError(f"Unsupported GPU preference: {preference}")
    options: dict[str, Any] = {"headless": not bool(getattr(args, "headed", False)),
                               "args": ["--force-high-performance-gpu"] if preference == "high-performance" else []}
    if channel != "headless-shell":
        options["channel"] = channel
    return options


def bounded_cleanup_call(target: Any, method: str, *args: Any, timeout: float = 30) -> Any:
    """Bound the installed Playwright coroutine on its existing sync event loop.

    Public sync close() has no timeout. This narrow adapter uses the same
    implementation/greenlet bridge as the installed generated sync methods;
    no Playwright object is moved to another thread or event loop.
    """
    operation = getattr(target._impl_obj, method)(*args)
    return target._sync(asyncio.wait_for(operation, timeout=timeout))


class BrowserAcceptance:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.base = args.url.rstrip("/")
        parsed = urlsplit(self.base)
        if parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.scheme != "http":
            raise ValueError("Only the authorized loopback HTTP server may be tested")
        self.host, self.port = parsed.hostname, parsed.port or 80
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + os.urandom(4).hex()
        self.directory = ROOT / "docs" / "reports" / f"browser-{self.run_id}"
        self.directory.mkdir(parents=True, exist_ok=False)
        self.required = json.loads(INVENTORY.read_text(encoding="utf-8"))["required"]
        ids = [scenario["id"] for scenario in self.required]
        if ids != [f"BROWSER{index:02d}" for index in range(1, 17)]:
            raise ValueError("Stable required BROWSER01..BROWSER16 inventory is missing, reordered or duplicated")
        self.report: dict[str, Any] = {
            "version": 1,
            "acceptance": "A9",
            "runId": self.run_id,
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "command": [sys.executable, *sys.argv],
            "runnerSha256": sha256(Path(__file__).read_bytes()),
            "benchmarkObserverSha256": sha256(Path(__file__).with_name("browser_benchmark.py").read_bytes()),
            "runnerPid": os.getpid(),
            "supervisorRunId": os.environ.get("GUILDS_BROWSER_SUPERVISOR_RUN_ID"),
            "cleanup": "PENDING",
            "browserCleanup": [],
            "unexpectedVoiceTokenRequests": [],
            "projectRoot": str(ROOT),
            "url": self.base,
            "captureOnly": bool(args.capture_only),
            "inventorySha256": sha256(INVENTORY.read_bytes()),
            "requiredScenarioIds": ids,
            "scenarios": [],
            "screenshots": [],
            "consoleErrors": [],
            "pageErrors": [],
            "requestFailures": [],
            "loadedResponses": [],
            "performanceIsolation": {
                "policy": "BROWSER01..14 share the functional browser; BROWSER15 always uses a new isolated browser, declared before execution",
                "cameraZoom": 0.9605607431229627,
                "priorSequenceSensitiveFailure": "docs/reports/browser-20261013T143056-e07dedde/results.json",
                "limitation": "Clean-context performance does not resolve the preserved full-sequence slowdown",
            },
            "limitations": [
                f"{'Headed' if getattr(args, 'headed', False) else 'Headless'} fresh Playwright browser; no real microphone grant or human audio is claimed.",
                "Native WebMCP and personal vendor calls are separately owned probes.",
                "Finite workload results apply only to the recorded hardware/browser/build."
            ],
        }
        self.current: dict[str, Any] | None = None
        self.page: Any = None
        self.browser: Any = None
        self.context: Any = None
        self.response_rows: dict[str, dict[str, Any]] = {}
        self.functional_response_rows: dict[str, dict[str, Any]] = {}
        self.health: dict[str, Any] = {}
        self.fixture_metadata: dict[str, Any] = {}

    def check(self, condition: bool, description: str, observed: Any = None) -> None:
        if self.current is None:
            raise RuntimeError("Assertions must belong to a stable scenario")
        self.current["checks"].append({"ok": bool(condition), "description": description, "observed": observed})
        if not condition:
            raise AcceptanceFailure(description + (f": {observed}" if observed is not None else ""))

    def record_checks(self, checks: list[dict[str, Any]]) -> None:
        if self.current is None:
            raise RuntimeError("Checks require a current scenario")
        self.current["checks"].extend(checks)
        failed = [item["description"] for item in checks if not item.get("ok")]
        if failed:
            raise AcceptanceFailure("; ".join(failed))

    def scenario(self, scenario_id: str, operation: Callable[[], None]) -> None:
        definition = next(item for item in self.required if item["id"] == scenario_id)
        row = {**definition, "status": "RUNNING", "checks": [], "startedAt": datetime.now(timezone.utc).isoformat()}
        self.current = row
        started = time.perf_counter()
        try:
            operation()
            if not row["checks"] or not all(check["ok"] for check in row["checks"]):
                raise AcceptanceFailure("Scenario produced no observed assertions or has a failed assertion")
            row["status"] = "PASS"
        except Exception as error:
            row["status"] = "FAIL"
            row["error"] = str(error)
            row["exception"] = type(error).__name__
            row["traceback"] = traceback.format_exc(limit=6)
            if self.page is not None:
                try:
                    self.capture(f"{scenario_id}-failure")
                    if self.page.evaluate("() => !!game.world"):
                        row["failureState"] = self.game_state()
                except Exception as capture_error:
                    row["captureError"] = str(capture_error)
        row["elapsedSeconds"] = time.perf_counter() - started
        self.report["scenarios"].append(row)
        self.current = None
        print(f"{scenario_id} {row['status']}: {row.get('error', definition['name'])}", flush=True)
        self.persist()

    def persist(self) -> None:
        self.report["loadedResponses"] = list(self.response_rows.values())
        write_json(self.directory / "results.json", self.report)

    def raw_http(self, path: str, method: str = "GET", headers: dict[str, str] | None = None,
                 body: bytes | str | None = None) -> dict[str, Any]:
        connection = http.client.HTTPConnection(self.host, self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            data = response.read()
            return {"path": path, "status": response.status, "headers": dict(response.getheaders()),
                    "bodySha256": sha256(data), "bodyText": data.decode("utf-8", errors="replace")[:2048]}
        finally:
            connection.close()

    def verify_health(self) -> None:
        response = self.raw_http("/api/health")
        if response["status"] != 200:
            raise AcceptanceFailure(f"Expected actual active local server health, got {response['status']}")
        self.health = json.loads(response["bodyText"])
        root = Path(self.health.get("root", "")).resolve()
        if root != ROOT or not self.health.get("ok"):
            raise AcceptanceFailure(f"Active server root identity mismatch: {self.health}")
        pid = int(self.health["pid"])
        if sys.platform == "win32":
            command = f"Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
            result = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=20)
            if result.returncode or not result.stdout.strip():
                raise AcceptanceFailure("Health PID is not an observed running process")
            process = json.loads(result.stdout)
            if int(process.get("ProcessId", 0)) != pid or "node" not in str(process.get("ExecutablePath", "")).lower():
                raise AcceptanceFailure(f"Unexpected server process: {process}")
            listener_command = f"Get-NetTCPConnection -LocalPort {self.port} -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"
            listener_result = subprocess.run(["powershell", "-NoProfile", "-Command", listener_command], capture_output=True, text=True, timeout=20)
            if listener_result.returncode or not listener_result.stdout.strip():
                raise AcceptanceFailure("Actual listening socket could not be observed")
            listeners = json.loads(listener_result.stdout)
            if isinstance(listeners, dict):
                listeners = [listeners]
            if not listeners or any(int(listener.get("OwningProcess", 0)) != pid
                                    or listener.get("LocalAddress") not in {"127.0.0.1", "::1"}
                                    for listener in listeners):
                raise AcceptanceFailure(f"Actual listener is not the expected loopback PID: {listeners}")
            self.report["actualListeners"] = listeners
        else:
            process = {"ProcessId": pid, "commandLine": Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace")}
        self.report["serverIdentity"] = {"health": self.health, "process": process, "healthResponse": response}

    def loaded_response(self, response: Any) -> None:
        parsed = urlsplit(response.url)
        if parsed.hostname not in {self.host, "127.0.0.1", "localhost"} or parsed.port != self.port:
            return
        path = unquote(parsed.path).lstrip("/") or "index.html"
        if path.startswith("api/") or path in {"health", "favicon.ico"}:
            return
        if not (path == "index.html" or path.startswith(("src/", "assets/"))):
            return
        try:
            body = response.body()
            headers = response.all_headers()
            self.response_rows[path] = {"url": response.url, "path": path, "status": response.status,
                                        "bytes": len(body), "sha256": sha256(body),
                                        "sourceHashHeader": headers.get("x-guild-source-hash"),
                                        "fromServiceWorker": response.from_service_worker,
                                        "resourceType": response.request.resource_type}
        except Exception as error:
            self.response_rows[path] = {"url": response.url, "path": path, "status": response.status,
                                       "captureError": str(error)}

    def setup_browser(self, playwright: Any) -> None:
        self.report["cleanup"] = "PENDING"
        self.persist()
        channel = getattr(self.args, "browser_channel", "chrome")
        headed = bool(getattr(self.args, "headed", False))
        launch_options = browser_launch_options(self.args)
        self.browser = playwright.chromium.launch(**launch_options)
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900},
                                                device_scale_factor=1, service_workers="block")
        # Only browser requests are intercepted. The real HTTP negative tests
        # still reach the actual server and validate its auth boundary.
        self.context.route(lambda url: urlsplit(url).path == "/api/voice/token", self.block_voice_token)
        self.page = self.context.new_page()
        cdp = self.context.new_cdp_session(self.page)
        cdp.send("Network.enable")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        self.page.on("pageerror", lambda error: self.report["pageErrors"].append(str(error)))
        self.page.on("console", lambda message: self.report["consoleErrors"].append({"text": message.text, "location": message.location}) if message.type == "error" else None)
        self.page.on("requestfailed", lambda request: self.report["requestFailures"].append({"url": request.url, "failure": request.failure}))
        self.page.on("response", self.loaded_response)
        hardware: dict[str, Any] = {"platform": platform.platform(), "machine": platform.machine(),
                                    "processor": platform.processor(), "logicalCpuCount": os.cpu_count()}
        if sys.platform == "win32":
            result = subprocess.run(["powershell", "-NoProfile", "-Command",
                                     "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress"],
                                    capture_output=True, text=True, timeout=20)
            if result.returncode == 0 and result.stdout.strip():
                hardware["cpu"] = json.loads(result.stdout)
        gpu: Any = None
        try:
            gpu = self.browser.new_browser_cdp_session().send("SystemInfo.getInfo")
        except Exception as error:
            gpu = {"unavailable": str(error)}
        self.report["environment"] = {"browser": "Playwright controlled Chrome/Chromium", "channel": channel, "version": self.browser.version,
                                       "gpuPreferenceRequested": getattr(self.args, "gpu_preference", "system"),
                                       "launchArgs": launch_options["args"],
                                       "headless": not headed, "headedRequested": headed, "viewport": {"width": 1440, "height": 900},
                                       "freshContext": True, "serviceWorkers": "blocked", "cacheDisabled": True,
                                       "hardware": hardware, "actualGpuInfo": gpu}
        self.page.goto(self.base, wait_until="networkidle", timeout=30000)
        self.page.wait_for_function("() => !!window.game && !!document.querySelector('canvas')", timeout=30000)
        self.report["environment"]["browserNavigator"] = self.page.evaluate("() => ({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null})")

    def block_voice_token(self, route: Any) -> None:
        self.report["unexpectedVoiceTokenRequests"].append({"url": route.request.url,
                                                           "method": route.request.method})
        self.persist()
        route.fulfill(status=403, content_type="application/json",
                      body='{"ok":false,"code":"BROWSER_ACCEPTANCE_VENDOR_BLOCKED"}')

    def close_browser(self, stage: str) -> None:
        if self.browser is None:
            return
        row = {"stage": stage, "status": "PENDING", "startedAt": datetime.now(timezone.utc).isoformat()}
        self.report["browserCleanup"].append(row)
        self.report["cleanup"] = "PENDING"
        self.persist()  # Preserve all measured evidence even if close never returns.
        try:
            if self.context is not None:
                row["phase"] = "destroy-owned-page-voice"
                self.persist()
                for page in self.context.pages:
                    if not page.is_closed():
                        bounded_cleanup_call(page, "evaluate", "() => window.guildVoice?.destroy?.()")
                row["phase"] = "close-context"
                self.persist()
                bounded_cleanup_call(self.context, "close")
            row["phase"] = "close-browser"
            self.persist()
            bounded_cleanup_call(self.browser, "close")
            row["status"] = "COMPLETE"
        except Exception as error:
            row["status"] = "FAILED"
            row["error"] = str(error) or type(error).__name__
            raise
        finally:
            self.browser = self.context = self.page = None
            row["finishedAt"] = datetime.now(timezone.utc).isoformat()
            self.report["cleanup"] = ("COMPLETE" if all(item["status"] == "COMPLETE"
                                      for item in self.report["browserCleanup"]) else "FAILED")
            self.persist()

    def capture(self, name: str) -> Path:
        path = self.directory / f"{name}.png"
        self.page.screenshot(path=str(path), full_page=True)
        self.report["screenshots"].append({"name": name, "path": str(path), "viewport": self.page.viewport_size})
        return path

    def action(self, name: str) -> Any:
        selector = f'[data-action="{name}"]:visible'
        locator = self.page.locator(selector)
        locator.first.wait_for(state="visible", timeout=10000)
        return locator.first

    def click_action(self, name: str) -> None:
        self.action(name).click()

    def snapshot(self) -> dict[str, Any]:
        return self.page.evaluate("() => {if (!game.world) throw Error('No actual World'); return game.world.serialize();}")

    def game_state(self) -> dict[str, Any]:
        return self.page.evaluate("() => ({state:game.world.serialize(),summary:game.world.summary(1),selectedIds:[...game.selectedIds],generation:game.worldGeneration,camera:game.renderer?.camera,stats:game.renderer?.stats})")

    def wait(self, predicate: str, args: Any = None, timeout: int = 15000) -> Any:
        return self.page.wait_for_function(predicate, arg=args, timeout=timeout).json_value()

    def entity(self, entity_id: str | int) -> dict[str, Any]:
        return self.page.evaluate("id => {const e=game.world.getEntity(id);if(!e)throw Error('Entity missing '+id);return JSON.parse(JSON.stringify(e));}", entity_id)

    def point(self, x: float, y: float) -> dict[str, float]:
        point = self.page.evaluate("({x,y}) => game.renderer.worldToScreen(x,y)", {"x": x, "y": y})
        if isinstance(point, list):
            return {"x": point[0], "y": point[1]}
        return point

    def center_visible(self, x: float, y: float) -> None:
        minimap = self.page.locator("[data-testid=minimap], #minimap").first
        box = minimap.bounding_box()
        dimensions = self.page.evaluate("() => ({width:game.world.state.map.width,height:game.world.state.map.height})")
        if box is None:
            raise AcceptanceFailure("Visible minimap required for camera navigation")
        self.page.mouse.click(box["x"] + x / dimensions["width"] * box["width"],
                              box["y"] + y / dimensions["height"] * box["height"])

    def click_entity(self, entity_id: str | int, button: str = "left", modifiers: list[str] | None = None) -> None:
        entity = self.entity(entity_id)
        self.center_visible(entity["x"], entity["y"])
        point = self.page.evaluate("""async id => {
          const {BUILDINGS,UNITS}=await import('/src/game/data.js');
          const e=game.world.getEntity(id),r=document.querySelector('#world-canvas').getBoundingClientRect();
          const size=BUILDINGS[e.kind]?.size??1,p=game.renderer.worldToScreen(e.x+(size-1)/2,e.y+(size-1)/2);
          const z=game.renderer.camera.zoom;
          const candidates=UNITS[e.kind]?[[0,-12*z],[0,-6*z],[0,0]]:[[0,0],[0,-12*z]];
          for(const y of [-30,-24,-18,-12,-6,0,6,12,18,24])for(const x of [0,-6,6,-12,12,-18,18,-24,24])candidates.push([x*z,y*z]);
          for(const [dx,dy] of candidates){const x=p.x+dx,y=p.y+dy;if(x>r.left&&x<r.right&&y>r.top&&y<r.bottom&&game.renderer.pick(x,y)?.id===id)return {x,y};}
          return null;
        }""", entity_id)
        if point is None:
            raise AcceptanceFailure(f"Actual renderer exposes no clickable hit point for {entity_id}")
        for modifier in modifiers or []:
            self.page.keyboard.down(modifier)
        self.page.mouse.click(point["x"], point["y"], button=button)
        for modifier in reversed(modifiers or []):
            self.page.keyboard.up(modifier)

    def click_world(self, x: float, y: float, button: str = "left") -> None:
        self.center_visible(x, y)
        point = self.point(x, y)
        self.page.mouse.click(point["x"], point["y"], button=button)

    def select_entity(self, entity_id: str | int) -> None:
        self.click_entity(entity_id)
        self.wait("id => game.selectedIds.includes(id)", entity_id)

    def select_entities(self, entity_ids: list[str | int]) -> None:
        if not entity_ids:
            raise AcceptanceFailure("Scenario has no actual command participants")
        if len(entity_ids) == 1:
            self.select_entity(entity_ids[0])
            return
        entities = [self.entity(entity_id) for entity_id in entity_ids]
        self.center_visible(sum(entity["x"] for entity in entities) / len(entities),
                            sum(entity["y"] for entity in entities) / len(entities))
        points = [self.point(entity["x"], entity["y"]) for entity in entities]
        left, right = min(point["x"] for point in points) - 10, max(point["x"] for point in points) + 10
        top, bottom = min(point["y"] for point in points) - 10, max(point["y"] for point in points) + 10
        self.page.mouse.move(left, top)
        self.page.mouse.down()
        self.page.mouse.move(right, bottom, steps=12)
        self.page.mouse.up()
        self.wait("ids => ids.every(id=>game.selectedIds.includes(id))", entity_ids)

    def tab(self, name: str) -> None:
        self.page.locator(f'[data-action="tab"][data-tab="{name}"]:visible').click()

    def retain_or_select_builders(self, builder_ids: list[str | int]) -> None:
        # Construction keeps its initial real UI selection. Avoid dragging a
        # stale rectangle around builders still moving toward the new house.
        predicate = "ids => ids.length>0 && game.selectedIds.length===ids.length && ids.every(id=>game.selectedIds.includes(id)&&game.world.getEntity(id)?.hp>0)"
        if not self.page.evaluate(predicate, builder_ids):
            self.select_entities(builder_ids)
        self.check(self.page.evaluate(predicate, builder_ids),
                   "Construction command retains the exact selected living builder group", builder_ids)

    def import_save(self, path: Path) -> None:
        if self.page.locator("#panel-drawer").is_visible():
            self.click_action("close-panel")
        self.page.evaluate("""() => {
          if(window.__browserQALoadObserver)return;
          const input=document.querySelector('#load-file');
          input.addEventListener('change',()=>{window.__browserQALastImport={wallMs:performance.now(),fileName:input.files?.[0]?.name,priorWorldGeneration:game.worldGeneration};},true);
          window.__browserQALoadObserver=true;
        }""")
        before = self.page.evaluate("() => game.worldGeneration")
        self.click_action("load")
        visible_import = self.page.locator('[data-action="load-file"]:visible')
        if visible_import.count():
            # Open the app's actual file chooser path, then supply the test file.
            with self.page.expect_file_chooser() as chooser:
                visible_import.first.click()
            chooser.value.set_files(str(path))
            self.wait("before => game.worldGeneration > before", before)
            return
        input_locator = self.page.locator('input[type="file"][data-action="load-file"], input[type="file"]')
        if input_locator.count() != 1:
            raise AcceptanceFailure("Expected exactly one actual save file input")
        input_locator.set_input_files(str(path))
        self.wait("before => game.worldGeneration > before", before)

    def fixture(self, name: str) -> dict[str, Any]:
        index = self.args.fixture_dir / "index.json"
        if not index.is_file():
            raise AcceptanceFailure(f"Validated real-engine browser fixture index is missing: {index}")
        data = json.loads(index.read_text(encoding="utf-8"))
        current_engine_hash = sha256((ROOT / "src" / "game" / "world.js").read_bytes())
        if data.get("engineSha256") != current_engine_hash:
            raise AcceptanceFailure("Engine changed after fixture validation; regenerate current fixtures before importing")
        fixture = data.get("fixtures", {}).get(name)
        if not fixture or not fixture.get("validatedByWorldFromSave"):
            raise AcceptanceFailure(f"Fixture {name} lacks actual World.fromSave validation")
        path = (index.parent / fixture["file"]).resolve()
        if not path.is_relative_to(index.parent.resolve()):
            raise AcceptanceFailure("Fixture path escapes its owned directory")
        if sha256(path.read_bytes()) != fixture.get("sha256"):
            raise AcceptanceFailure(f"Fixture {name} bytes differ from its validation manifest")
        self.import_save(path)
        self.fixture_metadata = fixture.get("metadata", {})
        return self.fixture_metadata

    def not_ready(self, name: str) -> None:
        raise AcceptanceFailure(f"{name} has no implementation handshake yet; not run and not accepted")

    def new_match(self, map_id: str = "valle-del-alba", guild_id: str = "alba",
                  difficulty: str = "normal", mode: str = "conquest") -> dict[str, Any]:
        if self.page.locator("#panel-drawer").is_visible():
            self.click_action("close-panel")
        if self.page.locator("#winner-dialog[open]").count():
            self.click_action("return-menu")
        if not self.page.locator("#start-screen").is_visible():
            self.click_action("new-match")
            self.click_action("return-menu")
        generation = self.page.evaluate("() => game.worldGeneration")
        self.page.locator(f'#guild-options label:has(input[value="{guild_id}"])').click()
        self.page.locator(f'#map-options label:has(input[value="{map_id}"])').click()
        self.page.locator("#difficulty").select_option(difficulty)
        self.page.locator(f'label:has(input[name="mode"][value="{mode}"])').click()
        self.click_action("start-match")
        self.wait("before => game.worldGeneration > before && !!game.world && !document.querySelector('#game-screen').hidden", generation)
        return self.game_state()

    def menu(self) -> None:
        self.check(self.page.locator("#start-screen").is_visible(), "Actual root opens the visible start menu")
        guilds = self.page.locator('#guild-options input[name="guild"]').evaluate_all("elements=>elements.map(e=>e.value)")
        maps = self.page.locator('#map-options input[name="map"]').evaluate_all("elements=>elements.map(e=>e.value)")
        self.check(len(guilds) == 4 and len(set(guilds)) == 4, "Four distinct guild choices are real visible controls", guilds)
        self.check(len(maps) == 10 and len(set(maps)) == 10, "Ten distinct map choices are real visible controls", maps)
        self.capture("menu-1440x900")
        for guild in guilds:
            observed = self.new_match(maps[0], guild, "hard", "peaceful")
            state = observed["state"]
            self.check(state.get("guildId") == guild and state.get("mapId") == maps[0],
                       "Visible guild/map choice changes the actual new World", {"guild": state.get("guildId"), "map": state.get("mapId")})
            self.check(state.get("difficulty") == "hard" and state.get("mode") == "peaceful",
                       "Visible difficulty and peaceful controls change the actual World", {"difficulty": state.get("difficulty"), "mode": state.get("mode")})
            self.check(state.get("time", 999) < 2 and state.get("winner") is None,
                       "New match resets simulation clock and terminal state", {"time": state.get("time"), "winner": state.get("winner")})
            self.check(observed["summary"]["population"] > 0 and observed["summary"]["reservedPopulation"] == 0,
                       "New World has real inhabitants and no inherited training reservations", observed["summary"])
        conquest = self.new_match(maps[0], guilds[0], "normal", "conquest")
        self.check(conquest["state"].get("mode") == "conquest" and conquest["state"].get("difficulty") == "normal",
                   "Visible conquest/normal choices take effect after peaceful matches", conquest["state"].get("mode"))

    def maps(self) -> None:
        catalog = self.page.evaluate("async()=>{const {MAPS}=await import('/src/game/data.js');return MAPS.map(({id,name,topology})=>({id,name,topology}));}")
        self.check(len(catalog) == 10, "Actual runtime catalog has ten maps", catalog)
        evidence = []
        for index, definition in enumerate(catalog):
            observed = self.new_match(definition["id"])
            state = observed["state"]
            self.check(state["mapId"] == definition["id"], "Each map is selected through visible menu and creates its real World", definition["id"])
            report = self.page.evaluate("""async()=>{
              const {Navigation}=await import('/src/game/navigation.js');
              const {TERRAIN,BUILDINGS}=await import('/src/game/data.js');
              const w=game.world, m=w.state.map, nav=new Navigation(w);
              const worker=w.state.units.find(u=>u.team===1&&u.kind==='villager'&&u.hp>0);
              const own=w.state.buildings.find(b=>b.team===1&&b.kind==='guildhall');
              const enemy=w.state.buildings.find(b=>b.team===2&&b.kind==='guildhall');
              const histogram={}; for(const t of m.terrain)histogram[t]=(histogram[t]??0)+1;
              const resources=['wood','food','gold','stone'].map(kind=>{
                const candidates=w.state.nodes.filter(n=>n.kind===kind&&n.amount>0).map(n=>({id:n.id,path:nav.path(worker,n)}));
                const route=candidates.find(c=>c.path.status==='arrived');
                return {kind,targetId:route?.id??null,status:route?.path.status??'unreachable',length:route?.path.path.length??null};
              });
              const dropoff=nav.path(worker,{x:own.x-1,y:own.y+1});
              const conquest=nav.path(worker,{x:enemy.x-1,y:enemy.y+1});
              let plots=0, degreeHistogram=[0,0,0,0,0],components=[], seen=new Set();
              for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(nav.walkable(x,y)){
                const degree=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>nav.walkable(x+dx,y+dy)).length;degreeHistogram[degree]++;
                if(x<m.width-2&&y<m.height-2&&[0,1].every(dx=>[0,1].every(dy=>nav.walkable(x+dx,y+dy))))plots++;
                const key=y*m.width+x;if(seen.has(key))continue;const q=[key];seen.add(key);let head=0;
                while(head<q.length){const at=q[head++],ax=at%m.width,ay=Math.floor(at/m.width);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=ax+dx,ny=ay+dy,ni=ny*m.width+nx;if(nav.walkable(nx,ny)&&!seen.has(ni)){seen.add(ni);q.push(ni);}}}
                components.push(q.length);
              }
              return {width:m.width,height:m.height,terrainCells:m.terrain.length,revealed:m.fullyDiscovered===true&&w.state.fog==null&&w.state.visibility==null,
                histogram,degreeHistogram,components:components.sort((a,b)=>b-a),availableHousePlots:plots,resources,
                dropoff:{status:dropoff.status,length:dropoff.path.length},conquest:{status:conquest.status,length:conquest.path.length},
                waterCells:histogram[TERRAIN.WATER]??0,bridgeCells:histogram[TERRAIN.BRIDGE]??0};
            }""")
            self.check(report["terrainCells"] == report["width"] * report["height"] and report["revealed"],
                       "Real map contains all terrain and no hidden/fog state", report)
            self.check(report["availableHousePlots"] > 0 and all(route["status"] == "arrived" for route in report["resources"]),
                       "Each map has actual reachable finite resources and construction plots", report)
            self.check(report["dropoff"]["status"] == "arrived" and report["conquest"]["status"] == "arrived",
                       "Actual navigation reaches dropoff and opposing city on each map", report)
            evidence.append({**definition, **report})
            if index in {0, 3, 9}:
                self.capture(f"map-{definition['id']}")
        signatures = [json.dumps({key: item[key] for key in ("histogram", "degreeHistogram", "components", "conquest", "bridgeCells")}, sort_keys=True) for item in evidence]
        self.check(len(set(signatures)) == 10, "Ten maps differ in measured terrain/connectivity/bottleneck/route structures", evidence)
        self.check(any(item["bridgeCells"] > 0 for item in evidence) and any(item["waterCells"] > 0 for item in evidence),
                   "Actual map set includes bridge and water traversal structures", evidence)
        write_json(self.directory / "maps.json", evidence)

    def names(self) -> None:
        observed = self.new_match()
        villagers = [unit for unit in observed["state"]["units"] if unit["kind"] == "villager" and unit["team"] == 1]
        normalized = [re.sub(r"\s+", " ", unit.get("name", "").strip()).casefold() for unit in villagers]
        self.check(bool(villagers) and all(normalized) and len(normalized) == len(set(normalized)),
                   "Actual default villagers are named uniquely", [{"id": unit["id"], "name": unit.get("name")} for unit in villagers])
        first, second = villagers[:2]
        self.select_entity(first["id"])
        self.click_action("rename")
        renamed = "Aurora Navegante"
        self.page.locator("#rename-input").fill(renamed)
        self.click_action("rename-submit")
        self.wait("({id,name}) => game.world.getEntity(id).name===name", {"id": first["id"], "name": renamed})
        self.check(self.entity(first["id"])["name"] == renamed, "Visible rename form changes the actual villager name", renamed)
        self.select_entity(second["id"])
        self.click_action("rename")
        self.page.locator("#rename-input").fill("  AURORA   NAVEGANTE  ")
        self.click_action("rename-submit")
        self.check(self.entity(second["id"])["name"] == second["name"],
                   "Normalized duplicate rename is rejected without mutation", self.entity(second["id"])["name"])
        if self.page.locator("#panel-drawer").is_visible():
            self.click_action("close-panel")
        self.capture("renamed-villager")

    def economy(self) -> None:
        metadata = self.fixture("economy")
        cycles = metadata.get("cycles", [])
        self.check({cycle.get("kind") for cycle in cycles} >= {"wood", "food", "gold", "stone", "fish", "farm"},
                   "Validated real-engine fixture covers finite resources, farming and fishing", cycles)
        for cycle in cycles:
            actor = self.entity(cycle["unitId"])
            target = self.entity(cycle["targetId"])
            resource = cycle.get("depositedResource", "food" if cycle["kind"] in {"fish", "farm"} else cycle["kind"])
            before = self.snapshot()["teams"]["1"]["resources"][resource]
            initial_amount = target.get("amount")
            self.select_entity(actor["id"])
            self.click_entity(target["id"], button="right")
            self.wait("id => game.world.getEntity(id).carry?.amount>0", actor["id"], 30000)
            carrying = self.entity(actor["id"])
            self.check(carrying["carry"]["amount"] > 0, "UI resource context order causes actual carried material", {"kind": cycle["kind"], "actor": carrying})
            self.wait("({resource,before}) => game.world.state.teams[1].resources[resource]>before", {"resource": resource, "before": before}, 30000)
            after = self.snapshot()["teams"]["1"]["resources"][resource]
            self.check(after > before, "Actual resource reaches the city bank through dropoff", {"kind": cycle["kind"], "before": before, "after": after})
            if initial_amount is not None:
                remaining = self.entity(target["id"])["amount"]
                self.check(remaining < initial_amount, "Actual finite resource amount was consumed", {"nodeId": target["id"], "before": initial_amount, "after": remaining})
            # The actor remains selected while depositing. Re-clicking a moving
            # actor can hit a different overlapping unit during cleanup.
            selected_actor = self.page.evaluate("id => game.selectedIds.length===1 && game.selectedIds[0]===id && game.world.getEntity(id)?.hp>0", actor["id"])
            if not selected_actor:
                self.select_entity(actor["id"])
            self.check(self.page.evaluate("id => game.selectedIds.length===1 && game.selectedIds[0]===id && game.world.getEntity(id)?.hp>0", actor["id"]),
                       "Cleanup Stop targets the exact selected living resource actor", actor["id"])
            self.click_action("stop")
            self.wait("id => game.world.getEntity(id)?.order?.type==='idle'", actor["id"])
            self.check(self.entity(actor["id"])["order"]["type"] == "idle", "Visible Stop ends the resource actor's order", actor["id"])
        self.capture("economy-carry-deposit")

    def construction(self) -> None:
        metadata = self.fixture("construction")
        builder_ids, plot = metadata["builderIds"], metadata["housePlot"]
        self.select_entities(builder_ids)
        self.tab("economy")
        before = self.snapshot()
        price = self.page.evaluate("async()=>{const {BUILDINGS}=await import('/src/game/data.js');return BUILDINGS.house.cost;}")
        self.click_action("build:house")
        self.click_world(plot["x"], plot["y"])
        self.wait("n => game.world.state.buildings.length>n", len(before["buildings"]))
        after = self.snapshot()
        new_buildings = [building for building in after["buildings"] if building["id"] not in {item["id"] for item in before["buildings"]}]
        self.check(len(new_buildings) == 1 and new_buildings[0]["kind"] == "house", "Visible legal construction creates exactly one actual house", new_buildings)
        house = new_buildings[0]
        self.check(all(before["teams"]["1"]["resources"][resource] - after["teams"]["1"]["resources"][resource] == cost for resource, cost in price.items()),
                   "Actual legal placement spends the catalog cost exactly once", {"before": before["teams"]["1"]["resources"], "after": after["teams"]["1"]["resources"], "price": price})
        self.wait("({id,progress}) => game.world.getEntity(id).progress>progress", {"id": house["id"], "progress": house["progress"]}, 15000)
        self.check(self.entity(house["id"])["progress"] > house["progress"], "Real selected builders advance construction", self.entity(house["id"]))
        self.retain_or_select_builders(builder_ids)
        self.tab("economy")
        invalid_before = self.snapshot()
        self.click_action("build:house")
        self.click_world(plot["x"], plot["y"])
        invalid_after = self.snapshot()
        self.check(len(invalid_after["buildings"]) == len(invalid_before["buildings"])
                   and invalid_before["teams"]["1"]["resources"] == invalid_after["teams"]["1"]["resources"],
                   "Overlapping construction is rejected atomically through UI", {"beforeResources": invalid_before["teams"]["1"]["resources"], "afterResources": invalid_after["teams"]["1"]["resources"]})
        self.page.keyboard.press("Escape")
        self.wait("id => game.world.getEntity(id).progress>=1", house["id"], 30000)
        self.check(self.entity(house["id"])["progress"] >= 1, "Actual house completes", house["id"])
        damaged = self.entity(metadata["damagedBuildingId"])
        self.check(damaged["hp"] < damaged["maxHp"], "Fixture contains an actual damaged repair target", damaged)
        self.retain_or_select_builders(builder_ids)
        self.click_entity(damaged["id"], button="right")
        self.wait("({id,hp}) => game.world.getEntity(id).hp>hp", {"id": damaged["id"], "hp": damaged["hp"]}, 10000)
        self.check(self.entity(damaged["id"])["hp"] > damaged["hp"], "Actual friendly-building context repair increases HP", self.entity(damaged["id"])["hp"])
        self.capture("construction-repair")

    def walls(self) -> None:
        metadata = self.fixture("walls")
        self.select_entities(metadata["builderIds"])
        self.tab("defense")
        kind = metadata.get("wallKind", "palisade")
        before = self.snapshot()
        self.click_action("build:" + kind)
        start, end = metadata["wallStart"], metadata["wallEnd"]
        self.center_visible((start["x"] + end["x"]) / 2, (start["y"] + end["y"]) / 2)
        first, last = self.point(start["x"], start["y"]), self.point(end["x"], end["y"])
        self.page.mouse.move(first["x"], first["y"])
        self.page.mouse.down()
        self.page.mouse.move(last["x"], last["y"], steps=12)
        self.page.mouse.up()
        existing = {building["id"] for building in before["buildings"]}
        self.wait("({existing,kind}) => game.world.state.buildings.filter(b=>b.kind===kind&&!existing.includes(b.id)).length>=2",
                  {"existing": list(existing), "kind": kind})
        line = [building for building in self.snapshot()["buildings"] if building["id"] not in existing and building["kind"] == kind]
        self.check(len(line) >= 2, "Real canvas drag builds multiple actual wall-line segments", line)
        self.wait("ids => ids.every(id=>game.world.getEntity(id).progress>=1)", [building["id"] for building in line], 30000)
        self.check(all(self.entity(building["id"])["progress"] >= 1 for building in line), "Actual builders complete the modular wall line", [building["id"] for building in line])
        gate_id = metadata["gateId"]
        self.select_entity(gate_id)
        initial = self.entity(gate_id)
        self.click_action("gate-toggle")
        toggled = self.entity(gate_id)
        self.check(toggled.get("open") is not initial.get("open"), "Visible gate action changes actual gate traversal state", {"before": initial.get("open"), "after": toggled.get("open")})
        self.click_action("gate-toggle")
        self.check(self.entity(gate_id).get("open") == initial.get("open"), "Visible gate can return to its original state", initial.get("open"))
        route = metadata["gateRoute"]
        if not self.entity(gate_id).get("open"):
            self.click_action("gate-toggle")
        self.select_entity(route["unitId"])
        self.click_world(route["destination"]["x"], route["destination"]["y"], button="right")
        self.wait("({id,destination})=>{const u=game.world.getEntity(id);return Math.hypot(u.x-destination.x,u.y-destination.y)<1.5;}",
                  {"id": route["unitId"], "destination": route["destination"]}, 30000)
        self.check(True, "Actual unit traverses the open gate to its destination", self.entity(route["unitId"]))
        self.select_entity(gate_id)
        self.click_action("gate-toggle")
        self.select_entity(route["unitId"])
        self.click_world(route["origin"]["x"], route["origin"]["y"], button="right")
        self.page.wait_for_timeout(1500)
        blocked = self.page.evaluate("id => game.world.state.navigation.filter(n=>n.unitId===id).at(-1)", route["unitId"])
        self.check(blocked and blocked.get("status") == "unreachable",
                   "Closing the gate invalidates the actual return route with a terminal unreachable result", blocked)
        self.wait("id => !game.world.getEntity(id)", gate_id, 30000)
        self.check(self.page.evaluate("id=>!game.world.getEntity(id)", gate_id), "Actual enemy siege destroys the closed gate", gate_id)
        self.select_entity(route["unitId"])
        self.click_world(route["origin"]["x"], route["origin"]["y"], button="right")
        self.wait("({id,destination})=>{const u=game.world.getEntity(id);return u&&Math.hypot(u.x-destination.x,u.y-destination.y)<1.5;}",
                  {"id": route["unitId"], "destination": route["origin"]}, 30000)
        self.check(True, "Gate destruction invalidates blocked navigation and actual unit returns through the gap", self.entity(route["unitId"]))
        self.capture("walls-functional-gate")

    def queues(self) -> None:
        metadata = self.fixture("queues")
        producer_id = metadata["producerId"]
        self.select_entity(producer_id)
        before = self.game_state()
        self.click_action("train:villager")
        queued = self.game_state()
        self.check(queued["summary"]["reservedPopulation"] == before["summary"]["reservedPopulation"] + 1,
                   "Visible training reserves one actual inhabitant", queued["summary"])
        self.check(len(self.entity(producer_id)["queue"]) == len(next(building for building in before["state"]["buildings"] if building["id"] == producer_id)["queue"]) + 1,
                   "Actual producer receives a training queue item", self.entity(producer_id)["queue"])
        self.click_action("cancel-train")
        cancelled = self.game_state()
        self.check(cancelled["summary"]["reservedPopulation"] == before["summary"]["reservedPopulation"]
                   and cancelled["state"]["teams"]["1"]["resources"] == before["state"]["teams"]["1"]["resources"],
                   "Visible cancellation releases reservation and refunds exact spend once", cancelled["summary"])
        self.click_action("train:villager")
        self.wait("n => game.world.summary(1).population===n+1", before["summary"]["population"], 30000)
        completed = self.game_state()
        self.check(completed["summary"]["reservedPopulation"] == before["summary"]["reservedPopulation"]
                   and completed["summary"]["population"] == before["summary"]["population"] + 1,
                   "Actual training completion converts the reservation into one living unit", completed["summary"])
        self.capture("training-completion")

    def technologies(self) -> None:
        metadata = self.fixture("technologies")
        self.select_entity(metadata["guildhallId"])
        before_age = self.snapshot()["teams"]["1"]["age"]
        self.click_action("advance-age")
        self.wait("age => game.world.state.teams[1].age>age", before_age, 45000)
        self.check(self.snapshot()["teams"]["1"]["age"] == before_age + 1, "Visible era action advances the actual city era", self.snapshot()["teams"]["1"]["age"])
        self.select_entity(metadata["technologyBuildingId"])
        technology = metadata.get("technologyId", "wheelbarrow")
        self.click_action("research:" + technology)
        self.wait("id => !!game.world.state.teams[1].upgrades[id]", technology, 30000)
        self.check(bool(self.snapshot()["teams"]["1"]["upgrades"][technology]), "Visible technology research changes actual upgrade state", technology)
        self.select_entity(metadata["marketId"])
        self.click_action("market")
        self.page.locator("#trade-amount").select_option("10")
        before = self.snapshot()["teams"]["1"]["resources"]
        self.page.locator('[data-action="trade"][data-resource="wood"][data-direction="buy"]:visible').click()
        after = self.snapshot()["teams"]["1"]["resources"]
        self.check(after["wood"] == before["wood"] + 10 and after["gold"] < before["gold"], "Visible market buy performs an actual priced trade", {"before": before, "after": after})
        self.page.locator('[data-action="trade"][data-resource="stone"][data-direction="sell"]:visible').click()
        sold = self.snapshot()["teams"]["1"]["resources"]
        self.check(sold["stone"] == after["stone"] - 10 and sold["gold"] > after["gold"], "Visible market sell performs an actual priced trade", {"before": after, "after": sold})
        self.click_action("close-panel")
        self.select_entity(metadata["guildhallId"])
        destination = metadata["rally"]
        self.click_world(destination["x"], destination["y"], button="right")
        rally = self.entity(metadata["guildhallId"])["rally"]
        self.check(abs(rally["x"] - destination["x"]) < 1 and abs(rally["y"] - destination["y"]) < 1,
                   "Visible producer rally changes the actual spawn rally destination", rally)
        self.capture("era-research-trade")

    def combat(self) -> None:
        metadata = self.fixture("combat")
        attacker, target = self.entity(metadata["attackerId"]), self.entity(metadata["targetId"])
        self.select_entity(attacker["id"])
        self.click_entity(target["id"], button="right")
        self.wait("({id,hp}) => game.world.getEntity(id).hp<hp", {"id": target["id"], "hp": target["hp"]}, 15000)
        self.check(self.entity(target["id"])["hp"] < target["hp"], "Actual combat context order damages an actual enemy", self.entity(target["id"]))
        destination = metadata["attackMoveDestination"]
        self.page.keyboard.press("a")
        self.click_world(destination["x"], destination["y"])
        self.check(self.entity(attacker["id"]).get("order", {}).get("attackMove") is True,
                   "A hotkey and real canvas click arm an actual offensive movement order", self.entity(attacker["id"])["order"])
        self.wait("({id,destination})=>{const u=game.world.getEntity(id);return u&&Math.hypot(u.x-destination.x,u.y-destination.y)<1.5;}",
                  {"id": attacker["id"], "destination": destination}, 30000)
        self.check(True, "Actual offensive movement fights the encountered enemy then continues to its destination", self.entity(attacker["id"]))
        mage = self.entity(metadata["mageId"])
        fire_target = self.entity(metadata["fireTargetId"])
        self.select_entity(mage["id"])
        self.click_action("cast-fireball")
        self.click_world(fire_target["x"], fire_target["y"])
        self.wait("({id,hp}) => game.world.getEntity(id).hp<hp", {"id": fire_target["id"], "hp": fire_target["hp"]}, 10000)
        mage_after = self.entity(mage["id"])
        self.check(self.entity(fire_target["id"])["hp"] < fire_target["hp"] and mage_after.get("mana", 0) < mage.get("mana", 0),
                   "Visible targeted fireball spends actual mana and damages an actual target", {"mage": mage_after, "target": self.entity(fire_target["id"])})
        injured = self.entity(metadata["injuredId"])
        self.check(0 < injured["hp"] < injured["maxHp"], "Heal test has a living wounded actual ally", injured)
        self.select_entity(metadata["healerId"])
        self.click_action("cast-heal")
        self.click_world(injured["x"], injured["y"])
        self.wait("({id,hp}) => game.world.getEntity(id).hp>hp", {"id": injured["id"], "hp": injured["hp"]}, 10000)
        self.check(self.entity(injured["id"])["hp"] > injured["hp"], "Visible targeted healing produces actual positive HP", self.entity(injured["id"]))
        self.capture("combat-spells-healing")

        ai = self.fixture("ai")
        before = self.snapshot()
        enemy_buildings = len([building for building in before["buildings"] if building["team"] == 2])
        gatherer = self.entity(ai["enemyGathererId"])
        self.wait("id => {const u=game.world.getEntity(id);return ['gather','return','deposit'].includes(u.order?.type)&&u.carry?.amount>0;}", gatherer["id"], 30000)
        self.check(self.entity(gatherer["id"])["carry"]["amount"] > 0, "Actual AI worker gathers and carries finite resources", self.entity(gatherer["id"]))
        self.wait("n => game.world.state.buildings.filter(b=>b.team===2&&b.hp>0).length>n", enemy_buildings, 45000)
        self.check(len([building for building in self.snapshot()["buildings"] if building["team"] == 2 and building["hp"] > 0]) > enemy_buildings,
                   "Actual AI begins an actual building", enemy_buildings)
        attacked = self.entity(ai["playerTargetId"])
        self.wait("({id,hp}) => game.world.getEntity(id).hp<hp", {"id": attacked["id"], "hp": attacked["hp"]}, 45000)
        self.check(self.entity(attacked["id"])["hp"] < attacked["hp"], "Actual AI attack reduces actual player HP", self.entity(attacked["id"]))

        victory = self.fixture("victory")
        self.select_entity(victory["attackerId"])
        self.click_entity(victory["enemyHallId"], button="right")
        self.wait("() => game.world.state.winner===1", timeout=15000)
        self.page.locator("#winner-dialog[open]").wait_for(state="visible")
        self.check(self.snapshot()["winner"] == 1 and bool(self.page.locator("#winner-title").inner_text()),
                   "Actual conquest destruction produces victory and visible terminal UI", self.page.locator("#winner-title").inner_text())
        self.capture("conquest-victory")
        self.click_action("continue-world")
        self.fixture("defeat")
        self.wait("() => game.world.state.winner===2", timeout=15000)
        self.page.locator("#winner-dialog[open]").wait_for(state="visible")
        self.check(self.snapshot()["winner"] == 2 and bool(self.page.locator("#winner-title").inner_text()),
                   "Actual enemy destruction produces defeat and visible terminal UI", self.page.locator("#winner-title").inner_text())
        self.capture("conquest-defeat")
        peaceful = self.new_match(mode="peaceful")
        self.page.wait_for_timeout(5000)
        peace_after = self.snapshot()
        self.check(peace_after["winner"] is None and not any(unit.get("order", {}).get("type") == "attack" for unit in peace_after["units"] if unit["team"] == 2),
                   "Actual peaceful game advances without enemy attack orders or forced terminal state", {"timeBefore": peaceful["state"]["time"], "timeAfter": peace_after["time"]})

    def controls(self) -> None:
        observed = self.new_match()
        villagers = [unit for unit in observed["state"]["units"] if unit["team"] == 1 and unit["kind"] == "villager" and unit["hp"] > 0]
        self.check(len(villagers) >= 2, "Control scenario has real selectable villagers", [unit["id"] for unit in villagers])
        center_x = sum(unit["x"] for unit in villagers) / len(villagers)
        center_y = sum(unit["y"] for unit in villagers) / len(villagers)
        self.center_visible(center_x, center_y)
        points = [self.point(unit["x"], unit["y"]) for unit in villagers]
        left, right = min(point["x"] for point in points) - 18, max(point["x"] for point in points) + 18
        top, bottom = min(point["y"] for point in points) - 35, max(point["y"] for point in points) + 18
        self.page.mouse.move(left, top)
        self.page.mouse.down()
        self.page.mouse.move(right, bottom, steps=15)
        self.page.mouse.up()
        selected = self.page.evaluate("() => [...game.selectedIds]")
        self.check(len(set(selected) & {unit["id"] for unit in villagers}) >= 2,
                   "Real pointer drag selects multiple actual inhabitants", selected)
        self.page.keyboard.press("Control+1")
        self.page.keyboard.press("Escape")
        blank = self.page.evaluate("""()=>{const r=document.querySelector('#world-canvas').getBoundingClientRect();for(let y=r.top+40;y<r.bottom-40;y+=50)for(let x=r.left+40;x<r.right-40;x+=50)if(!game.renderer.pick(x,y))return {x,y};return null;}""")
        self.check(blank is not None, "Actual view contains empty terrain for clearing selection", blank)
        self.page.mouse.click(blank["x"], blank["y"])
        self.check(not self.page.evaluate("() => game.selectedIds.length"), "Clicking empty terrain clears the actual selection")
        self.page.keyboard.press("1")
        recalled = self.page.evaluate("() => [...game.selectedIds]")
        self.check(set(recalled) == set(selected), "Control group hotkey restores the actual selected IDs", recalled)
        unit = self.entity(next(unit["id"] for unit in villagers if unit["id"] in selected))
        destination = self.page.evaluate("async({x,y})=>{const {Navigation}=await import('/src/game/navigation.js');return new Navigation(game.world).nearest(x+5,y+2);}", unit)
        self.check(destination is not None, "Control test has a reachable context-order destination", destination)
        self.click_world(destination["x"], destination["y"], button="right")
        self.wait("p => {const u=game.world.getEntity(p.id);return Math.hypot(u.x-p.x,u.y-p.y)>.2;}", unit, 5000)
        moved = self.entity(unit["id"])
        self.check((moved["x"], moved["y"]) != (unit["x"], unit["y"]), "Actual right-click order produces actual movement", moved)
        self.page.keyboard.press("s")
        stopped = self.entity(unit["id"])
        self.check(stopped.get("order", {}).get("type") in {"idle", "stop"}, "S hotkey stops real movement", stopped.get("order"))
        self.page.keyboard.press("d")
        defended = self.entity(unit["id"])
        self.check(defended.get("order", {}).get("type") == "defend", "D hotkey assigns an actual defend order", defended.get("order"))
        self.page.keyboard.press("b")
        focused_action = self.page.evaluate("() => document.activeElement?.dataset.action")
        self.check(focused_action == "build:house", "B hotkey focuses the actual building control", focused_action)
        self.page.keyboard.press("Escape")
        self.page.locator("#world-canvas").focus()
        camera_before = self.page.evaluate("() => JSON.parse(JSON.stringify(game.renderer.camera))")
        self.page.keyboard.down("ArrowRight")
        self.page.wait_for_timeout(350)
        self.page.keyboard.up("ArrowRight")
        camera_after = self.page.evaluate("() => JSON.parse(JSON.stringify(game.renderer.camera))")
        self.check(camera_before != camera_after, "Arrow keyboard input pans the actual camera", {"before": camera_before, "after": camera_after})
        self.click_action("zoom-in")
        zoomed = self.page.evaluate("() => JSON.parse(JSON.stringify(game.renderer.camera))")
        self.check(zoomed != camera_after, "Visible zoom control changes the actual camera", zoomed)
        self.page.locator("#world-canvas").hover()
        self.page.mouse.wheel(0, 180)
        self.page.wait_for_timeout(100)
        wheeled = self.page.evaluate("() => JSON.parse(JSON.stringify(game.renderer.camera))")
        self.check(wheeled != zoomed, "Mouse wheel changes actual zoom", wheeled)
        self.center_visible(55, 55)
        minimapped = self.page.evaluate("() => JSON.parse(JSON.stringify(game.renderer.camera))")
        self.check(minimapped != wheeled, "Visible minimap click navigates the actual camera", minimapped)
        self.page.keyboard.press("s")
        eligible = self.page.evaluate("() => game.world.state.units.filter(u=>u.team===1&&u.kind==='villager'&&u.hp>0&&['idle','stop'].includes(u.order?.type)).map(u=>u.id)")
        self.check(bool(eligible), "Idle-selection scenario has actual eligible idle villagers after visible stop command", eligible)
        blank = self.page.evaluate("""()=>{const r=document.querySelector('#world-canvas').getBoundingClientRect();for(let y=r.top+40;y<r.bottom-40;y+=50)for(let x=r.left+40;x<r.right-40;x+=50)if(!game.renderer.pick(x,y))return {x,y};return null;}""")
        self.check(blank is not None, "Actual minimap view contains empty terrain for clearing old selection", blank)
        self.page.mouse.click(blank["x"], blank["y"])
        self.check(not self.page.evaluate("() => game.selectedIds.length"), "Old defended selection is cleared before testing idle selection")
        self.click_action("select-idle")
        idle = self.page.evaluate("() => [...game.selectedIds]")
        self.check(len(idle) == 1 and idle[0] in eligible,
                   "Normal visible idle-villager click selects exactly one actual idle villager", idle)
        self.page.keyboard.down("Shift")
        self.click_action("select-idle")
        self.page.keyboard.up("Shift")
        all_idle = self.page.evaluate("() => [...game.selectedIds]")
        self.check(set(all_idle) == set(eligible), "Shift-click follows the actual UI promise and selects all eligible idle villagers", all_idle)
        paused_before = self.snapshot()["paused"]
        self.click_action("pause")
        state = self.snapshot()
        self.check(state["paused"] != paused_before, "Visible pause control changes actual simulation pause", state["paused"])
        if state["paused"]:
            now = state["time"]
            self.page.wait_for_timeout(300)
            self.check(self.snapshot()["time"] == now, "Actual simulation time stops while paused", now)
            self.page.keyboard.press("Space")
        speed_before = self.snapshot()["speed"]
        self.click_action("speed")
        speed_after = self.snapshot()["speed"]
        self.check(speed_before != speed_after and speed_after in {0.5, 1, 2}, "Visible speed control changes actual simulation rate", speed_after)
        for _ in range(3):
            if self.snapshot()["speed"] == 1:
                break
            self.click_action("speed")
        self.check(self.snapshot()["speed"] == 1 and self.snapshot()["paused"] is False,
                   "Control scenario restores normal unpaused simulation")
        self.capture("controls-selected")

    def saves(self) -> None:
        metadata = self.fixture("saves")
        initial = self.snapshot()
        if not initial["paused"]:
            self.click_action("pause")
        before = self.snapshot()
        queue_items = [item for building in before["buildings"] for item in building.get("queue", [])]
        ongoing = [building for building in before["buildings"] if 0 < building.get("progress", 1) < 1]
        carried = [unit for unit in before["units"] if unit.get("carry", {}).get("amount", 0) > 0]
        self.check(bool(queue_items) and bool(ongoing) and bool(carried) and self.game_state()["summary"]["reservedPopulation"] > 0,
                   "Save contains actual queued reservation, partially built work and carried resources", {"queueItems": queue_items, "ongoingBuildings": ongoing, "carryingIds": [unit["id"] for unit in carried]})
        self.click_action("save")
        with self.page.expect_download() as download:
            self.click_action("save-now")
        path = self.directory / "nontrivial-save.json"
        download.value.save_as(str(path))
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.check(saved == before, "Actual downloaded save exactly preserves the paused real World", {"sha256": sha256(path.read_bytes()), "bytes": path.stat().st_size})
        stored = self.page.evaluate("() => JSON.parse(localStorage.getItem('gremios-save'))")
        self.check(stored == saved, "Actual browser local save equals downloaded save", sha256(json.dumps(stored, sort_keys=True).encode()))
        self.click_action("close-panel")
        self.click_action("pause")
        self.wait("t => game.world.state.time>t+1", before["time"], 5000)
        self.check(self.snapshot() != saved, "Actual live World changes after saving", self.snapshot()["time"])
        generation = self.page.evaluate("() => game.worldGeneration")
        self.import_save(path)
        restored = self.snapshot()
        self.check(restored == saved and self.page.evaluate("() => game.worldGeneration") > generation,
                   "Visible file import replaces World with the exact nontrivial save and a new epoch", {"oldGeneration": generation, "newGeneration": self.page.evaluate("() => game.worldGeneration")})
        self.click_action("pause")
        self.wait("({id,progress}) => game.world.getEntity(id).progress>progress", {"id": ongoing[0]["id"], "progress": ongoing[0]["progress"]}, 15000)
        self.check(self.entity(ongoing[0]["id"])["progress"] > ongoing[0]["progress"], "Loaded ongoing construction continues through normal simulation", self.entity(ongoing[0]["id"])["progress"])
        population_before = self.game_state()["summary"]["population"]
        self.wait("n => game.world.summary(1).population>n", population_before, 30000)
        self.check(self.game_state()["summary"]["population"] > population_before, "Loaded queue actually completes into a living inhabitant", self.game_state()["summary"])
        carried_id = metadata.get("carryingUnitId", carried[0]["id"])
        original_resource = self.entity(carried_id).get("carry", {}).get("kind") or carried[0]["carry"].get("kind")
        bank_resource = "food" if original_resource == "fish" else original_resource
        if bank_resource:
            bank_before = restored["teams"]["1"]["resources"][bank_resource]
            self.wait("({resource,before}) => game.world.state.teams[1].resources[resource]>before", {"resource": bank_resource, "before": bank_before}, 30000)
            self.check(self.snapshot()["teams"]["1"]["resources"][bank_resource] > bank_before,
                       "Loaded carried resource actually reaches dropoff after continuation", bank_resource)
        self.click_action("pause")
        reject_before = self.snapshot()
        reject_generation = self.page.evaluate("() => game.worldGeneration")
        malformed = self.directory / "malformed-save.json"
        malformed.write_text('{"version":1,"units":[{"id":"invalid"}],"map":{}}\n', encoding="utf-8")
        self.click_action("load")
        with self.page.expect_file_chooser() as chooser:
            self.click_action("load-file")
        chooser.value.set_files(str(malformed))
        self.page.wait_for_function("() => [...document.querySelectorAll('.announcement.error')].some(e=>e.textContent.includes('cargar'))", timeout=10000)
        self.check(self.page.evaluate("() => game.worldGeneration") == reject_generation and self.snapshot() == reject_before,
                   "Actual malformed file rejection leaves current world/epoch unchanged", reject_generation)
        self.click_action("close-panel")
        self.click_action("pause")
        self.capture("save-load-continuation")

    def runtime_identity(self) -> None:
        self.check(bool(self.health), "Observed actual server health and PID", self.report.get("serverIdentity"))
        root = Path(self.health.get("root", "")).resolve()
        self.check(root == ROOT, "Actual server reports exact expected project root", str(root))
        server = ROOT / "server.mjs"
        expected_server_hash = sha256(server.read_bytes())
        actual_server_hash = self.health.get("serverHash", self.health.get("serverSha256"))
        self.check(actual_server_hash == expected_server_hash, "Running server digest matches inspected server bytes", {"actual": actual_server_hash, "expected": expected_server_hash})
        manifest_path = ROOT / "dist" / "build-manifest.json"
        self.check(manifest_path.is_file(), "Tested build has a static byte manifest", str(manifest_path))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        files = {entry["path"]: entry for entry in manifest.get("files", [])}
        self.report["buildIdentity"] = {"buildId": manifest.get("buildId"), "manifestSha256": sha256(manifest_path.read_bytes()),
                                         "manifest": str(manifest_path)}
        self.check(bool(files) and "index.html" in files, "Build manifest contains actual indexed entry bytes", len(files))
        self.check(self.health.get("entryHash") == files["index.html"]["sha256"], "Actual server entry equals tested build manifest", self.health.get("entryHash"))
        modules = [row for row in self.response_rows.values() if row["path"].endswith(".js")]
        assets = [row for row in self.response_rows.values() if row["path"].startswith("assets/")]
        self.check(bool(modules), "Fresh browser actually loaded JavaScript modules", [row["path"] for row in modules])
        self.check(bool(assets), "Fresh browser actually loaded renderer assets", [row["path"] for row in assets])
        mismatches = []
        for path, row in self.response_rows.items():
            entry = files.get(path)
            source = ROOT / path
            if (not entry or row.get("status") != 200 or row.get("sha256") != entry.get("sha256")
                    or row.get("bytes") != entry.get("bytes") or not source.is_file()
                    or sha256(source.read_bytes()) != entry.get("sha256")
                    or row.get("sourceHashHeader") != entry.get("sha256")
                    or row.get("fromServiceWorker")):
                mismatches.append({"loaded": row, "manifest": entry})
        self.check(not mismatches, "Every actually loaded entry/module/asset byte and source-hash header matches tested source/build", mismatches)
        stats = self.page.evaluate("() => game.renderer?.stats ?? null")
        self.check(isinstance(stats, dict), "Actual renderer exposes loaded-asset evidence", stats)
        self.check(bool(stats.get("loadedAssets")), "Renderer confirms nonempty actual asset loads", stats.get("loadedAssets"))
        self.check(not stats.get("assetFailures"), "No renderer asset load failures", stats.get("assetFailures"))

    def security(self) -> None:
        paths = ["/.env", "/.git/config", "/.local/build-leader.lock", "/keys/canary",
                 "/server.mjs", "/scripts/memory.py", "/src/../server.mjs",
                 "/assets/%2e%2e/server.mjs", "/assets/%252e%252e%252fserver.mjs",
                 "/assets/..%5cserver.mjs", "/assets/%2e%2e%5cserver.mjs",
                 "/C:%5cUsers%5cexample%5cgame%5cserver.mjs",
                 "/assets/%00canary.js"]
        for path in paths:
            response = self.raw_http(path)
            self.check(response["status"] in {400, 403, 404}, "Actual server denies private/traversal/absolute path", response)
            self.check("node:http" not in response["bodyText"] and "ELEVENLABS_API_KEY=" not in response["bodyText"],
                       "Rejected route does not disclose source or credential text", {"path": path, "bodySha256": response["bodySha256"]})
        for headers in ({"Host": "arbitrary.invalid"}, {"Origin": "https://arbitrary.invalid"}):
            response = self.raw_http("/api/health", headers=headers)
            self.check(response["status"] == 403, "Actual process rejects arbitrary Host or Origin", {"requestHeaders": headers, "response": response})
        session = self.raw_http("/api/session")
        self.check(session["status"] == 200, "Actual session endpoint works on allowed loopback origin", session["status"])
        headers = {key.lower(): value for key, value in session["headers"].items()}
        self.check("no-store" in headers.get("cache-control", ""), "Session response is not cached", headers.get("cache-control"))
        cookie_evidence = re.sub(r"guild_session=[a-f0-9]{64}", "guild_session=<redacted>", headers.get("set-cookie", ""))
        self.check("httponly" in headers.get("set-cookie", "").lower(), "Session cookie is HttpOnly", cookie_evidence)
        response = self.raw_http("/api/voice/token", "POST", {"Content-Type": "application/json"}, "{}")
        self.check(response["status"] in {400, 401, 403}, "Missing session/Origin/CSRF is rejected before vendor access", response)
        cookie = headers.get("set-cookie", "").split(";", 1)[0]
        response = self.raw_http("/api/voice/token", "POST", {"Content-Type": "application/json", "Origin": self.base,
                                  "Cookie": cookie, "X-Guild-CSRF": "wrong-browser-acceptance-canary"}, "{}")
        self.check(response["status"] == 403, "Wrong CSRF is rejected with an otherwise real session", response)
        if self.args.junction_path:
            response = self.raw_http(self.args.junction_path)
            self.check(response["status"] in {403, 404} and "BROWSER_PRIVATE_CANARY" not in response["bodyText"],
                       "Actual process denies canonical junction/symlink escape", response)
        else:
            self.junction_check()

    def junction_check(self) -> None:
        """Root-approved exact synthetic canary fixture; remove only the link."""
        link = ROOT / "assets" / "__browser_escape__"
        target = ROOT / ".local" / "browser-private" / "canary" / self.run_id
        local_root = (ROOT / ".local").resolve()
        if not target.resolve().is_relative_to(local_root) or link.parent.resolve() != (ROOT / "assets").resolve():
            raise AcceptanceFailure("Junction canary resolved outside its exact authorized roots")
        if link.exists() or link.is_symlink() or os.path.isjunction(link):
            raise AcceptanceFailure("Existing junction path is not owned by this run; refusing to replace it")
        target.mkdir(parents=True, exist_ok=False)
        canary = target / "canary.js"
        canary.write_text("// BROWSER_PRIVATE_CANARY " + self.run_id + "\n", encoding="utf-8")
        created = False
        try:
            if sys.platform == "win32":
                # Constant verified project paths are quoted as literal PowerShell strings.
                quoted_link = str(link).replace("'", "''")
                quoted_target = str(target).replace("'", "''")
                command = f"New-Item -ItemType Junction -Path '{quoted_link}' -Target '{quoted_target}' | Out-Null"
                result = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=15)
                if result.returncode or not os.path.isjunction(link):
                    raise AcceptanceFailure("Could not create actual junction fixture: " + result.stderr)
            else:
                link.symlink_to(target, target_is_directory=True)
            created = True
            self.check(link.resolve() == target.resolve(), "Actual escape link resolves to this run's synthetic private canary", str(target))
            response = self.raw_http("/assets/__browser_escape__/canary.js")
            self.check(response["status"] in {403, 404} and "BROWSER_PRIVATE_CANARY" not in response["bodyText"],
                       "Actual process denies canonical private-target junction escape", response)
        finally:
            if created:
                if link.resolve() != target.resolve() or link.parent.resolve() != (ROOT / "assets").resolve():
                    raise AcceptanceFailure("Junction changed identity before cleanup; refusing filesystem removal")
                if sys.platform == "win32":
                    os.rmdir(link)  # Remove the verified junction itself, never its target.
                else:
                    link.unlink()
                cleanup = {"linkRemoved": not link.exists() and not link.is_symlink() and not os.path.isjunction(link),
                           "canaryTargetIntact": canary.is_file(), "target": str(target)}
                self.report["junctionCleanup"] = cleanup
                self.check(cleanup["linkRemoved"] and cleanup["canaryTargetIntact"],
                           "Only the test link was removed and private canary remains intact", cleanup)

    def viewports(self) -> None:
        self.page.set_viewport_size({"width": 1440, "height": 900})
        self.capture("game-1440x900")
        for width, height in ((1440, 900), (390, 844)):
            self.page.set_viewport_size({"width": width, "height": height})
            self.page.wait_for_timeout(150)
            observed = self.page.evaluate("() => ({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,canvas:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height})),buttons:[...document.querySelectorAll('button')].filter(b=>{let r=b.getBoundingClientRect();return r.width>0&&r.height>0}).length})")
            self.check(observed["width"] == width and observed["height"] == height, "Actual viewport has requested CSS dimensions", observed)
            self.check(observed["scrollWidth"] <= width, "Page has no horizontal overflow at viewport", observed)
            self.check(observed["buttons"] > 0 and any(canvas["width"] > 100 and canvas["height"] > 100 for canvas in observed["canvas"]),
                       "Game canvas and visible controls remain available", observed)
            self.capture(f"viewport-{width}x{height}")
        self.page.set_viewport_size({"width": 1440, "height": 900})

    def benchmark_in_fresh_browser(self, playwright: Any) -> None:
        self.functional_response_rows = dict(self.response_rows)
        prior_health = dict(self.health)
        prior_build = dict(self.report.get("buildIdentity", {}))
        self.report["functionalBrowserEvidence"] = {
            "environment": self.report["environment"], "serverIdentity": self.report["serverIdentity"],
            "buildIdentity": prior_build, "loadedResponses": list(self.functional_response_rows.values()),
        }
        self.close_browser("functional-before-performance")
        self.response_rows = {}
        # Keep all scenarios, checks and error arrays from the functional browser.
        self.verify_health()
        self.check(all(self.health.get(key) == prior_health.get(key) for key in ("pid", "root", "serverHash", "entryHash")),
                   "Fresh performance browser uses the same live server revision as functional scenarios", self.health)
        self.check(prior_build.get("manifestSha256") == sha256((ROOT / "dist/build-manifest.json").read_bytes()),
                   "Performance isolation does not change the tested build manifest", prior_build)
        self.setup_browser(playwright)
        self.page.bring_to_front()
        self.report["performanceIsolation"]["newBrowserCreated"] = True
        self.benchmark()

    def benchmark(self) -> None:
        metadata = self.fixture("benchmark")
        self.page.evaluate("zoom => {game.renderer.camera.zoom=zoom;}", 0.9605607431229627)
        self.check(bool(metadata.get("metricContract")), "Benchmark fixture declares actual engine metric paths", metadata.get("metricContract"))
        self.page.set_viewport_size({"width": 1440, "height": 900})
        adapter_path = ROOT / metadata["phaseAdapter"]["sourcePath"]
        self.check(sha256(adapter_path.read_bytes()) == metadata["phaseAdapter"]["sourceSha256"],
                   "Stress phase adapter comes from the current engine-owned source", str(adapter_path))
        self.report["benchmarkWarmupObserver"] = install_phase_observer(self.page, metadata)
        warmup = max(5, self.args.warmup_seconds)
        self.page.wait_for_timeout(warmup * 1000)
        # Bind this browser's own loaded bytes/assets, not the prior browser's evidence.
        self.runtime_identity()
        # Reload the same validated workload after cache/simulation warmup so
        # all phase start populations are measured before combat casualties.
        metadata = self.fixture("benchmark")
        self.page.evaluate("zoom => {window.dispatchEvent(new Event('blur'));game.renderer.camera.zoom=zoom;}", 0.9605607431229627)
        self.report["benchmarkObserver"] = install_phase_observer(self.page, metadata)
        # A phase fixture must still have all actual living units at interval start.
        initial = self.page.evaluate("() => ({time:game.world.state.time,population:[1,2].map(team=>game.world.state.units.filter(u=>u.team===team&&u.hp>0).length),paused:game.world.state.paused,speed:game.world.state.speed,camera:{...game.renderer.camera}})")
        self.check(initial["population"] == [1000, 1000], "Warm workload still has two real 1000-inhabitant cities", initial)
        self.check(initial["camera"]["zoom"] == 0.9605607431229627,
                   "Measured view starts at the declared benchmark zoom", initial["camera"])
        self.report["benchmarkCamera"] = {"initial": initial["camera"], "allowedTransition": "existing combat centerOn(40,40)",
                                           "heldKeysCleared": "window blur before measurement", "inputGuard": "measured owned window only"}
        self.persist()
        self.page.evaluate("""() => {
          window.__a9Focus=[];
          window.__a9FocusTimer=setInterval(()=>window.__a9Focus.push({at:performance.now(),
            simulationTime:game.world.state.time,visibility:document.visibilityState,focused:document.hasFocus(),
            dpr:devicePixelRatio,inner:{width:innerWidth,height:innerHeight},outer:{width:outerWidth,height:outerHeight},
            screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight}}),1000);
        }""")
        print("BROWSER15 observing 120 seconds of real time after warmup", flush=True)
        try:
            result = observe_workload(self.page, self.args.benchmark_seconds, expected_camera=initial["camera"])
        finally:
            focus_observations = self.page.evaluate("() => {clearInterval(window.__a9FocusTimer);return window.__a9Focus;}")
        result["browserObservations"] = focus_observations
        result["browserConnectedAtEnd"] = self.browser.is_connected()
        result["warmupSeconds"] = warmup
        result["fixture"] = metadata
        checks = validate_workload(result, metadata["metricContract"])
        result["checks"] = checks
        path = self.directory / "benchmark.json"
        write_json(path, result)
        self.report["benchmark"] = {"path": str(path), "frameSummary": result["frameSummary"],
                                    "simulationSummary": result.get("simulationSummary"), "warmupSeconds": warmup}
        self.record_checks(checks)
        self.runtime_identity()
        self.capture("benchmark-final")

    def console(self) -> None:
        self.check(not self.report["unexpectedVoiceTokenRequests"],
                   "No browser attempted vendor token access", self.report["unexpectedVoiceTokenRequests"])
        self.check(not self.report["pageErrors"], "No uncaught JavaScript exceptions across all scenarios", self.report["pageErrors"])
        self.check(not self.report["consoleErrors"], "No browser console errors across all scenarios", self.report["consoleErrors"])
        self.check(not self.report["requestFailures"], "No browser network request failures across all scenarios", self.report["requestFailures"])

    def finish(self) -> int:
        scenarios = self.report["scenarios"]
        expected = set(self.report["requiredScenarioIds"])
        actual = [scenario["id"] for scenario in scenarios]
        lifecycle_ok = ("fatalError" not in self.report and self.report.get("cleanup") == "COMPLETE"
                        and not self.report["unexpectedVoiceTokenRequests"])
        complete = (lifecycle_ok and set(actual) == expected and len(actual) == len(expected)
                    and all(scenario["status"] == "PASS" and scenario["checks"]
                            and all(check["ok"] for check in scenario["checks"]) for scenario in scenarios))
        capture_ok = self.args.capture_only and lifecycle_ok
        self.report["status"] = "CAPTURE_ONLY" if capture_ok else ("PASS" if complete else "FAIL")
        self.report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        self.report["missingScenarioIds"] = sorted(expected - set(actual))
        self.report["exitCode"] = 0 if (complete or capture_ok) else 1
        self.persist()
        write_json(ROOT / "docs" / "reports" / "browser-latest.json", {"runId": self.run_id, "status": self.report["status"], "report": str(self.directory / "results.json")})
        game10 = next((scenario for scenario in scenarios if scenario["id"] == "BROWSER10"), None)
        controls_observed = bool(game10 and game10["status"] == "PASS" and game10["checks"]
                                 and all(check["ok"] for check in game10["checks"]))
        write_json(ROOT / "docs" / "reports" / "browser-acceptance.json", {
            "runId": self.run_id, "status": self.report["status"], "report": str(self.directory / "results.json"),
            "scenarios": {"GAME10": {"ok": controls_observed, "observed": controls_observed,
                "browserScenarioId": "BROWSER10", "checks": game10["checks"] if game10 else [],
                "loadedSourceDigests": {path: row.get("sha256") for path, row in (self.functional_response_rows or self.response_rows).items() if path.endswith(".js")},
                "scope": "Actual UI controls only; other failed/unrun browser gates retain their report status"}}
        })
        marker = "BROWSER_CAPTURE_OK" if capture_ok else ("BROWSER_ACCEPTANCE_OK" if complete else "BROWSER_ACCEPTANCE_FAILED")
        print(f"{marker} report={self.directory / 'results.json'}", flush=True)
        return self.report["exitCode"]

    def run(self) -> int:
        try:
            self.verify_health()
            if not self.args.capture_only:
                self.prepare_fixtures()
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                try:
                    self.setup_browser(playwright)
                    if self.args.capture_only:
                        self.capture("menu-1440x900")
                        self.report["domInventory"] = self.page.evaluate("() => [...document.querySelectorAll('button,select,input,canvas')].map(e=>({tag:e.tagName,id:e.id,action:e.dataset.action??null,testId:e.dataset.testid??null,text:e.textContent?.trim().slice(0,160),type:e.type??null}))")
                        self.page.set_viewport_size({"width": 390, "height": 844})
                        self.capture("menu-390x844")
                    else:
                        operations = [self.menu, self.maps, self.names, self.economy, self.construction,
                                      self.walls, self.queues, self.technologies, self.combat,
                                      self.controls, self.saves, self.runtime_identity, self.security,
                                      self.viewports, lambda: self.benchmark_in_fresh_browser(playwright), self.console]
                        for definition, operation in zip(self.required, operations, strict=True):
                            self.scenario(definition["id"], operation)
                        self.final_identity_binding()
                finally:
                    self.close_browser("final")
        except Exception as error:
            self.report["fatalError"] = str(error)
            self.report["fatalTraceback"] = traceback.format_exc(limit=8)
            self.report["captureOnly"] = False
            self.args.capture_only = False
            print(f"BROWSER_FATAL: {error}", flush=True)
        return self.finish()

    def final_identity_binding(self) -> None:
        row = next((scenario for scenario in self.report["scenarios"] if scenario["id"] == "BROWSER12"), None)
        if row is None or row["status"] != "PASS":
            return
        self.current = row
        try:
            response = self.raw_http("/api/health")
            health = json.loads(response["bodyText"]) if response["status"] == 200 else {}
            source_changes = [path for path, loaded in [*self.functional_response_rows.items(), *self.response_rows.items()]
                              if not (ROOT / path).is_file() or sha256((ROOT / path).read_bytes()) != loaded.get("sha256")]
            manifest = ROOT / "dist" / "build-manifest.json"
            unchanged = (health.get("pid") == self.health.get("pid")
                         and health.get("root") == self.health.get("root")
                         and health.get("serverHash", health.get("serverSha256")) == self.health.get("serverHash", self.health.get("serverSha256"))
                         and sha256((ROOT / "server.mjs").read_bytes()) == self.health.get("serverHash", self.health.get("serverSha256"))
                         and manifest.is_file() and sha256(manifest.read_bytes()) == self.report["buildIdentity"]["manifestSha256"]
                         and not source_changes)
            self.report["identityAtEnd"] = {"health": health, "changedLoadedPaths": source_changes,
                                             "checkedAfterAllScenarios": True}
            self.check(unchanged, "After the full workload, actual PID/server/manifest/loaded bytes still match the tested revision", self.report["identityAtEnd"])
        except Exception as error:
            row["status"] = "FAIL"
            row["error"] = str(error)
            row["endIdentityFailure"] = True
        finally:
            self.current = None
            self.persist()

    def prepare_fixtures(self) -> None:
        result = subprocess.run(["node", str(ROOT / "scripts" / "browser-fixtures.mjs")],
                                cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.report["fixturePreparation"] = {"command": "node scripts/browser-fixtures.mjs", "exitCode": result.returncode,
                                             "stdout": result.stdout, "stderr": result.stderr}
        if result.returncode != 0:
            raise AcceptanceFailure("Current engine rejected fixture preparation: " + result.stderr[-2000:])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173")
    parser.add_argument("--capture-only", action="store_true", help="Diagnostic screenshots/DOM only; never an A9 pass")
    parser.add_argument("--headed", action="store_true", help="Use an isolated visible browser; preserve all acceptance scenarios and thresholds")
    parser.add_argument("--browser-channel", choices=["chrome", "chromium", "headless-shell"], default="chrome",
                        help="Installed Chrome by default; bundled software shell is an explicitly labeled diagnostic")
    parser.add_argument("--gpu-preference", choices=["system", "high-performance"], default="system",
                        help="System GPU selection by default; high-performance explicitly requests Chrome's discrete-GPU preference")
    parser.add_argument("--fixture-dir", type=Path, default=ROOT / ".local" / "browser-fixtures")
    parser.add_argument("--benchmark-seconds", type=int, default=120)
    parser.add_argument("--warmup-seconds", type=int, default=5)
    parser.add_argument("--junction-path", help="Raw URL to an actually created private-target junction/symlink canary")
    args = parser.parse_args()
    if args.benchmark_seconds < 120:
        parser.error("The mandatory measured benchmark interval cannot be shortened below 120 seconds")
    return BrowserAcceptance(args).run()


if __name__ == "__main__":
    sys.exit(main())
