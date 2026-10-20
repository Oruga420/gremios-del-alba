// All world animation uses simulation time. Reuse the existing canvas only when
// its complete visual inputs are unchanged; interaction gestures always redraw.
export function createRenderGate() {
  let previous = null;
  return (world, renderer, { revision = 0, selectedIds = [], hoverId = null, placement = null, dragRect = null } = {}) => {
    if (placement || dragRect) { previous = null; return true; }
    const camera = renderer.camera;
    const current = [world, renderer, world.state.time, revision, renderer.surfaceRevision,
      renderer.canvas.width, renderer.canvas.height, camera.x, camera.y, camera.zoom,
      selectedIds.join('\0'), hoverId];
    if (previous && current.every((value, index) => value === previous[index])) return false;
    previous = current;
    return true;
  };
}
