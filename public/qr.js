// QR Code Model 2, version 6, error correction L, mask 0.
// Generated locally: no participant URL is sent to an image service.
function qrMatrix(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 134) throw new Error('Ссылка слишком длинная для QR-кода');
  const bits = [];
  const append = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, 1088 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  while (data.length < 136) data.push(data.length % 2 === Math.ceil(bits.length / 8) % 2 ? 0xec : 0x11);
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
  const divisor = Array(18).fill(0); divisor[17] = 1;
  for (let root = 1, i = 0; i < 18; i++, root = mul(root, 2)) for (let j = 0; j < 18; j++) divisor[j] = mul(divisor[j], root) ^ (j < 17 ? divisor[j + 1] : 0);
  const blocks = [data.slice(0, 68), data.slice(68)];
  const ecc = blocks.map(block => { const rem = Array(18).fill(0); for (const byte of block) { const factor = byte ^ rem.shift(); rem.push(0); for (let i = 0; i < 18; i++) rem[i] ^= mul(divisor[i], factor); } return rem; });
  const stream = []; for (let i = 0; i < 68; i++) for (const block of blocks) stream.push(block[i]);
  for (let i = 0; i < 18; i++) for (const block of ecc) stream.push(block[i]);
  const size = 41, modules = Array.from({length:size},()=>Array(size).fill(false)), reserved = Array.from({length:size},()=>Array(size).fill(false));
  const set = (x,y,on) => { modules[y][x] = !!on; reserved[y][x] = true; };
  for (let i=0;i<size;i++) { set(6,i,i%2===0); set(i,6,i%2===0); }
  for (const [cx,cy] of [[3,3],[size-4,3],[3,size-4]]) for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) { const x=cx+dx,y=cy+dy,d=Math.max(Math.abs(dx),Math.abs(dy)); if(x>=0&&y>=0&&x<size&&y<size)set(x,y,d!==2&&d!==4); }
  for (let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++)set(34+dx,34+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  const format=0x77c4,bit=i=>((format>>>i)&1)!==0;
  for(let i=0;i<6;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
  for(let i=9;i<15;i++)set(14-i,8,bit(i));
  for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true);
  let index=0;
  for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vertical=0;vertical<size;vertical++){const y=((right+1)&2)===0?size-1-vertical:vertical;for(let j=0;j<2;j++){const x=right-j;if(reserved[y][x])continue;const on=index<stream.length*8?((stream[index>>>3]>>>(7-(index&7)))&1)!==0:false;modules[y][x]=on!==((x+y)%2===0);index++;}}}
  return modules;
}
function qrSvg(value) {
  const matrix=qrMatrix(value),size=matrix.length,pad=4,total=size+pad*2;
  const isFinder=(x,y)=>(x<=7&&y<=7)||(x>=size-8&&y<=7)||(x<=7&&y>=size-8);
  let pills='';
  for(let y=0;y<size;y++){
    let start=-1;
    for(let x=0;x<=size;x++){
      const on=x<size&&matrix[y][x]&&!isFinder(x,y);
      if(on&&start===-1)start=x;
      else if(!on&&start!==-1){
        const len=x-start,px=start+pad,py=y+pad,rx=len===1?0.42:0.48;
        pills+='<rect x="'+px+'" y="'+py+'" width="'+len+'" height="1" rx="'+rx+'"/>';
        start=-1;
      }
    }
  }
  let eyes='';
  for(const [fx,fy] of [[0,0],[size-7,0],[0,size-7]]){
    const x=fx+pad,y=fy+pad;
    eyes+='<path fill-rule="evenodd" d="M'+(x+0.4)+','+y+'h6.2a0.4,0.4 0 0 1 0.4,0.4v6.2a0.4,0.4 0 0 1 -0.4,0.4h-6.2a0.4,0.4 0 0 1 -0.4,-0.4v-6.2a0.4,0.4 0 0 1 0.4,-0.4zM'+(x+1)+','+(y+1)+'h5v5h-5z"/>'+
          '<rect x="'+(x+2)+'" y="'+(y+2)+'" width="3" height="3" rx="0.4"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+total+' '+total+'" role="img" aria-label="QR-код для подключения к комнате"><rect width="'+total+'" height="'+total+'" rx="3.5" fill="#f7fcee"/><g fill="#101420">'+pills+eyes+'</g></svg>';
}
