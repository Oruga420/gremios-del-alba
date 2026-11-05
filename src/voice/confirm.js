// Adapted concepts from installed promise-voice-agent's framework-free confirm store.
// Contract correction: missing speech-end CANCELS; it can never auto-start execution.
import { phrase } from './i18n.js';

const PENDING = new Set(['proposed', 'armed', 'countdown']);
// Spanish `speak` plus its translatable key.
const said = (code, key) => { const value = phrase(key); return { ok: false, code, speak: value.text, i18n: value.i18n }; };
export const TERMINAL_PROPOSAL_STATES = ['done', 'failed', 'stopped', 'expired', 'superseded', 'invalidated'];

export function createConfirmStore({ game, execute, now = Date.now, stopWindowMs = 4000, proposalTimeoutMs = 30_000, armedTimeoutMs = 10_000 }) {
  let current = null;
  let epoch = 1;
  let lease = null;
  let counter = 0;
  const listeners = new Set();
  const history = [];
  const generation = () => game.worldGeneration ?? 0;
  const world = () => game.world;
  const snapshot = () => current ? structuredClone(current) : null;
  const emit = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
  const matches = (binding) => current && current.proposalId === binding.proposalId && current.worldGeneration === binding.worldGeneration && current.sessionEpoch === binding.sessionEpoch && generation() === binding.worldGeneration && epoch === binding.sessionEpoch;
  function restore() {
    if (!lease) return;
    if (generation() === lease.generation && world() === lease.world && world()?.state?.pauseRevision === lease.revision && world()?.state?.paused === true) game.execute('pause', { paused: lease.original });
    lease = null;
  }
  function finish(state, result = null) {
    if (!current || (!PENDING.has(current.state) && current.state !== 'executing')) return snapshot();
    current.state = state; current.result = result; current.finishedAt = now();
    restore();
    history.push(snapshot()); if (history.length > 25) history.shift();
    emit(); return snapshot();
  }
  function acquire() {
    if (lease) return;
    const target = world();
    const original = target?.state?.paused ?? false;
    game.execute('pause', { paused: true });
    lease = { world: target, generation: generation(), original, revision: target?.state?.pauseRevision };
  }
  function propose(action) {
    // Cancel, restore, and reacquire synchronously so supersession preserves pause ownership.
    if (current && PENDING.has(current.state)) finish('superseded');
    acquire();
    current = { proposalId: `proposal-${epoch}-${++counter}`, worldGeneration: generation(), sessionEpoch: epoch, state: 'proposed', createdAt: now(), expiresAt: now() + proposalTimeoutMs, armedAt: null, countdownStartedAt: null, stopWindowEndsAt: null, confirmationText: null, action: structuredClone(action), result: null };
    emit(); return snapshot();
  }
  function tick() {
    if (!current || !PENDING.has(current.state)) return snapshot();
    if (!matches(current)) return finish('invalidated', said('STALE_WORLD', 'voice.confirm.staleWorld'));
    if (current.state === 'proposed' && now() >= current.expiresAt) return finish('expired', said('PROPOSAL_EXPIRED', 'voice.confirm.expired'));
    if (current.state === 'armed' && now() >= current.armedAt + armedTimeoutMs) return finish('expired', said('SPEECH_END_MISSING', 'voice.confirm.speechEndMissing'));
    if (current.state === 'countdown' && now() >= current.stopWindowEndsAt) {
      const binding = { proposalId: current.proposalId, worldGeneration: current.worldGeneration, sessionEpoch: current.sessionEpoch };
      // Revalidate at the last synchronous boundary, then invoke only the engine command door.
      if (!matches(binding)) return finish('invalidated');
      const action = structuredClone(current.action);
      current.state = 'executing';
      let result;
      try { result = execute(action, { ...binding, confirmationText: current.confirmationText, source: 'voice', originalPaused: lease?.original, ownsPause: Boolean(lease && generation() === lease.generation && world() === lease.world && world()?.state?.pauseRevision === lease.revision) }); }
      catch { result = said('EXECUTION_FAILED', 'voice.confirm.executionFailed'); }
      if (result && typeof result.then === 'function') return finish('failed', said('ASYNC_MUTATION_REJECTED', 'voice.confirm.asyncRejected'));
      return finish(result?.ok ? 'done' : 'failed', result);
    }
    return snapshot();
  }
  function arm(proposalId, confirmationText = 'confirma') {
    tick();
    if (!current || current.proposalId !== proposalId || current.state !== 'proposed' || !matches(current)) return null;
    current.state = 'armed'; current.armedAt = now(); current.confirmationText = String(confirmationText).trim().slice(0, 160);
    emit(); return snapshot();
  }
  function speechEnded(binding) {
    tick();
    if (!current || current.state !== 'armed' || !matches(binding)) return null;
    current.state = 'countdown'; current.countdownStartedAt = now(); current.stopWindowEndsAt = now() + stopWindowMs;
    emit(); return snapshot();
  }
  return {
    propose, arm, speechEnded, tick,
    stop(proposalId = current?.proposalId) { if (current?.proposalId !== proposalId) return null; return finish('stopped', said('STOPPED', 'voice.confirm.stopped')); },
    invalidate(reason = 'SESSION_CHANGED') { finish('invalidated', said(reason, 'voice.confirm.invalidated')); epoch++; restore(); },
    getState: snapshot, get sessionEpoch() { return epoch; }, get pending() { return Boolean(current && PENDING.has(current.state)); }, get state() { return current?.state || 'idle'; }, getHistory: () => structuredClone(history),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { this.invalidate('DISCONNECTED'); listeners.clear(); }
  };
}
