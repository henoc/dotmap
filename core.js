'use strict';

const DEFAULT_PALETTE = ['#283b34','#526449','#628b53','#95b578','#c7d7a9','#f7f4e8','#e5d7b6','#c4ab81','#9b795a','#665144','#f1c4ad','#dc9478','#b56d58','#914f4a','#e7bc62','#c5dce1','#8fb4c0','#5f889f','#777590','#b4a2b8'];
const PALETTE_PRESETS = [
  {id:'nature',name:'自然（既定）',colors:DEFAULT_PALETTE},
  {id:'sweetie16',name:'Sweetie 16',colors:['#1a1c2c','#5d275d','#b13e53','#ef7d57','#ffcd75','#a7f070','#38b764','#257179','#29366f','#3b5dc9','#41a6f6','#73eff7','#f4f4f4','#94b0c2','#566c86','#333c57']},
  {id:'cc29',name:'CC-29',colors:['#f2f0e5','#b8b5b9','#868188','#646365','#45444f','#3a3858','#212123','#352b42','#43436a','#4b80ca','#68c2d3','#a2dcc7','#ede19e','#d3a068','#b45252','#6a536e','#4b4158','#80493a','#a77b5b','#e5ceb4','#c2d368','#8ab060','#567b79','#4e584a','#7b7243','#b2b47e','#edc8c4','#cf8acb','#5f556a']},
  {id:'aap64',name:'AAP-64',colors:['#060608','#141013','#3b1725','#73172d','#b4202a','#df3e23','#fa6a0a','#f9a31b','#ffd541','#fffc40','#d6f264','#9cdb43','#59c135','#14a02e','#1a7a3e','#24523b','#122020','#143464','#285cc4','#249fde','#20d6c7','#a6fcdb','#ffffff','#fef3c0','#fad6b8','#f5a097','#e86a73','#bc4a9b','#793a80','#403353','#242234','#221c1a','#322b28','#71413b','#bb7547','#dba463','#f4d29c','#dae0ea','#b3b9d1','#8b93af','#6d758d','#4a5462','#333941','#422433','#5b3138','#8e5252','#ba756a','#e9b5a3','#e3e6ff','#b9bffb','#849be4','#588dbe','#477d85','#23674e','#328464','#5daf8d','#92dcba','#cdf7e2','#e4d2aa','#c7b08b','#a08662','#796755','#5a4e44','#423934']},
  {id:'ok31',name:'👌31',colors:['#636663','#87857c','#bcad9f','#f2b888','#eb9661','#b55945','#734c44','#3d3333','#593e47','#7a5859','#a57855','#de9f47','#fdd179','#fee1b8','#d4c692','#a6b04f','#819447','#44702d','#2f4d2f','#546756','#89a477','#a4c5af','#cae6d9','#f1f6f0','#d5d6db','#bbc3d0','#96a9c1','#6c81a1','#405273','#303843','#14233a']},
];
function normalizePalette(value) {
  return Array.isArray(value) && value.every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c))
    ? value.map(c=>c.toLowerCase()) : DEFAULT_PALETTE.slice();
}
function serializePaletteHex(colors) {
  return colors.join('\n')+'\n';
}
function matchPalettePreset(colors) {
  return PALETTE_PRESETS.find(preset=>preset.colors.length===colors.length&&preset.colors.every((c,i)=>c===colors[i]));
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
function nearestBy(hex, palette, distance) {
  let best=palette[0], bestDist=Infinity;
  for(const color of palette) {
    const dist=distance(hex,color);
    if(dist<bestDist){bestDist=dist;best=color;}
  }
  return best;
}
function rgbDistance(a, b) {
  const dr=parseInt(a.slice(1,3),16)-parseInt(b.slice(1,3),16);
  const dg=parseInt(a.slice(3,5),16)-parseInt(b.slice(3,5),16);
  const db=parseInt(a.slice(5,7),16)-parseInt(b.slice(5,7),16);
  return dr*dr+dg*dg+db*db;
}
function nearestPaletteColor(hex, palette) { return nearestBy(hex,palette,rgbDistance); }
function rgbToLab(hex) {
  const lin=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
  const r=lin(parseInt(hex.slice(1,3),16)), g=lin(parseInt(hex.slice(3,5),16)), b=lin(parseInt(hex.slice(5,7),16));
  const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  const fy=f(0.2126729*r+0.7151522*g+0.0721750*b);
  return [116*fy-16, 500*(f((0.4124564*r+0.3575761*g+0.1804375*b)/0.95047)-fy), 200*(fy-f((0.0193339*r+0.1191920*g+0.9503041*b)/1.08883))];
}
function labDistance(a, b) {
  const A=rgbToLab(a), B=rgbToLab(b), dl=A[0]-B[0], da=A[1]-B[1], db=A[2]-B[2];
  return dl*dl+da*da+db*db;
}
function nearestLabColor(hex, palette) { return nearestBy(hex,palette,labDistance); }
function lumaDistance(a, b) {
  const d=rgbToLab(a)[0]-rgbToLab(b)[0];
  return d*d;
}
function nearestLumaColor(hex, palette) { return nearestBy(hex,palette,lumaDistance); }
function snapTypeToPalette(type, palette, mode='rgb') {
  if(!palette.length)return;
  const mapColor=mode==='lab'?hex=>nearestLabColor(hex,palette):mode==='luma'?hex=>nearestLumaColor(hex,palette):hex=>nearestPaletteColor(hex,palette);
  type.color=mapColor(type.color);
  for(const pixels of Object.values(type.tiles)) {
    for(let i=0;i<pixels.length;i++)if(pixels[i]!==null)pixels[i]=mapColor(pixels[i]);
  }
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
// D4 matrices act on screen coordinates (x right, y down). Order breaks source ties.
const TILE_TRANSFORMS = [
  {id:'identity',label:'そのまま',matrix:[1,0,0,1]},
  {id:'flipX',label:'左右反転',matrix:[-1,0,0,1]},
  {id:'flipY',label:'上下反転',matrix:[1,0,0,-1]},
  {id:'rotate90',label:'90°回転',matrix:[0,-1,1,0]},
  {id:'rotate180',label:'180°回転',matrix:[-1,0,0,-1]},
  {id:'rotate270',label:'270°回転',matrix:[0,1,-1,0]},
  {id:'diagonal',label:'対角反転',matrix:[0,1,1,0]},
  {id:'antiDiagonal',label:'逆対角反転',matrix:[0,-1,-1,0]},
];
function transformMask(mask, transform) {
  const [a,b,c,d]=transform.matrix;
  let result=0;
  NEIGHBORS.forEach(([x,y],bit)=>{
    if(mask&(1<<bit))result |= 1<<NEIGHBORS.findIndex(([nx,ny])=>nx===a*x+b*y&&ny===c*x+d*y);
  });
  return result;
}
function transformPixels(pixels, size, transform) {
  const [a,b,c,d]=transform.matrix, result=Array(size*size);
  const ox=(a<0||b<0)?size-1:0, oy=(c<0||d<0)?size-1:0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)result[(c*x+d*y+oy)*size+a*x+b*y+ox]=pixels[y*size+x];
  return result;
}
// symmetry bits: 1 = horizontal reflection, 2 = vertical reflection, 4 = quarter turns.
function supportedSymmetry(styleBits) {
  return [1,2,3].reduce((bits,index,i)=>bits | (transformMask(styleBits,TILE_TRANSFORMS[index])===styleBits ? 1<<i : 0),0);
}
const symmetryTransformCache=new Map();
function symmetryTransforms(type) {
  const bits=(type.symmetry || 0)&supportedSymmetry(type.styleBits);
  if(!symmetryTransformCache.has(bits)) {
    const generators=[1,2,3].filter((_,i)=>bits&(1<<i)).map(i=>TILE_TRANSFORMS[i]);
    const reached=new Set(['identity']), queue=[TILE_TRANSFORMS[0]];
    for(const transform of queue)for(const generator of generators) {
      const [a,b,c,d]=transform.matrix,[e,f,g,h]=generator.matrix;
      const matrix=[a*e+b*g,a*f+b*h,c*e+d*g,c*f+d*h];
      const next=TILE_TRANSFORMS.find(t=>t.matrix.every((value,i)=>value===matrix[i]));
      if(!reached.has(next.id)){reached.add(next.id);queue.push(next);}
    }
    symmetryTransformCache.set(bits,TILE_TRANSFORMS.filter(t=>reached.has(t.id)));
  }
  return symmetryTransformCache.get(bits);
}
const CENTER_TRANSFORM={id:'center',label:'中央タイル',matrix:[1,0,0,1]};
function centerSourceMask(type) {
  if(!type.centerFill)return null;
  const valid=new Set(patterns(type.styleBits));
  for(const mask of [type.styleBits, type.styleBits&85]) {
    if(mask&&valid.has(mask)&&Object.hasOwn(type.tiles,mask))return mask;
  }
  return null;
}
function derivedTile(type, mask) {
  if(Object.hasOwn(type.tiles,mask))return null;
  for(const transform of symmetryTransforms(type)) {
    // Orthogonal matrices invert by transposition: find a saved source, then transform it forward.
    const [a,b,c,d]=transform.matrix;
    const sourceMask=transformMask(mask,{matrix:[a,c,b,d]});
    if(Object.hasOwn(type.tiles,sourceMask))return {sourceMask,transform};
  }
  const source=centerSourceMask(type);
  if(source!=null&&source!==mask)return {sourceMask:source,transform:CENTER_TRANSFORM};
  return null;
}
function materializeTile(type, size, mask) {
  if(!Object.hasOwn(type.tiles,mask))type.tiles[mask]=tilePixels(type,size,mask).slice();
  return type.tiles[mask];
}
function symmetryTargets(type, mask) {
  const targets=new Map();
  for(const transform of symmetryTransforms(type)) {
    const target=transformMask(mask,transform);
    if(target!==mask&&!Object.hasOwn(type.tiles,target)&&!targets.has(target))targets.set(target,transform);
  }
  return targets;
}
function bakeSymmetricTiles(type, size, mask) {
  const targets=symmetryTargets(type,mask), pixels=tilePixels(type,size,mask);
  for(const [target,transform] of targets)type.tiles[target]=transformPixels(pixels,size,transform);
  return targets.size;
}
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
  return { id, name, color, seed, styleBits:255, symmetry:7, centerFill:true, tiles:{} };
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
  const derived=derivedTile(type,mask);
  if(derived)return transformPixels(type.tiles[derived.sourceMask],tileSize,derived.transform);
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
  if(!value||value.format!=='dot-map'||value.version!==2||![8,16,32,64].includes(value.tileSize)||typeof value.name!=='string'||value.name.length>80)fail();
  if(!Array.isArray(value.types)||value.types.length<1||value.types.length>32)fail();
  const ids=new Set();
  const types=value.types.map(t=>{
    if(!t||typeof t.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||t.name.length>40||!isColor(t.color)||typeof t.seed!=='boolean'||!Number.isInteger(t.styleBits)||t.styleBits<0||t.styleBits>255||!t.tiles)fail();
    ids.add(t.id);
    const type=makeType(t.id,t.name,t.color,t.seed);type.styleBits=t.styleBits;
    if(t.symmetry!==undefined&&(!Number.isInteger(t.symmetry)||t.symmetry<0||t.symmetry>7))fail();
    type.symmetry=t.symmetry===undefined?0:t.symmetry;
    if(t.centerFill!==undefined&&t.centerFill!==true&&t.centerFill!==false)fail();
    type.centerFill=t.centerFill===true;
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
function readAtlasMetadata(png) {
  const fail=()=>{throw new Error('dot-map-atlas の対応表が入ったPNGではありません。');};
  const signature=[137,80,78,71,13,10,26,10];
  if(!signature.every((byte,i)=>png[i]===byte))fail();
  const view=new DataView(png.buffer,png.byteOffset,png.byteLength), key=new TextEncoder().encode('dot-map-atlas\0');
  for(let offset=8;offset+12<=png.length;) {
    const length=view.getUint32(offset),end=offset+12+length;
    if(end>png.length)break;
    const data=png.subarray(offset+8,end-4);
    if(view.getUint32(offset+4)===0x74455874 && key.every((byte,i)=>data[i]===byte)) {
      let value;try{value=JSON.parse(new TextDecoder().decode(data.subarray(key.length)));}catch{fail();}
      if(!value||value.format!=='dot-map-atlas'||value.version!==1||![8,16,32,64].includes(value.tileSize)||!Number.isInteger(value.columns)||value.columns<1||!Array.isArray(value.types))fail();
      for(const t of value.types) {
        if(!t||typeof t.id!=='string'||typeof t.name!=='string'||!Number.isInteger(t.styleBits)||t.styleBits<0||t.styleBits>255||!Array.isArray(t.tiles))fail();
        if(!t.tiles.every(tile=>tile&&Number.isInteger(tile.mask)&&Number.isInteger(tile.x)&&Number.isInteger(tile.y)&&tile.x>=0&&tile.y>=0))fail();
      }
      return value;
    }
    offset=end;
  }
  fail();
}
// rgba = decoded atlas pixels (width*height*4). Adds one type per entry; ids are made unique, unknown masks are skipped.
function importAtlas(project, metadata, rgba, width, height) {
  if(metadata.tileSize!==project.tileSize)throw new Error(`タイルサイズが違います（アトラス ${metadata.tileSize}px、プロジェクト ${project.tileSize}px）。`);
  const size=project.tileSize, ids=new Set(project.types.map(t=>t.id)), added=[];
  for(const entry of metadata.types) {
    if(project.types.length+added.length>=32)break;
    let id=entry.id.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'type';
    for(let n=2;ids.has(id);n++)id=`${entry.id.slice(0,48)}-${n}`;
    ids.add(id);
    const type=makeType(id,entry.name.slice(0,40)||id,'#888888');type.styleBits=entry.styleBits;
    const valid=new Set(patterns(entry.styleBits)), counts=new Map();
    for(const tile of entry.tiles) {
      if(!valid.has(tile.mask)||(tile.x+1)*size>width||(tile.y+1)*size>height)continue;
      const pixels=Array(size*size);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
        const i=((tile.y*size+y)*width+tile.x*size+x)*4;
        const color=rgba[i+3]<128?null:'#'+[rgba[i],rgba[i+1],rgba[i+2]].map(n=>n.toString(16).padStart(2,'0')).join('');
        pixels[y*size+x]=color;if(color)counts.set(color,(counts.get(color)||0)+1);
      }
      type.tiles[tile.mask]=pixels;
    }
    // the field colour is the most common pixel colour so the layout view resembles the tiles
    for(const [color,count] of counts)if(count>(counts.get(type.color)||0))type.color=color;
    project.types.push(type);added.push(type);
  }
  return added;
}
