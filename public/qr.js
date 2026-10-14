// QR Code generator: Version 3 (29x29, minimal & bold) for up to 53 bytes,
// Version 6 (41x41) fallback for longer URLs.
function qrMatrix(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 134) throw new Error('Ссылка слишком длинная для QR-кода');
  const isV3 = bytes.length <= 53;
  const size = isV3 ? 29 : 41, dataCap = isV3 ? 55 : 136, maxBits = isV3 ? 440 : 1088, eccWords = isV3 ? 15 : 18;
  const bits = [];
  const append = (v, count) => { for (let i = count - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  while (data.length < dataCap) data.push(data.length % 2 === Math.ceil(bits.length / 8) % 2 ? 0xec : 0x11);
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
  const divisor = Array(eccWords).fill(0); divisor[eccWords - 1] = 1;
  for (let root = 1, i = 0; i < eccWords; i++, root = mul(root, 2)) for (let j = 0; j < eccWords; j++) divisor[j] = mul(divisor[j], root) ^ (j < eccWords - 1 ? divisor[j + 1] : 0);
  let stream = [];
  if (isV3) {
    const rem = Array(eccWords).fill(0);
    for (const byte of data) { const f = byte ^ rem.shift(); rem.push(0); for (let i = 0; i < eccWords; i++) rem[i] ^= mul(divisor[i], f); }
    stream = [...data, ...rem];
  } else {
    const blocks = [data.slice(0, 68), data.slice(68)];
    const ecc = blocks.map(block => { const rem = Array(18).fill(0); for (const byte of block) { const f = byte ^ rem.shift(); rem.push(0); for (let i = 0; i < 18; i++) rem[i] ^= mul(divisor[i], f); } return rem; });
    for (let i = 0; i < 68; i++) for (const block of blocks) stream.push(block[i]);
    for (let i = 0; i < 18; i++) for (const block of ecc) stream.push(block[i]);
  }
  const modules = Array.from({length:size},()=>Array(size).fill(false)), reserved = Array.from({length:size},()=>Array(size).fill(false));
  const set = (x,y,on) => { modules[y][x] = !!on; reserved[y][x] = true; };
  for (let i=0;i<size;i++) { set(6,i,i%2===0); set(i,6,i%2===0); }
  for (const [cx,cy] of [[3,3],[size-4,3],[3,size-4]]) for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) { const x=cx+dx,y=cy+dy,d=Math.max(Math.abs(dx),Math.abs(dy)); if(x>=0&&y>=0&&x<size&&y<size)set(x,y,d!==2&&d!==4); }
  const alignCoord = isV3 ? 22 : 34;
  for (let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) set(alignCoord+dx, alignCoord+dy, Math.max(Math.abs(dx),Math.abs(dy))!==1);
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
  let limePills='',olivePills='',dots='';
  for(let y=0;y<size;y++){
    let start=-1;
    for(let x=0;x<=size;x++){
      const on=x<size&&matrix[y][x]&&!isFinder(x,y);
      if(on&&start===-1)start=x;
      else if(!on&&start!==-1){
        const len=x-start,px=start+pad,py=y+pad;
        const col=(start*2+y)%3===0?'#92bb57':'#d5fa73';
        if(len===1){
          dots+='<circle cx="'+(px+0.5)+'" cy="'+(py+0.5)+'" r="0.5" fill="'+col+'"/>';
        }else{
          const rect='<rect x="'+px+'" y="'+(py-0.04)+'" width="'+len+'" height="1.08" rx="0.54" fill="'+col+'"/>';
          if(col==='#92bb57')olivePills+=rect;else limePills+=rect;
        }
        start=-1;
      }
    }
  }
  let eyes='';
  for(const [fx,fy] of [[0,0],[size-7,0],[0,size-7]]){
    for(let dy=0;dy<7;dy++){
      for(let dx=0;dx<7;dx++){
        if(dx===0||dx===6||dy===0||dy===6){
          eyes+='<circle cx="'+(fx+pad+dx+0.5)+'" cy="'+(fy+pad+dy+0.5)+'" r="0.5" fill="#d5fa73"/>';
        }
      }
    }
    for(let dy=2;dy<=4;dy++){
      const col=dy===3?'#92bb57':'#d5fa73';
      eyes+='<rect x="'+(fx+pad+2)+'" y="'+(fy+pad+dy+0.06)+'" width="3" height="0.88" rx="0.44" fill="'+col+'"/>';
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+total+' '+total+'" role="img" aria-label="QR-код для подключения к комнате"><rect width="'+total+'" height="'+total+'" rx="4" fill="#0d101b"/>'+limePills+olivePills+dots+eyes+'</svg>';
}
