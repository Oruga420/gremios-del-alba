"""Observed browser measurements; no simulation ticks or fabricated counters.

The fixture is a validated engine save loaded through the game's visible import
control. The app, rather than this observer, advances its normal simulation.
"""

from __future__ import annotations

import math
import time
from typing import Any


MEASURE_JS = r"""async ({durationMs, expectedCamera}) => {
  const started = performance.now();
  let previous = started;
  const frames = [];
  const observations = [];
  const initialCamera = {...(expectedCamera ?? window.game?.renderer?.camera)};
  const inputGuard = {scope:'measured-owned-window-only', cleanup:'PENDING', events:[]};
  const eventTypes = ['wheel','pointerdown','pointerup','pointermove','pointercancel',
    'keydown','keyup','keypress','click','dblclick','contextmenu','touchstart','touchmove','touchend'];
  const eventCounts = new Map();
  const guard = event => {
    if (!event.isTrusted) return;
    const wallMs = performance.now()-started;
    let row=eventCounts.get(event.type);
    if (!row) { row={type:event.type,count:0,firstWallMs:wallMs,lastWallMs:wallMs};eventCounts.set(event.type,row);inputGuard.events.push(row); }
    row.count++;row.lastWallMs=wallMs;
    event.preventDefault();event.stopImmediatePropagation();
  };
  const cameraDrift = {checks:0,count:0,first:null,last:null};
  const actualCamera = () => ({...window.game?.renderer?.camera});
  const declaredCamera = () => {
    const phase=window.game?.world?.benchmarkCameraPhase?.();
    return phase?.phase==='combat' ? {...phase.camera,zoom:initialCamera.zoom} : initialCamera;
  };
  function checkCamera() {
    const actual=actualCamera(),expected=declaredCamera();
    cameraDrift.checks++;
    if (!['x','y','zoom'].every(key=>Number.isFinite(actual[key])&&Number.isFinite(expected[key])&&Math.abs(actual[key]-expected[key])<=1e-9)) {
      const row={wallMs:performance.now()-started,actual,expected};
      cameraDrift.count++;cameraDrift.first??=row;cameraDrift.last=row;
    }
  }
  let interval=null,animation=null;
  function observe(full=false) {
    const world = window.game?.world;
    const state = world?.state;
    if (!state) throw new Error('Benchmark lost the actual World');
    const units = state.units.filter(u => u.hp > 0);
    const metrics = full
      ? (typeof world.benchmarkEvidence === 'function' ? world.benchmarkEvidence() : (world.metrics ?? state.metrics ?? null))
      : {observedEngineCounters:Object.fromEntries(Object.entries(state.metrics??{}).filter(([,v])=>typeof v==='number'))};
    const renderer = window.game.renderer?.stats;
    observations.push({
      wallMs: performance.now() - started,
      simulationTime: state.time,
      paused: state.paused,
      speed: state.speed,
      camera: actualCamera(),
      expectedCamera: {...declaredCamera()},
      population: Object.fromEntries([1, 2].map(team => [team,
        units.filter(u => u.team === team).length])),
      summaries: [world.summary(1), world.summary(2)],
      metrics: metrics == null ? null : JSON.parse(JSON.stringify(metrics)),
      metricSample: full ? 'full-boundary' : 'observed-counter-summary',
      eventTail: state.events?.slice(-20) ?? [],
      rendererStats: renderer ? {frames:renderer.frames,frameMs:renderer.frameMs,renderedEntities:renderer.renderedEntities,culledEntities:renderer.culledEntities,assetFailures:renderer.assetFailures} : null
    });
  }
  try {
    for (const type of eventTypes) window.addEventListener(type,guard,{capture:true,passive:false});
    return await new Promise((resolve,reject) => {
      checkCamera();
      observe(true);
      interval=setInterval(()=>{try{observe();}catch(error){reject(error);}},1000);
      function frame(now) {
        try {
          checkCamera();
          frames.push(now - previous);
          previous = now;
          if (now - started < durationMs) animation=requestAnimationFrame(frame);
          else {
            observe(true);
            resolve({started,wallMs:now-started,frames,observations,
              cameraContract:{initial:initialCamera,phaseEvents:[window.game.world.benchmarkCameraPhase?.()].filter(Boolean)},
              cameraDrift,inputGuard});
          }
        } catch(error) { reject(error); }
      }
      animation=requestAnimationFrame(frame);
    });
  } finally {
    clearInterval(interval);
    if(animation!==null)cancelAnimationFrame(animation);
    for(const type of eventTypes)window.removeEventListener(type,guard,true);
    inputGuard.cleanup='COMPLETE';
  }
}"""


def install_phase_observer(page: Any, metadata: dict[str, Any]) -> dict[str, Any]:
    """Adapt the engine-owned phase harness, preserving each actual app tick."""
    adapter = metadata.get("phaseAdapter", {})
    update_source, record_source = adapter.get("updateSource"), adapter.get("recordSource")
    if not isinstance(update_source, str) or not isinstance(record_source, str):
        raise ValueError("Actual engine phase helper source is missing")
    source = r"""async metadata => {
      const {UNITS}=await import('/src/game/data.js');
      const teams=[1,2];
      const alive=(world,team)=>world.state.units.filter(u=>u.team===team&&u.hp>0);
      const assert=(condition,message)=>{if(!condition)throw new Error(message);};
    """ + record_source + "\n" + update_source + r"""
      const world=game.world, generation=game.worldGeneration;
      const originalTick=world.tick.bind(world);
      // Rebind actual loaded record objects. JSON metadata contains copies;
      // retired completed history must not erase the observed initial cohort.
      metadata.initialNavigationRecords=[...world.state.navigation];
      const samples=[],engineSamples=[];
      const cameraEvents=[];
      world.benchmarkCameraPhase=()=>cameraEvents.at(-1)??null;
      let combatCameraSet=false;
      const loadMarker=window.__browserQALastImport;
      if(!loadMarker||loadMarker.priorWorldGeneration+1!==generation)throw new Error('Missing actual file-import wall-clock marker');
      const loadStarted=loadMarker.wallMs;
      const participantIds=new Set(Object.values(metadata.movement).flatMap(groups=>groups.flatMap(group=>group.unitIds)));
      const wallPaths=new Map();
      function observePaths(){
        const elapsed=(performance.now()-loadStarted)/1000;
        for(const entry of metadata.initialNavigationRecords){
          if(entry.commandedAt!==0||!participantIds.has(entry.unitId))continue;
          let observed=wallPaths.get(entry.unitId);
          if(!observed){observed={unitId:entry.unitId,team:entry.team,firstMovementWallSeconds:null,terminalWallSeconds:null};wallPaths.set(entry.unitId,observed);}
          if(entry.startedAt!==null&&observed.firstMovementWallSeconds===null)observed.firstMovementWallSeconds=elapsed;
          if(['arrived','unreachable'].includes(entry.status)&&observed.terminalWallSeconds===null)observed.terminalWallSeconds=elapsed;
        }
      }
      observePaths();
      let lastDt=null, actualTicks=0;
      world.tick=function(dt){
        if(game.world!==world||game.worldGeneration!==generation)throw new Error('Stale benchmark world');
        const start=performance.now();
        updateBenchmarkPhase(world,metadata);
        if(!combatCameraSet&&metadata.phases.some(phase=>phase.name==='combat')){
          game.renderer.centerOn(40,40);
          combatCameraSet=true;
          cameraEvents.push({phase:'combat',simulationTime:world.state.time,camera:{...game.renderer.camera}});
        }
        const engineStart=performance.now();
        originalTick(dt);
        engineSamples.push(performance.now()-engineStart);
        observePaths();
        samples.push(performance.now()-start);
        lastDt=dt; actualTicks++;
      };
      world.benchmarkEvidence=()=>({
        metrics:world.state.metrics,
        phases:metadata.phases,
        fixtureParticipants:metadata.participants,
        cameraEvents,
        tickSamples:[...samples],engineTickSamples:[...engineSamples],tickDt:lastDt,actualTicks,
        unitPaths:metadata.initialNavigationRecords.filter(n=>n.commandedAt===0&&metadata.movement[n.team]?.some(group=>group.unitIds.includes(n.unitId)))
          .map(n=>({...wallPaths.get(n.unitId),unitId:n.unitId,team:n.team,status:n.status,
            firstMovementSeconds:n.startedAt===null?null:n.startedAt-n.commandedAt,
            terminalSeconds:n.resolvedAt===null?null:n.resolvedAt-n.commandedAt})),
        rawNavigation:world.state.navigation,
        appSimulationSteps:game.stats.simulationSteps,
        appSimulationSamples:[...game.stats.simulationSamples]
      });
      return {worldGeneration:generation,sourcePath:metadata.phaseAdapter.sourcePath,
        sourceSha256:metadata.phaseAdapter.sourceSha256,
        actualFileImportMarker:loadMarker,
        originalTickSource:originalTick.name,description:'Actual app .05s ticks, engine-owned real phase commands, observed counters and navigation'};
    }"""
    return page.evaluate(source, metadata)


def percentile(samples: list[float], percent: float) -> float | None:
    finite = sorted(value for value in samples if math.isfinite(value))
    if not finite:
        return None
    index = max(0, min(len(finite) - 1, math.ceil(percent * len(finite)) - 1))
    return finite[index]


def observe_workload(page: Any, duration_seconds: int = 120,
                     expected_camera: dict[str, float] | None = None) -> dict[str, Any]:
    """Read a full real-time interval without changing world time or speed."""
    if duration_seconds < 120:
        raise ValueError("Acceptance measurement must last at least 120 seconds")
    wall_started = time.perf_counter()
    result = page.evaluate(MEASURE_JS, {"durationMs": duration_seconds * 1000,
                                       "expectedCamera": expected_camera})
    result["pythonWallSeconds"] = time.perf_counter() - wall_started
    frames = result["frames"]
    result["frameSummary"] = {
        "samples": len(frames),
        "p50Ms": percentile(frames, 0.50),
        "p95Ms": percentile(frames, 0.95),
        "p99Ms": percentile(frames, 0.99),
        "maxMs": max(frames) if frames else None,
    }
    return result


def metric_value(metrics: dict[str, Any], *keys: str) -> Any:
    """Read a declared engine metric path; absence is never a zero/pass."""
    value: Any = metrics
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def validate_camera(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Camera equality is required; only the existing combat center is allowed."""
    contract = result.get("cameraContract", {})
    initial = contract.get("initial", {})
    events = contract.get("phaseEvents", [])
    valid_number = lambda value: isinstance(value, (int, float)) and math.isfinite(value)
    valid_camera = lambda value: isinstance(value, dict) and all(valid_number(value.get(key)) for key in ("x", "y", "zoom"))
    declared = (valid_camera(initial) and isinstance(events, list) and len(events) <= 1
                and all(isinstance(event, dict) and event.get("phase") == "combat"
                        and valid_number(event.get("simulationTime")) and valid_camera(event.get("camera"))
                        and abs(event["camera"]["zoom"]-initial["zoom"]) <= 1e-9 for event in events))
    drift = result.get("cameraDrift", {})
    checks = [{"ok": declared, "description": "Camera contract declares initial view and only the existing combat-center transition", "observed": contract}]
    violations = []
    if declared:
        for observation in result.get("observations", []):
            expected = dict(initial)
            for event in events:
                if observation.get("simulationTime", -1) >= event["simulationTime"]:
                    expected = {**event["camera"], "zoom": initial["zoom"]}
            actual = observation.get("camera")
            if not valid_camera(actual) or any(abs(actual[key]-expected[key]) > 1e-9 for key in ("x", "y", "zoom")):
                violations.append({"wallMs": observation.get("wallMs"), "actual": actual, "expected": expected})
    checks.append({"ok": declared and bool(result.get("observations")) and not violations
                   and drift.get("count") == 0 and drift.get("checks", 0) >= len(result.get("frames", []))+1,
                   "description": "Every measured frame and sample preserves declared camera zoom and phase position",
                   "observed": {"frameDrift": drift, "sampleViolations": violations}})
    guard = result.get("inputGuard", {})
    checks.append({"ok": guard.get("scope") == "measured-owned-window-only" and guard.get("cleanup") == "COMPLETE",
                   "description": "Measured-window input guard was restored after observation", "observed": guard})
    return checks


def validate_workload(result: dict[str, Any], contract: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate the engine's named, measured evidence against contract rev2.

    Contract records exact metric paths supplied by the engine implementation.
    It cannot replace measured values, IDs, per-unit results or tick samples.
    """
    checks: list[dict[str, Any]] = validate_camera(result)

    def check(condition: bool, description: str, observed: Any) -> None:
        checks.append({"ok": bool(condition), "description": description, "observed": observed})

    observations = result.get("observations", [])
    check(len(observations) >= 120, "At least 120 periodic actual-world observations", len(observations))
    check(result.get("wallMs", 0) >= 120000, "Measured interval covers 120 real seconds", result.get("wallMs"))
    if not observations:
        return checks
    first, last = observations[0], observations[-1]
    elapsed = last["simulationTime"] - first["simulationTime"]
    check(elapsed >= 114, "Normal simulation advances at least 114 seconds", elapsed)
    check(all(o.get("paused") is False and o.get("speed") == 1 for o in observations),
          "World remains unpaused at speed one throughout measured interval",
          [{"wallMs": o["wallMs"], "paused": o.get("paused"), "speed": o.get("speed")} for o in observations])
    check(all(first.get("population", {}).get(str(team), first.get("population", {}).get(team)) == 1000
              for team in (1, 2)), "Interval begins with 1000 actual living units in each city", first.get("population"))
    frames = result.get("frameSummary", {})
    check(frames.get("samples", 0) >= 1200, "Sustained requestAnimationFrame samples collected", frames.get("samples"))
    check(frames.get("p95Ms") is not None and frames["p95Ms"] <= 50,
          "Observed frame p95 is at most 50 ms", frames.get("p95Ms"))
    check(frames.get("p99Ms") is not None and frames["p99Ms"] <= 100,
          "Observed frame p99 is at most 100 ms", frames.get("p99Ms"))

    before = first.get("metrics")
    after = last.get("metrics")
    check(isinstance(before, dict) and isinstance(after, dict), "Engine exposes actual metrics at both interval boundaries", {"before": type(before).__name__, "after": type(after).__name__})
    if not isinstance(before, dict) or not isinstance(after, dict):
        return checks
    declared_paths = contract.get("paths", {})
    counter_requirements = {"deposits": 100, "construction": 10, "arrivals": 200,
                            "hits": 100, "projectiles": 50, "heals": 20}
    for name, minimum in counter_requirements.items():
        path = declared_paths.get(name)
        start = metric_value(before, *(path or []))
        end = metric_value(after, *(path or []))
        delta = end - start if isinstance(start, (int, float)) and isinstance(end, (int, float)) else None
        check(delta is not None and delta >= minimum, f"At least {minimum} measured {name} events in the interval",
              {"path": path, "start": start, "end": end, "delta": delta})
    samples = metric_value(after, *(declared_paths.get("tickSamples") or []))
    tick_p95 = percentile(samples, 0.95) if isinstance(samples, list) and samples else None
    check(tick_p95 is not None and tick_p95 <= 50, "Measured simulation tick p95 is at most 50 ms", tick_p95)
    tick_dt = metric_value(after, *(declared_paths.get("tickDt") or []))
    check(tick_dt == 0.05, "Engine reports normal 20 Hz simulation step", tick_dt)

    phases = metric_value(after, *(declared_paths.get("phases") or []))
    check(isinstance(phases, list) and len(phases) > 0, "Engine supplies actual participant and start-count evidence by phase", phases)
    if isinstance(phases, list):
        required_phases = {"economy", "construction", "movement", "combat"}
        check(required_phases.issubset({phase.get("name") for phase in phases}),
              "All four active workload phases were measured", [phase.get("name") for phase in phases])
        for phase in phases:
            for team in (1, 2):
                team_data = phase.get("teams", {}).get(str(team), phase.get("teams", {}).get(team, {}))
                required = {"economy": 250, "construction": 50, "combat": 500, "movement": 800}.get(phase.get("name"))
                if required is None:
                    continue
                ids = team_data.get("participantIds", [])
                check(team_data.get("startLiving") == 1000 and len(set(ids)) >= required,
                      f"{phase.get('name')} team {team} starts with 1000 living and {required} actual participants",
                      {"startLiving": team_data.get("startLiving"), "participants": len(set(ids)), "ids": ids})
                participant_path = contract.get("participantPaths", {}).get(phase.get("name"))
                if participant_path:
                    actual_ids = metric_value(after, *participant_path)
                    intersection = set(ids).intersection(actual_ids) if isinstance(actual_ids, list) else set()
                    check(len(intersection) >= required,
                          f"{phase.get('name')} team {team} has {required} participants recorded by actual engine activity",
                          {"path": participant_path, "actualCount": len(intersection), "ids": sorted(intersection)})

    paths = metric_value(after, *(declared_paths.get("unitPaths") or []))
    check(isinstance(paths, list) and len(paths) >= 1600, "Per-unit path evidence exists for 800 distinct units per city", len(paths) if isinstance(paths, list) else paths)
    if isinstance(paths, list):
        for team in (1, 2):
            team_paths = {entry.get("unitId"): entry for entry in paths if entry.get("team") == team}
            check(len(team_paths) >= 800, f"Team {team} has 800 distinct mass movement participants", len(team_paths))
        failures = []
        for entry in paths:
            terminal = entry.get("status")
            latency = entry.get("firstMovementSeconds")
            completion = entry.get("terminalSeconds")
            wall_latency = entry.get("firstMovementWallSeconds")
            wall_completion = entry.get("terminalWallSeconds")
            valid = terminal in {"arrived", "unreachable"} and isinstance(completion, (int, float)) and completion <= 30
            valid = valid and isinstance(wall_completion, (int, float)) and wall_completion <= 30
            if terminal == "arrived":
                valid = valid and isinstance(latency, (int, float)) and latency <= 2.5
                valid = valid and isinstance(wall_latency, (int, float)) and wall_latency <= 2.5
            if not valid:
                failures.append(entry)
        check(not failures, "Every mass movement unit starts and terminates within its simulation and actual wall-clock bounds; none starve", failures)
    raw_paths = after.get("rawNavigation")
    check(isinstance(raw_paths, list), "All actual navigation records are retained, including later combat/healer orders", len(raw_paths) if isinstance(raw_paths, list) else raw_paths)
    if isinstance(raw_paths, list):
        starved = [entry for entry in raw_paths if entry.get("status") in {"pending", "moving"}
                   and last["simulationTime"] - entry.get("commandedAt", last["simulationTime"]) > 30]
        check(not starved, "No later actual path request remains indefinitely pending or moving", starved)
    result["simulationSummary"] = {"elapsedSeconds": elapsed, "tickP95Ms": tick_p95,
                                  "startPopulation": first.get("population"), "endPopulation": last.get("population")}
    return checks
