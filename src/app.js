import { World } from './game/world.js';
import { MAPS, GUILDS, UNITS, BUILDINGS, TECHNOLOGIES, AGE_COSTS } from './game/data.js';
import { GameRenderer, drawMenuLandscape } from './game/renderer.js';
import { createRenderGate } from './game/render-gate.js';
import { installAudio } from './audio/index.js';
import { t, getLocale, onLocaleChange, applyDocumentLocale, mountLanguageSelects, formatNumber, localize } from './i18n/index.js';
import { unitName, buildingName, techName, resourceName, resourceShort, guildText, mapText, kindName, entityName } from './i18n/names.js';

const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const number = value => formatNumber(value);
const numeral = age => ['','I','II','III','IV'][Number(age)] ?? '';
const upper = text => String(text ?? '').toLocaleUpperCase(getLocale());
const lower = text => String(text ?? '').toLocaleLowerCase(getLocale());
const costText = cost => Object.entries(cost || {}).filter(([,n])=>n).map(([key,value])=>t('app.common.cost',{amount:number(value),resource:resourceShort(key)})).join(' · ');
const RESOURCE_KINDS = new Set(['wood','food','gold','stone','fish']);
const isResourceKind = kind => RESOURCE_KINDS.has(kind);
const ORDER_TYPES = new Set(['idle','move','gather','build','repair','attack','attack_move','defend','cast','convert','return','deposit']);
const FORMATIONS = ['line','box','staggered'];
const formationName = kind => t(`app.formation.${kind}`);
const queueName = item => item.type==='age'?t('app.common.ageNumeral',{numeral:numeral(item.kind)}):(UNITS[item.kind]?unitName(item.kind):TECHNOLOGIES[item.kind]?techName(item.kind):TECHNOLOGIES[item.technologyId]?techName(item.technologyId):t('app.queue.fallback'));
const queueProgress = item => Math.max(0,Math.min(1,item.progress??1-(item.remaining||0)/(item.duration||1)));
const guildEmblems = {alba:'star',espina:'leaf',bastion:'shield',eclipse:'moon'};
/** A window.game result: Spanish .message stays stable for the voice layer and tests; i18n carries the key for display. */
const appResult = (ok,key,params,spanishParams=params) => ({ok,message:t(key,spanishParams,'es'),i18n:{key,params}});
const categoryFor = definition => definition.category==='research'||definition.category==='monument'?'knowledge':definition.category==='city'?'economy':definition.category;
let world = null, renderer = null, selectedIds = [], worldGeneration = 0, currentTab = 'economy';
let placement = null, attackMove = false, targetedSpell = null, convertTarget = false, hovered = null, lastHud = 0, lastMinimap = 0, accumulator = 0, lastFrame = 0;
let pointer = null, dragRect = null, menuVisible = true, currentPanel = null, panelSignature = '', selectionSignature = '', catalogSignature = '', winnerShown = false;
let catalogMarkup = null;
let renderRevision = 0;
const needsRender = createRenderGate();
let humanPauseGeneration = 0;
const controlGroups = new Map(), heldKeys = new Set();
const queueKeys = new WeakMap(), displayedQueueEntries = new Map();
let nextQueueKey = 0;
const appStats = { simulationSamples: [], frameSamples: [], simulationSteps: 0, frameIntervals: [], renderedFrames: 0, reusedFrames: 0 };
function queueKey(entry){
  if(!queueKeys.has(entry))queueKeys.set(entry,`queue-${++nextQueueKey}`);
  return queueKeys.get(entry);
}

function buildMenu() {
  $('#guild-options').innerHTML = GUILDS.map((guild,index)=>{
    const emblem=guildEmblems[guild.id]||'star';
    return `<label class="guild-option" style="--guild-color:${guild.color}" title="${escapeHTML(guildText(guild.id,'description'))}"><input type="radio" name="guild" value="${guild.id}" ${index===0?'checked':''} data-action="choose-guild"><span class="guild-portrait"><img src="/assets/portraits/${guild.id}.png" alt="">${icon(emblem)}</span><strong>${escapeHTML(guildText(guild.id,'label'))}</strong><small>${escapeHTML(guildText(guild.id,'specialty'))}</small></label>`;
  }).join('');
  $('#map-options').innerHTML=MAPS.map((map,index)=>`<label class="map-option" style="--map-color:${map.color}" title="${escapeHTML(mapText(map.id,'description'))}"><input type="radio" name="map" value="${map.id}" ${index===0?'checked':''} data-action="choose-map"><canvas width="140" height="90" data-map-preview="${map.id}" aria-hidden="true"></canvas><span>${escapeHTML(mapText(map.id,'name'))}</span></label>`).join('');
  updateMapDescription();
  for(const [index,map] of MAPS.entries()){
    const canvas=document.querySelector(`[data-map-preview="${map.id}"]`),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    c.fillStyle=map.palette[0];c.fillRect(0,0,w,h);
    c.fillStyle=map.palette[2];
    for(let i=0;i<22;i++){const x=(Math.sin(i*7+index)*.5+.5)*w,y=(Math.cos(i*5+index)*.5+.5)*h;c.beginPath();c.ellipse(x,y,8+(i%4)*3,5+(i%3)*3,0,0,Math.PI*2);c.fill();}
    c.strokeStyle=map.palette[1];c.lineWidth=map.topology==='coast'?32:map.topology==='islands'?18:10;
    c.beginPath();c.moveTo(w*.8,-10);c.bezierCurveTo(w*(.1+index*.04),h*.3,w*.8,h*.5,w*.22,h+10);c.stroke();
    if(['mountain','canyon','caldera'].includes(map.topology)){c.strokeStyle=map.palette[4];c.lineWidth=12;c.beginPath();c.moveTo(0,h*.5);c.lineTo(w*.4,h*.3);c.lineTo(w*.6,h*.65);c.lineTo(w,h*.5);c.stroke();}
    c.fillStyle='#eee3bc';c.fillRect(w*.23,h*.58,8,7);c.fillStyle='#536b52';c.beginPath();c.moveTo(w*.23-2,h*.58);c.lineTo(w*.23+4,h*.58-6);c.lineTo(w*.23+10,h*.58);c.fill();
    const img=new Image();img.onload=()=>{img.alt='';canvas.parentElement.insertBefore(img,canvas.nextSibling);};img.src=`/assets/maps/${map.id}.png`;
  }
  drawMenuLandscape($('#menu-landscape'));
  const hero=new Image();hero.onload=()=>$('.hero-image').classList.add('ready');hero.src='/assets/hero.png';
  $('#match-form').addEventListener('submit',event=>{
    event.preventDefault();const fields=new FormData(event.currentTarget);
    newMatch({guildId:fields.get('guild'),mapId:fields.get('map'),difficulty:fields.get('difficulty'),mode:fields.get('mode')});
  });
  $('#match-form').addEventListener('change',updateMapDescription);
}
function updateMapDescription(){const selected=document.querySelector('[name="map"]:checked'),map=MAPS.find(entry=>entry.id===selected?.value)||MAPS[0];$('#map-description').textContent=mapText(map.id,'description');}
/** Re-labels the start menu in place, so the chosen guild/map and the drawn previews survive a language change. */
function localizeMenu(){
  for(const input of document.querySelectorAll('#guild-options input[name="guild"]')){
    const label=input.closest('.guild-option');if(!label)continue;
    label.title=guildText(input.value,'description');
    const strong=label.querySelector('strong'),small=label.querySelector('small');
    if(strong)strong.textContent=guildText(input.value,'label');
    if(small)small.textContent=guildText(input.value,'specialty');
  }
  for(const input of document.querySelectorAll('#map-options input[name="map"]')){
    const label=input.closest('.map-option');if(!label)continue;
    label.title=mapText(input.value,'description');
    const name=label.querySelector('span');if(name)name.textContent=mapText(input.value,'name');
  }
  updateMapDescription();
}
const worldMapName = () => MAPS.some(map=>map.id===world?.state.mapId)?mapText(world.state.mapId,'name'):null;

function newMatch(options={}) {
  const next = new World(options);
  installWorld(next);
  const mapName=worldMapName();
  announce(mapName?t('app.menu.matchStart',{map:mapName}):t('app.menu.matchStartUnknown'));
  return {ok:true,worldGeneration};
}
function updateWorldCaption(){
  if(!world)return;
  $('#world-map-name').textContent=worldMapName()||world.state.mapId;
  $('#world-mode').textContent=t(world.state.mode==='peaceful'?'app.world.mode.peaceful':'app.world.mode.conquest');
  $('#map-size').textContent=t('app.world.mapSize',{width:world.state.map.width,height:world.state.map.height});
}
function installWorld(next) {
  worldGeneration++;
  window.dispatchEvent(new CustomEvent('worldchange',{detail:{worldGeneration}}));
  world=next;selectedIds=[];placement=null;attackMove=false;targetedSpell=null;convertTarget=false;hovered=null;winnerShown=false;
  controlGroups.clear();heldKeys.clear();accumulator=0;humanPauseGeneration++;menuVisible=false;currentTab='economy';
  $('#start-screen').hidden=true;$('#game-screen').hidden=false;
  if(renderer)renderer.setWorld(world);else {
    renderer=new GameRenderer($('#world-canvas'),world,{onAssetsLoaded:()=>{invalidateHUD();refreshHUD();}});
  }
  renderer.resize();
  const first=world.state.buildings.find(entity=>entity.team===1&&entity.kind==='guildhall');
  if(first){selectedIds=[first.id];renderer.centerOn(first.x+5.5,first.y+6.5);}
  updateWorldCaption();
  $('#winner-dialog').close();closePanel();invalidateHUD();refreshHUD();$('#world-canvas').focus({preventScroll:true});
  window.dispatchEvent(new CustomEvent('gremios:worldchange',{detail:{worldGeneration}}));
}
function execute(type,args={}) {
  if(!world)return appResult(false,'app.error.noMatch');
  const result=world.command(type,args);
  if(result.message||result.i18n)announce(localize(result),!result.ok);
  invalidateHUD();refreshHUD();
  return result;
}
function invalidateHUD(){renderRevision++;selectionSignature='';catalogSignature='';panelSignature='';}
function announce(message,error=false){
  if(!message)return;
  $('#screen-reader-status').textContent=message;
  const container=$('#announcements'),notice=document.createElement('div');notice.className=`announcement${error?' error':''}`;notice.textContent=message;container.append(notice);
  while(container.children.length>4)container.firstElementChild.remove();
  setTimeout(()=>notice.remove(),6000);
}
function select(ids){
  if(!world)return [];
  selectedIds=[...new Set(ids)].filter(id=>{const entity=world.getEntity(id);return entity&&entity.hp!==0;});
  placement=null;attackMove=false;targetedSpell=null;convertTarget=false;invalidateHUD();refreshHUD();return [...selectedIds];
}
function selectedEntities(){return world?selectedIds.map(id=>world.getEntity(id)).filter(Boolean):[];}
function ownUnits(){return selectedEntities().filter(entity=>entity.team===1&&UNITS[entity.kind]);}
function selectedWorkers(){return ownUnits().filter(entity=>entity.kind==='villager').map(entity=>entity.id);}
function selectedProducer(){return selectedEntities().find(entity=>entity.team===1&&BUILDINGS[entity.kind]);}
function formationFor(units=ownUnits()){
  const kind=units[0]?.formation;
  return FORMATIONS.includes(kind)&&units.every(unit=>unit.formation===kind)?kind:'box';
}
function chooseFormation(kind){
  if(!FORMATIONS.includes(kind))return appResult(false,'app.error.unknownFormation');
  return execute('formation',{unitIds:ownUnits().map(unit=>unit.id),kind});
}
function orderStatus(entity){
  if(entity.order?.waiting==='dropoff')return t('app.order.noDropoff');
  if(entity.order?.waiting==='resource')return t('app.order.noResource');
  if(entity.order?.type==='gather'&&entity.order.phase==='deliver')return t('app.order.deposit');
  return ORDER_TYPES.has(entity.order?.type)?t(`app.order.${entity.order.type}`):t('app.order.ready');
}
function cargoStatus(entities){
  const cargo=entities.reduce((out,unit)=>{if(unit.carry?.amount>0)out[unit.carry.kind]=(out[unit.carry.kind]||0)+unit.carry.amount;return out;},{});
  return Object.keys(cargo).length?t('app.cargo.some',{items:Object.entries(cargo).map(([kind,amount])=>t('app.common.amount',{amount:number(amount),resource:resourceName(kind)})).join(' · ')}):t('app.cargo.none');
}
function rallyStatus(entity){
  const target=world.getEntity(entity.rally?.targetId);
  return target?t('app.rally.target',{target:target.kind==='farm'?t('app.rally.farm'):isResourceKind(target.kind)?resourceName(target.kind):entityName(target)||target.kind}):t('app.rally.ground');
}
function enough(cost){const resources=world?.summary(1)?.resources||{};return Object.entries(cost||{}).every(([key,amount])=>(resources[key]||0)>=amount);}
function focusEntity(id){const entity=world.getEntity(id);if(!entity)return;select([id]);renderer.centerOn(entity.x,entity.y);closePanel();}

function setPlacement(kind){
  if(!BUILDINGS[kind])return appResult(false,'app.error.unknownBuilding');
  if(!selectedWorkers().length){announce(t('app.placement.selectVillagers'),true);return appResult(false,'app.error.selectVillagers');}
  const definition=BUILDINGS[kind];
  if(world.summary(1).age<definition.age){const result=appResult(false,'app.placement.needsAge',{building:{kind},numeral:numeral(definition.age)},{building:definition.name,numeral:numeral(definition.age)});announce(localize(result),true);return result;}
  if(!enough(definition.cost)){const result=appResult(false,'app.placement.missingResources',{building:{kind},cost:costText(definition.cost)},{building:definition.name,cost:costTextSpanish(definition.cost)});announce(localize(result),true);return result;}
  placement={kind,x:0,y:0,visible:false};attackMove=false;targetedSpell=null;convertTarget=false;
  $('#world-canvas').style.cursor='crosshair';refreshPlacementHint();invalidateHUD();refreshHUD();
  return appResult(true,'app.placement.choosePlace',{building:{kind}},{building:definition.name});
}
function costTextSpanish(cost){return Object.entries(cost||{}).filter(([,n])=>n).map(([key,value])=>t('app.common.cost',{amount:formatNumber(value,'es'),resource:t(`data.resourceShort.${key}`,null,'es')},'es')).join(' · ');}
function refreshPlacementHint(){
  const hint=$('#placement-hint');hint.hidden=!placement&&!attackMove&&!targetedSpell&&!convertTarget;
  const cancel=t('app.hint.escCancel');
  if(placement)hint.innerHTML=`<b>${escapeHTML(buildingName(placement.kind))}</b> · ${escapeHTML(t(['wall','palisade'].includes(placement.kind)?'app.hint.dragLine':'app.hint.clickBuild'))} · ${escapeHTML(cancel)}`;
  else if(targetedSpell)hint.textContent=`${targetedSpell==='heal'?t('app.hint.healSpell'):t('app.common.fireball')} · ${t('app.hint.clickTarget')} · ${cancel}`;
  else if(convertTarget)hint.textContent=`${t('app.common.conversion')} · ${t('app.hint.clickRival')} · ${cancel}`;
  else if(attackMove)hint.textContent=`${t('app.common.attackMove')} · ${t('app.hint.clickTarget')} · ${cancel}`;
}
function cancelTargeting(){placement=null;attackMove=false;targetedSpell=null;convertTarget=false;pointer=null;dragRect=null;$('#world-canvas').style.cursor='default';refreshPlacementHint();invalidateHUD();}
function canPlace(kind,x,y){
  const def=BUILDINGS[kind];
  if(!world.canPlace(kind,x,y))return false;
  return enough(def.cost)&&world.summary(1).age>=def.age;
}
function validPlacement(){
  if(!placement)return false;
  const {kind,x,y,endX,endY}=placement;
  if(!['wall','palisade'].includes(kind)||endX===undefined)return canPlace(kind,x,y);
  const dx=endX-x,dy=endY-y,count=Math.max(Math.abs(dx),Math.abs(dy));
  if(count>79)return false;
  const totalCost=Object.fromEntries(Object.entries(BUILDINGS[kind].cost).map(([resource,amount])=>[resource,amount*(count+1)]));
  if(!enough(totalCost)||world.summary(1).age<BUILDINGS[kind].age)return false;
  for(let index=0;index<=count;index++)if(!world.canPlace(kind,Math.round(x+dx*index/(count||1)),Math.round(y+dy*index/(count||1))))return false;
  return true;
}

function refreshHUD(){
  if(!world||menuVisible)return;
  const summary=world.summary(1);
  $('#resources').innerHTML=['wood','food','gold','stone'].map(resource=>`<div class="resource" data-resource="${resource}" title="${escapeHTML(resourceName(resource))}">${icon(resource)}<strong>${number(summary.resources?.[resource])}</strong><small>${escapeHTML(upper(resourceName(resource)))}</small></div>`).join('');
  $('#population').innerHTML=`${icon('people')}<strong>${number(summary.population)} / ${number(summary.capacity)}${summary.reservedPopulation?` <span class="reserved">+${summary.reservedPopulation}</span>`:''}</strong><small>${escapeHTML(t('app.hud.populationCaption'))}</small>`;
  const age=summary.age||1;
  $('#age-label').textContent=upper(t('app.hud.age',{numeral:numeral(age),name:t([1,2,3,4].includes(age)?`app.hud.ageShort.${age}`:'app.hud.ageShort.fallback')}));
  $('#idle-count').textContent=summary.idleVillagers||0;
  const seconds=Math.floor(world.state.time||0);$('#game-time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const pause=$('[data-action="pause"]');pause.innerHTML=icon(world.state.paused?'play':'pause');pause.setAttribute('aria-label',t(world.state.paused?'app.hud.resume':'app.hud.pause'));
  $('[data-action="speed"]').textContent=`${world.state.speed||1}×`;$('#pause-banner').hidden=!world.state.paused;
  $('#zoom-level').textContent=`${Math.round(renderer.camera.zoom*100)}%`;
  selectedIds=selectedIds.filter(id=>world.getEntity(id)?.hp!==0&&world.getEntity(id));
  const entities=selectedEntities(),first=entities[0];
  const signature=JSON.stringify([selectedIds,entities.map(e=>[e.kind,e.team,e.progress<1,e.order?.type,e.order?.phase,e.order?.waiting,e.formation,e.name,e.queue?.map(queueKey),e.open,e.rally?.targetId]),summary.age]);
  if(signature!==selectionSignature){selectionSignature=signature;renderSelection(entities,summary);}
  updateSelectionProgress(entities);
  const catalogKey=JSON.stringify([selectedIds,currentTab,summary.age,summary.resources,world.state.teams?.[1]?.upgrades,first?.queue?.map(queueKey),first?.progress>=1,placement?.kind]);
  if(catalogKey!==catalogSignature){catalogSignature=catalogKey;renderCatalog(entities,summary);}
  $('#selection-orders').textContent=placement?t('app.hud.orders.placing',{building:buildingName(placement.kind)}):first?(UNITS[first.kind]?t(entities.length>1?'app.hud.orders.unit.other':'app.hud.orders.unit.one',{count:entities.length,status:orderStatus(first),formation:formationName(formationFor())}):BUILDINGS[first.kind]?t('app.hud.orders.building',{rally:rallyStatus(first)}):t('app.hud.orders.resource',{resource:isResourceKind(first.kind)?resourceName(first.kind):first.kind})):t('app.hud.orders.empty');
  if(currentPanel==='roster')updateRoster();
  if(world.state.winner!==null&&world.state.winner!==undefined&&!winnerShown)showWinner();
}

function spritePreview(record){
  const image=renderer.images.get(record.image),width=record.frameWidth||image.width,height=record.frameHeight||image.height;
  return `<span class="sprite-preview" style="aspect-ratio:${width}/${height};background-image:url('/${record.image}');background-size:${image.width/width*100}% ${image.height/height*100}%" aria-hidden="true"></span>`;
}
function portrait(entity){
  const type=BUILDINGS[entity.kind]?'buildings':'units',record=renderer.atlas[type]?.[entity.kind];
  if(record&&renderer.images.has(record.image))return spritePreview(record);
  return icon(BUILDINGS[entity.kind]?'home':entity.kind==='villager'?'hammer':UNITS[entity.kind]?.role==='magic'?'moon':'shield');
}
function renderSelection(entities,summary){
  const panel=$('#selection-panel');
  displayedQueueEntries.clear();
  if(!entities.length){panel.innerHTML=`<div class="selection-empty"><div class="selection-crest">${icon('star')}</div><h3>${escapeHTML(t('app.selection.empty.title'))}</h3><p>${escapeHTML(t('app.selection.empty.line1'))}<br>${escapeHTML(t('app.selection.empty.line2'))}</p></div>`;return;}
  const entity=entities[0],definition=UNITS[entity.kind]||BUILDINGS[entity.kind],isUnit=!!UNITS[entity.kind],own=entity.team===1;
  if(!definition){panel.innerHTML=`<div class="selection-empty"><div class="selection-crest">${icon(entity.kind==='fish'?'food':entity.kind)}</div><h3>${escapeHTML(isResourceKind(entity.kind)?resourceName(entity.kind):entity.kind)}</h3><p>${escapeHTML(t('app.common.available',{amount:number(entity.amount)}))}<br>${escapeHTML(t('app.selection.resourceFlavor'))}</p></div>`;return;}
  const title=entities.length>1?t('app.selection.multipleTitle',{count:entities.length}):entityName(entity)||kindName(entity.kind);
  const order=isUnit?orderStatus(entity):t(entity.progress<1?'app.selection.underConstruction':own?'app.selection.ownBuilding':'app.selection.rivalBuilding');
  const percent=value=>t('app.common.percent',{value:Math.round(value*100)});
  panel.innerHTML=`<div class="selected-identity"><div class="entity-portrait">${portrait(entity)}</div><div class="selected-name"><small>${escapeHTML(t('app.selection.identity',{team:t(own?'app.selection.team.own':'app.selection.team.rival'),type:t(isUnit?'app.selection.type.unit':'app.selection.type.building')}))}</small><h3 title="${escapeHTML(title)}">${escapeHTML(title)}</h3><span>${escapeHTML(entities.length>1?t('app.selection.multiple'):kindName(entity.kind))}</span>${isUnit&&own&&entities.length===1?`<br><button class="rename-mini" data-action="rename" data-unit-id="${entity.id}">${escapeHTML(t('app.selection.rename'))}</button>`:''}</div></div>
    <div class="health-row"><div class="health-track"><i style="width:${Math.max(0,entity.hp/entity.maxHp*100)}%"></i></div><span>${number(entity.hp)} / ${number(entity.maxHp)}</span></div>
    <div class="entity-stats"><span>${escapeHTML(t(isUnit?'app.selection.stat.attack':'app.selection.stat.state'))} <b>${isUnit?definition.attack||0:entity.progress<1?escapeHTML(percent(entity.progress)):escapeHTML(t('app.selection.stat.ready'))}</b></span><span>${escapeHTML(t(isUnit?'app.selection.stat.armor':'app.selection.stat.age'))} <b>${isUnit?definition.armor||0:definition.age}</b></span>${isUnit?`<span>${escapeHTML(t('app.selection.stat.range'))} <b>${definition.range||1}</b></span>`:''}</div>
    ${own&&isUnit?`<div class="unit-orders"><button data-action="attack-move" title="${escapeHTML(t('app.selection.button.attackTitle'))}">${icon('sword')}${escapeHTML(t('app.selection.button.attack'))}</button><button data-action="stop" title="${escapeHTML(t('app.selection.button.stopTitle'))}">${icon('pause')}${escapeHTML(t('app.selection.button.stop'))}</button><button data-action="defend" title="${escapeHTML(t('app.selection.button.defendTitle'))}">${icon('shield')}${escapeHTML(t('app.selection.button.defend'))}</button></div>`:''}
    ${own&&isUnit?`<div class="formation-controls" role="group" aria-label="${escapeHTML(t('app.formation.groupLabel'))}">${FORMATIONS.map(kind=>`<button type="button" data-action="formation" data-formation="${kind}" aria-pressed="${formationFor()===kind}" title="${escapeHTML(t(`app.formation.regroup.${kind}`))}"><span class="formation-mark ${kind}" aria-hidden="true">${'<i></i>'.repeat(6)}</span>${escapeHTML(formationName(kind))}</button>`).join('')}</div><div class="unit-activity"><span class="order-status">${escapeHTML(order)}</span><span class="cargo-status">${escapeHTML(cargoStatus(entities))}</span></div>`:''}
    ${own&&!isUnit&&definition.trains?.length?`<div class="rally-status">${escapeHTML(rallyStatus(entity))}<small>${escapeHTML(t('app.selection.rallyHelp'))}</small></div>`:''}
    ${own&&!isUnit&&entity.kind==='gate'?`<div class="unit-orders"><button data-action="gate-toggle" data-building-id="${entity.id}">${icon('flag')}${escapeHTML(t(entity.open?'app.common.gate.close':'app.common.gate.open'))}</button></div>`:''}
    ${entity.progress<1?`<div class="progress-label">${escapeHTML(t('app.selection.constructionProgress',{percent:Math.round(entity.progress*100)}))}</div>`:''}
    ${entity.queue?.length?`<div class="training-queue">${entity.queue.map((item,index)=>renderQueueItem(item,index,entity.id)).join('')}</div>`:''}
    ${entities.length>1?`<div class="selection-chips">${Object.entries(entities.reduce((out,e)=>{out[e.kind]=(out[e.kind]||0)+1;return out;},{})).map(([kind,count])=>`<span class="selection-chip">${escapeHTML(t('app.selection.chip',{count,name:UNITS[kind]?unitName(kind):kind}))}</span>`).join('')}</div>`:''}`;
}
function renderQueueItem(item,index,buildingId){
  const key=queueKey(item),label=queueName(item);
  displayedQueueEntries.set(key,item);
  return `<div class="queue-item" title="${escapeHTML(label)}"><span class="queue-name">${escapeHTML(label.split(' ').slice(0,2).join(' '))}</span><button type="button" data-action="cancel-train" data-building-id="${buildingId}" data-queue-index="${index}" data-queue-key="${key}" aria-label="${escapeHTML(t('app.queue.cancel',{label}))}">×</button><i class="queue-progress" data-queue-key="${key}" style="width:${queueProgress(item)*100}%"></i></div>`;
}
function updateSelectionProgress(entities){
  const entity=entities[0],panel=$('#selection-panel');
  if(!entity||!(UNITS[entity.kind]||BUILDINGS[entity.kind]))return;
  const health=panel.querySelector('.health-track i'),healthText=panel.querySelector('.health-row>span');
  if(health)health.style.width=`${Math.max(0,entity.hp/entity.maxHp*100)}%`;
  if(healthText)healthText.textContent=`${number(entity.hp)} / ${number(entity.maxHp)}`;
  const activity=panel.querySelector('.order-status'),cargo=panel.querySelector('.cargo-status');
  if(activity)activity.textContent=orderStatus(entity);
  if(cargo)cargo.textContent=cargoStatus(entities);
  if(entity.progress<1){
    const progress=Math.round(entity.progress*100),state=panel.querySelector('.entity-stats span:first-child b'),label=panel.querySelector('.progress-label');
    if(state)state.textContent=t('app.common.percent',{value:progress});
    if(label)label.textContent=t('app.selection.constructionProgress',{percent:progress});
  }
  for(const bar of panel.querySelectorAll('.queue-progress')){
    const entry=displayedQueueEntries.get(bar.dataset.queueKey);
    if(entry)bar.style.width=`${queueProgress(entry)*100}%`;
  }
}

function actionCard({action,kind,label,cost,age,disabled=false,active=false,iconName='home',buildingId='',technologyId='',extra=''}){
  const type=UNITS[kind]?'units':'buildings',record=renderer.atlas[type]?.[kind];
  const thumb=record&&renderer.images.has(record.image)?spritePreview(record):icon(iconName);
  return `<button type="button" class="action-card${disabled?' locked':''}${active?' active':''}" data-action="${action}" data-kind="${kind||''}" data-building-id="${buildingId}" data-technology-id="${technologyId}" ${disabled?'aria-disabled="true"':''} title="${escapeHTML(`${label}${cost?` · ${costText(cost)}`:''}${age?` · ${t('app.common.ageNumber',{age})}`:''}${extra?` · ${extra}`:''}`)}"><span class="action-thumb">${thumb}</span><strong>${escapeHTML(label)}</strong><small>${escapeHTML(costText(cost)||extra||'')}</small>${age>1?`<span class="age-tag">${numeral(age)}</span>`:''}</button>`;
}
function renderCatalog(entities,summary){
  const own=entities.filter(e=>e.team===1),building=own.find(e=>BUILDINGS[e.kind]),unit=own.find(e=>UNITS[e.kind]);
  const workers=own.filter(e=>e.kind==='villager');
  const definitions=Object.entries(BUILDINGS).filter(([,def])=>categoryFor(def)===currentTab);
  let cards=[];
  if(building&&entities.length===1&&building.progress>=1){
    const definition=BUILDINGS[building.kind];
    for(const kind of definition.trains||[]){const def=UNITS[kind];cards.push(actionCard({action:`train:${kind}`,kind,label:unitName(kind),cost:def.cost,age:def.age,disabled:summary.age<def.age||!enough(def.cost),buildingId:building.id,iconName:kind==='villager'?'hammer':'sword'}));}
    if(building.kind==='guildhall'&&summary.age<4){const cost=AGE_COSTS[summary.age+1];cards.push(actionCard({action:'advance-age',label:t('app.common.ageNumeral',{numeral:numeral(summary.age+1)}),cost,iconName:'star',buildingId:building.id,disabled:!enough(cost),extra:t('app.catalog.advanceAge')}));}
    for(const technologyId of definition.technologies||[]){const def=TECHNOLOGIES[technologyId],done=world.state.teams[1].upgrades?.[technologyId];cards.push(actionCard({action:`research:${technologyId}`,label:techName(technologyId),cost:done?{}:def.cost,age:def.age,disabled:done||summary.age<def.age||!enough(def.cost),iconName:'book',buildingId:building.id,technologyId,extra:t(done?'app.common.researched':'app.common.research')}));}
    if(building.kind==='market')cards.push(actionCard({action:'market',label:t('app.catalog.trade'),iconName:'coins',extra:t('app.catalog.tradeExtra')}));
    if(building.kind==='gate')cards.push(actionCard({action:'gate-toggle',label:t(building.open?'app.common.gate.close':'app.common.gate.open'),buildingId:building.id,iconName:'flag',extra:t('app.catalog.gatePassage')}));
  }
  if(unit&&entities.some(e=>['mage','healer','wizard'].includes(e.kind))){
    if(own.some(e=>e.kind==='mage'))cards.push(actionCard({action:'cast-fireball',label:t('app.common.fireball'),iconName:'star',extra:t('app.common.chooseTarget')}));
    if(own.some(e=>e.kind==='healer'))cards.push(actionCard({action:'cast-heal',label:t('app.catalog.heal'),iconName:'leaf',extra:t('app.common.chooseTarget')}));
    if(own.some(e=>e.kind==='wizard'))cards.push(actionCard({action:'convert',label:t('app.common.conversion'),iconName:'moon',extra:t('app.catalog.chooseRival')}));
  }
  // Construction catalog stays visible next to a producer's contextual actions.
  for(const [kind,definition] of definitions){cards.push(actionCard({action:`build:${kind}`,kind,label:buildingName(kind),cost:definition.cost,age:definition.age,disabled:summary.age<definition.age||!enough(definition.cost),active:placement?.kind===kind,iconName:currentTab==='military'?'sword':currentTab==='defense'?'shield':currentTab==='knowledge'?'book':'home',extra:t(workers.length?'app.catalog.build':'app.catalog.needsVillagers')}));}
  const markup=cards.join('');
  if(markup!==catalogMarkup){$('#action-catalog').innerHTML=markup;catalogMarkup=markup;}
  document.querySelectorAll('[data-action="tab"]').forEach(button=>button.classList.toggle('active',button.dataset.tab===currentTab));
}

const HELP_CONTROLS = ['leftClick','drag','doubleClick','rightClick','formations','rally','wheel','camera','hotkeys','idle','groups','space','voice','save','escape'];
const PANEL_TITLES = ['help','roster','market','research','save','load','new','rename'];
let renameUnitId = null;
function openPanel(name){
  if(name==='voice'){window.guildVoice?.toggle();return;}
  currentPanel=name;panelSignature='';$('#modal-backdrop').hidden=false;$('#panel-drawer').hidden=false;
  $('#panel-title').textContent=PANEL_TITLES.includes(name)?t(`app.panel.title.${name}`):name;
  const content=$('#panel-content');
  if(name==='help')content.innerHTML=`<p class="panel-lead">${t('app.help.lead')}</p><p>${t('app.help.intro')}</p><h3>${t('app.help.controls.title')}</h3>${HELP_CONTROLS.map(id=>[t(`app.help.controls.${id}.key`),t(`app.help.controls.${id}.text`)]).map(([key,text])=>`<div class="help-row"><kbd>${key}</kbd><span>${text}</span></div>`).join('')}<h3>${t('app.help.build.title')}</h3><p>${t('app.help.build.p1')}</p><p>${t('app.help.build.p2')}</p><h3>${t('app.help.voice.title')}</h3><p>${t('app.help.voice.text')}</p>`;
  if(name==='roster'){
    content.innerHTML=`<p>${escapeHTML(t('app.roster.intro'))}</p><input class="roster-search" id="roster-search" placeholder="${escapeHTML(t('app.roster.searchPlaceholder'))}" aria-label="${escapeHTML(t('app.roster.searchLabel'))}" data-action="roster-search"><div id="roster-summary" class="roster-summary"></div><div id="roster-list"></div>`;
    $('#roster-search').addEventListener('input',()=>{panelSignature='';updateRoster();});updateRoster();
  }
  if(name==='market'){
    content.innerHTML=`<p>${escapeHTML(t('app.market.intro'))}</p><label for="trade-amount">${escapeHTML(t('app.market.amountLabel'))}</label><select id="trade-amount" data-action="trade-amount">${[100,50,10].map(amount=>`<option value="${amount}">${escapeHTML(t('app.market.amountOption',{amount}))}</option>`).join('')}</select><h3>${escapeHTML(t('app.market.goods'))}</h3><div class="trade-grid">${['wood','food','stone'].map(resource=>`<article class="trade-card">${icon(resource)}<h4>${escapeHTML(resourceName(resource))}</h4><small>${escapeHTML(t('app.market.priceNote'))}</small><div><button data-action="trade" data-resource="${resource}" data-direction="buy">${escapeHTML(t('app.market.buy'))}</button><button data-action="trade" data-resource="${resource}" data-direction="sell">${escapeHTML(t('app.market.sell'))}</button></div></article>`).join('')}</div><p>${escapeHTML(t('app.market.requirement'))}</p>`;
  }
  if(name==='research'){
    const age=world?.summary(1).age||1,team=world?.state.teams[1];
    content.innerHTML=`<p>${escapeHTML(t('app.research.intro'))}</p>${Object.entries(TECHNOLOGIES).map(([id,def])=>{
      const producer=world?.state.buildings.find(b=>b.kind===def.producer&&b.team===1&&b.progress>=1),done=team?.upgrades?.[id];
      const details=[BUILDINGS[def.producer]?buildingName(def.producer):def.producer,t('app.common.ageNumber',{age:def.age})];
      if(def.prerequisites.length)details.push(t('app.research.requires',{list:def.prerequisites.map(p=>techName(p)).join(t('app.common.listSeparator'))}));
      return `<article class="technology-row"><h4>${escapeHTML(techName(id))}</h4><p>${escapeHTML(details.join(' · '))}</p><footer><span>${escapeHTML(done?t('app.research.acquired'):costText(def.cost))}</span><button data-action="research:${id}" data-technology-id="${id}" data-building-id="${producer?.id||''}" ${!producer||done||age<def.age?'disabled':''}>${escapeHTML(t(done?'app.common.researched':'app.common.research'))}</button></footer></article>`;
    }).join('')}`;
  }
  if(name==='save'){
    content.innerHTML=`<p class="panel-lead">${escapeHTML(t('app.save.lead'))}</p><p>${escapeHTML(t('app.save.text'))}</p><button class="primary-button" data-action="save-now">${icon('save')}${escapeHTML(t('app.save.button'))}</button><p class="saved-notice">${escapeHTML(t('app.save.notice'))}</p>`;
  }
  if(name==='load'){
    let saved=null;try{saved=JSON.parse(localStorage.getItem('gremios-save'));}catch{saved=null;}
    const savedName=saved?(MAPS.some(m=>m.id===saved.mapId)?mapText(saved.mapId,'name'):saved.mapId||t('app.load.lastChronicle')):'';
    content.innerHTML=`<p class="panel-lead">${escapeHTML(t('app.load.lead'))}</p><p>${escapeHTML(t('app.load.text'))}</p>${saved?`<article class="technology-row"><h4>${escapeHTML(savedName)}</h4><p>${escapeHTML(t('app.load.localFile'))}</p><button class="primary-button" data-action="load-local">${escapeHTML(t('app.load.continue'))}</button></article>`:''}<button class="primary-button" data-action="load-file">${icon('load')}${escapeHTML(t('app.load.chooseFile'))}</button><p>${escapeHTML(t('app.load.validation'))}</p>`;
  }
  if(name==='new')content.innerHTML=`<p class="panel-lead">${escapeHTML(t('app.new.lead'))}</p><p>${escapeHTML(t('app.new.text'))}</p><button class="primary-button" data-action="save-now">${icon('save')}${escapeHTML(t('app.new.saveCurrent'))}</button><button class="primary-button" data-action="return-menu">${escapeHTML(t('app.new.chooseStory'))}${icon('arrow')}</button>`;
  $('#panel-drawer .icon-button').focus({preventScroll:true});
}
function closePanel(){currentPanel=null;renameUnitId=null;$('#panel-drawer').hidden=true;$('#modal-backdrop').hidden=true;}
const searchFold = text => lower(text).normalize('NFD').replace(/\p{Diacritic}/gu,'');
function updateRoster(){
  if(!world||!$('#roster-list'))return;
  const query=searchFold($('#roster-search').value||'');
  const units=world.state.units.filter(u=>u.team===1&&u.hp>0),signature=JSON.stringify([getLocale(),query,units.map(u=>[u.id,u.name,Math.round(u.hp),u.order?.type,u.order?.phase,u.order?.waiting])]);
  if(signature===panelSignature)return;panelSignature=signature;
  const summary=world.summary(1),bold=value=>`<b>${escapeHTML(number(value))}</b>`;
  $('#roster-summary').innerHTML=['population','villagers','military'].map(field=>{const count=Number(summary[field])||0;return `<span>${t(`app.roster.summary.${field}.${count===1?'one':'other'}`,{count:bold(count)})}</span>`;}).join('');
  // Spanish kind names stay searchable in every language (they are also the voice vocabulary).
  const filtered=units.filter(u=>searchFold(`${u.name} ${UNITS[u.kind]?.name} ${unitName(u.kind)}`).includes(query));
  $('#roster-list').innerHTML=filtered.slice(0,200).map(u=>`<div class="roster-row"><i class="unit-dot"></i><button data-action="select-entity" data-unit-id="${u.id}">${escapeHTML(entityName(u))}<small>${escapeHTML(unitName(u.kind))} · ${escapeHTML(orderStatus(u))}</small></button><span class="roster-hp">${escapeHTML(t('app.common.hp',{hp:Math.round(u.hp)}))}</span><button class="text-button" data-action="rename" data-unit-id="${u.id}">${escapeHTML(t('app.roster.rename'))}</button></div>`).join('')+(filtered.length>200?`<p>${escapeHTML(t('app.roster.refine'))}</p>`:'');
}
function renamePanel(unitId){
  const entity=world?.getEntity(unitId);if(!entity||entity.team!==1||!UNITS[entity.kind])return;
  openPanel('rename');renameUnitId=unitId;$('#panel-content').innerHTML=`<p>${escapeHTML(t('app.rename.intro'))}</p><form id="rename-form"><label for="rename-input">${escapeHTML(t('app.rename.label',{kind:upper(unitName(entity.kind))}))}</label><input id="rename-input" maxlength="40" required value="${escapeHTML(entity.name)}" data-unit-id="${unitId}" autocomplete="off"><div id="rename-error" class="form-error" role="status"></div><button class="primary-button" type="submit" data-action="rename-submit">${escapeHTML(t('app.rename.submit'))}${icon('arrow')}</button></form>`;
  $('#rename-form').addEventListener('submit',event=>{event.preventDefault();const result=execute('rename',{unitId,name:$('#rename-input').value});if(result.ok)closePanel();else $('#rename-error').textContent=localize(result);});
  $('#rename-input').focus();$('#rename-input').select();
}
/** Re-renders the open drawer in the new language, keeping what the player typed or chose. */
function refreshOpenPanel(){
  if(!currentPanel)return;
  if(currentPanel==='rename'){
    const id=renameUnitId,value=$('#rename-input')?.value;
    if(!world?.getEntity(id)){closePanel();return;}
    renamePanel(id);if(value!==undefined)$('#rename-input').value=value;return;
  }
  const query=$('#roster-search')?.value,amount=$('#trade-amount')?.value;
  openPanel(currentPanel);
  if(query!==undefined&&$('#roster-search')){$('#roster-search').value=query;panelSignature='';updateRoster();}
  if(amount!==undefined&&$('#trade-amount'))$('#trade-amount').value=amount;
}

function save(){
  if(!world)return appResult(false,'app.save.none');
  const snapshot=world.serialize();const json=JSON.stringify(snapshot);
  try{localStorage.setItem('gremios-save',json);}catch{announce(t('app.save.localFailed'),true);}
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`gremios-${world.state.mapId}-${new Date().toISOString().slice(0,10)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  announce(t('app.save.done'));return appResult(true,'app.save.result');
}
function load(serialized){
  if(serialized===undefined){openPanel('load');return appResult(true,'app.load.choose');}
  try{const next=World.fromSave(typeof serialized==='string'?JSON.parse(serialized):serialized);installWorld(next);announce(t('app.load.resumed'));return {ok:true,worldGeneration};}
  catch(error){const result=appResult(false,'app.load.failed',{error:error?.i18n?localize(error):error?.message},{error:error?.message});announce(localize(result),true);return {ok:false,message:result.message,i18n:result.i18n};}
}
$('#load-file').addEventListener('change',async event=>{
  const input=event.currentTarget,file=input.files?.[0];if(!file)return;
  if(file.size>25_000_000){announce(t('app.load.tooLarge'),true);input.value='';return;}
  const generation=worldGeneration;try{const text=await file.text();if(generation!==worldGeneration){announce(t('app.load.cancelled'),true);return;}load(text);}catch{announce(t('app.load.unreadable'),true);}finally{input.value='';}
});
function showWinner(){
  winnerShown=true;updateWinnerText();
  $('#winner-dialog').showModal();
}
function updateWinnerText(){
  if(!world||!winnerShown)return;
  const outcome=world.state.winner===1||world.state.winner==='player'?'won':'lost';
  $('#winner-title').textContent=t(`app.winner.${outcome}.title`);
  $('#winner-description').textContent=t(`app.winner.${outcome}.description`);
}
function returnMenu(){
  closePanel();$('#winner-dialog').close();menuVisible=true;heldKeys.clear();cancelTargeting();$('#game-screen').hidden=true;$('#start-screen').hidden=false;drawMenuLandscape($('#menu-landscape'));
  window.guildVoice?.close();
}

function handleAction(button,event){
  const action=button.dataset.action;
  if(action.startsWith('build:')){setPlacement(action.slice(6));return;}
  if(action.startsWith('train:')){execute('train',{buildingId:button.dataset.buildingId,kind:action.slice(6),quantity:event.shiftKey?5:1});return;}
  if(action.startsWith('research:')){execute('research',{buildingId:button.dataset.buildingId,technologyId:action.slice(9)});if(currentPanel==='research')openPanel('research');return;}
  switch(action){
    case 'help':openPanel('help');break;
    case 'roster':if(world)openPanel('roster');else announce(t('app.announce.rosterNeedsMatch'));break;
    case 'market':openPanel('market');break;
    case 'research':openPanel('research');break;
    case 'save':openPanel('save');break;
    case 'save-now':save();break;
    case 'load':openPanel('load');break;
    case 'load-file':$('#load-file').click();break;
    case 'load-local':try{load(JSON.parse(localStorage.getItem('gremios-save')));}catch{announce(t('app.load.invalidLocal'),true);}break;
    case 'new-match':openPanel('new');break;
    case 'return-menu':returnMenu();break;
    case 'continue-world':$('#winner-dialog').close();break;
    case 'close-panel':closePanel();break;
    case 'voice':window.guildVoice?.toggle(event);break;
    case 'pause':humanPauseGeneration++;execute('pause',{paused:!world.state.paused});break;
    case 'speed':{const speeds=[.5,1,2];execute('speed',{speed:speeds[(speeds.indexOf(world.state.speed)+1)%speeds.length]});break;}
    case 'tab':currentTab=button.dataset.tab;catalogSignature='';refreshHUD();break;
    case 'stop':execute('stop',{unitIds:ownUnits().map(e=>e.id)});cancelTargeting();break;
    case 'defend':execute('defend',{unitIds:ownUnits().map(e=>e.id)});cancelTargeting();break;
    case 'formation':chooseFormation(button.dataset.formation);cancelTargeting();break;
    case 'attack-move':if(ownUnits().length){cancelTargeting();attackMove=true;refreshPlacementHint();$('#world-canvas').style.cursor='crosshair';}else announce(t('app.announce.selectUnits'),true);break;
    case 'select-idle':selectIdle(event.shiftKey);break;
    case 'select-entity':focusEntity(button.dataset.unitId);break;
    case 'rename':renamePanel(button.dataset.unitId||selectedIds[0]);break;
    case 'cancel-train':{
      const buildingId=button.dataset.buildingId,queueIndex=Number(button.dataset.queueIndex),entry=displayedQueueEntries.get(button.dataset.queueKey);
      if(entry&&world.getEntity(buildingId)?.queue[queueIndex]===entry)execute('cancel_train',{buildingId,queueIndex});
      else{announce(t('app.announce.queueChanged'));invalidateHUD();refreshHUD();}
      break;
    }
    case 'advance-age':execute('advance_age',{buildingId:button.dataset.buildingId});break;
    case 'gate-toggle':{const building=world.getEntity(button.dataset.buildingId);execute('gate',{buildingId:building.id,open:!building.open});break;}
    case 'trade':execute('trade',{resource:button.dataset.resource,direction:button.dataset.direction,amount:Number($('#trade-amount').value)});break;
    case 'cast-fireball':case 'cast-heal':cancelTargeting();targetedSpell=action==='cast-heal'?'heal':'fireball';refreshPlacementHint();break;
    case 'convert':cancelTargeting();convertTarget=true;refreshPlacementHint();break;
    case 'zoom-in':renderer?.zoomAt(1.15);break;
    case 'zoom-out':renderer?.zoomAt(1/1.15);break;
    case 'center-selection':{const e=selectedEntities()[0]||world?.state.buildings.find(b=>b.team===1);if(e)renderer.centerOn(e.x,e.y);break;}
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  if(['start-match','choose-guild','choose-map','difficulty','trade-amount','roster-search','rename-submit'].includes(button.dataset.action))return;
  handleAction(button,event);
});
$('#modal-backdrop').addEventListener('click',closePanel);

function selectIdle(all=false){
  if(!world)return;
  const units=world.state.units.filter(u=>u.team===1&&u.kind==='villager'&&(!u.order||['idle','stop'].includes(u.order.type)));
  if(!units.length){announce(t('app.announce.allBusy'));return;}
  const unit=units.find(u=>!selectedIds.includes(u.id))||units[0];select(all?units.map(u=>u.id):[unit.id]);renderer.centerOn(unit.x,unit.y);
}
function contextOrder(clientX,clientY){
  if(!world)return;
  const entity=renderer.pick(clientX,clientY),position=renderer.screenToWorld(clientX,clientY),unitIds=ownUnits().map(u=>u.id),workers=selectedWorkers();
  if(!unitIds.length){const building=selectedProducer();if(building){const resource=entity&&(world.state.nodes.some(node=>node.id===entity.id)||entity.kind==='farm');execute('rally',{buildingId:building.id,...(resource?{targetId:entity.id}:{x:position.x,y:position.y})});}return;}
  if(entity&&entity.team&&entity.team!==1){execute('attack',{unitIds,targetId:entity.id});}
  else if(entity&&world.state.nodes.some(n=>n.id===entity.id)){
    const gatherers=ownUnits().filter(u=>UNITS[u.kind].gatherRate&&(entity.kind==='fish'?u.kind==='fishing_boat':u.kind!=='fishing_boat')).map(u=>u.id);
    if(gatherers.length)execute('gather',{unitIds:gatherers,targetId:entity.id});
    const escorts=ownUnits().filter(unit=>!gatherers.includes(unit.id));if(escorts.length)execute('move',{unitIds:escorts.map(unit=>unit.id),x:position.x,y:position.y,formation:formationFor(escorts)});
  }
  else if(entity&&entity.team===1&&BUILDINGS[entity.kind]&&workers.length&&(entity.hp<entity.maxHp||entity.progress<1)){execute('repair',{unitIds:workers,targetId:entity.id});}
  else if(entity&&entity.team===1&&entity.kind==='farm'&&workers.length){execute('gather',{unitIds:workers,targetId:entity.id});}
  else execute('move',{unitIds,x:position.x,y:position.y,attackMove,formation:formationFor()});
  cancelTargeting();
}
function bindWorldInputs(){
  const canvas=$('#world-canvas');
  canvas.addEventListener('contextmenu',event=>{event.preventDefault();if(placement||targetedSpell||convertTarget){cancelTargeting();return;}contextOrder(event.clientX,event.clientY);});
  canvas.addEventListener('pointerdown',event=>{
    if(!world||event.button===2)return;
    canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
    const p=renderer.screenToWorld(event.clientX,event.clientY);
    pointer={id:event.pointerId,button:event.button,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,worldX:Math.floor(p.x+.5),worldY:Math.floor(p.y+.5),dragged:false};
    if(event.button===1){event.preventDefault();canvas.style.cursor='grabbing';}
    if(placement&&['wall','palisade'].includes(placement.kind)){placement.x=pointer.worldX;placement.y=pointer.worldY;placement.endX=placement.x;placement.endY=placement.y;}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!world)return;const p=renderer.screenToWorld(event.clientX,event.clientY),rect=canvas.getBoundingClientRect();
    if(pointer){
      const dx=event.clientX-pointer.lastX,dy=event.clientY-pointer.lastY;
      if(Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>5)pointer.dragged=true;
      if(pointer.button===1){renderer.pan(dx,dy);}
      else if(placement&&['wall','palisade'].includes(placement.kind)){placement.endX=Math.floor(p.x+.5);placement.endY=Math.floor(p.y+.5);}
      else if(!placement&&!attackMove&&!targetedSpell&&!convertTarget&&pointer.dragged){dragRect={x:Math.min(pointer.startX,event.clientX)-rect.left,y:Math.min(pointer.startY,event.clientY)-rect.top,width:Math.abs(event.clientX-pointer.startX),height:Math.abs(event.clientY-pointer.startY)};}
      pointer.lastX=event.clientX;pointer.lastY=event.clientY;
    }
    if(placement){if(!pointer||!['wall','palisade'].includes(placement.kind)){placement.x=Math.floor(p.x+.5);placement.y=Math.floor(p.y+.5);}placement.visible=true;placement.valid=validPlacement();}
    else if(!pointer){hovered=renderer.pick(event.clientX,event.clientY);const tooltip=$('#world-tooltip');tooltip.hidden=!hovered;if(hovered){tooltip.style.left=`${Math.min(rect.width-190,event.clientX-rect.left+16)}px`;tooltip.style.top=`${Math.min(rect.height-60,event.clientY-rect.top+14)}px`;const def=UNITS[hovered.kind]||BUILDINGS[hovered.kind];tooltip.innerHTML=`${escapeHTML(def?entityName(hovered):isResourceKind(hovered.kind)?resourceName(hovered.kind):hovered.name||hovered.kind)}<small>${escapeHTML(def?`${t(hovered.team===1?'app.tooltip.own':'app.tooltip.rival')} · ${t('app.common.hp',{hp:number(hovered.hp)})}`:t('app.common.available',{amount:number(hovered.amount)}))}</small>`;}}
  });
  canvas.addEventListener('pointerup',event=>{
    if(!pointer||pointer.id!==event.pointerId)return;const start=pointer;pointer=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    if(start.button===1){canvas.style.cursor='default';return;}
    const p=renderer.screenToWorld(event.clientX,event.clientY),entity=renderer.pick(event.clientX,event.clientY);
    if(placement){const {kind,x,y}=placement;const result=['wall','palisade'].includes(kind)?execute('wall',{unitIds:selectedWorkers(),kind,x,y,endX:placement.endX??x,endY:placement.endY??y}):execute('build',{unitIds:selectedWorkers(),kind,x,y});if(result.ok&&!event.shiftKey)cancelTargeting();}
    else if(targetedSpell){execute('cast',{unitIds:ownUnits().filter(u=>UNITS[u.kind].spell===targetedSpell).map(u=>u.id),x:p.x,y:p.y,spell:targetedSpell});cancelTargeting();}
    else if(convertTarget){if(entity)execute('convert',{unitIds:ownUnits().filter(u=>u.kind==='wizard').map(u=>u.id),targetId:entity.id});else announce(t('app.announce.chooseConvertTarget'),true);cancelTargeting();}
    else if(attackMove){execute('move',{unitIds:ownUnits().map(u=>u.id),x:p.x,y:p.y,attackMove:true,formation:formationFor()});cancelTargeting();}
    else if(dragRect){
      const rect=canvas.getBoundingClientRect(),chosen=world.state.units.filter(u=>{if(u.team!==1||u.hp<=0)return false;const s=renderer.worldToScreen(u.x,u.y);return s.x-rect.left>=dragRect.x&&s.x-rect.left<=dragRect.x+dragRect.width&&s.y-rect.top>=dragRect.y&&s.y-rect.top<=dragRect.y+dragRect.height;}).map(u=>u.id);
      select(event.shiftKey?[...selectedIds,...chosen]:chosen);
    }else if(entity){select(event.shiftKey?(selectedIds.includes(entity.id)?selectedIds.filter(id=>id!==entity.id):[...selectedIds,entity.id]):[entity.id]);}
    else if(!event.shiftKey)select([]);
    dragRect=null;
  });
  canvas.addEventListener('pointercancel',()=>{pointer=null;dragRect=null;});
  canvas.addEventListener('pointerleave',()=>{hovered=null;$('#world-tooltip').hidden=true;});
  canvas.addEventListener('dblclick',event=>{
    const entity=renderer?.pick(event.clientX,event.clientY);if(!entity||!UNITS[entity.kind]||entity.team!==1)return;
    const rect=canvas.getBoundingClientRect();select(world.state.units.filter(u=>{const p=renderer.worldToScreen(u.x,u.y);return u.team===1&&u.kind===entity.kind&&p.x>=rect.left&&p.x<=rect.right&&p.y>=rect.top&&p.y<=rect.bottom;}).map(u=>u.id));
  });
  canvas.addEventListener('wheel',event=>{event.preventDefault();renderer?.zoomAt(Math.exp(-event.deltaY*.001),event.clientX,event.clientY);},{passive:false});
  $('#minimap').addEventListener('pointerdown',event=>{
    if(!world)return;const canvas=event.currentTarget,rect=canvas.getBoundingClientRect();renderer.centerOn((event.clientX-rect.left)/rect.width*world.state.map.width,(event.clientY-rect.top)/rect.height*world.state.map.height);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){cancelTargeting();closePanel();window.guildVoice?.close();return;}
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.target.isContentEditable)return;
    if(event.key.toLowerCase()==='v'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();if(!event.repeat)window.guildVoice?.toggle(event);return;}
    if(!world||menuVisible||currentPanel)return;
    const key=event.key.toLowerCase();
    if((event.ctrlKey||event.metaKey)&&key==='s'){event.preventDefault();save();return;}
    if(/^\d$/.test(key)&&key!=='0'){
      event.preventDefault();if(event.ctrlKey||event.metaKey){controlGroups.set(key,[...selectedIds]);announce(t(selectedIds.length===1?'app.announce.groupSaved.one':'app.announce.groupSaved.other',{group:key,count:selectedIds.length}));}else{select(controlGroups.get(key)||[]);if(event.repeat){const first=selectedEntities()[0];if(first)renderer.centerOn(first.x,first.y);}}return;
    }
    if(key===' '){event.preventDefault();if(!event.repeat){humanPauseGeneration++;execute('pause',{paused:!world.state.paused});}return;}
    if(key==='.'){selectIdle(event.shiftKey);return;}
    if(key==='b'){currentTab='economy';invalidateHUD();refreshHUD();const button=$('[data-action="build:house"]');button?.focus();return;}
    if(!event.altKey&&key==='a'&&!event.ctrlKey){handleAction($('[data-action="attack-move"]')||{dataset:{action:'attack-move'}},event);return;}
    if(!event.altKey&&key==='s'){if(!event.repeat&&ownUnits().length)execute('stop',{unitIds:ownUnits().map(u=>u.id)});cancelTargeting();return;}
    if(!event.altKey&&key==='d'){if(!event.repeat)execute('defend',{unitIds:ownUnits().map(u=>u.id)});cancelTargeting();return;}
    if(['arrowleft','arrowright','arrowup','arrowdown'].includes(key)||(event.altKey&&['w','a','s','d'].includes(key))){event.preventDefault();heldKeys.add(key);}
  });
  document.addEventListener('keyup',event=>heldKeys.delete(event.key.toLowerCase()));
  window.addEventListener('blur',()=>heldKeys.clear());
}

function frame(timestamp){
  const dt=lastFrame?Math.min(.25,(timestamp-lastFrame)/1000):0;lastFrame=timestamp;
  if(world&&!menuVisible){
    const begin=performance.now();
    accumulator+=dt;let iterations=0;
    while(accumulator>=.05&&iterations<5){const tickStart=performance.now();world.tick(.05);appStats.simulationSamples.push(performance.now()-tickStart);appStats.simulationSteps++;accumulator-=.05;iterations++;}
    if(appStats.simulationSamples.length>12000)appStats.simulationSamples.splice(0,6000);
    const speed=dt*400;if(heldKeys.has('arrowleft')||heldKeys.has('a'))renderer.pan(speed,0);if(heldKeys.has('arrowright')||heldKeys.has('d'))renderer.pan(-speed,0);if(heldKeys.has('arrowup')||heldKeys.has('w'))renderer.pan(0,speed);if(heldKeys.has('arrowdown')||heldKeys.has('s'))renderer.pan(0,-speed);
    const renderInput={revision:renderRevision,selectedIds,hoverId:hovered?.id,placement:placement?.visible?placement:null,dragRect};
    if(needsRender(world,renderer,renderInput)){renderer.render(renderInput);appStats.renderedFrames++;}
    else appStats.reusedFrames++;
    if(timestamp-lastHud>=200){refreshHUD();lastHud=timestamp;}
    if(timestamp-lastMinimap>=250){renderer.drawMinimap($('#minimap'));lastMinimap=timestamp;}
    appStats.frameSamples.push(performance.now()-begin);appStats.frameIntervals.push(dt*1000);
    if(appStats.frameSamples.length>24000){appStats.frameSamples.splice(0,12000);appStats.frameIntervals.splice(0,12000);}
  }
  requestAnimationFrame(frame);
}

const game = {
  get world(){return world;},get renderer(){return renderer;},get selectedIds(){return [...selectedIds];},get formation(){return formationFor();},get worldGeneration(){return worldGeneration;},get pauseGeneration(){return humanPauseGeneration;},get stats(){return appStats;},
  select,announce,newMatch,save,load,setPlacement,openPanel,execute,chooseFormation,
  view(action,args={}) {
    switch(action){
      case 'close-panel':closePanel();break;
      case 'tab':if(!['economy','military','defense','knowledge'].includes(args.tab))return appResult(false,'app.error.unknownTab');currentTab=args.tab;catalogSignature='';refreshHUD();break;
      case 'assign-group':if(!/^[1-9]$/.test(String(args.group)))return appResult(false,'app.error.invalidGroup');controlGroups.set(String(args.group),[...selectedIds]);break;
      case 'recall-group':select(controlGroups.get(String(args.group))||[]);break;
      case 'roster-search':if(currentPanel!=='roster')openPanel('roster');$('#roster-search').value=String(args.query||'');panelSignature='';updateRoster();break;
      case 'return-menu':returnMenu();break;
      case 'continue-world':$('#winner-dialog').close();break;
      case 'zoom-in':renderer?.zoomAt(1.15);break;
      case 'zoom-out':renderer?.zoomAt(1/1.15);break;
      case 'center-selection':{const entity=selectedEntities()[0];if(entity)renderer.centerOn(entity.x,entity.y);break;}
      default:return appResult(false,'app.error.unknownViewAction');
    }
    return {ok:true};
  },
  getState(){return world?{...world.summary(1),mapId:world.state.mapId,guildId:world.state.guildId,mode:world.state.mode,difficulty:world.state.difficulty,time:world.state.time,paused:world.state.paused,speed:world.state.speed,selectedIds:[...selectedIds],worldGeneration,winner:world.state.winner}:{worldGeneration,started:false};},
};
window.game=game;
installAudio(game);
mountLanguageSelects();applyDocumentLocale();
// Live language switch: re-label the menu in place and redraw every piece of text the HUD caches.
onLocaleChange(()=>{
  localizeMenu();
  if(!world)return;
  updateWorldCaption();
  invalidateHUD();catalogMarkup=null;
  if(!menuVisible){refreshHUD();refreshPlacementHint();}
  refreshOpenPanel();
  if(winnerShown)updateWinnerText();
});
buildMenu();bindWorldInputs();
import('./voice/index.js').then(({initializeVoice})=>initializeVoice(game)).catch(error=>announce(t('app.error.voiceUnavailable',{error:error.message}),true));
if(new URLSearchParams(location.search).get('play')==='1')newMatch({});
requestAnimationFrame(frame);
window.addEventListener('resize',()=>{if(menuVisible)drawMenuLandscape($('#menu-landscape'));});
