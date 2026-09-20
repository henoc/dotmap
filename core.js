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

const STYLES = {
  both: { label: 'Match Corners and Sides', count: 47 },
  sides: { label: 'Match Sides', count: 16 },
  corners: { label: 'Match Corners', count: 16 },
};
// Bits clockwise by group: N, E, S, W, NE, SE, SW, NW.
const NEIGHBORS = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
function patternMask(style, raw) {
  if (style === 'sides') return raw & 15;
  if (style === 'corners') return (raw >> 4) & 15;
  let result = raw & 15;
  // Blob-47: a diagonal only matters when both adjoining sides connect.
  for (const [corner, sides] of [[16,3],[32,6],[64,12],[128,9]]) {
    if ((raw & corner) && (raw & sides) === sides) result |= corner;
  }
  return result;
}
function patterns(style) {
  return style === 'both'
    ? [...new Set(Array.from({length:256}, (_,raw) => patternMask(style,raw)))].sort((a,b)=>a-b)
    : Array.from({length:16},(_,i)=>i);
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
  return { type, mask: patternMask(type.style,raw), raw };
}
function makeType(id, name, color, seed = false) {
  return { id, name, color, seed, style:'both', tiles:{both:{},sides:{},corners:{}} };
}
function createProject(tileSize = 16) {
  const rows = ['11111111','11122211','11222211','11221111','11331111','13311111','33311111','11111111'];
  return {
    format:'dot-map', version:1, name:'小さな世界', tileSize, palette:DEFAULT_PALETTE.slice(),
    types:[makeType('grass','草地','#789563',true),makeType('water','水辺','#759eac',true),makeType('path','小道','#be9b6f',true)],
    field:{width:8,height:8,cells:rows.join('').split('').map(c=>['grass','water','path'][Number(c)-1])},
  };
}
function shiftColor(hex, amount) {
  return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(hex.slice(i,i+2),16)+amount)).toString(16).padStart(2,'0')).join('');
}
function tilePixels(type, tileSize, mask, style = type.style) {
  const saved = type.tiles[style][mask];
  if (saved) return saved;
  const pixels = Array(tileSize*tileSize).fill(null);
  if (!type.seed) return pixels;
  const dark=shiftColor(type.color,-24), light=shiftColor(type.color,22);
  for(let y=0;y<tileSize;y++) for(let x=0;x<tileSize;x++) {
    let value=type.color;
    if ((x*13+y*7)%37===0) value=light;
    if (style!=='corners') {
      if((y<2&&!(mask&1))||(x>=tileSize-2&&!(mask&2))||(y>=tileSize-2&&!(mask&4))||(x<2&&!(mask&8))) value=dark;
    }
    if(style!=='sides') {
      const corner=style==='corners'?mask:mask>>4;
      if((x>=tileSize-3&&y<3&&!(corner&1))||(x>=tileSize-3&&y>=tileSize-3&&!(corner&2))||(x<3&&y>=tileSize-3&&!(corner&4))||(x<3&&y<3&&!(corner&8))) value=dark;
    }
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
  if(!value||value.format!=='dot-map'||value.version!==1||![8,16,32].includes(value.tileSize)||typeof value.name!=='string'||value.name.length>80)fail();
  if(!Array.isArray(value.types)||value.types.length<1||value.types.length>32)fail();
  const ids=new Set();
  const types=value.types.map(t=>{
    if(!t||typeof t.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||t.name.length>40||!isColor(t.color)||typeof t.seed!=='boolean'||!Object.hasOwn(STYLES,t.style)||!t.tiles)fail();
    ids.add(t.id);
    const type=makeType(t.id,t.name,t.color,t.seed);type.style=t.style;
    for(const style of Object.keys(STYLES)) {
      const bank=t.tiles[style], valid=patterns(style);
      if(!bank||typeof bank!=='object'||Array.isArray(bank))fail();
      for(const [key,pixels] of Object.entries(bank)) {
        if(!valid.includes(Number(key))||String(Number(key))!==key||!Array.isArray(pixels)||pixels.length!==value.tileSize**2||!pixels.every(p=>p===null||isColor(p)))fail();
        type.tiles[style][key]=pixels.map(p=>p===null?null:p.toLowerCase());
      }
    }
    return type;
  });
  const f=value.field;
  if(!f||!isSize(f.width)||!isSize(f.height)||!Array.isArray(f.cells)||f.cells.length!==f.width*f.height||!f.cells.every(c=>c===null||ids.has(c)))fail();
  return {format:'dot-map',version:1,name:value.name,tileSize:value.tileSize,palette:normalizePalette(value.palette),types,field:{width:f.width,height:f.height,cells:f.cells.slice()}};
}
