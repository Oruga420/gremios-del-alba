# Shared implementation contract, revision 2

This is an agreed design for executors, not a claim of existing behavior. The engine executor owns any corrections; coordinate incompatible changes before writing them. Source is native browser ESM JavaScript, no build dependency.

## Modules

`src/game/data.js` exports `MAPS`, `GUILDS`, `UNITS`, `BUILDINGS`, `TECHNOLOGIES`, `TERRAIN`. Catalogs except MAPS/GUILDS are dictionaries keyed by stable English snake_case IDs. MAPS and GUILDS are arrays of records with `id`, `name`, `description`, `color`. Names/UI prose in Spanish. Definition records include `name`, `cost:{wood,food,gold,stone}`, `age` and gameplay properties. Sprite URL convention `assets/sprites/{buildings|units}/<id>.png`; sprites are optional during development only. For menu images: `assets/maps/<map-id>.png`, `assets/hero.png`, `assets/portraits/<guild-id>.png`. Manifest records actual files.

`src/game/world.js` exports `World`. Constructor `new World({mapId, guildId, difficulty, mode, seed})`, defaults map `valle-del-alba`, guild `alba`, difficulty `normal`, mode `conquest`. Exposes mutable `state` owned exclusively by simulation and `tick(dtSeconds)`, `command(type,args)`, `getEntity(id)`, `summary(team=1)`, `serialize()` and static `World.fromSave(serialized)`. `serialize()` returns a plain JSON-compatible object. `fromSave` accepts that object, validates before mutation and throws on bad input.

## State

```
{
 version: 1, mapId, guildId, seed, time, paused:false, speed:1,
 map:{width:80,height:80,terrain:Array<integer>, heights:Array<number>},
 teams:{1:{name,guildId,color,resources:{wood,food,gold,stone},age:1,upgrades:{}},2:{...}},
 units:[{id,kind,team,name,x,y,hp,maxHp,order:{type,targetId?,x?,y?},carry:{kind?,amount},cooldown,...}],
 buildings:[{id,kind,team,name,x,y,hp,maxHp,progress:0..1,queue:[],rally:{x,y},...}],
 nodes:[{id,kind,x,y,amount,maxAmount,...}],
 projectiles:[],effects:[],events:[{time,text,kind}],winner:null
}
```

Coordinates are grid tile coordinates, floating point for moving units, integer anchor for buildings. `terrain[y*width+x]`: use exported TERRAIN numeric dictionary; renderer must derive colors by map palette. Buildings define `size` (square footprint). Nodes are finite resource entities. `kind` node IDs wood/food/gold/stone/fish. Teams 1 player, 2 enemy. GUILDS IDs alba/espina/bastion/eclipse. `summary(1)` returns `{resources, population, reservedPopulation, capacity, maxPopulation:1000, age, idleVillagers, military, villagers, ...}`. Population counts are authoritative, never inferred from HUD alone.

## Commands

All `command(type,args)` calls return `{ok:boolean,message:string,...optionalData}` and atomically reject invalid inputs without partial spend or mutation. Integer quantities 1..100, bounded tile positions, no hostile team control. Selection lives in UI, not engine.

| type | args |
| --- | --- |
| move | unitIds, x, y, attackMove? |
| gather | unitIds, targetId (node); resource convenience permitted |
| build | unitIds (villagers), kind, x, y |
| wall | unitIds, x, y, endX, endY, kind:'wall' or 'palisade' |
| repair | unitIds, targetId |
| train | buildingId, kind, quantity=1 |
| cancel_train | buildingId, queueIndex=0 |
| attack | unitIds, targetId |
| stop / defend | unitIds |
| rename | unitId, name |
| rally | buildingId, x, y |
| research | buildingId, technologyId |
| advance_age | buildingId (guildhall) |
| trade | resource, amount, direction:'buy' or 'sell' |
| cast | unitIds, x, y, spell:'fireball' or 'heal' |
| convert | unitIds, targetId |
| gate | buildingId, open:boolean |
| pause | paused:boolean |
| speed | speed:0.5,1,2 |

Engine may expose additional supported commands in inventory. `getEntity` returns matching unit/building/node or undefined. World event list bounded (latest100), UI announcement does not mutate world events. Save includes all gameplay state including deterministic RNG state/reservations/ongoing work; recompute indexes/caches safely.

## Renderer

`src/game/renderer.js` exports `GameRenderer`, constructor `(canvas, world, options={})`. Methods `setWorld(world)`, `resize()`, `render({selectedIds=[],hoverId=null,placement=null,dragRect=null}={})`, `screenToWorld(clientX,clientY)`, `worldToScreen(x,y)`, `pick(clientX,clientY)`, `centerOn(x,y)`, `zoomAt(factor,clientX?,clientY?)`, `pan(dxPixels,dyPixels)`, `drawMinimap(canvas)`, `destroy()`. `pick` returns entity or null. Camera and `stats` available publicly for view/test measurement. UI owns input event handlers. All screen coordinates are CSS/client pixels and methods compensate canvas DOM bounding rect and devicePixelRatio. Pick priority unit/building/node. Terrain is cached; texture/sprite files real; graceful initial loading.

## App and voice boundary

UI exports/attaches `window.game = {get world(),get renderer(),get selectedIds(),select(ids),announce(text),newMatch(options),save(),load(),setPlacement(kind),openPanel(name),execute(type,args),getState()}` after DOM initialized. App getter returns current World after new/load, so adapters never retain obsolete world. `execute` delegates world command and refreshes HUD. `announce` has aria-live support.

Voice initializer receives this facade. Registry derives from `docs/voice/clickables.md` produced from real UI and engine actions before domain tools. Native WebMCP and browser speech share `runTool`; selection/view/read immediate, consequential proposals pause the game visibly, confirm starts a stop window after speech end, cancel restores prior pause state. True browser-native support and fallback automation always labeled separately. Public `window.guildTools` is allowed as documented testing/automation surface and never claims to be native WebMCP.

Server default URL `http://127.0.0.1:4173`; bind loopback only. Never serve arbitrary repository files; allowlist public index/src/assets/docs reports/status, exclude `.local`, dotfiles, scripts/server/config/keys and traversal. Personal credential source allowlist must reject Promise paths. Root/index is playable start screen; explicit `?play=1` may start default scenario for QA, not test-only hidden commands or money cheats.

## Test organization and ownership

Engine executor: data/world + tests/world*.test.mjs + scripts/verify-game.mjs + scripts/benchmark.mjs.
UI executor: index/renderer/app/styles + UI test selectors/data action attributes. Must not create server, voice files or overwrite art.
Voice/server executor: server.mjs/src/voice + tests/voice*.test.mjs/tests/server*.test.mjs + inventory/verify voice and personal scripts + optional SDK vendoring/build.
Art executor: assets + generation scripts/budget ledger/verify asset and budget scripts. No game/UI source changes; publish integration manifest IDs.
Harness/report executor: README/wiki/sources/memory/check/build/package/status/report scripts. Avoid editing ownership files.
Fresh verifier: separate observed evidence; no code edits unless leader assigns a bounded fix.

## Art/renderer handshake

Art executor owns `assets/manifest.json` (provenance/coverage) and `assets/sprites/atlas.json` (drawing). Renderer must read the latter once, reload via a public `reloadAssets()` method for integration, and expose `stats.loadedAssets` plus `stats.assetFailures` so actual loading can be proved. URLs are same-origin relative paths under assets. Never ship reference-only images from sources/reference.

Atlas schema version1: `{version:1, units:{[kind]:Sprite}, buildings:{[kind]:Sprite}, resources:{[kind]:Sprite}}`. Sprite shape: `{image:"assets/sprites/units/heavy_knight.png",frameWidth:128,frameHeight:128,pivot:[0.5,0.88],directions:8,actions:{idle:{frames:[0],fps:1},walk:{frames:[0,1,2,3],fps:8},attack:{frames:[4,5,6,7],fps:8}},layout:"direction-rows"}`. Each direction is a row; frame indices are columns. Directions clockwise0..7 starting southeast. Single-frame sprites use directions1/frame0 for all actions, with manifest documenting deliberate procedural motion/weapon/VFX overlays. These are production styles only if original generated/rendered art is actually used; development generic silhouettes/fallback draw paths cannot pass A6.

Buildings can use static frame with intentional construction scaffolding, damage smoke and rubble overlays. Static Sprite record may omit actions/directions (defaults idle0/directions1). Resource sprites optional only if documented original procedural resource geometry is the accepted production design. Every gameplay catalog ID must have either an existing mapped sprite or an explicit intentional procedural render spec, never an accidental missing-file fallback. Cover boats, siege, mounted roles, walls/gates and effects as well as humanoids/buildings. Renderer procedural fields/terrain/VFX are original runtime geometry with documented palette/state behavior, not unaccounted provider assets. Asset verifier compares exact final catalog-ID coverage and verifies PNG geometry/frame bounds. Meshy knight representative requires genuine directional walk animation from rigged model; other generated role sprites may use documented lightweight procedural motion.

## Confirmation/world epochs

### Current game override and RTS orders (22 October 2026)

Ordinary tactical commands execute immediately with short replies, without a confirmation or tactical pause. The confirmation machinery described below remains an optional compatibility mode; it is not the default user flow. The canonical registry now has 37 tools, including `propose_formation`. Native registration must be verified separately from the application bridge and the remote agent's tool list.

`command('formation', {unitIds, kind, x?, y?})` accepts `line`, `box`, or `staggered`. A selected formation persists on each unit. `command('move', {unitIds, x, y, attackMove?, formation?})` may choose it explicitly; real UI/voice moves default to box. The app facade additionally exposes `formation` and `chooseFormation(kind)`. Explicit formation orders assign distinct reachable fractional slots, orient ranks toward the destination, group land/water movers separately and use each subgroup's slowest base speed. They store the anchor, slot, route/cursor and navigation version in the save. An unsupported slot stays idle and is recorded as unreachable rather than as an arrival. Soft neighbor separation is bounded steering; it does not guarantee solid-body collision freedom.

Navigation performs whole-segment and corner checks. Formation routes share anchor fields and derive paths through the cached parent tree; legacy moves retain their existing destination semantics. A simulation step admits at most eight new fields. Cache hits, deferred requests and truly unreachable goals have distinct outcomes. Persisted `navigationFields` (maximum 128) and `navigationQueue` (maximum 2048) retain canonical half-cell coordinates and disjoint keys so an immediate save/load preserves planner scheduling. Off-step speculative validation uses a separate cache and cannot mutate serialized hints.

Gather orders retain their resource intent. Cargo is deposited before switching kinds; missing or depleted targets trigger a search for an eligible reachable replacement. Missing dropoffs/resources keep the order and cargo with a bounded retry time. Enemy farms are excluded for both player and AI orders. `command('rally', {buildingId, targetId})` records a real resource/farm target and sends newly trained compatible workers directly into its gather cycle; coordinate rallies remain supported. Read tools expose carried resources, formation and rally state.

These are original browser-engine implementations. Reference investigation with REA remains partial: the exact commercial routing, formation layout and full gathering algorithms were not recovered. The regression tests and two benchmark entrypoints verify this project's own behavior; they do not establish equivalence with a commercial engine.

App facade exposes monotonically increasing `worldGeneration` changed on newMatch/load; voice session has its own epoch. Every pending proposal binds immutable worldGeneration/sessionEpoch/proposalId. One pending proposal at a time; supersession cancels previous before staging next and preserves original pause ownership. Unconfirmed proposal wall-clock expiry30s, armed missing-speech-end expiry10s; pause never freezes these deadlines. All terminal paths clear timers/listeners and restore original pause state unless the user manually changed pause ownership. Late callbacks cannot mutate a new match even if IDs are reused. Typed/browser-speech modes explicitly emit speech-end only when their own real response has ended (or immediately if no spoken response is scheduled), never after an arbitrary safety timeout.
