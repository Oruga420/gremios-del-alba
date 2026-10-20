import { World } from './game/world.js';
import { MAPS, GUILDS, UNITS, BUILDINGS, TECHNOLOGIES, AGE_NAMES, AGE_COSTS } from './game/data.js';
import { GameRenderer, drawMenuLandscape } from './game/renderer.js';
import { createRenderGate } from './game/render-gate.js';

const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const number = value => Math.floor(value || 0).toLocaleString('es-ES');
const costText = cost => Object.entries(cost || {}).filter(([,n])=>n).map(([key,value])=>`${number(value)} ${ {wood:'mad.',food:'alim.',gold:'oro',stone:'pied.'}[key] || key }`).join(' · ');
const names = {wood:'Madera',food:'Alimento',gold:'Oro',stone:'Piedra',fish:'Pesca'};
const orderNames = {idle:'Sin tarea',move:'En marcha',gather:'Recolectando',build:'Construyendo',repair:'Reparando',attack:'En combate',attack_move:'Avance ofensivo',defend:'Defendiendo',cast:'Canalizando',convert:'Convirtiendo',return:'Depositando',deposit:'Depositando'};
const queueName = item => item.type==='age'?`Era ${['','I','II','III','IV'][Number(item.kind)]}`:(UNITS[item.kind]?.name||TECHNOLOGIES[item.kind]?.name||TECHNOLOGIES[item.technologyId]?.name||'Orden');
const queueProgress = item => Math.max(0,Math.min(1,item.progress??1-(item.remaining||0)/(item.duration||1)));
const guildLabels = {alba:['Alba','Economía','star'],espina:['Espina','Bosque y sigilo','leaf'],bastion:['Bastión','Acero y honor','shield'],eclipse:['Eclipse','Saber y magia','moon']};
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
    const [label,specialty,emblem]=guildLabels[guild.id];
    return `<label class="guild-option" style="--guild-color:${guild.color}" title="${escapeHTML(guild.description)}"><input type="radio" name="guild" value="${guild.id}" ${index===0?'checked':''} data-action="choose-guild"><span class="guild-portrait"><img src="/assets/portraits/${guild.id}.png" alt="">${icon(emblem)}</span><strong>${label}</strong><small>${specialty}</small></label>`;
  }).join('');
  $('#map-options').innerHTML=MAPS.map((map,index)=>`<label class="map-option" style="--map-color:${map.color}" title="${escapeHTML(map.description)}"><input type="radio" name="map" value="${map.id}" ${index===0?'checked':''} data-action="choose-map"><canvas width="140" height="90" data-map-preview="${map.id}" aria-hidden="true"></canvas><span>${escapeHTML(map.name)}</span></label>`).join('');
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
function updateMapDescription(){const selected=document.querySelector('[name="map"]:checked');$('#map-description').textContent=MAPS.find(map=>map.id===selected?.value)?.description||MAPS[0].description;}

function newMatch(options={}) {
  const next = new World(options);
  installWorld(next);
  announce(`La crónica comienza en ${MAPS.find(map=>map.id===world.state.mapId)?.name||'estas tierras'}.`);
  return {ok:true,worldGeneration};
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
  $('#world-map-name').textContent=MAPS.find(map=>map.id===world.state.mapId)?.name||world.state.mapId;
  $('#world-mode').textContent=world.state.mode==='peaceful'?'CRÓNICA PACÍFICA · SIN NIEBLA':'CONQUISTA · MUNDO EXPLORADO';
  $('#map-size').textContent=`${world.state.map.width} × ${world.state.map.height}`;
  $('#winner-dialog').close();closePanel();invalidateHUD();refreshHUD();$('#world-canvas').focus({preventScroll:true});
  window.dispatchEvent(new CustomEvent('gremios:worldchange',{detail:{worldGeneration}}));
}
function execute(type,args={}) {
  if(!world)return {ok:false,message:'Comienza una partida primero.'};
  const result=world.command(type,args);
  if(result.message)announce(result.message,!result.ok);
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
function enough(cost){const resources=world?.summary(1)?.resources||{};return Object.entries(cost||{}).every(([key,amount])=>(resources[key]||0)>=amount);}
function focusEntity(id){const entity=world.getEntity(id);if(!entity)return;select([id]);renderer.centerOn(entity.x,entity.y);closePanel();}

function setPlacement(kind){
  if(!BUILDINGS[kind])return {ok:false,message:'Edificio desconocido.'};
  if(!selectedWorkers().length){announce('Selecciona uno o varios aldeanos para construir.',true);return {ok:false,message:'Selecciona aldeanos.'};}
  if(world.summary(1).age<BUILDINGS[kind].age){const message=`${BUILDINGS[kind].name} necesita la era ${['','I','II','III','IV'][BUILDINGS[kind].age]}.`;announce(message,true);return {ok:false,message};}
  if(!enough(BUILDINGS[kind].cost)){const message=`Faltan recursos para ${BUILDINGS[kind].name}. ${costText(BUILDINGS[kind].cost)}.`;announce(message,true);return {ok:false,message};}
  placement={kind,x:0,y:0,visible:false};attackMove=false;targetedSpell=null;convertTarget=false;
  $('#world-canvas').style.cursor='crosshair';refreshPlacementHint();invalidateHUD();refreshHUD();
  return {ok:true,message:`Elige el lugar para ${BUILDINGS[kind].name}.`};
}
function refreshPlacementHint(){
  const hint=$('#placement-hint');hint.hidden=!placement&&!attackMove&&!targetedSpell&&!convertTarget;
  if(placement)hint.innerHTML=`<b>${escapeHTML(BUILDINGS[placement.kind].name)}</b> · ${['wall','palisade'].includes(placement.kind)?'Arrastra para trazar una línea':'Haz clic para construir'} · Esc para cancelar`;
  else if(targetedSpell)hint.textContent=`${targetedSpell==='heal'?'Bendición sanadora':'Bola de fuego'} · Haz clic en el destino · Esc para cancelar`;
  else if(convertTarget)hint.textContent='Conversión · Haz clic en una unidad rival · Esc para cancelar';
  else if(attackMove)hint.textContent='Avance ofensivo · Haz clic en el destino · Esc para cancelar';
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
  $('#resources').innerHTML=['wood','food','gold','stone'].map(resource=>`<div class="resource" data-resource="${resource}" title="${names[resource]}">${icon(resource)}<strong>${number(summary.resources?.[resource])}</strong><small>${names[resource].toUpperCase()}</small></div>`).join('');
  $('#population').innerHTML=`${icon('people')}<strong>${number(summary.population)} / ${number(summary.capacity)}${summary.reservedPopulation?` <span class="reserved">+${summary.reservedPopulation}</span>`:''}</strong><small>HABITANTES · MÁX. 1.000</small>`;
  const age=summary.age||1;
  $('#age-label').textContent=`ERA ${['','I','II','III','IV'][age]} · ${(AGE_NAMES[age]||'Fundación').replace(/^Era (de |del |de las |de los )/,'').toUpperCase()}`;
  $('#idle-count').textContent=summary.idleVillagers||0;
  const seconds=Math.floor(world.state.time||0);$('#game-time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const pause=$('[data-action="pause"]');pause.innerHTML=icon(world.state.paused?'play':'pause');pause.setAttribute('aria-label',world.state.paused?'Continuar':'Pausar');
  $('[data-action="speed"]').textContent=`${world.state.speed||1}×`;$('#pause-banner').hidden=!world.state.paused;
  $('#zoom-level').textContent=`${Math.round(renderer.camera.zoom*100)}%`;
  selectedIds=selectedIds.filter(id=>world.getEntity(id)?.hp!==0&&world.getEntity(id));
  const entities=selectedEntities(),first=entities[0];
  const signature=JSON.stringify([selectedIds,entities.map(e=>[e.kind,e.team,e.progress<1,e.order?.type,e.name,e.queue?.map(queueKey),e.open]),summary.age]);
  if(signature!==selectionSignature){selectionSignature=signature;renderSelection(entities,summary);}
  updateSelectionProgress(entities);
  const catalogKey=JSON.stringify([selectedIds,currentTab,summary.age,summary.resources,world.state.teams?.[1]?.upgrades,first?.queue?.map(queueKey),first?.progress>=1,placement?.kind]);
  if(catalogKey!==catalogSignature){catalogSignature=catalogKey;renderCatalog(entities,summary);}
  $('#selection-orders').textContent=placement?`Construyendo: ${BUILDINGS[placement.kind].name}`:first?(UNITS[first.kind]?`${entities.length>1?`${entities.length} unidades · `:''}${orderNames[first.order?.type]||'Preparado'} · Clic derecho para ordenar`:BUILDINGS[first.kind]?`Punto de reunión: clic derecho en el terreno`:`${names[first.kind]||first.kind} · Clic derecho con aldeanos para recolectar`):'Selecciona un habitante para comenzar.';
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
  if(!entities.length){panel.innerHTML=`<div class="selection-empty"><div class="selection-crest">${icon('star')}</div><h3>Tu historia comienza aquí</h3><p>Selecciona un habitante o edificio.<br>Arrastra para reunir a tu gremio.</p></div>`;return;}
  const entity=entities[0],definition=UNITS[entity.kind]||BUILDINGS[entity.kind],isUnit=!!UNITS[entity.kind],own=entity.team===1;
  if(!definition){panel.innerHTML=`<div class="selection-empty"><div class="selection-crest">${icon(entity.kind==='fish'?'food':entity.kind)}</div><h3>${names[entity.kind]||entity.kind}</h3><p>${number(entity.amount)} disponibles<br>Una riqueza de estas tierras.</p></div>`;return;}
  const title=entities.length>1?`${entities.length} habitantes`:entity.name||definition.name;
  const order=isUnit?(orderNames[entity.order?.type]||'Preparado'):(entity.progress<1?'En construcción':own?'Edificio de tu gremio':'Edificio rival');
  panel.innerHTML=`<div class="selected-identity"><div class="entity-portrait">${portrait(entity)}</div><div class="selected-name"><small>${own?'TU GREMIO':'GREMIO RIVAL'} · ${isUnit?'HABITANTE':'EDIFICIO'}</small><h3 title="${escapeHTML(title)}">${escapeHTML(title)}</h3><span>${escapeHTML(entities.length>1?'Selección múltiple':definition.name)}</span>${isUnit&&own&&entities.length===1?`<br><button class="rename-mini" data-action="rename" data-unit-id="${entity.id}">Cambiar nombre</button>`:''}</div></div>
    <div class="health-row"><div class="health-track"><i style="width:${Math.max(0,entity.hp/entity.maxHp*100)}%"></i></div><span>${number(entity.hp)} / ${number(entity.maxHp)}</span></div>
    <div class="entity-stats"><span>${isUnit?'Ataque':'Estado'} <b>${isUnit?definition.attack||0:entity.progress<1?`${Math.round(entity.progress*100)}%`:'Listo'}</b></span><span>${isUnit?'Armadura':'Era'} <b>${isUnit?definition.armor||0:definition.age}</b></span>${isUnit?`<span>Alcance <b>${definition.range||1}</b></span>`:''}</div>
    ${own&&isUnit?`<div class="unit-orders"><button data-action="attack-move" title="Avance ofensivo (A)">${icon('sword')}Atacar</button><button data-action="stop" title="Detener (S)">${icon('pause')}Detener</button><button data-action="defend" title="Defender (D)">${icon('shield')}Defender</button></div>`:''}
    ${own&&!isUnit&&entity.kind==='gate'?`<div class="unit-orders"><button data-action="gate-toggle" data-building-id="${entity.id}">${icon('flag')}${entity.open?'Cerrar puerta':'Abrir puerta'}</button></div>`:''}
    ${entity.progress<1?`<div class="progress-label">Construcción · ${Math.round(entity.progress*100)}%</div>`:''}
    ${entity.queue?.length?`<div class="training-queue">${entity.queue.map((item,index)=>renderQueueItem(item,index,entity.id)).join('')}</div>`:''}
    ${entities.length>1?`<div class="selection-chips">${Object.entries(entities.reduce((out,e)=>{out[e.kind]=(out[e.kind]||0)+1;return out;},{})).map(([kind,count])=>`<span class="selection-chip">${count} ${escapeHTML(UNITS[kind]?.name||kind)}</span>`).join('')}</div>`:''}`;
}
function renderQueueItem(item,index,buildingId){
  const key=queueKey(item),label=queueName(item);
  displayedQueueEntries.set(key,item);
  return `<div class="queue-item" title="${escapeHTML(label)}"><span class="queue-name">${escapeHTML(label.split(' ').slice(0,2).join(' '))}</span><button type="button" data-action="cancel-train" data-building-id="${buildingId}" data-queue-index="${index}" data-queue-key="${key}" aria-label="Cancelar ${escapeHTML(label)}">×</button><i class="queue-progress" data-queue-key="${key}" style="width:${queueProgress(item)*100}%"></i></div>`;
}
function updateSelectionProgress(entities){
  const entity=entities[0],panel=$('#selection-panel');
  if(!entity||!(UNITS[entity.kind]||BUILDINGS[entity.kind]))return;
  const health=panel.querySelector('.health-track i'),healthText=panel.querySelector('.health-row>span');
  if(health)health.style.width=`${Math.max(0,entity.hp/entity.maxHp*100)}%`;
  if(healthText)healthText.textContent=`${number(entity.hp)} / ${number(entity.maxHp)}`;
  if(entity.progress<1){
    const progress=Math.round(entity.progress*100),state=panel.querySelector('.entity-stats span:first-child b'),label=panel.querySelector('.progress-label');
    if(state)state.textContent=`${progress}%`;
    if(label)label.textContent=`Construcción · ${progress}%`;
  }
  for(const bar of panel.querySelectorAll('.queue-progress')){
    const entry=displayedQueueEntries.get(bar.dataset.queueKey);
    if(entry)bar.style.width=`${queueProgress(entry)*100}%`;
  }
}

function actionCard({action,kind,label,cost,age,disabled=false,active=false,iconName='home',buildingId='',technologyId='',extra=''}){
  const type=UNITS[kind]?'units':'buildings',record=renderer.atlas[type]?.[kind];
  const thumb=record&&renderer.images.has(record.image)?spritePreview(record):icon(iconName);
  return `<button type="button" class="action-card${disabled?' locked':''}${active?' active':''}" data-action="${action}" data-kind="${kind||''}" data-building-id="${buildingId}" data-technology-id="${technologyId}" ${disabled?'aria-disabled="true"':''} title="${escapeHTML(`${label}${cost?` · ${costText(cost)}`:''}${age?` · Era ${age}`:''}${extra?` · ${extra}`:''}`)}"><span class="action-thumb">${thumb}</span><strong>${escapeHTML(label)}</strong><small>${escapeHTML(costText(cost)||extra||'')}</small>${age>1?`<span class="age-tag">${['','I','II','III','IV'][age]}</span>`:''}</button>`;
}
function renderCatalog(entities,summary){
  const own=entities.filter(e=>e.team===1),building=own.find(e=>BUILDINGS[e.kind]),unit=own.find(e=>UNITS[e.kind]);
  const workers=own.filter(e=>e.kind==='villager');
  const definitions=Object.entries(BUILDINGS).filter(([,def])=>categoryFor(def)===currentTab);
  let cards=[];
  if(building&&entities.length===1&&building.progress>=1){
    const definition=BUILDINGS[building.kind];
    for(const kind of definition.trains||[]){const def=UNITS[kind];cards.push(actionCard({action:`train:${kind}`,kind,label:def.name,cost:def.cost,age:def.age,disabled:summary.age<def.age||!enough(def.cost),buildingId:building.id,iconName:kind==='villager'?'hammer':'sword'}));}
    if(building.kind==='guildhall'&&summary.age<4){const cost=AGE_COSTS[summary.age+1];cards.push(actionCard({action:'advance-age',label:`Era ${['','I','II','III','IV'][summary.age+1]}`,cost,iconName:'star',buildingId:building.id,disabled:!enough(cost),extra:'Avanzar la crónica'}));}
    for(const technologyId of definition.technologies||[]){const def=TECHNOLOGIES[technologyId],done=world.state.teams[1].upgrades?.[technologyId];cards.push(actionCard({action:`research:${technologyId}`,label:def.name,cost:done?{}:def.cost,age:def.age,disabled:done||summary.age<def.age||!enough(def.cost),iconName:'book',buildingId:building.id,technologyId,extra:done?'Investigado':'Investigar'}));}
    if(building.kind==='market')cards.push(actionCard({action:'market',label:'Intercambiar',iconName:'coins',extra:'Comprar / vender'}));
    if(building.kind==='gate')cards.push(actionCard({action:'gate-toggle',label:building.open?'Cerrar puerta':'Abrir puerta',buildingId:building.id,iconName:'flag',extra:'Paso del gremio'}));
  }
  if(unit&&entities.some(e=>['mage','healer','wizard'].includes(e.kind))){
    if(own.some(e=>e.kind==='mage'))cards.push(actionCard({action:'cast-fireball',label:'Bola de fuego',iconName:'star',extra:'Elegir destino'}));
    if(own.some(e=>e.kind==='healer'))cards.push(actionCard({action:'cast-heal',label:'Sanación',iconName:'leaf',extra:'Elegir destino'}));
    if(own.some(e=>e.kind==='wizard'))cards.push(actionCard({action:'convert',label:'Conversión',iconName:'moon',extra:'Elegir rival'}));
  }
  // Construction catalog stays visible next to a producer's contextual actions.
  for(const [kind,definition] of definitions){cards.push(actionCard({action:`build:${kind}`,kind,label:definition.name,cost:definition.cost,age:definition.age,disabled:summary.age<definition.age||!enough(definition.cost),active:placement?.kind===kind,iconName:currentTab==='military'?'sword':currentTab==='defense'?'shield':currentTab==='knowledge'?'book':'home',extra:workers.length?'Construir':'Requiere aldeanos seleccionados'}));}
  const markup=cards.join('');
  if(markup!==catalogMarkup){$('#action-catalog').innerHTML=markup;catalogMarkup=markup;}
  document.querySelectorAll('[data-action="tab"]').forEach(button=>button.classList.toggle('active',button.dataset.tab===currentTab));
}

function openPanel(name){
  if(name==='voice'){window.guildVoice?.toggle();return;}
  currentPanel=name;panelSignature='';$('#modal-backdrop').hidden=false;$('#panel-drawer').hidden=false;
  const titles={help:'El arte de guiar',roster:'Los nombres de tu ciudad',market:'El mercado del gremio',research:'Conocimiento y eras',save:'Guardar la crónica',load:'Retomar una historia',new:'Un nuevo comienzo',rename:'Un nombre, una historia'};
  $('#panel-title').textContent=titles[name]||name;
  const content=$('#panel-content');
  if(name==='help')content.innerHTML=`<p class="panel-lead">Construye un hogar. Cuida a sus habitantes. Deja un legado.</p><p>Los aldeanos recogen y transportan recursos hasta un almacén. Construye casas para ampliar la capacidad, recluta unidades y lleva a tu gremio a través de cuatro eras.</p><h3>Las manos del estratega</h3>${[
    ['Clic izquierdo','Seleccionar una unidad, un edificio o un recurso.'],['Arrastrar','Seleccionar varios habitantes; Mayús añade a la selección.'],['Doble clic','Seleccionar unidades del mismo tipo en la vista.'],['Clic derecho','Mover, recolectar, reparar o atacar según el destino.'],['Rueda','Acercar o alejar el mundo alrededor del cursor.'],['Flechas / Alt + WASD','Desplazar la cámara. Arrastrar con botón central también funciona.'],['B / A / S / D','Construir, avance ofensivo, detener y defender.'],['. (punto)','Seleccionar un aldeano sin tarea.'],['Ctrl + 1…9','Guardar un grupo de control. 1…9 lo selecciona.'],['Espacio','Pausar o continuar la partida.'],['V','Abrir la voz del gremio.'],['Ctrl + S','Guardar la partida en este navegador y descargar el archivo.'],['Esc','Cancelar una orden, la voz o cerrar un panel.']
  ].map(([key,text])=>`<div class="help-row"><kbd>${key}</kbd><span>${text}</span></div>`).join('')}<h3>De la semilla al reino</h3><p>Selecciona aldeanos y un edificio de la barra inferior. Haz clic en un terreno libre para construir; para murallas y empalizadas, arrastra una línea. Con aldeanos seleccionados, el clic derecho sobre un edificio dañado repara sus heridas.</p><p>Selecciona la Casa del Gremio para reclutar aldeanos y avanzar de era. Los edificios militares reclutan sus propias unidades; la forja y las academias investigan. En el mercado puedes convertir el excedente en nuevos recursos.</p><h3>La voz de tu gremio</h3><p>Prueba “selecciona mis aldeanos” o “recoge madera”. Las órdenes con consecuencias piden confirmar y permiten decir “detente”. El estado de micrófono, voz y WebMCP se muestra por separado en su panel.</p>`;
  if(name==='roster'){
    content.innerHTML=`<p>Una ciudad está hecha de historias. Encuentra a un habitante, vuelve a él o dale un nombre propio.</p><input class="roster-search" id="roster-search" placeholder="Buscar por nombre o profesión…" aria-label="Buscar habitantes" data-action="roster-search"><div id="roster-summary" class="roster-summary"></div><div id="roster-list"></div>`;
    $('#roster-search').addEventListener('input',()=>{panelSignature='';updateRoster();});updateRoster();
  }
  if(name==='market'){
    content.innerHTML=`<p>El oro recorre los caminos del gremio. Compra recursos que escasean o vende lo que tus almacenes guardan.</p><label for="trade-amount">CANTIDAD POR INTERCAMBIO</label><select id="trade-amount" data-action="trade-amount"><option value="100">100 unidades</option><option value="50">50 unidades</option><option value="10">10 unidades</option></select><h3>Mercancías</h3><div class="trade-grid">${['wood','food','stone'].map(resource=>`<article class="trade-card">${icon(resource)}<h4>${names[resource]}</h4><small>El precio se valida al comerciar</small><div><button data-action="trade" data-resource="${resource}" data-direction="buy">Comprar</button><button data-action="trade" data-resource="${resource}" data-direction="sell">Vender</button></div></article>`).join('')}</div><p>Necesitas un mercado terminado de tu ciudad.</p>`;
  }
  if(name==='research'){
    const age=world?.summary(1).age||1,team=world?.state.teams[1];
    content.innerHTML=`<p>El conocimiento abre caminos que la fuerza no alcanza. Cada descubrimiento necesita su edificio y su era.</p>${Object.entries(TECHNOLOGIES).map(([id,def])=>{
      const producer=world?.state.buildings.find(b=>b.kind===def.producer&&b.team===1&&b.progress>=1),done=team?.upgrades?.[id];
      return `<article class="technology-row"><h4>${escapeHTML(def.name)}</h4><p>${escapeHTML(BUILDINGS[def.producer]?.name)} · Era ${def.age}${def.prerequisites.length?` · Requiere ${def.prerequisites.map(p=>TECHNOLOGIES[p].name).join(', ')}`:''}</p><footer><span>${done?'Conocimiento adquirido':costText(def.cost)}</span><button data-action="research:${id}" data-technology-id="${id}" data-building-id="${producer?.id||''}" ${!producer||done||age<def.age?'disabled':''}>${done?'Investigado':'Investigar'}</button></footer></article>`;
    }).join('')}`;
  }
  if(name==='save'){
    content.innerHTML=`<p class="panel-lead">Cada historia merece conservarse.</p><p>Tu partida se guarda en este navegador y se descarga como archivo JSON. El archivo conserva habitantes, recursos, construcciones y órdenes en curso.</p><button class="primary-button" data-action="save-now">${icon('save')}Guardar y descargar</button><p class="saved-notice">Las partidas viven en tu equipo.</p>`;
  }
  if(name==='load'){
    let saved=null;try{saved=JSON.parse(localStorage.getItem('gremios-save'));}catch{saved=null;}
    content.innerHTML=`<p class="panel-lead">Un mundo te está esperando.</p><p>Abre una crónica de tu equipo o continúa la última guardada en este navegador.</p>${saved?`<article class="technology-row"><h4>${escapeHTML(MAPS.find(m=>m.id===saved.mapId)?.name||saved.mapId||'Última crónica')}</h4><p>Archivo local de este navegador</p><button class="primary-button" data-action="load-local">Continuar crónica</button></article>`:''}<button class="primary-button" data-action="load-file">${icon('load')}Elegir archivo de partida</button><p>Los archivos se validan antes de reemplazar tu mundo.</p>`;
  }
  if(name==='new')content.innerHTML=`<p class="panel-lead">Una tierra nueva aguarda al otro lado del camino.</p><p>Guarda esta crónica si deseas volver. Podrás elegir otro gremio, región y desafío.</p><button class="primary-button" data-action="save-now">${icon('save')}Guardar la crónica actual</button><button class="primary-button" data-action="return-menu">Elegir una nueva historia${icon('arrow')}</button>`;
  $('#panel-drawer .icon-button').focus({preventScroll:true});
}
function closePanel(){currentPanel=null;$('#panel-drawer').hidden=true;$('#modal-backdrop').hidden=true;}
function updateRoster(){
  if(!world||!$('#roster-list'))return;
  const query=($('#roster-search').value||'').toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'');
  const units=world.state.units.filter(u=>u.team===1&&u.hp>0),signature=JSON.stringify([query,units.map(u=>[u.id,u.name,Math.round(u.hp),u.order?.type])]);
  if(signature===panelSignature)return;panelSignature=signature;
  const summary=world.summary(1);$('#roster-summary').innerHTML=`<span><b>${summary.population}</b> habitantes</span><span><b>${summary.villagers}</b> aldeanos</span><span><b>${summary.military}</b> militares</span>`;
  const filtered=units.filter(u=>`${u.name} ${UNITS[u.kind]?.name}`.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'').includes(query));
  $('#roster-list').innerHTML=filtered.slice(0,200).map(u=>`<div class="roster-row"><i class="unit-dot"></i><button data-action="select-entity" data-unit-id="${u.id}">${escapeHTML(u.name)}<small>${escapeHTML(UNITS[u.kind]?.name)} · ${orderNames[u.order?.type]||'Preparado'}</small></button><span class="roster-hp">${Math.round(u.hp)} PV</span><button class="text-button" data-action="rename" data-unit-id="${u.id}">Renombrar</button></div>`).join('')+(filtered.length>200?'<p>Refina la búsqueda para encontrar otros habitantes.</p>':'');
}
function renamePanel(unitId){
  const entity=world?.getEntity(unitId);if(!entity||entity.team!==1||!UNITS[entity.kind])return;
  openPanel('rename');$('#panel-content').innerHTML=`<p>Los nombres acompañan a tus habitantes en el mundo y en tus órdenes de voz.</p><form id="rename-form"><label for="rename-input">NOMBRE DE ${escapeHTML(UNITS[entity.kind].name.toUpperCase())}</label><input id="rename-input" maxlength="40" required value="${escapeHTML(entity.name)}" data-unit-id="${unitId}" autocomplete="off"><div id="rename-error" class="form-error" role="status"></div><button class="primary-button" type="submit" data-action="rename-submit">Guardar nombre${icon('arrow')}</button></form>`;
  $('#rename-form').addEventListener('submit',event=>{event.preventDefault();const result=execute('rename',{unitId,name:$('#rename-input').value});if(result.ok)closePanel();else $('#rename-error').textContent=result.message;});
  $('#rename-input').focus();$('#rename-input').select();
}

function save(){
  if(!world)return {ok:false,message:'No hay una partida que guardar.'};
  const snapshot=world.serialize();const json=JSON.stringify(snapshot);
  try{localStorage.setItem('gremios-save',json);}catch{announce('El navegador no pudo conservar una copia local; el archivo sí se descargará.',true);}
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`gremios-${world.state.mapId}-${new Date().toISOString().slice(0,10)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  announce('Crónica guardada. Tu mundo te esperará.');return {ok:true,message:'Partida guardada.'};
}
function load(serialized){
  if(serialized===undefined){openPanel('load');return {ok:true,message:'Elige una partida guardada.'};}
  try{const next=World.fromSave(typeof serialized==='string'?JSON.parse(serialized):serialized);installWorld(next);announce('La crónica continúa.');return {ok:true,worldGeneration};}
  catch(error){const message=`No se pudo cargar la partida: ${error.message}`;announce(message,true);return {ok:false,message};}
}
$('#load-file').addEventListener('change',async event=>{
  const input=event.currentTarget,file=input.files?.[0];if(!file)return;
  if(file.size>25_000_000){announce('Este archivo de partida es demasiado grande.',true);input.value='';return;}
  const generation=worldGeneration;try{const text=await file.text();if(generation!==worldGeneration){announce('La carga se canceló porque cambió la partida.',true);return;}load(text);}catch{announce('No se pudo leer el archivo.',true);}finally{input.value='';}
});
function showWinner(){
  winnerShown=true;const won=world.state.winner===1||world.state.winner==='player';
  $('#winner-title').textContent=won?'El alba es tuya.':'Hasta la próxima aurora.';
  $('#winner-description').textContent=won?'Tu gremio ha unido estas tierras bajo una nueva historia. Los habitantes recordarán este día.':'Tu ciudad cayó, pero el legado de sus habitantes vive. Otra tierra espera una nueva oportunidad.';
  $('#winner-dialog').showModal();
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
    case 'roster':if(world)openPanel('roster');else announce('Comienza una partida para conocer a sus habitantes.');break;
    case 'market':openPanel('market');break;
    case 'research':openPanel('research');break;
    case 'save':openPanel('save');break;
    case 'save-now':save();break;
    case 'load':openPanel('load');break;
    case 'load-file':$('#load-file').click();break;
    case 'load-local':try{load(JSON.parse(localStorage.getItem('gremios-save')));}catch{announce('La copia local no es válida.',true);}break;
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
    case 'attack-move':if(ownUnits().length){cancelTargeting();attackMove=true;refreshPlacementHint();$('#world-canvas').style.cursor='crosshair';}else announce('Selecciona unidades para dar esta orden.',true);break;
    case 'select-idle':selectIdle(event.shiftKey);break;
    case 'select-entity':focusEntity(button.dataset.unitId);break;
    case 'rename':renamePanel(button.dataset.unitId||selectedIds[0]);break;
    case 'cancel-train':{
      const buildingId=button.dataset.buildingId,queueIndex=Number(button.dataset.queueIndex),entry=displayedQueueEntries.get(button.dataset.queueKey);
      if(entry&&world.getEntity(buildingId)?.queue[queueIndex]===entry)execute('cancel_train',{buildingId,queueIndex});
      else{announce('Esa orden ya terminó o cambió de posición.');invalidateHUD();refreshHUD();}
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
  if(!units.length){announce('Todos tus aldeanos tienen una tarea.');return;}
  const unit=units.find(u=>!selectedIds.includes(u.id))||units[0];select(all?units.map(u=>u.id):[unit.id]);renderer.centerOn(unit.x,unit.y);
}
function contextOrder(clientX,clientY){
  if(!world)return;
  const entity=renderer.pick(clientX,clientY),position=renderer.screenToWorld(clientX,clientY),unitIds=ownUnits().map(u=>u.id),workers=selectedWorkers();
  if(!unitIds.length){const building=selectedProducer();if(building)execute('rally',{buildingId:building.id,x:position.x,y:position.y});return;}
  if(entity&&entity.team&&entity.team!==1){execute('attack',{unitIds,targetId:entity.id});}
  else if(entity&&world.state.nodes.some(n=>n.id===entity.id)){
    const gatherers=ownUnits().filter(u=>UNITS[u.kind].gatherRate&&(entity.kind==='fish'?u.kind==='fishing_boat':u.kind!=='fishing_boat')).map(u=>u.id);
    if(gatherers.length)execute('gather',{unitIds:gatherers,targetId:entity.id});
    const escorts=unitIds.filter(id=>!gatherers.includes(id));if(escorts.length)execute('move',{unitIds:escorts,x:position.x,y:position.y});
  }
  else if(entity&&entity.team===1&&BUILDINGS[entity.kind]&&workers.length&&(entity.hp<entity.maxHp||entity.progress<1)){execute('repair',{unitIds:workers,targetId:entity.id});}
  else if(entity&&entity.team===1&&entity.kind==='farm'&&workers.length){execute('gather',{unitIds:workers,targetId:entity.id});}
  else execute('move',{unitIds,x:position.x,y:position.y,attackMove});
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
    else if(!pointer){hovered=renderer.pick(event.clientX,event.clientY);const tooltip=$('#world-tooltip');tooltip.hidden=!hovered;if(hovered){tooltip.style.left=`${Math.min(rect.width-190,event.clientX-rect.left+16)}px`;tooltip.style.top=`${Math.min(rect.height-60,event.clientY-rect.top+14)}px`;const def=UNITS[hovered.kind]||BUILDINGS[hovered.kind];tooltip.innerHTML=`${escapeHTML(hovered.name||def?.name||names[hovered.kind]||hovered.kind)}<small>${def?`${hovered.team===1?'Tu gremio':'Gremio rival'} · ${number(hovered.hp)} PV`:`${number(hovered.amount)} disponibles`}</small>`;}}
  });
  canvas.addEventListener('pointerup',event=>{
    if(!pointer||pointer.id!==event.pointerId)return;const start=pointer;pointer=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    if(start.button===1){canvas.style.cursor='default';return;}
    const p=renderer.screenToWorld(event.clientX,event.clientY),entity=renderer.pick(event.clientX,event.clientY);
    if(placement){const {kind,x,y}=placement;const result=['wall','palisade'].includes(kind)?execute('wall',{unitIds:selectedWorkers(),kind,x,y,endX:placement.endX??x,endY:placement.endY??y}):execute('build',{unitIds:selectedWorkers(),kind,x,y});if(result.ok&&!event.shiftKey)cancelTargeting();}
    else if(targetedSpell){execute('cast',{unitIds:ownUnits().filter(u=>UNITS[u.kind].spell===targetedSpell).map(u=>u.id),x:p.x,y:p.y,spell:targetedSpell});cancelTargeting();}
    else if(convertTarget){if(entity)execute('convert',{unitIds:ownUnits().filter(u=>u.kind==='wizard').map(u=>u.id),targetId:entity.id});else announce('Elige una unidad rival para convertir.',true);cancelTargeting();}
    else if(attackMove){execute('move',{unitIds:ownUnits().map(u=>u.id),x:p.x,y:p.y,attackMove:true});cancelTargeting();}
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
      event.preventDefault();if(event.ctrlKey||event.metaKey){controlGroups.set(key,[...selectedIds]);announce(`Grupo ${key} guardado: ${selectedIds.length} habitantes.`);}else{select(controlGroups.get(key)||[]);if(event.repeat){const first=selectedEntities()[0];if(first)renderer.centerOn(first.x,first.y);}}return;
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
  get world(){return world;},get renderer(){return renderer;},get selectedIds(){return [...selectedIds];},get worldGeneration(){return worldGeneration;},get pauseGeneration(){return humanPauseGeneration;},get stats(){return appStats;},
  select,announce,newMatch,save,load,setPlacement,openPanel,execute,
  view(action,args={}) {
    switch(action){
      case 'close-panel':closePanel();break;
      case 'tab':if(!['economy','military','defense','knowledge'].includes(args.tab))return {ok:false,message:'Categoría desconocida.'};currentTab=args.tab;catalogSignature='';refreshHUD();break;
      case 'assign-group':if(!/^[1-9]$/.test(String(args.group)))return {ok:false,message:'Grupo no válido.'};controlGroups.set(String(args.group),[...selectedIds]);break;
      case 'recall-group':select(controlGroups.get(String(args.group))||[]);break;
      case 'roster-search':if(currentPanel!=='roster')openPanel('roster');$('#roster-search').value=String(args.query||'');panelSignature='';updateRoster();break;
      case 'return-menu':returnMenu();break;
      case 'continue-world':$('#winner-dialog').close();break;
      case 'zoom-in':renderer?.zoomAt(1.15);break;
      case 'zoom-out':renderer?.zoomAt(1/1.15);break;
      case 'center-selection':{const entity=selectedEntities()[0];if(entity)renderer.centerOn(entity.x,entity.y);break;}
      default:return {ok:false,message:'Acción de vista desconocida.'};
    }
    return {ok:true};
  },
  getState(){return world?{...world.summary(1),mapId:world.state.mapId,guildId:world.state.guildId,mode:world.state.mode,difficulty:world.state.difficulty,time:world.state.time,paused:world.state.paused,speed:world.state.speed,selectedIds:[...selectedIds],worldGeneration,winner:world.state.winner}:{worldGeneration,started:false};},
};
window.game=game;
buildMenu();bindWorldInputs();
import('./voice/index.js').then(({initializeVoice})=>initializeVoice(game)).catch(error=>announce(`La voz aún no está disponible: ${error.message}`,true));
if(new URLSearchParams(location.search).get('play')==='1')newMatch({});
requestAnimationFrame(frame);
window.addEventListener('resize',()=>{if(menuVisible)drawMenuLandscape($('#menu-landscape'));});
