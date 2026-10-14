class Cloud {
  constructor(canvas) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.nodes=[]; this.last=null;
    this.active=true; this.serial=0; this.reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ro=new ResizeObserver(()=>this.resize()); this.ro.observe(canvas); this.resize();
    this.animate=this.animate.bind(this); requestAnimationFrame(this.animate);
    if(typeof document!=='undefined' && document.fonts) document.fonts.ready.then(()=>{this.signature=null;this.update(this.nodes.map(n=>({word:n.word,count:n.count})));});
  }
  setActive(active) { this.active=active; }
  resize() {
    const r=this.canvas.getBoundingClientRect();this.w=r.width;this.h=r.height;
    const d=devicePixelRatio||1;this.canvas.width=r.width*d;this.canvas.height=r.height*d;this.ctx.setTransform(d,0,0,d,0,0);
    if(this.nodes.length){this.signature=null;this.update(this.nodes.map(n=>({word:n.word,count:n.count})));}
  }
  hash(word) { let h=2166136261;for(const ch of word)h=Math.imul(h^ch.codePointAt(0),16777619);return h>>>0; }
  bounds(n,size=n.size,angle=n.angle,scale=1) {
    this.ctx.font='800 '+size+'px Manrope, sans-serif';
    const w=Math.min(this.w-24,this.ctx.measureText(n.word).width)*scale,h=size*1.25*scale;
    const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));return {width:w*c+h*s,height:w*s+h*c};
  }
  update(words) {
    words=[...words].sort((a,b)=>b.count-a.count||a.word.localeCompare(b.word));
    const signature=JSON.stringify(words)+this.w+':'+this.h;if(signature===this.signature)return;
    this.signature=signature;const old=new Map(this.nodes.map(n=>[n.word,n]));
    const max=Math.max(1,...words.map(w=>w.count));
    const area=words.reduce((sum,w)=>{const size=18+Math.pow(w.count/max,.65)*74;return sum+(w.word.length*size*.6+16)*(size*1.3+16);},0);
    const density=Math.min(1,Math.sqrt(this.w*this.h*.46/Math.max(1,area)));
    this.nodes=words.map((w,rank)=>{
      let n=old.get(w.word);const seed=this.hash(w.word);
      if(!n)n={word:w.word,seed,phase:seed%628/100,age:0,size:14,sizeVelocity:0,x:this.w/2,y:this.h/2,vx:0,vy:0,angle:0,entry:this.serial++%5,fresh:true};
      const grew=w.count>n.count;n.count=w.count;n.rank=rank;
      n.target=Math.max(14,Math.min(92,18+Math.pow(w.count/max,.65)*74*density));
      n.targetAngle=rank===0?0:seed%7===0?Math.PI/2:seed%5===0?-Math.PI/2:((seed%3)-1)*.12;
      if(grew)n.pulse=1;return n;
    });
    this.pack();
  }
  pack() {
    const W=this.w,H=this.h;if(W<30||H<30)return;
    const cell=4,cols=Math.ceil(W/cell),rows=Math.ceil(H/cell),stride=Math.ceil(cols/32);
    let occupied;
    const check=(p,write=false)=>{
      const x0=Math.max(0,Math.floor((p.x-p.width/2-4)/cell)),x1=Math.min(cols-1,Math.ceil((p.x+p.width/2+4)/cell));
      const y0=Math.max(0,Math.floor((p.y-p.height/2-4)/cell)),y1=Math.min(rows-1,Math.ceil((p.y+p.height/2+4)/cell));
      for(let block=x0>>>5;block<=x1>>>5;block++){
        const left=block===(x0>>>5)?x0&31:0,right=block===(x1>>>5)?x1&31:31;
        const mask=((0xffffffff<<left)&(0xffffffff>>>(31-right)))>>>0;
        for(let y=y0;y<=y1;y++){const index=y*stride+block;if(write)occupied[index]|=mask;else if((occupied[index]&mask)!==0)return true;}
      }return false;
    };
    let placed=[];
    for(let attempt=0;attempt<12;attempt++){
      placed=[];occupied=new Uint32Array(rows*stride);let failed=false;
      for(const n of this.nodes){
        const box=this.bounds(n,Math.max(n.target,n.fresh?14:n.size),n.targetAngle,1.045);
        // Reserve the envelope of small rotations as well as breathing scale.
        const tilted=this.bounds(n,Math.max(n.target,n.fresh?14:n.size),n.targetAngle+.035,1.045);
        box.width=Math.max(box.width,tilted.width);box.height=Math.max(box.height,tilted.height);
        let found=null;
        for(let k=0;k<5000;k++){
          const angle=k*2.399963229728653, radius=8*Math.sqrt(k);
          const x=W/2+Math.cos(angle)*radius*Math.sqrt(W/H),y=H/2+Math.sin(angle)*radius*Math.sqrt(H/W);
          const p={x,y,...box};
          if(x-box.width/2<12||x+box.width/2>W-12||y-box.height/2<12||y+box.height/2>H-12)continue;
          if(!check(p)){found=p;check(p,true);break;}
        }
        if(!found){failed=true;break;}n.tx=found.x;n.ty=found.y;placed.push(found);
      }
      if(!failed)break;
      for(const n of this.nodes)n.target=Math.max(14,n.target*.88);
    }
    for(const n of this.nodes){
      if(n.fresh){n.x=n.tx??W/2;n.y=n.ty??H/2;n.angle=n.targetAngle;n.fresh=false;
        if(!this.reduce){if(n.entry===1)n.x-=64;else if(n.entry===2)n.y+=54;else if(n.entry===4)n.y-=48;}
      }
    }
  }
  animate(t) {
    const dt=this.last===null?1:Math.min(2,Math.max(.1,(t-this.last)/16.67));this.last=t;
    const c=this.ctx,W=this.w,H=this.h;c.clearRect(0,0,W,H);
    for(const n of this.nodes){
      n.age+=dt*16.67;const progress=Math.min(1,n.age/380);
      n.pulse=(n.pulse||0)*Math.pow(.91,dt);
      n.sizeVelocity+=(n.target-n.size)*.13*dt;n.sizeVelocity*=Math.pow(.58,dt);n.size=Math.max(14,n.size+n.sizeVelocity*dt);
      const moving=this.active&&!this.reduce;
      const sway=moving?Math.sin(t*.00065+n.phase):0;
      const angle=n.targetAngle+sway*.025;
      n.angle+=(angle-n.angle)*(this.reduce?1:1-Math.pow(.80,dt));
      const tx=(n.tx??W/2)+(moving?Math.sin(t*.0006+n.phase)*2:0),ty=(n.ty??H/2)+(moving?Math.cos(t*.0005+n.phase)*2:0);
      if(this.reduce){n.x=tx;n.y=ty;n.size=n.target;n.angle=n.targetAngle;}
      else{n.vx+=(tx-n.x)*.14*dt;n.vy+=(ty-n.y)*.14*dt;n.vx*=Math.pow(.52,dt);n.vy*=Math.pow(.52,dt);n.x+=n.vx*dt;n.y+=n.vy*dt;}
      const breath=moving?1+Math.sin(t*.001+n.phase)*.012:1;
      n.scale=breath+(this.reduce?0:n.pulse*.025);
      n.alpha=this.reduce?1:Math.min(1,.2+progress*1.6);
      n.flip=1;
      if(!this.reduce&&progress<1){
        const ease=1-Math.pow(1-progress,3);
        if(n.entry===0)n.scale*=.58+.42*ease;
        if(n.entry===3)n.flip=.18+.82*ease;
        if(n.entry===4)n.scale*=.78+.22*ease;
      }
      Object.assign(n,this.bounds(n,n.size,n.angle,n.scale));
    }
    // Resolve conservative rotated text boxes before drawing; never draw an unresolved overlap.
    for(let pass=0;pass<20;pass++){
      let worst=0;
      for(let i=0;i<this.nodes.length;i++)for(let j=i+1;j<this.nodes.length;j++){
        const a=this.nodes[i],b=this.nodes[j],dx=b.x-a.x,dy=b.y-a.y;
        const ox=(a.width+b.width)/2+4-Math.abs(dx),oy=(a.height+b.height)/2+4-Math.abs(dy);
        if(ox>0&&oy>0){worst=Math.max(worst,Math.min(ox,oy));if(ox<oy){const d=(ox/2+.01)*(dx>=0?1:-1);a.x-=d;b.x+=d;}else{const d=(oy/2+.01)*(dy>=0?1:-1);a.y-=d;b.y+=d;}}
      }
      for(const n of this.nodes){n.x=Math.max(n.width/2+8,Math.min(W-n.width/2-8,n.x));n.y=Math.max(n.height/2+8,Math.min(H-n.height/2-8,n.y));}
      if(worst<.1)break;
    }
    this.visibleNodes=[];
    for(const n of this.nodes){
      if(this.visibleNodes.some(b=>Math.abs(n.x-b.x)<(n.width+b.width)/2+1&&Math.abs(n.y-b.y)<(n.height+b.height)/2+1))continue;
      this.visibleNodes.push(n);c.save();c.globalAlpha=n.alpha;c.translate(n.x,n.y);c.rotate(n.angle);c.scale(n.scale*n.flip,n.scale);
      c.font='800 '+n.size+'px Manrope, sans-serif';c.textAlign='center';c.textBaseline='middle';
      c.fillStyle=n.rank===0?'#d5fa73':n.rank<4?'#c3a6f8':n.rank<9?'#9bb6f5':['#b5bddd','#93c9c4','#d5b2c8'][n.seed%3];
      c.fillText(n.word,0,0,W-24);c.restore();
    }
    requestAnimationFrame(this.animate);
  }
}
