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
  const matrix=qrMatrix(value),size=matrix.length+8;
  let path='';matrix.forEach((row,y)=>row.forEach((on,x)=>{if(on)path+='M'+(x+4)+','+(y+4)+'h1v1h-1z';}));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" role="img" aria-label="QR-код для подключения к комнате" shape-rendering="crispEdges"><rect width="'+size+'" height="'+size+'" fill="white"/><path d="'+path+'" fill="black"/></svg>';
}
