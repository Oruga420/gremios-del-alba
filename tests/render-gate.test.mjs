import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderGate } from '../src/game/render-gate.js';

function fixture() {
  return { gate: createRenderGate(), world: { state: { time: 0 } }, renderer: { camera: { x: 0, y: 0, zoom: 1 }, canvas: { width: 1440, height: 900 }, surfaceRevision: 1 } };
}
test('unchanged RAF callbacks reuse pixels but every simulation update draws', () => {
  const { gate, world, renderer } = fixture(); let draws = 0;
  for (let i = 0; i < 60; i++) { if (i % 3 === 0) world.state.time += .05; if (gate(world, renderer)) draws++; }
  assert.equal(draws, 20); assert.equal(world.state.time, 1.0000000000000002);
});
test('paused commands, selection and hover invalidate retained pixels', () => {
  const { gate, world, renderer } = fixture(); const input = { revision: 0, selectedIds: ['u1'] };
  assert.equal(gate(world, renderer, input), true); assert.equal(gate(world, renderer, input), false);
  input.revision++; assert.equal(gate(world, renderer, input), true);
  input.selectedIds.push('u2'); assert.equal(gate(world, renderer, input), true);
  input.hoverId = 'u3'; assert.equal(gate(world, renderer, input), true);
  assert.equal(gate(world, renderer, input), false);
});
test('camera, dimensions, same-size surface reset, assets and world changes redraw', () => {
  const { gate, world, renderer } = fixture(); gate(world, renderer);
  for (const update of [()=>renderer.camera.x++,()=>renderer.camera.y++,()=>renderer.camera.zoom=1.1,()=>renderer.canvas.width++,()=>renderer.canvas.height++,()=>renderer.surfaceRevision++]) {
    update(); assert.equal(gate(world, renderer), true); assert.equal(gate(world, renderer), false);
  }
  assert.equal(gate({state:{time:world.state.time}}, renderer), true);
});
test('drag and placement draw continuously and clearing a gesture redraws once', () => {
  const { gate, world, renderer } = fixture(); gate(world, renderer);
  for (const input of [{placement:{kind:'house',x:5,y:5}},{dragRect:{x:0,y:0,width:3,height:4}}]) {
    assert.equal(gate(world, renderer, input), true); assert.equal(gate(world, renderer, input), true);
    assert.equal(gate(world, renderer), true); assert.equal(gate(world, renderer), false);
  }
});
