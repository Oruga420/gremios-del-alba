import { MAPS, GUILDS, UNITS, BUILDINGS, TECHNOLOGIES, TERRAIN, AGE_COSTS } from './data.js';
import { Navigation, SpatialIndex } from './navigation.js';

const RESOURCE_KEYS = ['wood','food','gold','stone'];
const ORDER_TYPES = new Set(['idle','move','gather','build','repair','attack','defend','convert']);
export const NAVIGATION_HISTORY_LIMIT = 6000;
const NAMES = ['Luna','Alina','Teo','Mara','Nico','Iris','Sol','Gael','Noa','Elia','Leo','Ada','Ciro','Uma','Vera','Río','Dalia','Bruno','Lía','Enzo','Nara','Olmo','Ariel','Sira','Elio','Inés','Aina','Ren','Aster','Yuna','Kai','Flora'];
const norm = value => value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('es');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const copy = object => JSON.parse(JSON.stringify(object));
const sumCost = (price, quantity=1) => Object.fromEntries(RESOURCE_KEYS.map(key=>[key,(price[key]||0)*quantity]));
const fail = message => ({ok:false,message});
const done = (message, data={}) => ({ok:true,message,...data});
const definition = (catalog,id) => typeof id==='string'&&Object.hasOwn(catalog,id)?catalog[id]:undefined;

function makeMap(definition, seed) {
  const width=80,height=80,terrain=Array(width*height).fill(TERRAIN.GRASS),heights=Array(width*height).fill(0);
  const topology=definition.topology;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let t=TERRAIN.GRASS;const dx=x-39.5,dy=y-39.5;
    if(topology==='lake'&&dx*dx+dy*dy<110)t=TERRAIN.WATER;
    if(topology==='forest-pass'&&x>=32&&x<=34&&y>18&&y<65&&!((y>=25&&y<=29)||(y>=43&&y<=46)))t=TERRAIN.CLIFF;
    if(topology==='coast'&&x>=46&&y<=51&&!(y>=35&&x<54))t=TERRAIN.WATER;
    if(topology==='islands'&&((x>=37&&x<=42)||(y>=37&&y<=42)))t=TERRAIN.WATER;
    if(topology==='islands'&&((y>=24&&y<=26&&x>=36&&x<=43)||(y>=54&&y<=56&&x>=36&&x<=43)||(x>=24&&x<=26&&y>=36&&y<=43)||(x>=54&&x<=56&&y>=36&&y<=43)))t=TERRAIN.BRIDGE;
    if(topology==='mountain'&&Math.abs(x-y)<4&&x>22&&x<58&&!((x>=29&&x<=33)||(x>=47&&x<=51)))t=TERRAIN.CLIFF;
    if(topology==='canyon'){t=TERRAIN.SAND;if(((x>=30&&x<=32&&y>=20&&y<=57)||(x>=47&&x<=49&&y>=22&&y<=59))&&!((y>=26&&y<=29)||(y>=49&&y<=52)))t=TERRAIN.CLIFF;}
    if(topology==='marsh'){t=TERRAIN.MARSH;if((x===29||x===30||x===46||x===47)&&y>17&&y<65)t=TERRAIN.WATER;if(((x>=29&&x<=30)&&(y===25||y===55))||((x>=46&&x<=47)&&(y===34||y===61)))t=TERRAIN.BRIDGE;}
    if(topology==='plains'&&(((x-28)**2+(y-48)**2<50)||((x-53)**2+(y-29)**2<50)))t=TERRAIN.WATER;
    const r=Math.hypot(dx,dy);
    if(topology==='caldera'&&r>17&&r<20&&Math.abs(dx)>3&&Math.abs(dy)>3)t=TERRAIN.CLIFF;
    if(topology==='caldera'&&r<7)t=TERRAIN.WATER;
    const riverX=39+Math.round(Math.sin(y/9)*8);
    if(topology==='river'&&Math.abs(x-riverX)<=2)t=TERRAIN.WATER;
    if(topology==='river'&&[24,40,56].some(py=>Math.abs(y-py)<=1)&&Math.abs(x-riverX)<=3)t=TERRAIN.BRIDGE;
    if(topology==='mountain'&&t===TERRAIN.GRASS)t=TERRAIN.SNOW;
    if((x<=22&&y<=23)||(x>=57&&y>=56))t=topology==='mountain'?TERRAIN.SNOW:TERRAIN.GRASS;
    if((x>=24&&x<=29&&y>=8&&y<=19)||(x>=50&&x<=55&&y>=60&&y<=71))t=TERRAIN.WATER;
    if(t===TERRAIN.GRASS&&((x*19+y*31+seed)%47)<3)t=TERRAIN.FOREST;
    terrain[y*width+x]=t;heights[y*width+x]=t===TERRAIN.CLIFF?1:0;
  }
  return {width,height,terrain,heights,fullyDiscovered:true,topology};
}

/** Deterministic DOM-free authoritative simulation. Public commands always control team 1. */
export class World {
  constructor({mapId='valle-del-alba',guildId='alba',difficulty='normal',mode='conquest',seed=20261013}={}) {
    const map=MAPS.find(m=>m.id===mapId),guild=GUILDS.find(g=>g.id===guildId);
    if(!map||!guild||!['easy','normal','hard'].includes(difficulty)||!['conquest','peaceful'].includes(mode)||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Opciones de partida inválidas');
    this.state={version:1,mapId,guildId,difficulty,mode,seed,rngState:seed||1,nextId:1,nameCursor:0,time:0,paused:false,pauseRevision:0,speed:1,map:makeMap(map,seed),teams:{},units:[],buildings:[],nodes:[],projectiles:[],effects:[],events:[],winner:null,aiClock:0,navigation:[],metrics:{gatherCycles:0,gathered:0,constructionProgress:0,constructionCompleted:0,movementArrivals:0,damagingHits:0,projectiles:0,healingEvents:0,conversions:0,trained:0,aiGatherOrders:0,aiBuildOrders:0,aiAttackOrders:0,participants:{economy:[],builders:[],military:[]}}};
    this._indexes();this.navigation=new Navigation(this);this.spatial=new SpatialIndex();this._sets={economy:new Set(),builders:new Set(),military:new Set()};
    for(const team of [1,2]){const g=team===1?guild:GUILDS[(GUILDS.indexOf(guild)+2)%4];this.state.teams[team]={name:team===1?'Tu ciudad':'Gremio rival',guildId:g.id,color:g.color,resources:{wood:650,food:600,gold:350,stone:400},age:1,upgrades:{}};this._town(team);}
    this.navigation.rebuild();this._indexes();
    for(const team of [1,2]){const home=this.state.buildings.find(b=>b.team===team&&b.kind==='guildhall');for(let i=0;i<12;i++)this._spawn('villager',team,home.x+4+(i%4),home.y+4+Math.floor(i/4));for(const kind of ['infantry','archer','scout','healer','heavy_knight','mage'])this._spawn(kind,team,home.x+5+(this.state.units.length%4),home.y+8);}
    this._indexes();this._event('Tu gremio despierta. Reúne recursos, construye y protege el Alba.');
  }
  // Presentation journal is deliberately outside serialized deterministic state.
  _combatEvent(kind,source,target,amount=0){
    this.combatEvents ||= Array(512);
    this.combatSequence=(this.combatSequence||0)+1;
    const snapshot=e=>e?{id:e.id,kind:e.kind,team:e.team,x:e.x,y:e.y,hp:e.hp}:null;
    this.combatEvents[(this.combatSequence-1)%512]={seq:this.combatSequence,time:this.state.time,kind,source:snapshot(source),target:snapshot(target),amount};
  }
  _random(){let x=this.state.rngState;x^=x<<13;x^=x>>>17;x^=x<<5;this.state.rngState=x>>>0;return (x>>>0)/4294967296;}
  _id(prefix){return `${prefix}${this.state.nextId++}`;}
  _name(){let name;do{const n=this.state.nameCursor++;name=`${NAMES[n%NAMES.length]}${n>=NAMES.length?' '+(Math.floor(n/NAMES.length)+1):''}`;}while(this.state.units.some(u=>norm(u.name)===norm(name)));return name;}
  _event(text,kind='info'){this.state.events.push({time:this.state.time,text,kind});if(this.state.events.length>100)this.state.events.shift();}
  _indexes(){this.entities=new Map([...this.state.units,...this.state.buildings,...this.state.nodes].map(e=>[e.id,e]));}
  _participant(category,id){if(!this._sets[category].has(id)){this._sets[category].add(id);this.state.metrics.participants[category].push(id);}}
  _town(team){const mirror=(x,y,size=1)=>team===1?{x,y}:{x:80-x-size,y:80-y-size};
    for(const[kind,x,y]of [['guildhall',8,8],['house',3,5],['house',3,8],['house',3,11],['barracks',14,5],['archery',18,5],['stable',14,9],['lumber_camp',7,16],['mill',10,16],['mining_camp',14,16],['dock',23,9]]){const p=mirror(x,y,BUILDINGS[kind].size);this._building(kind,team,p.x,p.y,1);}
    for(const[kind,x,y]of [['wood',19,15],['food',11,21],['gold',16,21],['stone',20,21],['fish',26,15]]){const p=mirror(x,y);this._node(kind,p.x+.5,p.y+.5,kind==='fish'?4000:6000);}
    for(let i=0;i<5;i++){const p=mirror(4+i*3,24);if(this.state.map.terrain[Math.floor(p.y)*80+Math.floor(p.x)]!==TERRAIN.WATER)this._node('wood',p.x+.5,p.y+.5,1800);}
  }
  _node(kind,x,y,amount,extra={}){const node={id:this._id('n'),kind,x,y,amount,maxAmount:amount,...extra};this.state.nodes.push(node);this.entities.set(node.id,node);return node;}
  _building(kind,team,x,y,progress=0){this._stepDropoffs?.clear();const d=BUILDINGS[kind],b={id:this._id('b'),kind,team,name:d.name,x,y,hp:progress===1?d.hp:Math.max(1,d.hp*.1),maxHp:d.hp,progress,queue:[],rally:{x:Math.min(79.5,x+d.size+.5),y:Math.min(79.5,y+d.size+.5)},cooldown:0,open:false};this.state.buildings.push(b);this.entities.set(b.id,b);if(progress===1&&d.farmFood)this._node('food',x+d.size/2,y+d.size/2,d.farmFood,{buildingId:b.id,team});return b;}
  _spawn(kind,team,x,y){const d=UNITS[kind],p=this.navigation.nearest(x,y,d.movement,20);if(!p)return null;const u={id:this._id('u'),kind,team,name:this._name(),x:p.x,y:p.y,hp:d.hp,maxHp:d.hp,order:{type:'idle'},carry:{kind:null,amount:0},cooldown:0,mana:d.mana||0,convertCooldown:0,scanCooldown:0,waypoint:null,navKey:null,navigationIndex:null};this.state.units.push(u);this.entities.set(u.id,u);return u;}
  getEntity(id){return this.entities.get(id);}
  summary(team=1){const t=this.state.teams[team];if(!t)return null;let population=0,reservedPopulation=0,capacity=0,villagers=0,idleVillagers=0,military=0;for(const u of this.state.units)if(u.team===team&&u.hp>0){population++;if(u.kind==='villager'||u.kind==='fishing_boat'){villagers++;if(u.order.type==='idle')idleVillagers++;}else military++;}for(const b of this.state.buildings)if(b.team===team&&b.hp>0){if(b.progress===1)capacity+=BUILDINGS[b.kind].capacity||0;for(const q of b.queue)if(q.type==='train')reservedPopulation++;}return {resources:{...t.resources},population,reservedPopulation,capacity:Math.min(1000,capacity),maxPopulation:1000,age:t.age,idleVillagers,military,villagers,upgrades:{...t.upgrades},name:t.name};}
  _afford(team,price){return RESOURCE_KEYS.every(k=>this.state.teams[team].resources[k]+1e-8>=(price[k]||0));}
  _spend(team,price,sign=-1){for(const k of RESOURCE_KEYS)this.state.teams[team].resources[k]+=(price[k]||0)*sign;}
  _position(x,y){return finite(x)&&finite(y)&&x>=0&&y>=0&&x<80&&y<80;}
  _ownedUnits(ids,team){return Array.isArray(ids)&&ids.length>0&&ids.length<=1000&&new Set(ids).size===ids.length&&ids.every(id=>{const e=this.getEntity(id);return e&&UNITS[e.kind]&&e.team===team&&e.hp>0;});}
  _ownedBuilding(id,team){const b=this.getEntity(id);return b&&BUILDINGS[b.kind]&&b.team===team&&b.hp>0?b:null;}
  _plot(kind,x,y,extra=[]){const d=definition(BUILDINGS,kind);if(!d||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x+d.size>80||y+d.size>80)return false;let land=0,water=0;for(let yy=y;yy<y+d.size;yy++)for(let xx=x;xx<x+d.size;xx++){const t=this.state.map.terrain[yy*80+xx];if(t===TERRAIN.CLIFF)return false;if(t===TERRAIN.WATER)water++;else land++;}if(d.placement==='shore'?!land||!water:water)return false;
    if([...this.state.buildings,...extra].some(b=>b.hp>0&&x<b.x+BUILDINGS[b.kind].size&&x+d.size>b.x&&y<b.y+BUILDINGS[b.kind].size&&y+d.size>b.y))return false;
    if(this.state.nodes.some(n=>!n.buildingId&&n.amount>0&&n.x>=x&&n.x<x+d.size&&n.y>=y&&n.y<y+d.size))return false;
    if(this.state.units.some(u=>u.hp>0&&u.x>=x&&u.x<x+d.size&&u.y>=y&&u.y<y+d.size))return false;return true;}
  canPlace(kind,x,y){return this._plot(kind,x,y);}
  command(type,args={}){return this._command(type,args,1);}
  _command(type,args={},team=1){
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.prototype.hasOwnProperty.call(args,'team'))return fail('Argumentos inválidos');
    const t=this.state.teams[team];if(!t)return fail('Ciudad inválida');
    if(['move','gather','build','wall','repair','attack','stop','defend','cast','convert'].includes(type)&&!this._ownedUnits(args.unitIds,team))return fail('Selecciona unidades propias válidas');
    const units=Array.isArray(args.unitIds)?args.unitIds.map(id=>this.getEntity(id)):[];
    if(type==='pause'){if(typeof args.paused!=='boolean')return fail('Pausa inválida');this.state.paused=args.paused;this.state.pauseRevision++;return done(args.paused?'Partida pausada':'Partida reanudada');}
    if(type==='speed'){if(![.5,1,2].includes(args.speed))return fail('Velocidad inválida');this.state.speed=args.speed;return done('Velocidad actualizada');}
    if(type==='rename'){const u=this.getEntity(args.unitId);if(!u||!UNITS[u.kind]||u.team!==team||typeof args.name!=='string')return fail('Aldeano o nombre inválido');const name=args.name.normalize('NFKC').trim().replace(/\s+/gu,' ');if(!name||name.length>48||/[\u0000-\u001f\u007f]/u.test(name)||this.state.units.some(e=>e.id!==u.id&&norm(e.name)===norm(name)))return fail('El nombre debe ser único y tener 1–48 caracteres');u.name=name;return done(`${name} está listo`);}
    if(type==='move'){if(!this._position(args.x,args.y)||('attackMove'in args&&typeof args.attackMove!=='boolean'))return fail('Destino inválido');for(const u of units){this._order(u,{type:'move',x:args.x,y:args.y,attackMove:!!args.attackMove});this._recordNavigation(u,args.x,args.y);}return done('En marcha',{unitIds:args.unitIds});}
    if(type==='stop'||type==='defend'){let target=null;if(type==='defend'&&args.targetId){target=this.getEntity(args.targetId);if(!target||target.team!==team||target.hp<=0)return fail('Ancla defensiva inválida');}if(type==='defend'&&('x'in args||'y'in args)&&!this._position(args.x,args.y))return fail('Destino defensivo inválido');for(const u of units){const x=target?.x??args.x??u.x,y=target?.y??args.y??u.y;this._order(u,{type:type==='stop'?'idle':'defend',x,y});if(type==='defend'&&(target||'x'in args))this._recordNavigation(u,x,y);}return done(type==='stop'?'Unidades detenidas':'Posición defendida');}
    if(type==='gather'){let node=this.getEntity(args.targetId);if(node?.kind==='farm')node=this.state.nodes.find(n=>n.buildingId===node.id&&n.amount>0);if(!node&&typeof args.resource==='string')node=this.state.nodes.filter(n=>n.kind===args.resource&&n.amount>0).sort((a,b)=>distance(a,units[0])-distance(b,units[0]))[0];if(!node||!this.state.nodes.includes(node)||node.amount<=0||units.some(u=>!(UNITS[u.kind].gatherRate)||(u.kind==='fishing_boat'?(node.kind!=='fish'):node.kind==='fish')))return fail('Recurso o recolectores inválidos');for(const u of units)this._order(u,{type:'gather',targetId:node.id,phase:u.carry.amount>0?'deliver':'gather'});return done('Recolección iniciada',{targetId:node.id});}
    if(type==='build'||type==='wall'){if(units.some(u=>u.kind!=='villager'))return fail('Solo los aldeanos construyen');const kind=args.kind,d=definition(BUILDINGS,kind);if(!d||d.age>t.age)return fail('Edificio no disponible en esta era');const plots=[];
      if(type==='wall'){if(!['wall','palisade'].includes(kind)||!this._position(args.x,args.y)||!this._position(args.endX,args.endY)||![args.x,args.y,args.endX,args.endY].every(Number.isInteger))return fail('Muralla inválida');const dx=args.endX-args.x,dy=args.endY-args.y,n=Math.max(Math.abs(dx),Math.abs(dy));if(n>79)return fail('Línea demasiado larga');for(let i=0;i<=n;i++)plots.push({kind,x:Math.round(args.x+(n?dx*i/n:0)),y:Math.round(args.y+(n?dy*i/n:0)),hp:1});
      }else plots.push({kind,x:args.x,y:args.y,hp:1});
      if(plots.some((p,i)=>!this._plot(kind,p.x,p.y,plots.slice(0,i))))return fail('No hay espacio o terreno adecuado');const price=sumCost(d.cost,plots.length);if(!this._afford(team,price))return fail('Recursos insuficientes');
      if(plots.some(p=>{const field=this.navigation.field(p.x,p.y,'land',p);return !field||!units.some(u=>field.distance[Math.floor(u.y)*80+Math.floor(u.x)]>=0);}))return fail('Los constructores no pueden llegar a la obra');
      this._spend(team,price);const made=plots.map(p=>this._building(kind,team,p.x,p.y));this.navigation.rebuild();for(let i=0;i<units.length;i++)this._order(units[i],{type:'build',targetId:made[i%made.length].id,chain:made.map(b=>b.id)});return done('Construcción iniciada',{buildingIds:made.map(b=>b.id)});}
    if(type==='repair'){const b=this._ownedBuilding(args.targetId,team);if(!b||(b.hp>=b.maxHp&&b.progress===1)||units.some(u=>u.kind!=='villager')||('budgetWood'in args&&(!finite(args.budgetWood)||args.budgetWood<=0||args.budgetWood>1e6)))return fail('Reparación inválida');for(const u of units)this._order(u,{type:b.progress<1?'build':'repair',targetId:b.id,...('budgetWood'in args&&b.progress===1?{remainingRepairWood:args.budgetWood/units.length}:{})});return done(b.progress<1?'Construcción reanudada':'Reparación iniciada');}
    if(type==='train'){const b=this._ownedBuilding(args.buildingId,team),d=definition(UNITS,args.kind),quantity=args.quantity??1;if(!b||b.progress<1||!d||!BUILDINGS[b.kind].trains?.includes(args.kind)||d.age>t.age||!Number.isInteger(quantity)||quantity<1||quantity>100||b.queue.length+quantity>100)return fail('Entrenamiento inválido');const s=this.summary(team);if(s.population+s.reservedPopulation+quantity>s.capacity||s.population+s.reservedPopulation+quantity>1000)return fail('No hay alojamiento disponible');const price=sumCost(d.cost,quantity);if(!this._afford(team,price))return fail('Recursos insuficientes');if(!this.navigation.nearest(b.x+BUILDINGS[b.kind].size,b.y+BUILDINGS[b.kind].size,d.movement,20))return fail('No hay salida adecuada para esta unidad');this._spend(team,price);for(let i=0;i<quantity;i++)b.queue.push({type:'train',kind:args.kind,remaining:d.trainTime,duration:d.trainTime,cost:{...d.cost}});return done('Unidades en cola',{quantity});}
    if(type==='cancel_train'){const b=this._ownedBuilding(args.buildingId,team),i=args.queueIndex??0;if(!b||!Number.isInteger(i)||i<0||i>=b.queue.length)return fail('Cola inválida');const[q]=b.queue.splice(i,1);this._spend(team,q.cost,1);return done('Orden cancelada y recursos devueltos');}
    if(type==='rally'){const b=this._ownedBuilding(args.buildingId,team);if(!b||!this._position(args.x,args.y))return fail('Punto de reunión inválido');b.rally={x:args.x,y:args.y};return done('Punto de reunión actualizado');}
    if(type==='gate'){const b=this._ownedBuilding(args.buildingId,team);if(!b||b.kind!=='gate'||b.progress<1||typeof args.open!=='boolean')return fail('Puerta inválida');b.open=args.open;this.navigation.rebuild();return done(args.open?'Puerta abierta':'Puerta cerrada');}
    if(type==='research'){const b=this._ownedBuilding(args.buildingId,team),d=definition(TECHNOLOGIES,args.technologyId);if(!b||b.progress<1||b.queue.length>=100||!d||d.producer!==b.kind||t.age<d.age||d.prerequisites.some(id=>!t.upgrades[id])||t.upgrades[args.technologyId]||this.state.buildings.some(e=>e.team===team&&e.queue.some(q=>q.type==='research'&&q.kind===args.technologyId)))return fail('Tecnología o requisitos inválidos');if(!this._afford(team,d.cost))return fail('Recursos insuficientes');this._spend(team,d.cost);b.queue.push({type:'research',kind:args.technologyId,remaining:d.time,duration:d.time,cost:{...d.cost}});return done('Investigación iniciada');}
    if(type==='advance_age'){const b=this._ownedBuilding(args.buildingId,team),age=t.age+1;if(!b||b.kind!=='guildhall'||b.progress<1||b.queue.length>=100||age>4||this.state.buildings.some(e=>e.team===team&&e.queue.some(q=>q.type==='age')))return fail('Avance de era no disponible');if(age===3&&!this.state.buildings.some(e=>e.team===team&&e.kind==='market'&&e.progress===1&&e.hp>0))return fail('Construye un mercado antes de la tercera era');if(age===4&&!this.state.buildings.some(e=>e.team===team&&e.kind==='academy'&&e.progress===1&&e.hp>0))return fail('Construye una academia antes de la cuarta era');if(!this._afford(team,AGE_COSTS[age]))return fail('Recursos insuficientes');this._spend(team,AGE_COSTS[age]);b.queue.push({type:'age',kind:String(age),remaining:20,duration:20,cost:{...AGE_COSTS[age]}});return done('Avance de era iniciado');}
    if(type==='trade'){if(!RESOURCE_KEYS.includes(args.resource)||args.resource==='gold'||!Number.isInteger(args.amount)||args.amount<1||args.amount>100||!['buy','sell'].includes(args.direction)||!this.state.buildings.some(b=>b.team===team&&b.kind==='market'&&b.progress===1&&b.hp>0))return fail('Intercambio inválido o mercado ausente');const rate=t.upgrades.trade_routes?.8:1;const gold=args.direction==='buy'?Math.ceil(args.amount*1.5*rate):Math.floor(args.amount*.65/rate);if(args.direction==='buy'){if(t.resources.gold<gold)return fail('Oro insuficiente');t.resources.gold-=gold;t.resources[args.resource]+=args.amount;}else{if(t.resources[args.resource]<args.amount)return fail('Recursos insuficientes');t.resources[args.resource]-=args.amount;t.resources.gold+=gold;}return done('Intercambio realizado',{gold,amount:args.amount});}
    if(type==='attack'||type==='convert'){const target=this.getEntity(args.targetId);if(!target||!target.team||target.team===team||target.hp<=0||this.state.mode==='peaceful')return fail('Objetivo enemigo inválido');if(type==='convert'&&(!UNITS[target.kind]||units.some(u=>u.kind!=='wizard'||u.convertCooldown>0)))return fail('Solo un hechicero preparado convierte unidades');if(type==='convert'){const s=this.summary(team);if(s.population+s.reservedPopulation>=s.capacity||s.population+s.reservedPopulation>=1000)return fail('No hay población disponible para convertir');}for(const u of units)this._order(u,{type,targetId:target.id,conversion:0});return done(type==='attack'?'Al ataque':'Conversión iniciada');}
    if(type==='cast'){if(!this._position(args.x,args.y)||!['fireball','heal'].includes(args.spell)||units.some(u=>UNITS[u.kind].spell!==args.spell||u.mana<35))return fail('Hechizo, maná o posición inválidos');if(args.spell==='fireball'&&this.state.mode==='peaceful')return fail('Combate desactivado en modo pacífico');if(units.some(u=>Math.hypot(u.x-args.x,u.y-args.y)>UNITS[u.kind].range+1))return fail('El objetivo está fuera de alcance');this.spatial.rebuild([...this.state.units,...this.state.buildings]);for(const u of units){this._combatEvent('cast',u,{x:args.x,y:args.y});u.mana-=35;this._participant('military',u.id);this.state.effects.push({id:this._id('e'),kind:args.spell,x:args.x,y:args.y,ttl:1});for(const e of this.spatial.within(args.x,args.y,2.6,e=>args.spell==='heal'?e.team===team:e.team!==team))if(args.spell==='heal')this._heal(e,55,u);else this._damage(e,48,u);}this._cleanup();return done('Hechizo lanzado');}
    return fail('Orden desconocida');
  }
  _order(u,order){if(u.navigationIndex!==null){const r=this.state.navigation[u.navigationIndex];if(r&&['pending','moving'].includes(r.status)){r.status='cancelled';r.resolvedAt=this.state.time;}}u.order=order;u.waypoint=null;u.navKey=null;u.navigationIndex=null;}
  _compactNavigation(){
    const history=this.state.navigation,keep=new Set();
    for(let i=0;i<history.length;i++)if(['pending','moving'].includes(history[i].status))keep.add(i);
    // Retire only terminal telemetry, in batches. Every unresolved request survives.
    let terminalBudget=Math.max(0,NAVIGATION_HISTORY_LIMIT-2000-keep.size);
    for(let i=history.length-1;i>=0&&terminalBudget>0;i--)if(!keep.has(i)){keep.add(i);terminalBudget--;}
    const remap=new Map(),retained=[];
    for(let i=0;i<history.length;i++)if(keep.has(i)){remap.set(i,retained.length);retained.push(history[i]);}
    for(const unit of this.state.units)if(unit.navigationIndex!==null)unit.navigationIndex=remap.get(unit.navigationIndex)??null;
    this.state.navigation=retained;
  }
  _recordNavigation(u,x,y){if(this.state.navigation.length>=NAVIGATION_HISTORY_LIMIT)this._compactNavigation();const r={unitId:u.id,team:u.team,x,y,commandedAt:this.state.time,startedAt:null,resolvedAt:null,status:'pending'};u.navigationIndex=this.state.navigation.length;this.state.navigation.push(r);}
  _go(u,x,y,dt,footprint=null){const d=UNITS[u.kind],field=this.navigation.field(x,y,d.movement,footprint);const at=Math.floor(u.y)*80+Math.floor(u.x),record=u.navigationIndex===null?null:this.state.navigation[u.navigationIndex],originalDestination=record&&Math.floor(record.x)===Math.floor(x)&&Math.floor(record.y)===Math.floor(y);
    if(!field||field.distance[at]<0){if(originalDestination&&['pending','moving'].includes(record.status)){record.status='unreachable';record.resolvedAt=this.state.time;}u.waypoint=null;return 'unreachable';}
    const key=`${field.key}:${field.version}`;
    if(u.navKey!==key){u.waypoint=null;u.navKey=key;}
    if(!u.waypoint){if(field.distance[at]===0)u.waypoint={x:Math.floor(u.x)+.5,y:Math.floor(u.y)+.5};else{let best=field.distance[at],point=null;const xx=Math.floor(u.x),yy=Math.floor(u.y);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=xx+dx,ny=yy+dy,nd=field.distance[ny*80+nx];if(this.navigation.walkable(nx,ny,d.movement)&&nd>=0&&nd<best){best=nd;point={x:nx+.5,y:ny+.5};}}u.waypoint=point;if(!point)return 'unreachable';}}
    const target=u.waypoint,delta=Math.hypot(target.x-u.x,target.y-u.y);let speed=d.speed;if(d.movement==='water'&&this.state.teams[u.team].upgrades.navigation)speed*=1.25;const step=speed*dt;
    if(delta>1e-7){if(record&&record.startedAt===null){record.startedAt=this.state.time;record.status='moving';}u.x+=(target.x-u.x)*Math.min(1,step/delta);u.y+=(target.y-u.y)*Math.min(1,step/delta);}
    if(delta<=step+1e-7){u.x=target.x;u.y=target.y;u.waypoint=null;if(field.distance[Math.floor(u.y)*80+Math.floor(u.x)]===0){if(originalDestination&&['pending','moving'].includes(record.status)){record.status='arrived';record.resolvedAt=this.state.time;if(record.startedAt===null)record.startedAt=this.state.time;this.state.metrics.movementArrivals++;}return 'arrived';}}
    return 'moving';
  }
  _dropoff(u,kind){
    // Share only eligibility candidates during this step, never a worker's choice.
    // Positions, reachability and health can change while units are processed.
    const groups=this._stepDropoffs,key=`${u.team}:${kind}`;
    let candidates=groups?.get(key);
    if(!candidates){
      candidates=this.state.buildings.filter(b=>b.team===u.team&&b.progress===1&&b.hp>0&&(BUILDINGS[b.kind].dropoff||[]).includes(kind));
      groups?.set(key,candidates);
    }
    let best,bestDistance=Infinity;
    const at=Math.floor(u.y)*80+Math.floor(u.x),movement=UNITS[u.kind].movement;
    for(const b of candidates){
      if(b.hp<=0||b.team!==u.team||b.progress!==1)continue;
      const d=distance(b,u);
      // Strict comparison preserves the original stable-sort tie order.
      if(d>=bestDistance)continue;
      const field=this.navigation.field(b.x,b.y,movement,b);
      if(field&&field.distance[at]>=0){best=b;bestDistance=d;}
    }
    return best;
  }
  _gather(u,dt){const d=UNITS[u.kind],o=u.order;let n=this.getEntity(o.targetId);
    if(o.phase==='deliver'||u.carry.amount>=(d.carryCapacity*(this.state.teams[u.team].upgrades.wheelbarrow?1.5:1))-.0001||(n?.amount<=0&&u.carry.amount>0)){
      o.phase='deliver';const drop=this._dropoff(u,u.carry.kind);if(!drop){this._order(u,{type:'idle'});return;}const result=this._go(u,drop.x+BUILDINGS[drop.kind].size/2,drop.y+BUILDINGS[drop.kind].size/2,dt,drop);
      if(result==='arrived'){const key=u.carry.kind==='fish'?'food':u.carry.kind;this.state.teams[u.team].resources[key]+=u.carry.amount;this.state.metrics.gathered+=u.carry.amount;this.state.metrics.gatherCycles++;this._participant('economy',u.id);u.carry={kind:null,amount:0};o.phase='gather';}else if(result==='unreachable')this._order(u,{type:'idle'});return;
    }
    if(!n||n.amount<=0){n=this.state.nodes.filter(e=>e.amount>0&&e.kind===(n?.kind||'wood')).sort((a,b)=>distance(a,u)-distance(b,u))[0];if(!n){this._order(u,{type:'idle'});return;}o.targetId=n.id;}
    const result=this._go(u,n.x,n.y,dt,n.buildingId?this.getEntity(n.buildingId):null);if(result==='unreachable'){this._order(u,{type:'idle'});return;}if(result!=='arrived')return;
    const t=this.state.teams[u.team],g=GUILDS.find(g=>g.id===t.guildId);const capacity=d.carryCapacity*(t.upgrades.wheelbarrow?1.5:1);const rate=d.gatherRate*(g.gatherBonus||1)*(t.upgrades.wheelbarrow?1.1:1)*(t.upgrades.agriculture?1.25:1);const amount=Math.min(n.amount,capacity-u.carry.amount,rate*dt);n.amount-=amount;u.carry.kind=n.kind;u.carry.amount+=amount;this._participant('economy',u.id);
  }
  _build(u,dt){const o=u.order;let b=this.getEntity(o.targetId);if(!b||b.hp<=0||b.progress>=1){const next=(o.chain||[]).map(id=>this.getEntity(id)).find(e=>e&&e.hp>0&&e.progress<1);if(next){o.targetId=next.id;b=next;}else{this._order(u,{type:'idle'});return;}}
    const r=this._go(u,b.x+BUILDINGS[b.kind].size/2,b.y+BUILDINGS[b.kind].size/2,dt,b);if(r==='unreachable'){this._order(u,{type:'idle'});return;}if(r!=='arrived')return;const amount=dt/BUILDINGS[b.kind].buildTime;const before=b.progress;b.progress=Math.min(1,b.progress+amount);b.hp=Math.min(b.maxHp,b.hp+(b.progress-before)*b.maxHp*.9);this.state.metrics.constructionProgress++;this._participant('builders',u.id);if(b.progress===1){this._stepDropoffs?.clear();b.hp=b.maxHp;this.state.metrics.constructionCompleted++;if(BUILDINGS[b.kind].farmFood)this._node('food',b.x+BUILDINGS[b.kind].size/2,b.y+BUILDINGS[b.kind].size/2,BUILDINGS[b.kind].farmFood,{buildingId:b.id,team:b.team});this._event(`${b.name} terminado`,'build');}}
  _repair(u,dt){const b=this.getEntity(u.order.targetId);if(!b||b.hp<=0||b.hp>=b.maxHp||u.order.remainingRepairWood<=1e-8){this._order(u,{type:'idle'});return;}if(this._go(u,b.x+BUILDINGS[b.kind].size/2,b.y+BUILDINGS[b.kind].size/2,dt,b)!=='arrived')return;const amount=Math.min(45*dt,b.maxHp-b.hp,(u.order.remainingRepairWood??Infinity)/.08),price={wood:amount*.08};if(!this._afford(u.team,price))return;this._spend(u.team,price);if('remainingRepairWood'in u.order)u.order.remainingRepairWood=Math.max(0,u.order.remainingRepairWood-price.wood);b.hp+=amount;this._participant('builders',u.id);}
  _upgrade(team,key,fallback=0){let value=fallback;for(const id of Object.keys(this.state.teams[team].upgrades)){const e=TECHNOLOGIES[id]?.effect;if(e?.[key])value+=e[key];}return value;}
  _damage(target,amount,source){if(!target||!this.state.teams[target.team]||!finite(target.hp)||target.hp<=0)return;const d=UNITS[target.kind],guild=GUILDS.find(g=>g.id===this.state.teams[target.team].guildId);const armor=d?(d.armor+(guild.armorBonus||0)+this._upgrade(target.team,'armor')):this._upgrade(target.team,'buildingArmor');const applied=Math.max(1,amount-armor);target.hp-=applied;this._combatEvent('hit',source,target,applied);if(target.hp<=0&&d)this._combatEvent('death',source,target,applied);this.state.metrics.damagingHits++;if(source?.id)this._participant('military',source.id);if(target.hp<=0)this._event(`${target.name} ha caído`,'combat');}
  _heal(target,amount,source){if(!target||target.hp<=0||target.hp>=target.maxHp)return;const before=target.hp;target.hp=Math.min(target.maxHp,target.hp+amount);this._combatEvent('support',source,target,target.hp-before);this.state.metrics.healingEvents++;if(source?.id)this._participant('military',source.id);this.state.effects.push({id:this._id('e'),kind:'heal',x:target.x,y:target.y,ttl:.3});}
  _combat(u,dt){const d=UNITS[u.kind],o=u.order;if(this.state.mode==='peaceful')return;
    if(d.healRate){u.scanCooldown-=dt;if(u.scanCooldown<=0){u.scanCooldown=.35;u.autoTarget=this.spatial.nearest(u.x,u.y,d.range,e=>e.team===u.team&&UNITS[e.kind]&&e.hp>0&&e.hp<e.maxHp)?.id||null;}const ally=this.getEntity(u.autoTarget);if(ally&&distance(u,ally)<=d.range&&u.cooldown<=0){const g=GUILDS.find(g=>g.id===this.state.teams[u.team].guildId);this._heal(ally,d.healRate*(g.magicBonus||1),u);u.cooldown=1;}return;}
    let target=['attack','convert'].includes(o.type)&&o.targetId?this.getEntity(o.targetId):null;
    if(o.type==='convert'){if(!target||target.hp<=0||target.team===u.team){this._order(u,{type:'idle'});return;}if(distance(u,target)>d.range){this._go(u,target.x,target.y,dt);return;}o.conversion=(o.conversion||0)+dt;const duration=d.convertTime*(this.state.teams[u.team].upgrades.faith?.7:1);if(o.conversion>=duration){const s=this.summary(u.team);if(s.population+s.reservedPopulation<s.capacity&&s.population+s.reservedPopulation<1000){target.team=u.team;this._combatEvent('support',u,target);this._order(target,{type:'idle'});u.convertCooldown=d.convertCooldown;this.state.metrics.conversions++;this._event(`${target.name} se une a tu gremio`,'convert');}this._order(u,{type:'idle'});}return;}
    if(!d.attack)return;
    if(!target||target.hp<=0||target.team===u.team){if(o.type==='attack'){this._order(u,{type:'idle'});target=null;}u.scanCooldown-=dt;if(u.scanCooldown<=0){u.scanCooldown=.35+(Number(u.id.slice(1))%5)*.02;u.autoTarget=this.spatial.nearest(u.x,u.y,Math.max(7,d.range),e=>e.team!==u.team&&e.team&&e.hp>0)?.id||null;}target=this.getEntity(u.autoTarget);}
    if(!target||target.hp<=0||target.team===u.team)return false;
    const range=d.range+((d.projectile&&this.state.teams[u.team].upgrades.fletching)?1:0);const radius=BUILDINGS[target.kind]?BUILDINGS[target.kind].size*.5:0;
    if(distance(u,target)>range+radius){if(o.type==='attack'||(o.type==='move'&&o.attackMove))this._go(u,target.x,target.y,dt);return true;}
    if(u.cooldown>0)return true;this._combatEvent('attack',u,target);u.cooldown=d.cooldown;this._participant('military',u.id);const g=GUILDS.find(g=>g.id===this.state.teams[u.team].guildId);let attack=(d.attack+this._upgrade(u.team,'attack'))*(d.counters?.[BUILDINGS[target.kind]?'building':target.kind]||1);if(['archer','assassin'].includes(u.kind))attack*=g.rangedBonus||1;if(d.role==='magic')attack*=(g.magicBonus||1)*(this.state.teams[u.team].upgrades.arcane_mastery?1.35:1);
    if(d.projectile){this.state.projectiles.push({id:this._id('p'),kind:u.kind==='mage'?'fireball':u.kind==='siege_engine'?'stone':'arrow',team:u.team,sourceId:u.id,targetId:target.id,x:u.x,y:u.y,targetX:target.x,targetY:target.y,damage:attack,splash:d.splash||0,ttl:Math.max(.12,distance(u,target)/14)});this.state.metrics.projectiles++;}else this._damage(target,attack,u);return true;
  }
  _queues(dt){const summaries={1:this.summary(1),2:this.summary(2)};for(const b of this.state.buildings){if(b.hp<=0||b.progress<1||!b.queue.length)continue;const q=b.queue[0],s=summaries[b.team];if(q.type==='train'&&(s.population+s.reservedPopulation>s.capacity||s.population+s.reservedPopulation>1000)){b.queuePaused='housing';continue;}b.queuePaused=null;q.remaining-=dt;if(q.remaining>0)continue;
      if(q.type==='train'){const u=this._spawn(q.kind,b.team,b.x+BUILDINGS[b.kind].size+.5,b.y+BUILDINGS[b.kind].size+.5);if(!u){q.remaining=0;b.queuePaused='exit';continue;}b.queue.shift();s.population++;s.reservedPopulation--;this.state.metrics.trained++;this._order(u,{type:'move',...b.rally});this._recordNavigation(u,b.rally.x,b.rally.y);}
      else if(q.type==='research'){this.state.teams[b.team].upgrades[q.kind]=true;b.queue.shift();this._event(`${TECHNOLOGIES[q.kind].name} investigado`,'research');}
      else{this.state.teams[b.team].age=Number(q.kind);b.queue.shift();this._event(`Tu gremio alcanza la era ${q.kind}`,'age');}
    }}
  _ai(dt){this.state.aiClock+=dt;if(this.state.aiClock<3)return;this.state.aiClock=0;const team=2,t=this.state.teams[team],resourceOffset=Math.floor(this._random()*4),workers=this.state.units.filter(u=>u.team===team&&u.kind==='villager'&&u.hp>0);for(let i=0;i<workers.length;i++){const u=workers[i];if(u.order.type==='idle'){const kind=RESOURCE_KEYS[(i+resourceOffset)%4];const node=this.state.nodes.filter(n=>n.kind===kind&&n.amount>0).sort((a,b)=>distance(a,u)-distance(b,u))[0];if(node){this._order(u,{type:'gather',targetId:node.id,phase:'gather'});this.state.metrics.aiGatherOrders++;}}}
    const s=this.summary(team),hall=this.state.buildings.find(b=>b.team===team&&b.kind==='guildhall'&&b.hp>0);if(hall&&s.population+s.reservedPopulation<s.capacity&&workers.length<35)this._command('train',{buildingId:hall.id,kind:'villager'},team);
    if(workers.length&&t.resources.wood>=60&&!this.state.buildings.some(b=>b.team===team&&b.progress<1)){for(let y=57;y<76;y+=3){let made=false;for(let x=58;x<76;x+=3)if(this._plot('house',x,y)){const r=this._command('build',{unitIds:[workers[0].id],kind:'house',x,y},team);if(r.ok){this.state.metrics.aiBuildOrders++;made=true;}break;}if(made)break;}}
    if(this.state.mode==='peaceful')return;const producer=this.state.buildings.find(b=>b.team===team&&b.kind==='barracks'&&b.hp>0);if(producer&&producer.queue.length<3)this._command('train',{buildingId:producer.id,kind:'infantry'},team);
    const target=this.state.buildings.find(b=>b.team===1&&b.kind==='guildhall'&&b.hp>0);const attackTime=this.state.difficulty==='hard'?25:this.state.difficulty==='easy'?120:70;if(target&&this.state.time>attackTime)for(const u of this.state.units)if(u.team===team&&UNITS[u.kind].attack>5&&u.kind!=='villager'&&u.order.type!=='attack'){this._order(u,{type:'attack',targetId:target.id});this.state.metrics.aiAttackOrders++;}
  }
  _cleanup(){let changed=false;this.state.units=this.state.units.filter(u=>{if(u.hp>0)return true;this.state.effects.push({id:this._id('e'),kind:'death',x:u.x,y:u.y,ttl:1.2,entityKind:u.kind,team:u.team});if(u.navigationIndex!==null){const r=this.state.navigation[u.navigationIndex];if(r&&['pending','moving'].includes(r.status)){r.status='cancelled';r.resolvedAt=this.state.time;}}return false;});this.state.buildings=this.state.buildings.filter(b=>{if(b.hp>0)return true;this.state.effects.push({id:this._id('e'),kind:'rubble',x:b.x,y:b.y,ttl:8,entityKind:b.kind,team:b.team,size:BUILDINGS[b.kind].size});for(const q of b.queue)this._spend(b.team,q.cost,1);for(const n of this.state.nodes)if(n.buildingId===b.id)n.amount=0;changed=true;return false;});if(this.state.effects.length>3000)this.state.effects.splice(0,this.state.effects.length-3000);if(changed)this.navigation.rebuild();this._indexes();if(this.state.mode==='conquest'&&this.state.winner===null){const living=[1,2].filter(team=>this.state.buildings.some(b=>b.team===team&&b.kind==='guildhall'));if(living.length===1){this.state.winner=living[0];this._event(living[0]===1?'¡Victoria del Alba!':'Tu gremio ha sido derrotado',living[0]===1?'victory':'defeat');}}}
  tick(dtSeconds){if(!finite(dtSeconds)||dtSeconds<0||dtSeconds>2)throw new Error('Delta de simulación inválido');if(this.state.paused||this.state.winner!==null||dtSeconds===0)return;let left=dtSeconds*this.state.speed;while(left>1e-8){const dt=Math.min(.1,left);this._step(dt);left-=dt;}}
  _step(dt){this._stepDropoffs=new Map();this.state.time+=dt;this.spatial.rebuild([...this.state.units,...this.state.buildings]);this._queues(dt);
    for(const u of this.state.units){if(u.hp<=0)continue;u.cooldown=Math.max(0,u.cooldown-dt);u.convertCooldown=Math.max(0,u.convertCooldown-dt);if(UNITS[u.kind].mana)u.mana=Math.min(UNITS[u.kind].mana,u.mana+dt*2);const o=u.order;
      const attackMoving=o.type==='move'&&o.attackMove;
      if(o.type==='move'){const engaged=attackMoving&&this._combat(u,dt);if(!engaged){const r=this._go(u,o.x,o.y,dt);if(r==='arrived'||r==='unreachable')u.order={type:'idle'};}}
      else if(o.type==='defend'&&finite(o.x)&&finite(o.y)&&Math.hypot(u.x-o.x,u.y-o.y)>.5)this._go(u,o.x,o.y,dt);
      else if(o.type==='gather')this._gather(u,dt);else if(o.type==='build')this._build(u,dt);else if(o.type==='repair')this._repair(u,dt);
      if(!attackMoving)this._combat(u,dt);
    }
    for(const b of this.state.buildings){const d=BUILDINGS[b.kind];b.cooldown=Math.max(0,b.cooldown-dt);if(d.attack&&b.progress===1&&b.hp>0&&b.cooldown<=0&&this.state.mode!=='peaceful'){const target=this.spatial.nearest(b.x,b.y,d.range,e=>e.team!==b.team&&e.team&&e.hp>0);if(target){b.cooldown=d.cooldown;this.state.projectiles.push({id:this._id('p'),kind:'arrow',team:b.team,sourceId:b.id,targetId:target.id,x:b.x,y:b.y,targetX:target.x,targetY:target.y,damage:d.attack,splash:0,ttl:.3});this.state.metrics.projectiles++;}}}
    this.state.projectiles=this.state.projectiles.filter(p=>{p.ttl-=dt;if(p.ttl>0)return true;const target=this.getEntity(p.targetId),source=this.getEntity(p.sourceId);if(target&&target.hp>0){this._damage(target,p.damage,source);if(p.splash)for(const e of this.spatial.within(target.x,target.y,p.splash,e=>e.team!==p.team&&e.id!==target.id))this._damage(e,p.damage*.5,source);}return false;});
    this.state.effects=this.state.effects.filter(e=>(e.ttl-=dt)>0);this._ai(dt);this._cleanup();this._stepDropoffs=null;
  }
  serialize(){return copy(this.state);}
  static fromSave(serialized){const s=validateSave(serialized);const world=Object.create(World.prototype);world.state=s;world._indexes();world.navigation=new Navigation(world);world.spatial=new SpatialIndex();world._sets=Object.fromEntries(['economy','builders','military'].map(k=>[k,new Set(s.metrics.participants[k])]));return world;}
}

function validateSave(input){
  const bad=()=>{throw new Error('Partida guardada inválida');};if(!input||typeof input!=='object'||Array.isArray(input))bad();let raw;try{raw=JSON.stringify(input);}catch{bad();}if(raw.length>8_000_000)bad();const s=JSON.parse(raw);
  const number=(v,min=0,max=1e9)=>finite(v)&&v>=min&&v<=max;const position=e=>e&&number(e.x,0,79.99999)&&number(e.y,0,79.99999);const price=p=>p&&RESOURCE_KEYS.every(k=>number(p[k],0,1e9));
  if(s.version!==1||!MAPS.some(m=>m.id===s.mapId)||!GUILDS.some(g=>g.id===s.guildId)||!['easy','normal','hard'].includes(s.difficulty)||!['conquest','peaceful'].includes(s.mode)||!Number.isSafeInteger(s.seed)||!number(s.seed,0,0xffffffff)||!Number.isSafeInteger(s.rngState)||!number(s.rngState,0,0xffffffff)||!Number.isSafeInteger(s.navigationVersion)||s.navigationVersion<0||!Number.isSafeInteger(s.nextId)||s.nextId<1||!Number.isSafeInteger(s.nameCursor)||s.nameCursor<0||!number(s.time)||typeof s.paused!=='boolean'||!Number.isSafeInteger(s.pauseRevision)||![.5,1,2].includes(s.speed)||![null,1,2].includes(s.winner)||!number(s.aiClock,0,3.1))bad();
  const m=s.map;if(!m||m.width!==80||m.height!==80||!Array.isArray(m.terrain)||m.terrain.length!==6400||m.terrain.some(t=>!Number.isInteger(t)||!Object.values(TERRAIN).includes(t))||!Array.isArray(m.heights)||m.heights.length!==6400||m.heights.some(h=>!number(h,0,4)))bad();
  if(!s.teams||Object.keys(s.teams).join(',')!=='1,2')bad();for(const t of Object.values(s.teams))if(!t||!GUILDS.some(g=>g.id===t.guildId)||typeof t.name!=='string'||typeof t.color!=='string'||!price(t.resources)||!Number.isInteger(t.age)||t.age<1||t.age>4||!t.upgrades||Object.entries(t.upgrades).some(([id,v])=>!definition(TECHNOLOGIES,id)||v!==true))bad();
  if(!Array.isArray(s.units)||s.units.length>2000||!Array.isArray(s.buildings)||s.buildings.length>10000||!Array.isArray(s.nodes)||s.nodes.length>10000||!Array.isArray(s.projectiles)||s.projectiles.length>10000||!Array.isArray(s.effects)||s.effects.length>10000||!Array.isArray(s.events)||s.events.length>100||!Array.isArray(s.navigation)||s.navigation.length>100000)bad();
  const ids=new Set(),names=new Set();const entity=e=>{if(!e||typeof e.id!=='string'||!/^[ubn][1-9]\d*$/u.test(e.id)||ids.has(e.id)||Number(e.id.slice(1))>=s.nextId||!position(e))bad();ids.add(e.id);};
  for(const u of s.units){entity(u);const d=definition(UNITS,u.kind);if(!d||![1,2].includes(u.team)||!number(u.hp,.00001,d.hp)||u.maxHp!==d.hp||typeof u.name!=='string'||!u.name.trim()||u.name.length>48||/[\u0000-\u001f\u007f]/u.test(u.name)||names.has(norm(u.name))||!u.order||!ORDER_TYPES.has(u.order.type)||!u.carry||!number(u.carry.amount,0,(d.carryCapacity||0)*1.5)||!(u.carry.kind===null||['wood','food','gold','stone','fish'].includes(u.carry.kind))||(u.carry.amount>0&&u.carry.kind===null)||!number(u.cooldown,0,20)||!number(u.mana,0,d.mana||0)||!number(u.convertCooldown,0,100)||!number(u.scanCooldown,-1,10))bad();names.add(norm(u.name));for(const k of ['x','y'])if(k in u.order&&!number(u.order[k],0,79.99999))bad();if('targetId'in u.order&&(typeof u.order.targetId!=='string'||!/^[ubn][1-9]\d*$/u.test(u.order.targetId)||Number(u.order.targetId.slice(1))>=s.nextId))bad();if(['build','repair'].includes(u.order.type)&&!/^b/u.test(u.order.targetId))bad();if(u.order.type==='gather'&&!/^n/u.test(u.order.targetId))bad();if(u.order.type==='convert'&&!/^u/u.test(u.order.targetId))bad();if(u.order.type==='attack'&&!/^[ub]/u.test(u.order.targetId))bad();if(['move','defend'].includes(u.order.type)&&!position(u.order))bad();if(['gather','build','repair','attack','convert'].includes(u.order.type)&&typeof u.order.targetId!=='string')bad();if('remainingRepairWood'in u.order&&!number(u.order.remainingRepairWood,0,1e6))bad();if('chain'in u.order&&(!Array.isArray(u.order.chain)||u.order.chain.length>100||u.order.chain.some(id=>typeof id!=='string')))bad();if('phase'in u.order&&!['deliver','gather'].includes(u.order.phase))bad();if('conversion'in u.order&&!number(u.order.conversion,0,20))bad();if('attackMove'in u.order&&typeof u.order.attackMove!=='boolean')bad();if(u.waypoint!==null&&!position(u.waypoint))bad();if(u.navigationIndex!==null&&(!Number.isInteger(u.navigationIndex)||!s.navigation[u.navigationIndex]||s.navigation[u.navigationIndex].unitId!==u.id))bad();}
  for(const b of s.buildings){entity(b);const d=definition(BUILDINGS,b.kind);if(!d||![1,2].includes(b.team)||!Number.isInteger(b.x)||!Number.isInteger(b.y)||b.x+d.size>80||b.y+d.size>80||!number(b.hp,.00001,d.hp)||b.maxHp!==d.hp||!number(b.progress,0,1)||!Array.isArray(b.queue)||b.queue.length>100||!position(b.rally)||typeof b.open!=='boolean'||!number(b.cooldown,0,20))bad();for(const q of b.queue){let expected,duration;if(q.type==='train'){const ud=definition(UNITS,q.kind);if(!ud||!d.trains?.includes(q.kind)||ud.age>s.teams[b.team].age)bad();expected=ud.cost;duration=ud.trainTime;}else if(q.type==='research'){const td=definition(TECHNOLOGIES,q.kind);if(!td||td.producer!==b.kind||td.age>s.teams[b.team].age||td.prerequisites.some(id=>!s.teams[b.team].upgrades[id]))bad();expected=td.cost;duration=td.time;}else if(q.type==='age'){if(b.kind!=='guildhall'||!['2','3','4'].includes(q.kind)||Number(q.kind)!==s.teams[b.team].age+1)bad();expected=AGE_COSTS[Number(q.kind)];duration=20;}else bad();if(!price(q.cost)||RESOURCE_KEYS.some(k=>q.cost[k]!==expected[k])||q.duration!==duration||!number(q.remaining,0,duration))bad();}}
  for(let i=0;i<s.buildings.length;i++){const a=s.buildings[i],size=BUILDINGS[a.kind].size;for(let j=i+1;j<s.buildings.length;j++){const b=s.buildings[j],bs=BUILDINGS[b.kind].size;if(a.x<b.x+bs&&a.x+size>b.x&&a.y<b.y+bs&&a.y+size>b.y)bad();}}
  for(const n of s.nodes){entity(n);if(!['wood','food','gold','stone','fish'].includes(n.kind)||!number(n.amount,0,n.maxAmount)||!number(n.maxAmount,1,1e7))bad();}
  const targets=new Map([...s.units,...s.buildings,...s.nodes].map(e=>[e.id,e]));
  for(const u of s.units){
    const order=u.order,target=targets.get(order.targetId),d=UNITS[u.kind];
    if(order.type==='gather'&&(!d.gatherRate||(target&&(u.kind==='fishing_boat'?target.kind!=='fish':target.kind==='fish'))))bad();
    if(['build','repair'].includes(order.type)){
      if(u.kind!=='villager'||(target&&(!definition(BUILDINGS,target.kind)||target.team!==u.team)))bad();
      for(const id of order.chain||[]){const next=targets.get(id);if(!/^b[1-9]\d*$/u.test(id)||Number(id.slice(1))>=s.nextId||(next&&(!definition(BUILDINGS,next.kind)||next.team!==u.team)))bad();}
    }
    if(order.type==='convert'&&u.kind!=='wizard')bad();
  }
  for(const p of s.projectiles)if(!p||!position(p)||!number(p.damage,0,1e5)||!number(p.ttl,0,30)||![1,2].includes(p.team)||typeof p.targetId!=='string'||typeof p.sourceId!=='string'||!number(p.splash,0,10)||!number(p.targetX,0,79.99999)||!number(p.targetY,0,79.99999))bad();
  for(const e of s.effects)if(!position(e)||!number(e.ttl,0,30)||typeof e.kind!=='string')bad();for(const e of s.events)if(!e||!number(e.time)||typeof e.text!=='string'||e.text.length>1000||typeof e.kind!=='string')bad();
  for(const n of s.navigation)if(!n||typeof n.unitId!=='string'||![1,2].includes(n.team)||!position(n)||!number(n.commandedAt,0,s.time)||!(n.startedAt===null||number(n.startedAt,n.commandedAt,s.time))||!(n.resolvedAt===null||number(n.resolvedAt,n.commandedAt,s.time))||!['pending','moving','arrived','unreachable','cancelled'].includes(n.status))bad();
  const metricKeys=['gatherCycles','gathered','constructionProgress','constructionCompleted','movementArrivals','damagingHits','projectiles','healingEvents','conversions','trained','aiGatherOrders','aiBuildOrders','aiAttackOrders'];if(!s.metrics||metricKeys.some(k=>!number(s.metrics[k]))||!s.metrics.participants||['economy','builders','military'].some(k=>!Array.isArray(s.metrics.participants[k])||s.metrics.participants[k].some(id=>typeof id!=='string')))bad();
  for(const team of [1,2]){const pop=s.units.filter(u=>u.team===team).length,reserved=s.buildings.filter(b=>b.team===team).reduce((n,b)=>n+b.queue.filter(q=>q.type==='train').length,0);if(pop+reserved>1000)bad();}
  return s;
}
