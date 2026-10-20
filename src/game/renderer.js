import { MAPS, BUILDINGS, UNITS, TERRAIN } from './data.js';

const TW = 48;
const TH = 24;
const HW = TW / 2;
const HH = TH / 2;
const TAU = Math.PI * 2;
const hash = (x, y, seed = 1) => {
  let n = Math.imul(x + seed, 374761393) + Math.imul(y + seed, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function mixColor(a,b,amount){
  const channel=(hex,index)=>parseInt(hex.slice(index,index+2),16);
  return `#${[1,3,5].map(index=>Math.round(channel(a,index)*(1-amount)+channel(b,index)*amount).toString(16).padStart(2,'0')).join('')}`;
}
function polygon(c, points, fill, stroke) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.stroke(); }
}
function ellipse(c, x, y, rx, ry, color) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fillStyle = color; c.fill();
}
function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

/** Canvas renderer owns presentation only; simulation state is never modified here. */
export class GameRenderer {
  constructor(canvas, world, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.options = options;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.stats = { loadedAssets: [], assetFailures: [], frameMs: 0, frameSamples: [], renderedEntities: 0, culledEntities: 0, terrainCacheMs: 0, frames: 0 };
    this.images = new Map();
    this.fallbacks = new Map();
    this.atlas = { units: {}, buildings: {}, resources: {} };
    this.ground = null;
    this.minimapCache = null;
    this.assetEpoch = 0;
    this._resize = () => this.resize();
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(canvas);
    this.setWorld(world);
    this.resize();
    this.assetsReady = this.reloadAssets();
  }

  setWorld(world) {
    this.surfaceRevision=(this.surfaceRevision||0)+1;
    this.world = world;
    this.combatSequence = 0;
    this.projectileVisuals = new Map();
    this.combatPoses = new Map();
    this.combatBursts = [];
    this.bloodDecals = [];
    this.bodies = [];
    this.fallbacks.clear();
    this.buildTerrain();
    const hall = world.state.buildings.find(b => b.team === 1 && b.kind === 'guildhall');
    this.centerOn(hall ? hall.x + 5.5 : world.state.map.width * .25, hall ? hall.y + 6.5 : world.state.map.height * .25);
  }

  resize() {
    this.surfaceRevision=(this.surfaceRevision||0)+1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  async reloadAssets() {
    const epoch = ++this.assetEpoch;
    const failures = [];
    try {
      const response = await fetch(`/assets/sprites/atlas.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Atlas HTTP ${response.status}`);
      const atlas = await response.json();
      if (atlas.version !== 1) throw new Error('Versión del atlas no admitida');
      const entries = Object.values({ ...atlas.units, ...atlas.buildings, ...atlas.resources });
      const urls = [...new Set(entries.map(e => e.image))];
      const nextImages = new Map();
      await Promise.all(urls.map(url => new Promise(resolve => {
        if (!/^assets\/[a-zA-Z0-9_./-]+\.(png|webp|jpg|jpeg)$/.test(url) || url.includes('..')) {
          failures.push(url); resolve(); return;
        }
        const img = new Image();
        img.onload = () => { nextImages.set(url, img); resolve(); };
        img.onerror = () => { failures.push(url); resolve(); };
        img.src = `/${url}?v=${epoch}`;
      })));
      if (epoch !== this.assetEpoch) return this.stats;
      this.atlas = atlas;
      this.images = nextImages;
      this.surfaceRevision=(this.surfaceRevision||0)+1;
      this.stats.loadedAssets = [...nextImages.keys()];
      this.stats.assetFailures = failures;
      this.stats.assetCoverage = { units: Object.keys(atlas.units || {}), buildings: Object.keys(atlas.buildings || {}), resources: Object.keys(atlas.resources || {}) };
      this.options.onAssetsLoaded?.(this.stats);
    } catch (error) {
      if (epoch === this.assetEpoch) this.stats.assetFailures = [String(error.message)];
    }
    return this.stats;
  }

  buildTerrain() {
    const start = performance.now();
    const { map, mapId, seed } = this.world.state;
    const palette = MAPS.find(m => m.id === mapId)?.palette || MAPS[0].palette;
    this.palette = palette;
    this.ground = makeCanvas((map.width + map.height) * HW + 192, (map.width + map.height) * HH + 192);
    this.groundOffset = { x: map.height * HW + 96, y: 96 };
    const c = this.ground.getContext('2d');
    c.lineWidth = .5;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const terrain = map.terrain[y * map.width + x];
      const px = (x - y) * HW + this.groundOffset.x;
      const py = (x + y) * HH + this.groundOffset.y;
      const groundColor=terrain===TERRAIN.FOREST?mixColor(palette[0],palette[2],.18):(palette[terrain]||palette[0]);
      polygon(c, [[px,py-HH],[px+HW+.5,py],[px,py+HH+.5],[px-HW-.5,py]], groundColor);
      const noise = hash(x,y,seed || 1);
      c.globalAlpha = terrain===TERRAIN.WATER?.015+noise*.012:.012+noise*.025;
      polygon(c, [[px,py-HH],[px+HW,py],[px,py+HH],[px-HW,py]], noise > .5 ? '#f9f4c7' : '#1b422c');
      c.globalAlpha = 1;
      if (terrain === TERRAIN.WATER) {
        if (noise > .55) { c.strokeStyle='#b7dbd260'; c.beginPath(); c.moveTo(px-10,py+1); c.quadraticCurveTo(px-2,py-3,px+9,py+1); c.stroke(); }
        if (noise > .88) { c.strokeStyle='#d4eddf88'; c.beginPath(); c.moveTo(px+2,py+4); c.lineTo(px+10,py+4); c.stroke(); }
      } else if (terrain === TERRAIN.BRIDGE) {
        polygon(c, [[px-18,py-3],[px,py-12],[px+19,py-2],[px,py+8]], '#b9a280', '#867553');
        c.strokeStyle='#7d72574d'; for(let a=-12;a<15;a+=5){c.beginPath();c.moveTo(px+a,py-6);c.lineTo(px+a+12,py);c.stroke();}
      } else if (terrain === TERRAIN.CLIFF || terrain === TERRAIN.ROCK) {
        if(noise>.25)polygon(c,[[px-8,py+1],[px-5,py-7-noise*7],[px+3,py-10],[px+10,py+3],[px,py+6]],noise>.7?'#b3b5a2':'#8a927f','#757d6b44');
      } else {
        for(let j=0;j<3;j++){
          const a=hash(x*3+j,y+3,seed), b=hash(x+4,y*3+j,seed);
          const ox=(a-.5)*30,oy=(b-.5)*11;
          c.strokeStyle=terrain===TERRAIN.SNOW?'#91ada266':'#4c754845';
          c.beginPath();c.moveTo(px+ox,py+oy+1);c.lineTo(px+ox-1.5,py+oy-2.5);c.moveTo(px+ox,py+oy+1);c.lineTo(px+ox+1.5,py+oy-2);c.stroke();
          if((a>.73 && terrain!==TERRAIN.SAND && terrain!==TERRAIN.SNOW)|| (terrain===TERRAIN.GRASS&&noise>.88)){
            const colors=['#f3e7b0','#d0d49b','#dcb8c0','#c4ccdc','#faf0cd'];
            c.fillStyle=colors[Math.floor(b*colors.length)];c.fillRect(px+ox,py+oy-3,1.8,1.8);
          }
        }
      }
    }
    // Broad paths join the settlement clearings. The terrain remains fully revealed.
    const halls = this.world.state.buildings.filter(b=>b.kind==='guildhall');
    c.strokeStyle='#d8c58d30'; c.lineWidth=19; c.lineCap='round';
    halls.forEach(h=>{
      const px=(h.x-h.y)*HW+this.groundOffset.x, py=(h.x+h.y+4)*HH+this.groundOffset.y;
      c.beginPath();c.moveTo(px-145,py+65);c.bezierCurveTo(px-50,py-6,px+40,py+40,px+170,py-45);c.stroke();
    });
    this.minimapCache=makeCanvas(map.width*3,map.height*3);
    const mc=this.minimapCache.getContext('2d');
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
      mc.fillStyle=palette[map.terrain[y*map.width+x]]||palette[0];mc.fillRect(x*3,y*3,3,3);
    }
    this.stats.terrainCacheMs=performance.now()-start;
  }

  project(x,y) { return { x:(x-y)*HW, y:(x+y)*HH }; }
  worldToScreen(x,y) {
    const p=this.project(x,y),r=this.canvas.getBoundingClientRect();
    return { x:r.left+this.width/2+(p.x-this.camera.x)*this.camera.zoom, y:r.top+this.height/2+(p.y-this.camera.y)*this.camera.zoom };
  }
  screenToWorld(clientX,clientY) {
    const r=this.canvas.getBoundingClientRect();
    const px=(clientX-r.left-this.width/2)/this.camera.zoom+this.camera.x;
    const py=(clientY-r.top-this.height/2)/this.camera.zoom+this.camera.y;
    return { x:(px/HW+py/HH)/2,y:(py/HH-px/HW)/2 };
  }
  centerOn(x,y) { const p=this.project(x,y);this.camera.x=p.x;this.camera.y=p.y; }
  pan(dx,dy) { this.camera.x-=dx/this.camera.zoom;this.camera.y-=dy/this.camera.zoom;this.limitCamera(); }
  limitCamera() {
    const map=this.world.state.map;
    this.camera.x=clamp(this.camera.x,-map.height*HW,map.width*HW);
    this.camera.y=clamp(this.camera.y,-100,(map.width+map.height)*HH+100);
  }
  zoomAt(factor,clientX=this.canvas.getBoundingClientRect().left+this.width/2,clientY=this.canvas.getBoundingClientRect().top+this.height/2) {
    const before=this.screenToWorld(clientX,clientY);
    this.camera.zoom=clamp(this.camera.zoom*factor,.35,2.3);
    const after=this.screenToWorld(clientX,clientY);
    const delta=this.project(before.x-after.x,before.y-after.y);
    this.camera.x+=delta.x;this.camera.y+=delta.y;this.limitCamera();
  }

  pick(clientX,clientY) {
    const point=this.screenToWorld(clientX,clientY);
    const {units,buildings,nodes}=this.world.state;
    const rect=this.canvas.getBoundingClientRect(),zoom=this.camera.zoom;
    const screenPoint=(x,y)=>{const p=this.project(x,y);return {x:rect.left+this.width/2+(p.x-this.camera.x)*zoom,y:rect.top+this.height/2+(p.y-this.camera.y)*zoom};};
    let nearest=null,dist=Infinity;
    for(const u of units){
      if(u.hp<=0)continue;
      const p=screenPoint(u.x,u.y);
      const d=Math.hypot((p.x-clientX), (p.y-clientY-12*this.camera.zoom)*1.4);
      if(d<22*this.camera.zoom&&d<dist){nearest=u;dist=d;}
    }
    if(nearest)return nearest;
    for(let i=buildings.length-1;i>=0;i--){
      const b=buildings[i];if(b.hp<=0)continue;
      const size=BUILDINGS[b.kind]?.size||1;
      if(point.x>=b.x-.5&&point.x<b.x+size-.5&&point.y>=b.y-.5&&point.y<b.y+size-.5)return b;
      const center=screenPoint(b.x+(size-1)/2,b.y+(size-1)/2);
      if(Math.abs(center.x-clientX)<size*HW*this.camera.zoom*.65&&clientY<center.y&&clientY>center.y-size*TH*this.camera.zoom*1.4)return b;
    }
    nearest=null;dist=Infinity;
    for(const n of nodes){if(n.amount<=0)continue;const d=Math.hypot(n.x-point.x,n.y-point.y);if(d<1.05&&d<dist){nearest=n;dist=d;}}
    return nearest;
  }

  render({selectedIds=[],hoverId=null,placement=null,dragRect=null}={}) {
    const start=performance.now();
    const c=this.ctx,{width,height,dpr,camera}=this;
    c.setTransform(dpr,0,0,dpr,0,0);
    c.fillStyle='#78977e';c.fillRect(0,0,width,height);
    const sky=c.createLinearGradient(0,0,width,height);sky.addColorStop(0,'#b4c3a2');sky.addColorStop(1,'#597d70');c.fillStyle=sky;c.fillRect(0,0,width,height);
    c.save();c.translate(width/2,height/2);c.scale(camera.zoom,camera.zoom);c.translate(-camera.x,-camera.y);
    c.drawImage(this.ground,-this.groundOffset.x,-this.groundOffset.y);
    const left=camera.x-width/2/camera.zoom-170,right=camera.x+width/2/camera.zoom+170;
    const top=camera.y-height/2/camera.zoom-30,bottom=camera.y+height/2/camera.zoom+210;
    this.combatBounds={left,right,top,bottom};
    this.updateCombat();
    this.drawBattlefield(c);
    const list=[];let culled=0;
    const collect=(items,type)=>{
      for(const e of items){
        if(e.hp<=0 || (type==='resources'&&e.amount<=0))continue;
        if(type==='resources'&&e.buildingId)continue;
        const size=type==='buildings'?(BUILDINGS[e.kind]?.size||1):1;
        const p=this.project(e.x+(size-1)/2,e.y+(size-1)/2);
        if(p.x<left||p.x>right||p.y<top||p.y>bottom){culled++;continue;}
        list.push({e,type,p,size,depth:e.x+e.y+size-1});
      }
    };
    collect(this.world.state.nodes,'resources');collect(this.world.state.buildings,'buildings');collect(this.world.state.units,'units');
    for(const event of this.bodies){const e=event.target,p=this.project(e.x,e.y);if(this.combatVisible(p))list.push({e,event,p,type:'bodies',size:1,depth:e.x+e.y});}
    list.sort((a,b)=>a.depth-b.depth||Number(a.type==='units')-Number(b.type==='units'));
    const selected=new Set(selectedIds),time=this.world.state.time||0;
    for(const item of list){
      const {e,type,p,size}=item;
      if(type==='bodies'){this.drawBody(c,item.event);continue;}
      if(type==='buildings'){
        if(selected.has(e.id)||e.id===hoverId)this.drawFootprint(c,e.x,e.y,size,selected.has(e.id)?'#f9e9a090':'#f8eed442','#f9e2a2');
        this.drawEntity(c,e,type,p,time);
        if(e.progress<1)this.drawConstruction(c,e,p,size,time);
        if(e.hp<e.maxHp*.7 && e.progress>=1){const f=Math.sin(time*2+e.x);ellipse(c,p.x+10,p.y-size*19-f*4,4,8,'#56654f55');}
      }else if(type==='units'){
        if(selected.has(e.id)){
          c.strokeStyle=e.team===1?'#fff2b4':'#efa098';c.lineWidth=1.6/camera.zoom;c.beginPath();c.ellipse(p.x,p.y+1,14,6,0,0,TAU);c.stroke();
          if(e.order?.x!==undefined && selectedIds.length<=12 && ['move','attack_move'].includes(e.order.type)){
            const dest=this.project(e.order.x,e.order.y);c.strokeStyle='#f6e3a64a';c.lineWidth=.8;c.setLineDash([3,4]);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(dest.x,dest.y);c.stroke();c.setLineDash([]);
          }
        }else if(e.id===hoverId){ellipse(c,p.x,p.y,13,5,'#fff8c54d');}
        this.drawEntity(c,e,type,p,time);
        if(selected.has(e.id)||e.hp<e.maxHp*.65)this.health(c,e,p.x,p.y-48,27);
      }else{this.drawEntity(c,e,type,p,time);}
    }
    for(const projectile of this.world.state.projectiles||[])this.drawProjectile(c,projectile);
    this.drawCombatBursts(c);
    for(const effect of (this.world.state.effects||[]).slice(-80)){
      this.drawEffect(c,effect);
    }
    if(placement)this.drawPlacement(c,placement);
    c.restore();
    // Quiet atmosphere across the world, kept separate from interaction layers.
    c.fillStyle='#fff7cf';c.globalAlpha=.17;
    for(let i=0;i<12;i++){const x=((time*8+i*137)% (width+70))-35,y=(Math.sin(time*.18+i*3)*.1+.45+i*.019)*height;ellipse(c,x,y,1.3,1.3,'#fff7cf');}
    c.globalAlpha=1;
    if(dragRect){c.strokeStyle='#fbefb5';c.lineWidth=1;c.fillStyle='#faedac20';c.fillRect(dragRect.x,dragRect.y,dragRect.width,dragRect.height);c.strokeRect(dragRect.x,dragRect.y,dragRect.width,dragRect.height);}
    this.stats.frameMs=performance.now()-start;
    this.stats.frames++;
    this.stats.renderedEntities=list.length;this.stats.culledEntities=culled;
    this.stats.frameSamples.push(this.stats.frameMs);
    if(this.stats.frameSamples.length>24000)this.stats.frameSamples.splice(0,12000);
  }

  drawEntity(c,e,type,p,time) {
    const record=this.atlas[type]?.[e.kind],img=record&&this.images.get(record.image);
    const size=type==='buildings'?(BUILDINGS[e.kind]?.size||1):1;
    const unit=type==='units', pose=unit?this.unitPose(e,time):null;
    if(unit)ellipse(c,p.x+2,p.y+1,12,4,'#1f3c3033');
    else if(type==='buildings'&&size>1)ellipse(c,p.x+9,p.y+8,size*19,size*8,'#243c2b26');
    c.save();
    if(pose){c.translate(p.x+pose.dx,p.y+pose.dy);c.rotate(pose.tilt);c.translate(-p.x,-p.y);}
    if(img){
      const fw=record.frameWidth||img.width,fh=record.frameHeight||img.height;
      const moving=unit&&!!(e.waypoint||e.path?.length);
      const working=unit&&(['build','repair','convert'].includes(e.order?.type)||(e.order?.type==='gather'&&e.order.phase==='gather'));
      const action=pose?.active?'attack':moving?'walk':working?'attack':'idle';
      const anim=record.actions?.[action]||record.actions?.idle||{frames:[0],fps:1};
      const frames=anim.frames||[0];
      let index=Math.floor(time*(anim.fps||1)+(e.id?.length||0))%frames.length;
      if(pose?.active){const impact=anim.impactFrame??Math.floor(frames.length*.4);index=pose.windup?Math.floor(impact*pose.progress):impact+Math.floor(pose.age*(anim.fps||12));index=clamp(index,0,frames.length-1);}
      const target=pose?.target||e.waypoint||(e.order?.targetId?this.world.getEntity?.(e.order.targetId):null)||(e.order?.x!==undefined?e.order:null);
      const facing=e.facing??e.direction??(target?((Math.round(Math.atan2(target.y-e.y,target.x-e.x)/(Math.PI/4))+8)%8):0);
      const row=(record.directions||1)>1?clamp(Math.round(facing),0,(record.directions||1)-1):0;
      const drawWidth=type==='buildings'?Math.max(56,(size+.7)*TW):type==='resources'?72:this.unitWidth(e.kind);
      const drawHeight=drawWidth*fh/fw,pivot=anim.pivot||record.pivot||[.5,.88];
      const bob=moving&&record.directions===1?Math.sin(time*12+(e.x+e.y))*1.1:0;
      c.drawImage(img,frames[index]*fw,row*fh,fw,fh,p.x-drawWidth*pivot[0],p.y-drawHeight*pivot[1]+bob,drawWidth,drawHeight);
    }else{
      const sprite=this.fallback(e,type);c.drawImage(sprite.canvas,p.x-sprite.pivotX,p.y-sprite.pivotY);
    }
    c.restore();
    if(unit){
      if(pose?.active)this.drawWeaponAction(c,e,p,pose);
      c.fillStyle=this.teamColor(e.team);c.fillRect(p.x-3,p.y-43,6,2);
      if(e.carry?.amount>0){c.fillStyle=e.carry.kind==='gold'?'#dab257':e.carry.kind==='wood'?'#775a3d':'#d3ba7d';c.fillRect(p.x+5,p.y-13,5,6);}
    }else if(type==='buildings'){
      if(e.kind==='gate'&&e.open){c.strokeStyle='#e8e4be';c.lineWidth=2;c.beginPath();c.moveTo(p.x-10,p.y-17);c.lineTo(p.x-17,p.y-25);c.moveTo(p.x+10,p.y-17);c.lineTo(p.x+17,p.y-25);c.stroke();}
      if(e.queue?.length){const q=e.queue[0],progress=q.progress??1-(q.remaining||0)/(q.duration||1);c.fillStyle='#547147';c.fillRect(p.x-7,p.y+7,14,3);c.fillStyle='#f7e3a5';c.fillRect(p.x-7,p.y+7,Math.max(0,Math.min(14,progress*14)),3);}
    }
  }

  unitWidth(kind){const animated=this.atlas.units?.[kind]?.directions===8&&this.atlas.units[kind].actions?.death;return animated?(kind==='heavy_knight'?96:90):kind.includes('boat')?73:kind==='heavy_knight'?76:kind==='siege_engine'?64:58;}

  // All visual pools are bounded and reset with the world; no visual state enters a save.
  updateCombat(){
    const time=this.world.state.time||0,last=this.world.combatSequence||0;
    const append=(pool,value,limit)=>{if(pool.length>=limit)pool.shift();pool.push(value);};
    for(let seq=Math.max(this.combatSequence+1,last-511);seq<=last;seq++){
      const event=this.world.combatEvents?.[(seq-1)%512];
      if(!event||event.seq!==seq||time-event.time>1.5)continue;
      const {source,target,kind}=event;
      if((kind==='attack'||kind==='cast'||kind==='support')&&source){
        const old=this.combatPoses.get(source.id)||{};this.combatPoses.set(source.id,{...old,attack:event});
      }
      if(kind==='hit'&&target){
        const old=this.combatPoses.get(target.id)||{};this.combatPoses.set(target.id,{...old,hit:event});
        append(this.combatBursts,event,128);
        if(UNITS[target.kind]&&!target.kind.includes('boat')&&target.kind!=='siege_engine')append(this.bloodDecals,event,192);
      }
      if(kind==='death'&&target)append(this.bodies,event,96);
    }
    this.combatSequence=last;
    while(this.combatPoses.size>2048)this.combatPoses.delete(this.combatPoses.keys().next().value);
    for(const [id,pose] of this.combatPoses)if(time-Math.max(pose.attack?.time??-9,pose.hit?.time??-9)>1.5)this.combatPoses.delete(id);
    while(this.combatBursts.length&&time-this.combatBursts[0].time>1.1)this.combatBursts.shift();
    while(this.bloodDecals.length&&time-this.bloodDecals[0].time>45)this.bloodDecals.shift();
    while(this.bodies.length&&time-this.bodies[0].time>30)this.bodies.shift();
    for(const [id,flight] of this.projectileVisuals||[])if(flight.seenFrame<this.stats.frames-1)this.projectileVisuals.delete(id);
    this.stats.combat={bursts:this.combatBursts.length,decals:this.bloodDecals.length,bodies:this.bodies.length,poses:this.combatPoses.size,sequence:last};
  }

  combatVisible(p){const b=this.combatBounds;return !b||p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom;}

  unitPose(e,time){
    const state=this.combatPoses.get(e.id),attack=state?.attack,hit=state?.hit;
    const target=attack&&time-attack.time<.6?attack.target:this.world.getEntity?.(e.order?.targetId||e.autoTarget);
    const age=attack?time-attack.time:9;
    const d=UNITS[e.kind];
    const ready=target&&target.hp>0&&target.team!==e.team&&d?.attack&&Math.hypot(target.x-e.x,target.y-e.y)<=d.range+(BUILDINGS[target.kind]?.size||0)*.5+.05;
    const windup=ready&&e.cooldown>0&&e.cooldown<.24;
    const active=age>=0&&age<.55||windup;
    const direction=target?this.project(target.x-e.x,target.y-e.y):{x:1,y:0};
    const length=Math.hypot(direction.x,direction.y)||1,nx=direction.x/length,ny=direction.y/length;
    const progress=windup?1-e.cooldown/.24:clamp(age/.45,0,1);
    const lunge=active?(windup?-3*progress:Math.sin(Math.min(1,age/.34)*Math.PI)*(d?.projectile?2:11)):0;
    let dx=nx*lunge,dy=ny*lunge,tilt=nx*(windup?-.09*progress:active?.11*Math.sin(progress*Math.PI):0);
    if(hit&&time-hit.time<.3){const impact=this.project(e.x-(hit.source?.x??e.x-1),e.y-(hit.source?.y??e.y));const len=Math.hypot(impact.x,impact.y)||1,kick=Math.sin((time-hit.time)/.3*Math.PI)*6;dx+=impact.x/len*kick;dy+=impact.y/len*kick;tilt+=impact.x/len*kick*.025;}
    return {active,windup,progress,age,target,nx,ny,dx,dy,tilt};
  }

  drawWeaponAction(c,e,p,pose){
    const {age,windup,progress,nx,ny}=pose,magic=['mage','wizard','healer'].includes(e.kind);
    const x=p.x+pose.dx,y=p.y-23+pose.dy;
    c.save();
    if(magic){
      const pulse=windup?progress:Math.max(0,1-age/.5),color=e.kind==='mage'?'#ff9b3e':e.kind==='healer'?'#a5efbb':'#bd9eff';
      c.globalAlpha=pulse*.8;c.strokeStyle=color;c.lineWidth=1.5;
      c.beginPath();c.ellipse(p.x,p.y,18+5*pulse,7+2*pulse,0,0,TAU);c.stroke();
      for(let i=0;i<5;i++){const a=i*TAU/5+progress*4;ellipse(c,x+nx*13+Math.cos(a)*9*pulse,y-5+Math.sin(a)*9*pulse,2,2,color);}
      ellipse(c,x+nx*14,y-4,3+4*pulse,3+4*pulse,color);ellipse(c,x+nx*14,y-4,2,2,'#fff4df');
    }else if(e.kind==='archer'&&(this.atlas.units?.archer?.directions||1)===1){
      c.translate(x+nx*9,y);c.rotate(Math.atan2(ny,nx));c.strokeStyle='#c5a274';c.lineWidth=2;c.beginPath();c.moveTo(1,-13);c.quadraticCurveTo(12,0,1,13);c.stroke();c.strokeStyle='#f1e6c8';c.lineWidth=.8;c.beginPath();c.moveTo(1,-13);c.lineTo(windup?-8*progress:0,0);c.lineTo(1,13);c.stroke();
      if(windup){c.strokeStyle='#e7e2d1';c.beginPath();c.moveTo(-10,0);c.lineTo(17,0);c.stroke();}
    }else if(!UNITS[e.kind]?.projectile&&age<.27&&!windup){
      const a=Math.atan2(ny,nx),sweep=age/.27;
      c.translate(x,y);c.rotate(a);c.globalAlpha=(1-sweep)*.95;
      c.strokeStyle='#eff9e4';c.lineWidth=e.kind==='heavy_knight'?4:2.4;c.beginPath();c.arc(0,0,e.kind==='heavy_knight'?29:23,-1.25+sweep*2.3,-.45+sweep*2.3);c.stroke();
      c.strokeStyle='#b1c9d8';c.lineWidth=1;c.beginPath();c.arc(0,0,31,-1.3+sweep*2.3,-.7+sweep*2.3);c.stroke();
    }
    c.restore();
  }

  drawBattlefield(c){
    const time=this.world.state.time||0;
    for(const event of this.bloodDecals){
      const p=this.project(event.target.x,event.target.y);if(!this.combatVisible(p))continue;
      const age=time-event.time;if(age<.08)continue;
      c.save();c.globalAlpha=Math.min(1,age*5,Math.max(0,(45-age)/8))*.8;
      const size=event.target.hp<=0?14:5.5;
      const direction=event.source?this.project(event.target.x-event.source.x,event.target.y-event.source.y):{x:1,y:0};
      c.translate(p.x,p.y);c.scale(1,.45);c.rotate(Math.atan2(direction.y,direction.x));
      c.beginPath();for(let i=0;i<18;i++){const a=i*TAU/18,r=size*(.45+hash(i,event.seq,3)*.65),x=Math.cos(a)*r+size*.28,y=Math.sin(a)*r;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.closePath();c.fillStyle=age>12?'#57252a':'#781b27';c.fill();
      for(let i=0;i<6;i++){const a=(hash(i,event.seq,7)-.5)*2.5,r=5+hash(i,event.seq,9)*size*1.9;ellipse(c,Math.cos(a)*r,Math.sin(a)*r, .6+hash(i,event.seq)*1.5,.5+hash(i,event.seq)*.9,'#7a1c2b');}c.restore();
    }
  }

  drawBody(c,event){
      const time=this.world.state.time||0;
      const e=event.target,p=this.project(e.x,e.y);if(!this.combatVisible(p))return;
      const age=time-event.time,fall=clamp(age/.55,0,1),record=this.atlas.units?.[e.kind],img=record&&this.images.get(record.image);
      c.save();c.globalAlpha=Math.min(1,(30-age)/4);ellipse(c,p.x+6,p.y+1,17,6,'#2d1d2288');
      const dir=event.source?Math.sign(e.x-e.y-event.source.x+event.source.y)||1:1;
      if(img){
        const fw=record.frameWidth||img.width,fh=record.frameHeight||img.height,death=record.actions?.death;
        const width=this.unitWidth(e.kind),height=width*fh/fw,pivot=death?.pivot||record.pivot||[.5,.88];
        let frame=record.actions?.idle?.frames?.[0]||0;
        if(death){frame=death.frames[Math.min(death.frames.length-1,Math.floor(age*(death.fps||12)))];c.translate(p.x+dir*fall*5,p.y);}
        else{c.translate(p.x+dir*fall*12,p.y);c.rotate(dir*fall*1.45);c.scale(1,1-fall*.23);}
        const facing=event.source?(Math.round(Math.atan2(event.source.y-e.y,event.source.x-e.x)/(Math.PI/4))+8)%8:0;
        c.drawImage(img,frame*fw,(record.directions>1?facing:0)*fh,fw,fh,-width*pivot[0],-height*pivot[1],width,height);
      }else{c.translate(p.x+dir*fall*12,p.y);c.rotate(dir*fall*1.45);const sprite=this.fallback(e,'units');c.drawImage(sprite.canvas,-sprite.pivotX,-sprite.pivotY);}
      c.restore();
      // Dropped steel and dark tissue fragments settle into the blood, with no RNG calls.
      if(age>.2){c.strokeStyle='#b9bcb0';c.lineWidth=1.5;c.beginPath();c.moveTo(p.x-16,p.y+5);c.lineTo(p.x-27,p.y+2);c.stroke();for(let i=0;i<3;i++){const ox=(hash(i,event.seq,3)-.5)*34,oy=(hash(i,event.seq,5)-.5)*12;polygon(c,[[p.x+ox-2,p.y+oy],[p.x+ox-.5,p.y+oy-1.4],[p.x+ox+2.6,p.y+oy-.3],[p.x+ox+1,p.y+oy+1.5]],i%2?'#591623':'#8d2930');}}
  }

  projectilePose(projectile){
    let flight=this.projectileVisuals.get(projectile.id);
    if(!flight){
      const source=this.world.getEntity?.(projectile.sourceId)||this.combatPoses.get(projectile.sourceId)?.attack?.source;
      const sourceKind=source?.kind;
      flight={duration:projectile.sourceId?.startsWith('b') ? .3 : Math.max(.12,Math.hypot(projectile.targetX-projectile.x,projectile.targetY-projectile.y)/14),magic:projectile.kind==='fireball'||sourceKind==='wizard',stone:projectile.kind==='stone',color:sourceKind==='wizard'?'#b891ff':'#ff9942'};
      if(this.projectileVisuals.size>=4096)this.projectileVisuals.delete(this.projectileVisuals.keys().next().value);
      this.projectileVisuals.set(projectile.id,flight);
    }
    flight.seenFrame=this.stats.frames;
    const target=this.world.getEntity?.(projectile.targetId);
    const from=this.project(projectile.x,projectile.y),to=this.project(target?.hp>0?target.x:projectile.targetX,target?.hp>0?target.y:projectile.targetY);
    const progress=clamp(1-projectile.ttl/flight.duration,0,1);
    return {x:from.x+(to.x-from.x)*progress,y:from.y+(to.y-from.y)*progress-24-Math.sin(progress*Math.PI)*(flight.stone?48:flight.magic?3:13),angle:Math.atan2(to.y-from.y,to.x-from.x),...flight};
  }

  drawProjectile(c,projectile){
    const {x,y,angle,color,magic,stone}=this.projectilePose(projectile);
    if(!this.combatVisible({x,y}))return;
    c.save();c.translate(x,y);c.rotate(angle);
    if(magic){for(let i=5;i>=0;i--){c.globalAlpha=(1-i/7)*.7;ellipse(c,-i*4,0,6-i*.6,4-i*.35,color);}c.globalAlpha=1;ellipse(c,0,0,5,4,'#ffe1aa');ellipse(c,1,0,2,2,'#fff8e2');}
    else if(stone){ellipse(c,0,0,6,5,'#726b62');ellipse(c,-1,-2,3,2,'#b6ac96');}
    else{c.strokeStyle='#edf0df';c.lineWidth=1.4;c.beginPath();c.moveTo(-15,0);c.lineTo(5,0);c.stroke();polygon(c,[[7,0],[2,-2],[2,2]],'#f6eed9');c.strokeStyle='#a58664';c.beginPath();c.moveTo(-13,0);c.lineTo(-17,-3);c.moveTo(-13,0);c.lineTo(-17,3);c.stroke();}
    c.restore();
  }

  drawCombatBursts(c){
    const time=this.world.state.time||0;
    for(const event of this.combatBursts){
      const age=time-event.time,e=event.target,p=this.project(e.x,e.y);if(age<0||age>1||!this.combatVisible(p))continue;
      const organic=UNITS[e.kind]&&!e.kind.includes('boat')&&e.kind!=='siege_engine',magic=['mage','wizard'].includes(event.source?.kind);
      const direction=event.source?this.project(e.x-event.source.x,e.y-event.source.y):{x:1,y:0},angle=Math.atan2(direction.y,direction.x);
      c.save();
      if(magic&&age<.55){const t=age/.55;c.globalAlpha=(1-t)*.7;const color=event.source.kind==='mage'?'#f47c34':'#a08bea';const glow=c.createRadialGradient(p.x,p.y-16,0,p.x,p.y-16,8+t*32);glow.addColorStop(0,'#fff0c8');glow.addColorStop(.3,color);glow.addColorStop(1,'#00000000');ellipse(c,p.x,p.y-16,8+t*32,8+t*32,glow);c.strokeStyle='#ffd789';c.lineWidth=2*(1-t);c.beginPath();c.ellipse(p.x,p.y,8+t*38,4+t*16,0,0,TAU);c.stroke();}
      const lethal=organic&&e.hp<=0,count=organic?(lethal?20:12):8;
      c.lineCap='butt';
      for(let i=0;i<count;i++){
        const seed=hash(i,event.seq,8),a=angle+(seed-.5)*(lethal?2.5:1.9),velocity=20+hash(i,event.seq,4)*(lethal?90:65),t=Math.min(age,.65);
        const vx=Math.cos(a)*velocity,vy=Math.sin(a)*velocity*.65-35+200*t;
        const x=p.x+vx*t,y=p.y-23+Math.sin(a)*velocity*t*.65-35*t+100*t*t;
        c.globalAlpha=Math.max(0,1-age/(organic?.75:.4));
        if(organic){
          // Tapered, ballistic drops stay fine at close zoom and readable at 100%.
          // Dark angular silhouettes avoid the rounded pink capsule/heart appearance.
          const length=Math.hypot(vx,vy)||1,nx=vx/length,ny=vy/length;
          const width=clamp((.65+seed*.65)/Math.sqrt(this.camera.zoom||1),.6,1.5),tail=1.5+seed*3.8;
          const color=i%5===0?'#a32b32':i%2?'#701520':'#8b1b29';
          if(lethal&&i<3){
            const r=1.5+seed*1.7;
            polygon(c,[[x-r,y-r*.3],[x-r*.2,y-r],[x+r,y-r*.15],[x+r*.35,y+r*.7],[x-r*.6,y+r*.4]],i%2?'#58101d':'#8d2630');
          }else{
            polygon(c,[[x+nx*width,y+ny*width],[x-ny*width*.6,y+nx*width*.6],[x-nx*tail,y-ny*tail],[x+ny*width*.4,y-nx*width*.4]],color);
          }
        }else{c.strokeStyle='#ffe4a6';c.lineWidth=1.2;c.beginPath();c.moveTo(x,y);c.lineTo(x-Math.cos(a)*7,y-Math.sin(a)*7);c.stroke();}
      }
      if(age<.09&&(!organic||(UNITS[e.kind]?.armor||0)>0)){
        c.globalAlpha=(1-age/.09)*.8;c.strokeStyle='#eed39a';c.lineWidth=.75;
        for(let i=0;i<3;i++){const a=angle+i*2.1;c.beginPath();c.moveTo(p.x+Math.cos(a)*2,p.y-23+Math.sin(a)*2);c.lineTo(p.x+Math.cos(a)*6,p.y-23+Math.sin(a)*6);c.stroke();}
      }
      c.restore();
    }
  }

  teamColor(team){return this.world.state.teams?.[team]?.color||(team===1?'#d0b570':'#ab5e5e');}
  drawEffect(c,effect){
    const life=effect.life??effect.ttl??.5,kind=effect.kind;
    if(kind==='rubble'||kind==='building_rubble'){
      const size=effect.size||BUILDINGS[effect.entityKind]?.size||2,p=this.project((effect.x||0)+(size-1)/2,(effect.y||0)+(size-1)/2);
      c.save();c.globalAlpha=Math.min(1,life/2);ellipse(c,p.x,p.y,size*21,size*9,'#736e4c50');
      for(let i=0;i<Math.min(17,5+size*3);i++){const x=p.x+(hash(i,Math.floor(effect.x),2)-.5)*size*38,y=p.y+(hash(i,Math.floor(effect.y),9)-.5)*size*15,s=4+hash(i,3,7)*6;polygon(c,[[x-s,y],[x-s*.5,y-s],[x+s*.4,y-s*1.2],[x+s,y],[x,y+s*.4]],i%2?'#aaa58b':'#c5bfa5','#858b7255');}
      c.strokeStyle='#887856';c.lineWidth=3;c.beginPath();c.moveTo(p.x-size*10,p.y+4);c.lineTo(p.x+size*12,p.y-7);c.moveTo(p.x+size*4,p.y+10);c.lineTo(p.x-size*9,p.y-10);c.stroke();
      if(life>6){ellipse(c,p.x-8,p.y-17-(8-life)*10,8,12,'#a2a78b66');ellipse(c,p.x+13,p.y-12-(8-life)*8,11,15,'#d4c9aa4d');}c.restore();return;
    }
    const p=this.project(effect.x||0,effect.y||0);
    if(kind==='death'&&this.world.combatEvents)return;
    if(kind==='death'||kind==='death_dust'){
      c.save();c.globalAlpha=Math.min(1,life*1.2);ellipse(c,p.x,p.y,12,5,'#746f4e3b');polygon(c,[[p.x-10,p.y-3],[p.x+1,p.y-7],[p.x+10,p.y],[p.x-1,p.y+3]],this.teamColor(effect.team));
      const age=Math.max(0,1.2-life);for(let i=0;i<7;i++){const angle=i*TAU/7,spread=age*18;ellipse(c,p.x+Math.cos(angle)*spread,p.y-7-age*13+Math.sin(angle)*spread*.4,1.2,1.2,i%2?'#d4c99d':'#edf0cc');}c.restore();return;
    }
    c.strokeStyle=kind==='heal'?'#d5efd0bb':kind==='fireball'?'#f0b681cc':'#f5d795aa';c.lineWidth=1.5;c.beginPath();c.ellipse(p.x,p.y-12,kind==='fireball'?26+life*22:8+life*12,kind==='fireball'?13+life*11:4+life*6,0,0,TAU);c.stroke();
  }
  health(c,e,x,y,width){c.fillStyle='#233c30bb';c.fillRect(x-width/2,y,width,3);c.fillStyle=e.team===1?'#c9d99a':'#d29284';c.fillRect(x-width/2,y,width*clamp(e.hp/e.maxHp,0,1),3);}
  drawFootprint(c,x,y,size,fill,stroke){const a=this.project(x-.5,y-.5),b=this.project(x+size-.5,y-.5),d=this.project(x-.5,y+size-.5),f=this.project(x+size-.5,y+size-.5);polygon(c,[[a.x,a.y],[b.x,b.y],[f.x,f.y],[d.x,d.y]],fill,stroke);}
  drawConstruction(c,e,p,size,time){
    c.fillStyle='#efe8d9';c.globalAlpha=.42;c.fillRect(p.x-size*16,p.y-size*17,size*32,size*18);c.globalAlpha=1;
    c.strokeStyle='#8a6a44';c.lineWidth=2;
    for(let i=-1;i<=1;i++){const x=p.x+i*size*14;c.beginPath();c.moveTo(x,p.y+3);c.lineTo(x,p.y-size*25);c.stroke();}
    c.beginPath();c.moveTo(p.x-size*18,p.y-size*10);c.lineTo(p.x+size*18,p.y-size*10);c.moveTo(p.x-size*18,p.y-size*20);c.lineTo(p.x+size*18,p.y-size*20);c.stroke();
    const progress=clamp(e.progress||0,0,1);c.fillStyle='#3f4e36';c.fillRect(p.x-24,p.y+10,48,4);c.fillStyle='#d4b975';c.fillRect(p.x-24,p.y+10,48*progress,4);
  }
  drawPlacement(c,placement){
    const {kind,x,y,endX,endY}=placement,size=BUILDINGS[kind]?.size||1;
    const blocked=placement.valid===false;const fill=blocked?'#b65b5155':'#e8e4a955',stroke=blocked?'#ef9685':'#fff0ba';
    if((kind==='wall'||kind==='palisade')&&endX!==undefined){
      const dx=endX-x,dy=endY-y,n=Math.max(Math.abs(dx),Math.abs(dy));
      for(let i=0;i<=Math.min(n,79);i++)this.drawFootprint(c,Math.round(x+dx*i/(n||1)),Math.round(y+dy*i/(n||1)),1,fill,stroke);
    }else{
      this.drawFootprint(c,x,y,size,fill,stroke);
      const p=this.project(x+(size-1)/2,y+(size-1)/2);c.globalAlpha=.65;this.drawEntity(c,{kind,x,y,team:1,id:'ghost',progress:1},'buildings',p,this.world.state.time);c.globalAlpha=1;
    }
  }

  fallback(e,type){
    const variant=type==='resources'?Math.floor(hash(Math.floor(e.x),Math.floor(e.y),3)*4):0;
    const key=`${type}:${e.kind}:${e.team||0}:${variant}:${e.open?'open':'closed'}`;
    if(this.fallbacks.has(key))return this.fallbacks.get(key);
    const size=type==='buildings'?(BUILDINGS[e.kind]?.size||1):1;
    const width=type==='buildings'?size*TW+70:type==='resources'?100:90,height=type==='buildings'?size*34+110:type==='resources'?125:96;
    const canvas=makeCanvas(width,height),c=canvas.getContext('2d'),px=width/2,py=height-17;
    if(type==='resources')this.paintResource(c,e.kind,px,py,variant);
    else if(type==='buildings')this.paintBuilding(c,e.kind,px,py,size,this.teamColor(e.team),e.open);
    else this.paintUnit(c,e.kind,px,py,this.teamColor(e.team));
    const result={canvas,pivotX:px,pivotY:py};this.fallbacks.set(key,result);return result;
  }

  paintResource(c,kind,x,y,variant){
    if(kind==='wood'){
      const h=58+variant*8;
      ellipse(c,x+5,y+2,25,9,'#335a3830');polygon(c,[[x-3,y],[x+4,y],[x+3,y-h+8],[x-3,y-h+10]],'#796c4a');
      const colors=['#517a4f','#628556','#7e9b61','#8fa970','#456d4d'];
      for(let i=0;i<13;i++){const a=hash(i,variant,4)*TAU,r=hash(i,variant,8)*21;ellipse(c,x+Math.cos(a)*r,y-h+14+Math.sin(a)*r*.65,16+hash(i,variant,1)*7,15+hash(i,variant,7)*6,colors[i%5]);}
      ellipse(c,x-10,y-h+2,12,9,'#a4ba7a50');c.strokeStyle='#dae7a13b';c.lineWidth=1;c.beginPath();c.moveTo(x-21,y-h+11);c.lineTo(x-13,y-h+8);c.stroke();
    }else if(kind==='food'){
      ellipse(c,x,y,20,8,'#3e5e3540');for(let i=0;i<8;i++){const dx=(hash(i,variant,2)-.5)*31,dy=(hash(i,variant,5)-.5)*9;ellipse(c,x+dx,y-6+dy,8,7,i%2?'#68844d':'#819458');if(i%2){ellipse(c,x+dx-2,y-8+dy,1.8,1.8,'#d89b8c');ellipse(c,x+dx+3,y-10+dy,1.4,1.4,'#d2aa8c');}}
    }else if(kind==='fish'){
      c.strokeStyle='#e8ebc16b';c.lineWidth=1;c.beginPath();c.ellipse(x,y,16,6,0,0,TAU);c.stroke();ellipse(c,x-3,y-2,5,2,'#d0d6bf');polygon(c,[[x+2,y-2],[x+7,y-4],[x+7,y]],'#d0d6bf');
    }else{
      ellipse(c,x+3,y+2,22,8,'#28483926');
      for(let i=0;i<5;i++){const dx=(i-2)*8,dy=(i%2)*4;polygon(c,[[x+dx-9,y+dy],[x+dx-5,y-16-i%3*5],[x+dx+3,y-22-i%2*4],[x+dx+10,y+dy-2],[x+dx+2,y+dy+5]],kind==='gold'?(i%2?'#bca369':'#d5bc77'):(i%2?'#a8afa2':'#8e9b8f'),'#71827255');polygon(c,[[x+dx-5,y-16-i%3*5],[x+dx+3,y-22-i%2*4],[x+dx+1,y-6]],kind==='gold'?'#edda94':'#c1c9b6');}
    }
  }

  paintBuilding(c,kind,x,y,size,teamColor,open){
    const w=size*HW*.9,d=size*HH*.9,h=kind==='guildhall'?62:kind.includes('tower')||kind==='watchtower'?82:kind==='fortress'?78:kind==='wonder'?96:30+size*5;
    const stone='#c5c3ab',light='#e6dfc5',dark='#a9af98',roof=kind==='arcane_tower'||kind==='academy'?'#5d6578':kind==='barracks'||kind==='fortress'?'#76665b':'#789480';
    if(kind==='farm'){
      polygon(c,[[x-w,y],[x,y-d],[x+w,y],[x,y+d]],'#a58e5c','#d4c293');
      for(let i=-3;i<=3;i++){c.strokeStyle=i%2?'#d2bf73':'#7b9253';c.lineWidth=4;c.beginPath();c.moveTo(x-w*.65+i*4,y-d*.25+i*2);c.lineTo(x+w*.55+i*4,y+d*.25+i*2);c.stroke();}return;
    }
    if(kind==='wall'||kind==='palisade'||kind==='gate'){
      const wood=kind==='palisade',height=wood?27:35;
      polygon(c,[[x-23,y],[x,y+12],[x,y+12-height],[x-23,y-height]],wood?'#8b7e58':dark);
      polygon(c,[[x,y+12],[x+23,y],[x+23,y-height],[x,y+12-height]],wood?'#b3a373':stone);
      polygon(c,[[x-23,y-height],[x,y+12-height],[x+23,y-height],[x,y-12-height]],wood?'#c2b181':light);
      if(wood){c.strokeStyle='#625c43';for(let i=-18;i<20;i+=7){c.beginPath();c.moveTo(x+i,y+8-Math.abs(i)*.45);c.lineTo(x+i,y-height+7-Math.abs(i)*.45);c.stroke();}}
      else{c.strokeStyle='#7f8d7e55';for(let i=0;i<3;i++){c.beginPath();c.moveTo(x-23,y-height+i*10+10);c.lineTo(x,y-height+i*10+22);c.lineTo(x+23,y-height+i*10+10);c.stroke();}}
      if(kind==='gate'){if(open){c.clearRect(x-8,y-22,16,23);}else{polygon(c,[[x-8,y-2],[x,y+4],[x+8,y],[x+8,y-22],[x,y-28],[x-8,y-23]],'#645d45');}c.fillStyle=teamColor;c.fillRect(x-2,y-49,3,11);polygon(c,[[x+1,y-49],[x+13,y-45],[x+1,y-41]],teamColor);}return;
    }
    if(kind==='wonder'){
      ellipse(c,x,y,61,20,'#c9c9a0');for(let i=0;i<5;i++){c.strokeStyle='#7b7256';c.lineWidth=10-i;c.beginPath();c.moveTo(x+(i-2)*10,y);c.bezierCurveTo(x+(i-2)*3,y-45,x+(i-2)*15,y-75,x+(i-2)*23,y-93);c.stroke();}for(let i=0;i<25;i++){const a=hash(i,1,3)*TAU,r=hash(i,1,5)*48;ellipse(c,x+Math.cos(a)*r,y-105+Math.sin(a)*r*.7,18,14,i%3?'#a8ba7a':'#d1cf96');}ellipse(c,x,y-101,14,18,'#eee1ad77');return;
    }
    if(kind==='dock'){
      polygon(c,[[x-w,y],[x,y-d],[x+w,y],[x,y+d]],'#b8a481','#8f866a');c.strokeStyle='#81785f';for(let i=-4;i<5;i++){c.beginPath();c.moveTo(x-w*.7+i*7,y-3+i*3);c.lineTo(x+w*.4+i*7,y+15+i*3);c.stroke();}
    }
    if(kind==='lumber_camp'||kind==='mining_camp'){
      for(let i=0;i<6;i++){const dx=(i%3-1)*12,dy=Math.floor(i/3)*6;polygon(c,[[x+dx-12,y+dy],[x+dx+6,y+dy+8],[x+dx+17,y+dy],[x+dx-1,y+dy-8]],kind==='lumber_camp'?'#91734e':'#9ba28e','#66776166');}
    }
    polygon(c,[[x-w,y],[x,y+d],[x,y+d-h],[x-w,y-h]],dark,'#6f7e6355');
    polygon(c,[[x,y+d],[x+w,y],[x+w,y-h],[x,y+d-h]],light,'#8e977c44');
    polygon(c,[[x-w,y-h],[x,y+d-h],[x+w,y-h],[x,y-d-h]],stone);
    // Plaster, beams and tiny illuminated windows keep the settlement readable.
    c.strokeStyle='#8e8a6a88';c.lineWidth=2;
    c.beginPath();c.moveTo(x,y+d);c.lineTo(x,y+d-h);c.moveTo(x+w*.87,y+d*.13);c.lineTo(x+w*.87,y-h+d*.13);c.moveTo(x-w*.88,y+d*.12);c.lineTo(x-w*.88,y-h+d*.12);c.stroke();
    const roofRise=kind==='fortress'?6:kind==='watchtower'?20:25+size*3;
    if(kind==='fortress'){
      polygon(c,[[x-w-4,y-h],[x,y+d-h+4],[x+w+4,y-h],[x,y-d-h-4]],'#9ba68d','#74826d');
      for(let i=-2;i<=2;i++)polygon(c,[[x+i*18-6,y+d*.6-h+i*3],[x+i*18+3,y+d*.6-h+i*3+4],[x+i*18+3,y+d*.6-h+i*3-8],[x+i*18-6,y+d*.6-h+i*3-12]],light,'#9ba58f');
    }else{
      polygon(c,[[x-w-7,y-h-1],[x,y+d-h+5],[x+5,y-h-roofRise],[x-w*.2,y-d-h-roofRise*.45]],'#587b69','#3e64573b');
      polygon(c,[[x,y+d-h+5],[x+w+7,y-h-1],[x+w*.22,y-d-h-roofRise*.45],[x+5,y-h-roofRise]],roof,'#4d6c5f55');
      c.strokeStyle='#d1d6b636';c.lineWidth=1;for(let i=1;i<6;i++){c.beginPath();c.moveTo(x+5+(w-4)*i/7,y-h-roofRise+(roofRise-1)*i/7);c.lineTo(x+w*i/7,y+d-h+4-d*i/7);c.stroke();}
    }
    polygon(c,[[x+w*.2,y+d*.8],[x+w*.43,y+d*.57],[x+w*.43,y+d*.57-22],[x+w*.3,y+d*.7-28],[x+w*.2,y+d*.8-22]],'#6e7861');
    for(let i=0;i<(size>2?3:2);i++){const dx=-(i+1)*w/(size>2?4:3);polygon(c,[[x+dx-3,y+d+dx*.5-h*.43],[x+dx+3,y+d+(dx+6)*.5-h*.43],[x+dx+3,y+d+(dx+6)*.5-h*.43-9],[x+dx-3,y+d+dx*.5-h*.43-9]],'#6b8b79','#a8b89a');}
    if(kind==='mill'){const mx=x+8,my=y-h-15;c.strokeStyle='#e4d9b6';c.lineWidth=4;for(let i=0;i<4;i++){const a=i*TAU/4+.4;c.beginPath();c.moveTo(mx,my);c.lineTo(mx+Math.cos(a)*31,my+Math.sin(a)*31);c.stroke();}ellipse(c,mx,my,4,4,'#a18b65');}
    if(kind==='sanctuary'){c.strokeStyle='#d5c18c';c.lineWidth=3;c.beginPath();c.moveTo(x+5,y-h-roofRise-18);c.lineTo(x+5,y-h-roofRise+1);c.moveTo(x-2,y-h-roofRise-10);c.lineTo(x+12,y-h-roofRise-10);c.stroke();}
    if(kind==='forge'){polygon(c,[[x-w*.4,y-h-10],[x-w*.2,y-h-5],[x-w*.2,y-h-37],[x-w*.4,y-h-42]],'#a4ac98');ellipse(c,x-w*.3,y-h-47,7,10,'#8b9a8255');}
    c.strokeStyle='#857a55';c.lineWidth=2;c.beginPath();c.moveTo(x+w*.75,y-h-2);c.lineTo(x+w*.75,y-h-35);c.stroke();polygon(c,[[x+w*.75,y-h-35],[x+w*.75+20,y-h-30],[x+w*.75,y-h-23]],teamColor);
    if(kind==='guildhall'){c.fillStyle='#cbb276';c.font='16px Georgia';c.textAlign='center';c.fillText('✦',x+18,y-h-12);}
    for(let i=0;i<4;i++){const dx=(hash(i,size,5)-.5)*w*1.7;ellipse(c,x+dx,y+d+3+(i%2)*4,3,2,i%2?'#c5b789':'#81945e');}
  }

  paintUnit(c,kind,x,y,teamColor){
    if(kind.includes('boat')){
      ellipse(c,x,y+2,31,8,'#d8e5cc66');polygon(c,[[x-31,y-7],[x-20,y+4],[x+15,y+5],[x+31,y-8],[x+8,y-14]],'#8e7852','#5d6750');c.strokeStyle='#756a50';c.lineWidth=2;c.beginPath();c.moveTo(x,y-6);c.lineTo(x,y-52);c.stroke();polygon(c,[[x+2,y-50],[x+2,y-14],[x+24,y-19]],'#eadfb7');polygon(c,[[x-2,y-45],[x-2,y-17],[x-16,y-20]],teamColor);return;
    }
    if(kind==='siege_engine'){
      polygon(c,[[x-21,y-8],[x+3,y+4],[x+24,y-9],[x,y-20]],'#aa9260','#6a7052');ellipse(c,x-13,y-4,5,9,'#64734e');ellipse(c,x+17,y-7,5,9,'#64734e');c.strokeStyle='#76694c';c.lineWidth=5;c.beginPath();c.moveTo(x-2,y-7);c.lineTo(x+3,y-32);c.lineTo(x-15,y-48);c.stroke();ellipse(c,x-15,y-48,8,4,'#a8b28e');return;
    }
    const mounted=['scout','cavalry','heavy_knight'].includes(kind),heavy=kind==='heavy_knight',mage=['mage','healer','wizard'].includes(kind);
    if(mounted){ellipse(c,x,y-13,18,10,'#a9a489');ellipse(c,x+13,y-23,7,12,'#bcb79c');c.strokeStyle='#7b8066';c.lineWidth=3;for(let i=-1;i<=1;i+=2){c.beginPath();c.moveTo(x+i*12,y-12);c.lineTo(x+i*13,y-1);c.stroke();}polygon(c,[[x-11,y-21],[x+9,y-25],[x+10,y-10],[x-9,y-10]],teamColor);y-=18;}
    c.strokeStyle='#5d6652';c.lineWidth=3;c.beginPath();c.moveTo(x-4,y-10);c.lineTo(x-5,y);c.moveTo(x+3,y-10);c.lineTo(x+5,y);c.stroke();
    const cloak=mage?(kind==='healer'?'#e0d9bd':'#74788f'):kind==='assassin'?'#5b6873':kind==='archer'?'#77936a':teamColor;
    polygon(c,[[x-6,y-28],[x+5,y-28],[x+9,y-7],[x-8,y-8]],cloak,'#56684b55');
    if(heavy||kind==='infantry'){polygon(c,[[x-6,y-28],[x+6,y-28],[x+7,y-14],[x,y-11],[x-7,y-14]],'#c6ceb8','#7f937b');polygon(c,[[x-12,y-24],[x-5,y-26],[x-3,y-13],[x-10,y-10]],teamColor,'#cad4b7');}
    ellipse(c,x,y-34,5.5,6,'#e4ceb2');ellipse(c,x-1,y-38,5.5,3,'#887550');
    if(heavy){polygon(c,[[x-6,y-33],[x-6,y-40],[x,y-43],[x+6,y-40],[x+6,y-33]],'#c4d0bb','#7d967f');c.fillStyle='#627766';c.fillRect(x-3,y-36,6,2);}
    if(mage){polygon(c,[[x-8,y-38],[x+1,y-50],[x+7,y-38]],cloak);c.strokeStyle='#8f8860';c.lineWidth=2;c.beginPath();c.moveTo(x+11,y-2);c.lineTo(x+10,y-40);c.stroke();ellipse(c,x+10,y-42,3,4,kind==='healer'?'#d9e7ac':'#dcc99e');}
    else if(kind==='archer'){c.strokeStyle='#8d7751';c.lineWidth=1.8;c.beginPath();c.arc(x+8,y-21,12,-1.3,1.3);c.stroke();c.strokeStyle='#dfd5ae';c.beginPath();c.moveTo(x+11,y-33);c.lineTo(x+11,y-9);c.stroke();}
    else if(kind!=='villager'){c.strokeStyle='#ccd6b7';c.lineWidth=2;c.beginPath();c.moveTo(x+9,y-11);c.lineTo(x+14,y-37);c.stroke();}
    else{c.strokeStyle='#8c7953';c.lineWidth=2;c.beginPath();c.moveTo(x+9,y-6);c.lineTo(x+10,y-28);c.stroke();c.strokeStyle='#bec7a8';c.lineWidth=3;c.beginPath();c.moveTo(x+5,y-29);c.lineTo(x+15,y-29);c.stroke();}
    c.strokeStyle='#e0c7a5';c.lineWidth=3;c.beginPath();c.moveTo(x+5,y-26);c.lineTo(x+9,y-18);c.stroke();
  }

  drawMinimap(canvas){
    const c=canvas.getContext('2d'),{map,units,buildings}=this.world.state,w=canvas.width,h=canvas.height;
    c.clearRect(0,0,w,h);c.drawImage(this.minimapCache,0,0,w,h);
    const sx=w/map.width,sy=h/map.height;
    for(const b of buildings){if(b.hp<=0)continue;c.fillStyle=b.team===1?'#f1d288':'#b95950';const size=BUILDINGS[b.kind]?.size||1;c.fillRect(b.x*sx,b.y*sy,Math.max(3,size*sx),Math.max(3,size*sy));}
    for(const u of units){if(u.hp<=0)continue;c.fillStyle=u.team===1?'#f7e8b2':'#a94d49';c.fillRect(u.x*sx,u.y*sy,1.4,1.4);}
    const r=this.canvas.getBoundingClientRect(),corners=[[r.left,r.top],[r.right,r.top],[r.right,r.bottom],[r.left,r.bottom]].map(([x,y])=>this.screenToWorld(x,y));
    polygon(c,corners.map(p=>[p.x*sx,p.y*sy]),'#fff8d80b','#f8efc9');
  }

  destroy(){this.resizeObserver.disconnect();this.assetEpoch++;this.images.clear();this.fallbacks.clear();}
}

/** Original menu landscape while the generated panorama is loading. */
export function drawMenuLandscape(canvas){
  const rect=canvas.getBoundingClientRect();canvas.width=Math.max(600,rect.width);canvas.height=Math.max(700,rect.height);
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const sky=c.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#a6c2c1');sky.addColorStop(.5,'#dde3bc');sky.addColorStop(1,'#80956b');c.fillStyle=sky;c.fillRect(0,0,w,h);
  ellipse(c,w*.64,h*.26,w*.16,w*.16,'#f7eab864');
  for(let layer=0;layer<4;layer++){
    c.fillStyle=['#b4c4b0','#98b2a0','#7e9d83','#718e70'][layer];c.beginPath();c.moveTo(0,h);
    for(let x=0;x<=w+20;x+=20){c.lineTo(x,h*(.38+layer*.085)+Math.sin(x/w*5+layer)*h*.035+Math.cos(x/w*11+layer)*h*.017);}c.lineTo(w,h);c.closePath();c.fill();
  }
  // Pastoral river and original distant settlement; no reference pixels are used.
  c.strokeStyle='#b4d3c5';c.lineWidth=w*.065;c.beginPath();c.moveTo(w*.88,h*.53);c.bezierCurveTo(w*.28,h*.65,w*.8,h*.76,w*.42,h);c.stroke();
  for(let i=0;i<7;i++){const x=w*(.45+i*.04),y=h*(.59+Math.sin(i)*.012);polygon(c,[[x-7,y],[x+8,y],[x+8,y-19],[x-7,y-19]],'#d8dbc2');polygon(c,[[x-11,y-19],[x+1,y-34],[x+12,y-19]],'#657d72');}
  for(let i=0;i<280;i++){const x=hash(i,4,1)*w,y=h*(.68+hash(i,4,7)*.34),scale=(y/h-.5)*4;const color=['#d6d4a0','#a6b97d','#e5dca5','#d8bdb3','#ebdfbb'][i%5];c.strokeStyle='#708455';c.lineWidth=scale*.4;c.beginPath();c.moveTo(x,y+5*scale);c.lineTo(x,y);c.stroke();ellipse(c,x,y,1.7*scale,1.2*scale,color);}
  for(let side=0;side<2;side++){
    const x=side?w*.98:w*.02;c.strokeStyle='#385747';c.lineWidth=w*.045;c.beginPath();c.moveTo(x,h);c.bezierCurveTo(x+w*.02,h*.6,x-w*.02,h*.32,x,h*.05);c.stroke();
    for(let i=0;i<24;i++){const xx=x+(hash(i,side,3)-.5)*w*.35,yy=hash(i,side,8)*h*.32;ellipse(c,xx,yy,w*.13,h*.09,i%2?'#4c7159':'#5c7f62');}
  }
}
