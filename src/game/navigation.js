import { TERRAIN, BUILDINGS } from './data.js';
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const FIELD_LIMIT = 128;
const PENDING_LIMIT = 2048;

/** Bounded tile navigation. Groups share reverse distance fields; A* is also exposed. */
export class Navigation {
  constructor(world) {
    this.world = world;
    this.version = world.state.navigationVersion || 0;
    this.fields = new Map();
    this.queryCache = new Map();
    this.pending = new Map();
    this.stats = {builtTotal:0,builtThisStep:0,maxBuiltPerStep:0,deferredTotal:0};
    this.stepLimit = null;
    this.stepUsed = 0;
    const savedFields = world.state.navigationFields?.slice() || [];
    const savedQueue = world.state.navigationQueue?.slice() || [];
    this.rebuild(true);
    // Save descriptors, rather than large derived arrays, in cache insertion order.
    for (const saved of savedFields) {
      const descriptor = this.descriptor(saved.x,saved.y,saved.movement,saved.footprint);
      if (!descriptor || this.fields.has(this.key(descriptor)) || this.fields.size>=FIELD_LIMIT) throw new Error('Invalid saved navigation field descriptor.');
      const goals = this.goals(descriptor);
      if (!goals.length) throw new Error('Saved navigation field has no reachable goals.');
      this.rememberField(this.buildField(descriptor,goals));
    }
    for (const saved of savedQueue) {
      const descriptor = this.descriptor(saved.x,saved.y,saved.movement,saved.footprint);
      if (!descriptor) throw new Error('Invalid saved navigation queue descriptor.');
      const key = this.key(descriptor);
      if (this.fields.has(key) || this.pending.has(key) || this.pending.size>=PENDING_LIMIT) throw new Error('Invalid saved navigation queue descriptor.');
      if (!this.goals(descriptor).length) throw new Error('Saved navigation queue entry has no reachable goals.');
      this.pending.set(key,descriptor);
    }
    if (savedFields.length || savedQueue.length) this.syncDescriptors();
  }
  rebuild(initial=false) {
    const { map, buildings } = this.world.state;
    this.blocked = new Uint8Array(map.width * map.height);
    for (const b of buildings) if (b.hp > 0 && !(b.kind === 'gate' && b.open)) {
      const size = BUILDINGS[b.kind].size;
      for (let y = b.y; y < b.y + size; y++) for (let x = b.x; x < b.x + size; x++) this.blocked[y * map.width + x] = 1;
    }
    if(!initial)this.version++;this.world.state.navigationVersion=this.version;this.fields.clear();this.queryCache.clear();this.pending.clear();
    if (!initial) this.syncDescriptors();
  }
  walkable(x, y, movement = 'land') {
    const m = this.world.state.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
    const t = m.terrain[y * m.width + x];
    return movement === 'water' ? t === TERRAIN.WATER : t !== TERRAIN.WATER && t !== TERRAIN.CLIFF && !this.blocked[y * m.width + x];
  }
  nearest(x, y, movement = 'land', maxRadius = 12) {
    x = Math.floor(x); y = Math.floor(y);
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx),Math.abs(dy)) !== r) continue;
        if (this.walkable(x+dx,y+dy,movement)) return {x:x+dx+.5,y:y+dy+.5};
      }
    }
    return null;
  }
  segmentClear(x0,y0,x1,y1,movement='land') {
    if (![x0,y0,x1,y1].every(Number.isFinite)) return false;
    let x=Math.floor(x0),y=Math.floor(y0);
    const endX=Math.floor(x1),endY=Math.floor(y1);
    if (!this.walkable(x,y,movement) || !this.walkable(endX,endY,movement)) return false;
    const dx=x1-x0,dy=y1-y0,sx=Math.sign(dx),sy=Math.sign(dy);
    const stepX=dx===0?Infinity:1/Math.abs(dx),stepY=dy===0?Infinity:1/Math.abs(dy);
    let nextX=dx===0?Infinity:((sx>0?x+1:x)-x0)/dx;
    let nextY=dy===0?Infinity:((sy>0?y+1:y)-y0)/dy;
    const m=this.world.state.map;
    // A segment crosses at most width + height tile boundaries.
    for (let remaining=m.width+m.height+2;remaining>0;remaining--) {
      if (x===endX && y===endY) return true;
      // A negative ray ending exactly on a boundary belongs to the endpoint's
      // floor cell; do not take one extra step beyond that endpoint.
      if (x===endX) nextX=Infinity;
      if (y===endY) nextY=Infinity;
      if (Number.isFinite(nextX) && Number.isFinite(nextY) && Math.abs(nextX-nextY)<=Number.EPSILON*8*Math.max(1,Math.abs(nextX),Math.abs(nextY))) {
        if (!this.walkable(x+sx,y,movement) || !this.walkable(x,y+sy,movement)) return false;
        x+=sx;y+=sy;nextX+=stepX;nextY+=stepY;
      } else if (nextX<nextY) { x+=sx;nextX+=stepX; }
      else { y+=sy;nextY+=stepY; }
      if (!this.walkable(x,y,movement)) return false;
    }
    return false;
  }
  descriptor(x,y,movement='land',footprint=null) {
    const m=this.world.state.map;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0 || x>=m.width || y>=m.height) return null;
    return {x:Math.floor(x)+.5,y:Math.floor(y)+.5,movement,footprint:footprint?{kind:footprint.kind,x:footprint.x,y:footprint.y}:null};
  }
  key(descriptor) {
    const {x,y,movement,footprint}=descriptor;
    return footprint?`${movement}:building:${footprint.x}:${footprint.y}:${BUILDINGS[footprint.kind].size}`:`${movement}:${Math.floor(x)}:${Math.floor(y)}`;
  }
  syncDescriptors() {
    const copy=d=>({...d,footprint:d.footprint?{...d.footprint}:null});
    this.world.state.navigationFields=Array.from(this.fields.values(),field=>copy(field.descriptor));
    this.world.state.navigationQueue=Array.from(this.pending.values(),copy);
  }
  beginStep(limit=8) {
    this.stepLimit=Number.isFinite(limit)?Math.max(0,Math.floor(limit)):8;
    this.stepUsed=0;
    this.stats.builtThisStep=0;
    const queuedAllowance=Math.floor(this.stepLimit/2);
    while (this.pending.size && this.stepUsed<queuedAllowance) {
      const [key,descriptor]=this.pending.entries().next().value;
      this.pending.delete(key);
      if (!this.fields.has(key)) {
        const goals=this.goals(descriptor);
        if (goals.length) this.admitField(descriptor,goals);
      }
    }
    if (this.world.state.navigationQueue?.length || this.pending.size) this.syncDescriptors();
  }
  endStep() { this.stepLimit=null; }
  goals(descriptor) {
    const {x,y,movement,footprint}=descriptor,gx=Math.floor(x),gy=Math.floor(y),size=footprint?BUILDINGS[footprint.kind].size:0;
    const goals=[];
    const walkable=(xx,yy)=>this.walkable(xx,yy,movement)&&(!footprint||xx<footprint.x||xx>=footprint.x+size||yy<footprint.y||yy>=footprint.y+size);
    if(footprint){
      // Every edge is a work position; never expand beyond an enclosing wall.
      // Exclude the future footprint during construction preflight as well.
      const add=(xx,yy)=>{if(walkable(xx,yy))goals.push({x:xx+.5,y:yy+.5});};
      for(let i=0;i<size;i++){
        add(footprint.x+i,footprint.y-1);add(footprint.x+i,footprint.y+size);
        add(footprint.x-1,footprint.y+i);add(footprint.x+size,footprint.y+i);
      }
    }else{
      for(let r=0;r<=12&&!goals.length;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.max(Math.abs(dx),Math.abs(dy))===r&&walkable(gx+dx,gy+dy))goals.push({x:gx+dx+.5,y:gy+dy+.5});
    }
    return goals;
  }
  buildField(descriptor,goals) {
    const m=this.world.state.map,{movement,footprint}=descriptor,size=footprint?BUILDINGS[footprint.kind].size:0,key=this.key(descriptor);
    const walkable=(xx,yy)=>this.walkable(xx,yy,movement)&&(!footprint||xx<footprint.x||xx>=footprint.x+size||yy<footprint.y||yy>=footprint.y+size);
    const distance = new Int32Array(m.width*m.height); distance.fill(-1);
    const parent = new Int32Array(distance.length); parent.fill(-1);
    const queue = new Int32Array(distance.length); let head=0, tail=0;
    for(const goal of goals){const target=Math.floor(goal.y)*m.width+Math.floor(goal.x);distance[target]=0;queue[tail++]=target;}
    while(head<tail) {
      const at=queue[head++], ax=at%m.width, ay=Math.floor(at/m.width);
      for(const [dx,dy] of DIRS) { const nx=ax+dx,ny=ay+dy,ni=ny*m.width+nx;
        if(walkable(nx,ny)&&distance[ni]<0) {distance[ni]=distance[at]+1;parent[ni]=at;queue[tail++]=ni;}
      }
    }
    const value={distance,parent,goal:goals[0],key,version:this.version,movement,descriptor};
    this.stats.builtTotal++;
    if (this.stepLimit!==null) {
      this.stats.builtThisStep++;
      this.stats.maxBuiltPerStep=Math.max(this.stats.maxBuiltPerStep,this.stats.builtThisStep);
    }
    return value;
  }
  rememberField(value) {
    this.fields.set(value.key,value);
    if (this.fields.size>FIELD_LIMIT) this.fields.delete(this.fields.keys().next().value);
    return value;
  }
  admitField(descriptor,goals) {
    const key=this.key(descriptor),query=this.queryCache.get(key);
    // A warm UI probe must use the same admission as a cold restored game.
    // Its original query coordinates are not the persistent request descriptor.
    const value=query?{...query,descriptor}:this.buildField(descriptor,goals);
    this.queryCache.delete(key);
    this.stepUsed++;
    return this.rememberField(value);
  }
  queryField(descriptor) {
    const key=this.key(descriptor);
    if (this.queryCache.has(key)) return this.queryCache.get(key);
    const goals=this.goals(descriptor);
    if (!goals.length) return null;
    const value=this.buildField(descriptor,goals);
    this.queryCache.set(key,value);
    if (this.queryCache.size>FIELD_LIMIT) this.queryCache.delete(this.queryCache.keys().next().value);
    return value;
  }
  field(x,y,movement='land',footprint=null) {
    const descriptor=this.descriptor(x,y,movement,footprint);
    if (!descriptor) {
      // Legacy external callers may search just outside the map. Preserve their
      // nearby-goal result without persisting an invalid off-map descriptor.
      if (this.stepLimit!==null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      return this.queryField({x,y,movement,footprint});
    }
    const key=this.key(descriptor);
    if (this.fields.has(key)) return this.fields.get(key);
    if (this.stepLimit===null) return this.queryField(descriptor);
    if (this.stepLimit!==null && this.pending.has(key)) {
      this.stats.deferredTotal++;
      return undefined;
    }
    const goals=this.goals(descriptor);
    if (!goals.length) return null;
    if (this.stepUsed>=this.stepLimit) {
      if (this.pending.size<PENDING_LIMIT) {
        this.pending.set(key,descriptor);
        this.world.state.navigationFields ||= [];
        this.world.state.navigationQueue ||= [];
        this.world.state.navigationQueue.push({...descriptor,footprint:descriptor.footprint?{...descriptor.footprint}:null});
      }
      this.stats.deferredTotal++;
      return undefined;
    }
    this.pending.delete(key);
    const value=this.admitField(descriptor,goals);
    this.syncDescriptors();
    return value;
  }
  route(startPoint,goalPoint,field,maxCells=512) {
    const unreachable={status:'unreachable',cells:[],truncated:false},m=this.world.state.map;
    if (!field || field.version!==this.version || !(field.parent instanceof Int32Array)) return unreachable;
    const cell=point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y)&&point.x>=0&&point.y>=0&&point.x<m.width&&point.y<m.height?Math.floor(point.y)*m.width+Math.floor(point.x):-1;
    let a=cell(startPoint),b=cell(goalPoint);
    if (a<0 || b<0 || field.distance[a]<0 || field.distance[b]<0) return unreachable;
    const left=[],right=[];
    let remaining=field.distance.length*2;
    while (a!==b && remaining-->0) {
      if (field.distance[a]>=field.distance[b]) {
        a=field.parent[a];
        if (a<0) return unreachable;
        left.push(a);
      } else {
        right.push(b);b=field.parent[b];
        if (b<0) return unreachable;
      }
    }
    if (a!==b) return unreachable;
    const cells=left.concat(right.reverse()),limit=Number.isFinite(maxCells)?Math.max(0,Math.floor(maxCells)):512;
    return {status:'ok',cells:cells.slice(0,limit),truncated:cells.length>limit};
  }
  path(start, destination, movement = 'land', maxExpanded = 6400) {
    const m=this.world.state.map, goal=this.nearest(destination.x,destination.y,movement), source=this.nearest(start.x,start.y,movement,2);
    if(!goal||!source) return {status:'unreachable',path:[],expanded:0};
    const si=Math.floor(source.y)*m.width+Math.floor(source.x), gi=Math.floor(goal.y)*m.width+Math.floor(goal.x);
    const scores=new Float64Array(m.width*m.height);scores.fill(Infinity);scores[si]=0;
    const parents=new Int32Array(scores.length);parents.fill(-1);
    const closed=new Uint8Array(scores.length), heap=[];
    const heuristic=i=>Math.abs(i%m.width-gi%m.width)+Math.abs(Math.floor(i/m.width)-Math.floor(gi/m.width));
    const push=(id,f)=>{let n=heap.length;heap.push({id,f});while(n){const p=(n-1)>>1;if(heap[p].f<=f)break;heap[n]=heap[p];n=p;}heap[n]={id,f};};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let n=0;while(n*2+1<heap.length){let c=n*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[n]=heap[c];n=c;}heap[n]=last;}return top.id;};
    push(si,heuristic(si));let expanded=0;
    while(heap.length&&expanded<maxExpanded){const at=pop();if(closed[at])continue;closed[at]=1;expanded++;
      if(at===gi){const path=[];let i=gi;while(i!==si){path.push({x:i%m.width+.5,y:Math.floor(i/m.width)+.5});i=parents[i];}path.reverse();return {status:'arrived',path,expanded};}
      const ax=at%m.width,ay=Math.floor(at/m.width);
      for(const[dx,dy]of DIRS){const x=ax+dx,y=ay+dy,ni=y*m.width+x;if(!this.walkable(x,y,movement)||closed[ni])continue;const score=scores[at]+1;if(score<scores[ni]){scores[ni]=score;parents[ni]=at;push(ni,score+heuristic(ni));}}
    }
    return {status:heap.length?'budget_exceeded':'unreachable',path:[],expanded};
  }
}

export class SpatialIndex {
  constructor(size=5){this.size=size;this.buckets=new Map();}
  rebuild(entities){this.buckets.clear();for(const e of entities)if(e.hp>0){const key=`${Math.floor(e.x/this.size)}:${Math.floor(e.y/this.size)}`;let b=this.buckets.get(key);if(!b)this.buckets.set(key,b=[]);b.push(e);}}
  nearest(x,y,radius,predicate){let best=null,distance=radius*radius;const s=this.size;
    for(let by=Math.floor((y-radius)/s);by<=Math.floor((y+radius)/s);by++)for(let bx=Math.floor((x-radius)/s);bx<=Math.floor((x+radius)/s);bx++){
      const bucket=this.buckets.get(`${bx}:${by}`);if(!bucket)continue;
      for(const e of bucket){const d=(e.x-x)**2+(e.y-y)**2;if(d<=distance&&predicate(e)){best=e;distance=d;}}
    }return best;
  }
  within(x,y,radius,predicate){const found=[];const s=this.size,r2=radius*radius;for(let by=Math.floor((y-radius)/s);by<=Math.floor((y+radius)/s);by++)for(let bx=Math.floor((x-radius)/s);bx<=Math.floor((x+radius)/s);bx++)for(const e of this.buckets.get(`${bx}:${by}`)||[])if((e.x-x)**2+(e.y-y)**2<=r2&&predicate(e))found.push(e);return found;}
}
