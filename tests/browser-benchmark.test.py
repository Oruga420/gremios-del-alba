"""Offline observer tests with synthetic events/clock; not browser evidence."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from browser_benchmark import MEASURE_JS, validate_camera


def execute_observer(mode="normal"):
    # Run the exact measurement function with an explicit synthetic clock and
    # event target. No browser, engine simulation, microphone or network runs.
    script = r"""
let now=0,frameCount=0,phase=null,removed=0,intervalCleared=0,bubbleCalls=0;
const listeners=new Map();
const camera={x:10,y:20,zoom:.9605607431229627};
const world={state:{time:0,units:[],metrics:{},events:[],paused:false,speed:1},summary:()=>({}),benchmarkCameraPhase:()=>phase};
globalThis.window={game:{world,renderer:{camera,stats:{}}},
  addEventListener(type,handler,options){if(!options.capture||options.passive)throw Error('guard must capture and prevent default');listeners.set(type,handler);},
  removeEventListener(type,handler,capture){if(capture&&listeners.get(type)===handler){listeners.delete(type);removed++;}}};
function input(type,isTrusted=true){
  let stopped=false,prevented=false;
  listeners.get(type)?.({type,isTrusted,key:'PRIVATE_KEY_VALUE',data:'PRIVATE_TEXT_VALUE',clientX:123,
    preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  if(!stopped)bubbleCalls++;
  return {stopped,prevented};
}
Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
globalThis.setInterval=()=>1;
globalThis.clearInterval=()=>intervalCleared++;
globalThis.cancelAnimationFrame=()=>{};
const intercepted=[];
globalThis.requestAnimationFrame=callback=>{
  setImmediate(()=>{
    now+=60000;frameCount++;world.state.time=now/1000;
    if(frameCount===1){for(const type of ['wheel','keydown','pointermove'])intercepted.push(input(type));}
    if(mode==='drift'&&frameCount===1)camera.zoom=.35;
    if(mode==='phase'&&frameCount===2){camera.x=40;camera.y=40;phase={phase:'combat',simulationTime:120,camera:{...camera}};}
    callback(now);
  });return frameCount+1;
};
if(mode==='error')world.state=null;
let result=null,error=null;
try{result=await measure({durationMs:120000,expectedCamera:{...camera}});}catch(e){error=e.message;}
const after=input('keydown');
process.stdout.write(JSON.stringify({result,error,removed,remaining:listeners.size,intervalCleared,intercepted,after,bubbleCalls}));
"""
    result = subprocess.run(["node", "--input-type=module"],
                            input=f"const mode={json.dumps(mode)};const measure={MEASURE_JS};\n"+script,
                            text=True, capture_output=True, timeout=10, check=True)
    return json.loads(result.stdout)


class CameraObserverTests(unittest.TestCase):
    def test_guard_blocks_inputs_and_restores_handlers_without_private_values(self):
        value = execute_observer()
        self.assertIsNone(value["error"])
        self.assertEqual(value["remaining"], 0)
        self.assertEqual(value["removed"], 14)
        self.assertEqual(value["intervalCleared"], 1)
        self.assertTrue(all(row["stopped"] and row["prevented"] for row in value["intercepted"]))
        self.assertFalse(value["after"]["stopped"])
        self.assertEqual(value["bubbleCalls"], 1)
        events = value["result"]["inputGuard"]["events"]
        self.assertEqual({row["type"] for row in events}, {"wheel", "keydown", "pointermove"})
        self.assertTrue(all(set(row)=={"type","count","firstWallMs","lastWallMs"} for row in events))
        self.assertNotIn("PRIVATE", json.dumps(events))
        self.assertTrue(all(check["ok"] for check in validate_camera(value["result"])))

    def test_guard_is_restored_when_observation_throws(self):
        value = execute_observer("error")
        self.assertIn("lost the actual World", value["error"])
        self.assertEqual(value["remaining"], 0)
        self.assertEqual(value["removed"], 14)
        self.assertFalse(value["after"]["stopped"])

    def test_zoom_drift_fails_camera_acceptance(self):
        result = execute_observer("drift")["result"]
        self.assertEqual(result["observations"][-1]["camera"]["zoom"], .35)
        self.assertGreater(result["cameraDrift"]["count"], 0)
        self.assertFalse(validate_camera(result)[1]["ok"])

    def test_existing_combat_center_transition_remains_allowed(self):
        result = execute_observer("phase")["result"]
        self.assertEqual(result["cameraDrift"]["count"], 0)
        self.assertTrue(all(check["ok"] for check in validate_camera(result)))

    def test_sample_drift_cannot_be_hidden_by_clean_frame_counter(self):
        result = execute_observer()["result"]
        result["observations"][-1]["camera"]["x"] += 1
        self.assertFalse(validate_camera(result)[1]["ok"])

    def test_other_camera_transitions_and_missing_evidence_fail(self):
        result = execute_observer("phase")["result"]
        result["cameraContract"]["phaseEvents"][0]["phase"] = "unapproved"
        self.assertFalse(validate_camera(result)[0]["ok"])
        self.assertTrue(all(not check["ok"] for check in validate_camera({})))


if __name__ == "__main__":
    unittest.main()
