import { World } from '../src/game/world.js';
import { BUILDINGS, UNITS } from '../src/game/data.js';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]||0;
const teams=[1,2];
const alive=(world,team)=>world.state.units.filter(u=>u.team===team&&u.hp>0);
const assert=(condition,message)=>{if(!condition)throw new Error(message);};

/** Real native simulation fixture; all entities validate through the production save reader. */
export function createBenchmarkWorld(seed=20261013){
  const world=new World({mapId:'llanuras-de-otono',mode:'conquest',difficulty:'easy',seed});
  world.state.units=[];world.state.teams[1].age=4;world.state.teams[2].age=4;world._indexes();
  for(const team of teams){
    world.state.teams[team].resources={wood:100000,food:100000,gold:100000,stone:100000};
    for(let y=1;y<78&&world.summary(team).capacity<1000;y+=3)for(let x=team===1?1:58;x<(team===1?22:79)&&world.summary(team).capacity<1000;x+=3)if(world.canPlace('house',x,y))world._building('house',team,x,y,1);
  }
  world.navigation.rebuild();
  const metadata={seed,dt:.05,participants:{1:{economy:[],builders:[],military:[]},2:{economy:[],builders:[],military:[]}},construction:{1:[],2:[]},movement:{1:[],2:[]},unreachable:{1:[],2:[]},wallCommandedAt:{},wallNavigation:{},phases:[],paths:{deposits:['metrics','gatherCycles'],construction:['metrics','constructionProgress'],arrivals:['metrics','movementArrivals'],hits:['metrics','damagingHits'],projectiles:['metrics','projectiles'],heals:['metrics','healingEvents'],unitPaths:['navigation']}};
  for(const team of teams){
    const p=metadata.participants[team],base=team===1?{x:17,y:19}:{x:62,y:60};
    for(let i=0;i<250;i++){const u=world._spawn('villager',team,base.x+(i%4)*.3,base.y+Math.floor(i%12/4)*.3);p.economy.push(u.id);}
    for(let i=0;i<50;i++){const u=world._spawn('villager',team,team===1?20:58,team===1?32:47);p.builders.push(u.id);}
    for(let i=0;i<700;i++){const kind=i%8===0?'healer':i%6===0?'mage':i%4===0?'archer':'heavy_knight';const u=world._spawn(kind,team,team===1?33:47,team===1?35:44);p.military.push(u.id);if(kind==='heavy_knight')u.hp=u.maxHp-60;}
    let made=0;
    for(let y=team===1?28:44;y<(team===1?38:57)&&made<5;y+=3)for(let x=team===1?21:54;x<(team===1?30:60)&&made<5;x+=3)if(world.canPlace('house',x,y)){const b=world._building('house',team,x,y,0);metadata.construction[team].push(b.id);made++;}
    assert(made===5,'Benchmark needs five legal construction plots per city');
  }
  for(const team of teams){const center=team===1?{x:30,y:2}:{x:49,y:77};for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)world._building('wall',team,center.x+dx,center.y+dy,1);metadata.unreachable[team]={...center,unitIds:metadata.participants[team].military.slice(0,5)};}
  world.navigation.rebuild();world._indexes();
  for(const team of teams){
    const all=alive(world,team);assert(all.length===1000,`Team ${team} fixture must contain 1000 actual units`);
    // One reused field per meaningful cohort. The movement distance is reachable and bounded.
    const p=metadata.participants[team];
    const builder=world.getEntity(p.builders[0]);let builderGoal=world.navigation.nearest(builder.x+4,builder.y,'land');
    if(Math.floor(builderGoal.x)===Math.floor(builder.x)&&Math.floor(builderGoal.y)===Math.floor(builder.y))builderGoal=world.navigation.nearest(builder.x,builder.y+4,'land');
    for(const [ids,point]of [[p.economy,{x:team===1?18:61,y:team===1?19:60}],[p.builders,builderGoal],[p.military.slice(5),{x:team===1?34:46,y:team===1?35:44}]]){
      const issued=performance.now(),result=world._command('move',{unitIds:ids,...point},team);assert(result.ok,result.message);for(const id of ids)metadata.wallCommandedAt[id]=issued;metadata.movement[team].push({unitIds:ids,...point});
    }
    const blocked=metadata.unreachable[team],issued=performance.now();assert(world._command('move',blocked,team).ok,'Blocked navigation command rejected');for(const id of blocked.unitIds)metadata.wallCommandedAt[id]=issued;metadata.movement[team].push({...blocked,expectedUnreachable:true});
  }
  metadata.overCapRejected=teams.every(team=>{const hall=world.state.buildings.find(b=>b.team===team&&b.kind==='guildhall'),dock=world.state.buildings.find(b=>b.team===team&&b.kind==='dock');return !world._command('train',{buildingId:hall.id,kind:'villager'},team).ok&&!world._command('train',{buildingId:dock.id,kind:'fishing_boat'},team).ok;});assert(metadata.overCapRejected,'1001st inhabitant/boat accepted');
  // Harness-owned references survive retirement of terminal production telemetry.
  // They are outside World.state/serialize(), and cannot hide an unresolved cohort.
  metadata.initialNavigationRecords=[...world.state.navigation];
  World.fromSave(world.serialize());
  return {world,metadata};
}

function recordPhase(world,metadata,name,key){
  if(metadata.phases.some(p=>p.name===name))return;
  metadata.phases.push({name,simTime:world.state.time,teams:Object.fromEntries(teams.map(team=>[team,{startLiving:alive(world,team).length,participantIds:name==='movement'?alive(world,team).map(u=>u.id):[...metadata.participants[team][key]]}]))});
}

/** Called by the harness, using actual game orders and actual participant IDs. */
export function updateBenchmarkPhase(world,metadata){
  const time=world.state.time;
  recordPhase(world,metadata,'movement','military');
  if(time>=2.5&&!metadata.buildersHeld){metadata.buildersHeld=true;for(const team of teams)world._command('defend',{unitIds:metadata.participants[team].builders},team);}
  if(time>=5&&!metadata.phases.some(p=>p.name==='economy')){
    recordPhase(world,metadata,'economy','economy');
    recordPhase(world,metadata,'construction','builders');
    for(const team of teams){const p=metadata.participants[team];
      for(let i=0;i<p.economy.length;i++){const u=world.getEntity(p.economy[i]);if(!u)continue;const kinds=['wood','food','gold','stone'],kind=kinds[i%4];const node=world.state.nodes.filter(n=>n.kind===kind&&n.amount>0).sort((a,b)=>Math.hypot(a.x-u.x,a.y-u.y)-Math.hypot(b.x-u.x,b.y-u.y))[0];assert(world._command('gather',{unitIds:[u.id],targetId:node.id},team).ok,'Economic participant command failed');}
      // Every builder has its own legal approach tile before work, so early completions cannot
      // silently exclude a late cohort member from the measured construction workload.
      for(let i=0;i<p.builders.length;i++){const b=metadata.construction[team][Math.floor(i/10)];const result=world._command('repair',{unitIds:[p.builders[i]],targetId:b},team);assert(result.ok,'Construction participant command failed');const u=world.getEntity(p.builders[i]);world._order(u,{type:'build',targetId:b,chain:metadata.construction[team]});}
    }
  }
  if(time>=70&&!metadata.phases.some(p=>p.name==='combat')){
    recordPhase(world,metadata,'combat','military');
    for(const team of teams){const other=team===1?2:1;for(let i=0;i<metadata.participants[team].military.length;i++){const id=metadata.participants[team].military[i],u=world.getEntity(id),target=world.getEntity(metadata.participants[other].military[(i+23)%700]);if(u&&target&&UNITS[u.kind].attack>0)world._command('attack',{unitIds:[id],targetId:target.id},team);else if(u)world._command('defend',{unitIds:[id],x:team===1?39:41,y:39},team);}}
  }
}

export function benchmarkEvidence(world,metadata,samples,elapsedSeconds,startTime){
  const paths=(metadata.initialNavigationRecords??world.state.navigation).filter(n=>n.commandedAt===0&&metadata.movement[n.team]?.some(group=>group.unitIds.includes(n.unitId))).map(n=>({unitId:n.unitId,team:n.team,status:n.status,firstMovementSeconds:n.startedAt===null?null:n.startedAt-n.commandedAt,terminalSeconds:n.resolvedAt===null?null:n.resolvedAt-n.commandedAt,wallFirstMovementSeconds:metadata.wallNavigation?.[n.unitId]?.first??null,wallTerminalSeconds:metadata.wallNavigation?.[n.unitId]?.terminal??null}));
  return {observedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()},seed:metadata.seed,dt:.05,elapsedSeconds,simulatedSeconds:world.state.time-startTime,tickSampleCount:samples.length,p95TickMs:percentile(samples,.95),p99TickMs:percentile(samples,.99),maxTickMs:Math.max(...samples),metrics:world.state.metrics,liveCounts:Object.fromEntries(teams.map(team=>[team,alive(world,team).length])),phases:metadata.phases,unitPaths:paths,allNavigationRecords:world.state.navigation,fixtureParticipants:metadata.participants,expectedUnreachable:metadata.unreachable,overCapRejected:metadata.overCapRejected};
}

async function sourceDigests(){const files=['src/game/data.js','src/game/world.js','src/game/navigation.js','src/game/formations.js','scripts/benchmark.mjs'];return Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));}

export async function runBenchmark({durationSeconds=120,realtime=true}={}){
  const sourceBefore=await sourceDigests(),warmup=createBenchmarkWorld();for(let i=0;i<100;i++){updateBenchmarkPhase(warmup.world,warmup.metadata);warmup.world.tick(.05);}const {world,metadata}=createBenchmarkWorld();const samples=[],pendingWall=new Set(metadata.initialNavigationRecords);const startTime=world.state.time,start=performance.now();let deadline=start;
  while((realtime?(performance.now()-start)/1000:world.state.time-startTime)<durationSeconds){
    updateBenchmarkPhase(world,metadata);const before=performance.now();world.tick(.05);samples.push(performance.now()-before);deadline+=50;
    const observed=performance.now();for(const r of pendingWall){const wall=metadata.wallNavigation[r.unitId]??={first:null,terminal:null};if(r.startedAt!==null&&wall.first===null)wall.first=(observed-metadata.wallCommandedAt[r.unitId])/1000;if(r.resolvedAt!==null){wall.terminal=(observed-metadata.wallCommandedAt[r.unitId])/1000;pendingWall.delete(r);}}
    if(realtime){const delay=deadline-performance.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));}
  }
  const elapsedSeconds=(performance.now()-start)/1000,evidence=benchmarkEvidence(world,metadata,samples,elapsedSeconds,startTime);const problems=[];
  for(const team of teams){if(!evidence.phases.every(phase=>phase.teams[team].startLiving===1000))problems.push(`Team ${team} phase did not start with 1000 living units`);const paths=evidence.unitPaths.filter(p=>p.team===team);if(new Set(paths.map(p=>p.unitId)).size<800)problems.push(`Team ${team} has fewer than800 movement participants`);}
  for(const team of teams)for(const[category,min]of [['economy',250],['builders',50],['military',500]]){const actual=metadata.participants[team][category].filter(id=>evidence.metrics.participants[category].includes(id)).length;if(actual<min)problems.push(`Team ${team} only ${actual} actual ${category} participants (<${min})`);}
  for(const p of evidence.unitPaths)if((p.status!=='unreachable'&&(p.firstMovementSeconds===null||p.firstMovementSeconds>2.5))||!['arrived','unreachable'].includes(p.status)||p.terminalSeconds===null||p.terminalSeconds>30)problems.push(`Unresolved/late navigation ${p.unitId}`);
  for(const p of evidence.unitPaths)if((p.status!=='unreachable'&&(p.wallFirstMovementSeconds===null||p.wallFirstMovementSeconds>2.5))||p.wallTerminalSeconds===null||p.wallTerminalSeconds>30)problems.push(`Unresolved/late wall-clock navigation ${p.unitId}`);
  for(const team of teams)for(const id of metadata.unreachable[team].unitIds)if(!evidence.unitPaths.some(p=>p.unitId===id&&p.status==='unreachable'&&p.terminalSeconds<=30))problems.push(`Blocked unit ${id} did not report terminal unreachable`);
  for(const [key,min]of Object.entries({gatherCycles:100,constructionProgress:10,movementArrivals:200,damagingHits:100,projectiles:50,healingEvents:20}))if(evidence.metrics[key]<min)problems.push(`${key} ${evidence.metrics[key]} < ${min}`);
  if(evidence.p95TickMs>50)problems.push('Simulation p95 tick >50ms');if(realtime&&evidence.simulatedSeconds<durationSeconds*.95)problems.push('Simulation did not keep normal20Hz progression');
  const sourceAfter=await sourceDigests();if(JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter))problems.push('Simulation source changed during the measured run');if(!evidence.overCapRejected)problems.push('1001st recruit/boat accepted');
  evidence.sourceDigests=sourceAfter;evidence.warmup={ticks:100,simulatedSeconds:5,fixtureResetBeforeMeasure:true};evidence.problems=problems;evidence.ok=problems.length===0;evidence.realtime=realtime;
  await mkdir(new URL('../docs/reports/',import.meta.url),{recursive:true});await writeFile(new URL('../docs/reports/simulation-benchmark.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({status:evidence.ok&&realtime?'POPULATION_1000_OK':evidence.ok?'SIMULATION_DIAGNOSTIC_OK':'SIMULATION_BENCHMARK_FAILED',elapsedSeconds,simulatedSeconds:evidence.simulatedSeconds,tickSampleCount:evidence.tickSampleCount,p95TickMs:evidence.p95TickMs,p99TickMs:evidence.p99TickMs,metrics:{...evidence.metrics,participants:Object.fromEntries(Object.entries(evidence.metrics.participants).map(([k,ids])=>[k,ids.length]))},liveCounts:evidence.liveCounts,unitPaths:evidence.unitPaths.length,phaseCounts:evidence.phases.map(p=>({name:p.name,teams:Object.fromEntries(Object.entries(p.teams).map(([team,v])=>[team,{startLiving:v.startLiving,participants:v.participantIds.length}]))})),problems:evidence.problems.slice(0,10),problemCount:evidence.problems.length,report:'docs/reports/simulation-benchmark.json'},null,2));
  return evidence;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const diagnostic=process.argv.includes('--diagnostic');const durationArg=process.argv.find(a=>a.startsWith('--duration='));
  const result=await runBenchmark({durationSeconds:durationArg?Number(durationArg.split('=')[1]):120,realtime:!diagnostic});if(!result.ok)process.exitCode=1;
}
