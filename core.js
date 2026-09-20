'use strict';

const DEFAULT_PALETTE = ['#283b34','#526449','#628b53','#95b578','#c7d7a9','#f7f4e8','#e5d7b6','#c4ab81','#9b795a','#665144','#f1c4ad','#dc9478','#b56d58','#914f4a','#e7bc62','#c5dce1','#8fb4c0','#5f889f','#777590','#b4a2b8'];
function normalizePalette(value) {
  return Array.isArray(value) && value.every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c))
    ? value.map(c=>c.toLowerCase()) : DEFAULT_PALETTE.slice();
}
function parsePaletteText(text) {
  const colors = new Set();
  for (const line of text.split(/\r\n?|\n/)) {
    const rgb = line.match(/^\s*(\d{1,3})[\t ]+(\d{1,3})[\t ]+(\d{1,3})(?=\s|$)/);
    if(rgb && rgb.slice(1).every(n=>Number(n)<=255)) {
      colors.add('#'+rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join(''));
    }
    for(const match of line.matchAll(/(?<![a-z0-9_])#?([a-f0-9]{8}|[a-f0-9]{6})(?![a-z0-9_])/gi)) {
      colors.add('#'+match[1].slice(-6).toLowerCase());
    }
  }
  return [...colors];
}
function paletteFromPixels(rgba) {
  const colors=new Set();
  // Read every pixel in row-major order; the palette stores RGB, not alpha.
  for(let i=0;i<rgba.length;i+=4) {
    colors.add('#'+[rgba[i],rgba[i+1],rgba[i+2]].map(n=>n.toString(16).padStart(2,'0')).join(''));
  }
  return [...colors];
}
function mergePalette(existing, incoming, mode) {
  const result=mode==='append'?existing.slice():[], seen=new Set(result);
  for(const color of incoming)if(!seen.has(color)){result.push(color);seen.add(color);}
  return result;
}

// Integer coordinates keep strokes continuous even when pointer events skip pixels.
function drawLine(pixels, size, from, to, color, brush = 1) {
  let [x, y] = from;
  const [tx, ty] = to, dx = Math.abs(tx-x), dy = -Math.abs(ty-y);
  const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    const offset = Math.floor((brush-1)/2);
    for (let by = 0; by < brush; by++) for (let bx = 0; bx < brush; bx++) {
      const px = x + bx-offset, py = y + by-offset;
      if (px >= 0 && py >= 0 && px < size && py < size) pixels[py*size+px] = color;
    }
    if (x === tx && y === ty) break;
    const e2 = 2*error;
    if (e2 >= dy) { error += dy; x += sx; }
    if (e2 <= dx) { error += dx; y += sy; }
  }
}
function floodFill(pixels, size, x, y, color) {
  const target = pixels[y*size+x];
  if (target === color) return;
  const pending = [y*size+x];
  pixels[y*size+x] = color;
  while (pending.length) {
    const index = pending.pop(), cx = index%size, cy = Math.floor(index/size);
    for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny*size+nx;
      if (pixels[next] === target) { pixels[next] = color; pending.push(next); }
    }
  }
}

const STYLE_PRESETS = [
  { bits:255, label:'Match Corners and Sides' },
  { bits:85, label:'Match Sides' },
  { bits:170, label:'Match Corners' },
];
const BIT_ORDER = ['top','topRight','right','bottomRight','bottom','bottomLeft','left','topLeft'];
const NEIGHBORS = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
function styleLabel(bits) { return STYLE_PRESETS.find(p=>p.bits===bits)?.label || 'カスタム接続'; }
function patternMask(styleBits, raw) {
  let mask=raw & styleBits;
  for(let corner=1;corner<8;corner+=2) {
    const sides=(1<<(corner-1)) | (1<<((corner+1)%8));
    // Only constrain a corner when both adjacent sides participate in this style.
    if((styleBits&sides)===sides && (mask&sides)!==sides) mask &= ~(1<<corner);
  }
  return mask;
}
function patterns(styleBits) {
  return [...new Set(Array.from({length:256},(_,raw)=>patternMask(styleBits,raw)))].sort((a,b)=>a-b);
}
function discardedMasks(type, styleBits) {
  const valid=new Set(patterns(styleBits));
  return Object.keys(type.tiles).map(Number).filter(mask=>!valid.has(mask));
}
function setStyleBits(type, styleBits) {
  for(const mask of discardedMasks(type,styleBits))delete type.tiles[mask];
  type.styleBits=styleBits;
}
function resolveCell(project, index) {
  const { width, height, cells } = project.field;
  if (index < 0 || index >= cells.length) return null;
  const type = project.types.find(t => t.id === cells[index]);
  if (!type) return null;
  const x = index % width, y = Math.floor(index / width);
  let raw = 0;
  NEIGHBORS.forEach(([dx,dy], bit) => {
    const nx=x+dx, ny=y+dy;
    if(nx>=0 && nx<width && ny>=0 && ny<height && cells[ny*width+nx]===type.id) raw |= 1<<bit;
  });
  return { type, mask: patternMask(type.styleBits,raw), raw };
}
function makeType(id, name, color, seed = false) {
  return { id, name, color, seed, styleBits:255, tiles:{} };
}
function createProject(tileSize = 16) {
  const rows = ['11111111','11122211','11222211','11221111','11331111','13311111','33311111','11111111'];
  return {
    format:'dot-map', version:2, name:'小さな世界', tileSize, palette:DEFAULT_PALETTE.slice(),
    types:[makeType('grass','草地','#789563',true),makeType('water','水辺','#759eac',true),makeType('path','小道','#be9b6f',true)],
    field:{width:8,height:8,cells:rows.join('').split('').map(c=>['grass','water','path'][Number(c)-1])},
  };
}
function shiftColor(hex, amount) {
  return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(hex.slice(i,i+2),16)+amount)).toString(16).padStart(2,'0')).join('');
}
function tilePixels(type, tileSize, mask) {
  const saved = type.tiles[mask];
  if (saved) return saved;
  const pixels = Array(tileSize*tileSize).fill(null);
  if (!type.seed) return pixels;
  const dark=shiftColor(type.color,-24), light=shiftColor(type.color,22);
  for(let y=0;y<tileSize;y++) for(let x=0;x<tileSize;x++) {
    let value=type.color;
    if ((x*13+y*7)%37===0) value=light;
    const absent=type.styleBits & ~mask;
    if((y<2&&(absent&1))||(x>=tileSize-2&&(absent&4))||(y>=tileSize-2&&(absent&16))||(x<2&&(absent&64))) value=dark;
    if((x>=tileSize-3&&y<3&&(absent&2))||(x>=tileSize-3&&y>=tileSize-3&&(absent&8))||(x<3&&y>=tileSize-3&&(absent&32))||(x<3&&y<3&&(absent&128))) value=dark;
    pixels[y*tileSize+x]=value;
  }
  return pixels;
}
function resizeField(project, width, height) {
  const old=project.field;
  project.field={width,height,cells:Array.from({length:width*height},(_,i)=>{
    const x=i%width,y=Math.floor(i/width);
    return x<old.width&&y<old.height?old.cells[y*old.width+x]:null;
  })};
}
function removeType(project, id) {
  project.types=project.types.filter(t=>t.id!==id);
  project.field.cells=project.field.cells.map(value=>value===id?null:value);
}
function validateProject(value) {
  const fail=()=>{throw new Error('対応するDOTマップのプロジェクトファイルではありません。');};
  const isColor=c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c);
  const isSize=n=>Number.isInteger(n)&&n>=1&&n<=32;
  if(!value||value.format!=='dot-map'||value.version!==2||![8,16,32].includes(value.tileSize)||typeof value.name!=='string'||value.name.length>80)fail();
  if(!Array.isArray(value.types)||value.types.length<1||value.types.length>32)fail();
  const ids=new Set();
  const types=value.types.map(t=>{
    if(!t||typeof t.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||t.name.length>40||!isColor(t.color)||typeof t.seed!=='boolean'||!Number.isInteger(t.styleBits)||t.styleBits<0||t.styleBits>255||!t.tiles)fail();
    ids.add(t.id);
    const type=makeType(t.id,t.name,t.color,t.seed);type.styleBits=t.styleBits;
    const bank=t.tiles, valid=patterns(type.styleBits);
    if(typeof bank!=='object'||Array.isArray(bank))fail();
    for(const [key,pixels] of Object.entries(bank)) {
      if(!valid.includes(Number(key))||String(Number(key))!==key||!Array.isArray(pixels)||pixels.length!==value.tileSize**2||!pixels.every(p=>p===null||isColor(p)))fail();
      type.tiles[key]=pixels.map(p=>p===null?null:p.toLowerCase());
    }
    return type;
  });
  const f=value.field;
  if(!f||!isSize(f.width)||!isSize(f.height)||!Array.isArray(f.cells)||f.cells.length!==f.width*f.height||!f.cells.every(c=>c===null||ids.has(c)))fail();
  return {format:'dot-map',version:2,name:value.name,tileSize:value.tileSize,palette:normalizePalette(value.palette),types,field:{width:f.width,height:f.height,cells:f.cells.slice()}};
}


function atlasLayout(project, columns=8) {
  let row=0;
  const types=project.types.map(type=>{
    const tiles=patterns(type.styleBits).map((mask,index)=>({mask,x:index%columns,y:row+Math.floor(index/columns)}));
    row+=Math.ceil(tiles.length/columns);
    return {id:type.id,name:type.name,styleBits:type.styleBits,tiles};
  });
  return {
    width:columns*project.tileSize, height:row*project.tileSize,
    metadata:{format:'dot-map-atlas',version:1,tileSize:project.tileSize,columns,bitOrder:BIT_ORDER.slice(),types},
  };
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) {
    crc ^= byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function pngChunk(type, data) {
  const chunk=new Uint8Array(data.length+12), view=new DataView(chunk.buffer);
  view.setUint32(0,data.length);chunk.set(new TextEncoder().encode(type),4);chunk.set(data,8);
  view.setUint32(chunk.length-4,crc32(chunk.subarray(4,chunk.length-4)));return chunk;
}
function embedAtlasMetadata(png, metadata) {
  const signature=[137,80,78,71,13,10,26,10];
  if(!signature.every((byte,i)=>png[i]===byte))throw new Error('PNGの形式が不正です。');
  const view=new DataView(png.buffer,png.byteOffset,png.byteLength);
  for(let offset=8;offset+12<=png.length;) {
    const length=view.getUint32(offset),end=offset+12+length;
    if(end>png.length)break;
    if(view.getUint32(offset+4)===0x49454e44 && length===0 && end===png.length) {
      // The engine contract explicitly uses UTF-8 JSON in tEXt (including Japanese names).
      const data=new TextEncoder().encode('dot-map-atlas\0'+JSON.stringify(metadata));
      const chunk=pngChunk('tEXt',data), result=new Uint8Array(png.length+chunk.length);
      result.set(png.subarray(0,offset));result.set(chunk,offset);result.set(png.subarray(offset),offset+chunk.length);return result;
    }
    offset=end;
  }
  throw new Error('PNGのIENDチャンクが見つかりません。');
}
