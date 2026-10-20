import { TERRAIN, BUILDINGS } from './data.js';
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

/** Bounded tile navigation. Groups share reverse distance fields; A* is also exposed. */
export class Navigation {
  constructor(world) { this.world = world; this.version = world.state.navigationVersion||0; this.fields = new Map(); this.rebuild(true); }
  rebuild(initial=false) {
    const { map, buildings } = this.world.state;
    this.blocked = new Uint8Array(map.width * map.height);
    for (const b of buildings) if (b.hp > 0 && !(b.kind === 'gate' && b.open)) {
      const size = BUILDINGS[b.kind].size;
      for (let y = b.y; y < b.y + size; y++) for (let x = b.x; x < b.x + size; x++) this.blocked[y * map.width + x] = 1;
    }
    if(!initial)this.version++;this.world.state.navigationVersion=this.version;this.fields.clear();
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
  field(x, y, movement = 'land', footprint = null) {
    const m = this.world.state.map, gx=Math.floor(x),gy=Math.floor(y),size=footprint?BUILDINGS[footprint.kind].size:0;
    const key=footprint?`${movement}:building:${footprint.x}:${footprint.y}:${size}`:`${movement}:${gx}:${gy}`;
    if (this.fields.has(key)) return this.fields.get(key);
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
    if(!goals.length)return null;
    const distance = new Int32Array(m.width*m.height); distance.fill(-1);
    const queue = new Int32Array(distance.length); let head=0, tail=0;
    for(const goal of goals){const target=Math.floor(goal.y)*m.width+Math.floor(goal.x);distance[target]=0;queue[tail++]=target;}
    while(head<tail) {
      const at=queue[head++], ax=at%m.width, ay=Math.floor(at/m.width);
      for(const [dx,dy] of DIRS) { const nx=ax+dx,ny=ay+dy,ni=ny*m.width+nx;
        if(walkable(nx,ny)&&distance[ni]<0) {distance[ni]=distance[at]+1;queue[tail++]=ni;}
      }
    }
    const value={ distance,goal:goals[0],key,version:this.version }; this.fields.set(key,value);
    if(this.fields.size>96) this.fields.delete(this.fields.keys().next().value);
    return value;
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
