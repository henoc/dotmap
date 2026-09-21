// Run with: node test.mjs (no dependencies required).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { deflateSync } from 'node:zlib';

const core = readFileSync(new URL('./core.js', import.meta.url), 'utf8');
const { drawLine, floodFill, patternMask, patterns, createProject, resolveCell, tilePixels, makeType, resizeField, removeType, validateProject, DEFAULT_PALETTE, PALETTE_PRESETS, normalizePalette, parsePaletteText, serializePaletteHex, paletteFromPixels, mergePalette, nearestPaletteColor, snapTypeToPalette, BIT_ORDER, setStyleBits, discardedMasks, atlasLayout, crc32, pngChunk, embedAtlasMetadata, readAtlasMetadata, importAtlas, TILE_TRANSFORMS, transformMask, transformPixels, supportedSymmetry, symmetryTransforms, derivedTile, materializeTile, symmetryTargets, bakeSymmetricTiles } = runInNewContext(core + '\n({drawLine, floodFill, patternMask, patterns, createProject, resolveCell, tilePixels, makeType, resizeField, removeType, validateProject, DEFAULT_PALETTE, PALETTE_PRESETS, normalizePalette, parsePaletteText, serializePaletteHex, paletteFromPixels, mergePalette, nearestPaletteColor, snapTypeToPalette, BIT_ORDER, setStyleBits, discardedMasks, atlasLayout, crc32, pngChunk, embedAtlasMetadata, readAtlasMetadata, importAtlas, TILE_TRANSFORMS, transformMask, transformPixels, supportedSymmetry, symmetryTransforms, derivedTile, materializeTile, symmetryTargets, bakeSymmetricTiles})', {TextEncoder, TextDecoder});
const pixels = Array(64).fill(null);
drawLine(pixels, 8, [0,0], [7,7], '#123456');
assert.equal(pixels.filter(Boolean).length, 8, 'Fast diagonal strokes must be continuous');
for (let i=0; i<8; i++) assert.equal(pixels[i*8+i], '#123456');
floodFill(pixels, 8, 0, 7, '#abcdef');
assert.equal(pixels[7*8], '#abcdef');
assert.equal(pixels[7], null, 'Fill must not cross diagonal boundary');
assert.equal(pixels.filter(p=>p==='#abcdef').length, 28);
floodFill(pixels, 8, 0, 7, '#abcdef');
assert.equal(pixels.filter(p=>p==='#abcdef').length, 28, 'Same-color fill terminates');
drawLine(pixels, 8, [7,7], [0,0], null);
assert.equal(pixels.filter(p=>p==='#123456').length, 0, 'Reverse strokes can erase');
const edge = Array(64).fill(null);
drawLine(edge, 8, [0,0], [0,0], '#123456', 4);
assert.equal(edge.length,64);
assert.equal(edge.filter(Boolean).length,9,'Large brushes clip at canvas edges');
assert.equal(edge[7],null,'Brush must not wrap into another row');
floodFill(edge,8,7,7,'#123456');
assert.ok(edge.every(p=>p==='#123456'));


assert.equal(patterns(255).length,47);
assert.equal(patterns(85).length,16);
assert.equal(patterns(170).length,16);
assert.equal(patterns(68).length,4,'Left/right-only style');
assert.equal(patterns(0).length,1,'No directions means one tile');
assert.equal(patternMask(255,2),0,'Disconnected corner is ignored when both sides participate');
assert.equal(patternMask(255,3),1,'One adjoining side is insufficient');
assert.equal(patternMask(255,7),7,'Both adjoining sides allow the corner');
assert.equal(patternMask(170,2),2,'Corner-only style keeps independent corners');
assert.equal(patternMask(3,2),2,'Corner stays independent if one side is outside style');
assert.equal(patternMask(193,128),0,'Top-left wraps to top and left');
assert.equal(patternMask(193,193),193);
const neighborProject=createProject();
neighborProject.field={width:3,height:3,cells:Array(9).fill(null)};
const positions=[1,2,5,8,7,6,3,0];
for(let styleBits=0;styleBits<256;styleBits++) {
  const masks=patterns(styleBits),reachable=new Set();
  neighborProject.types[0].styleBits=styleBits;
  for(let raw=0;raw<256;raw++) {
    neighborProject.field.cells.fill(null);neighborProject.field.cells[4]='grass';
    positions.forEach((index,bit)=>{if(raw&(1<<bit))neighborProject.field.cells[index]='grass';});
    const resolved=resolveCell(neighborProject,4);
    // Independent per-direction oracle: gate each enabled corner by its enabled side pair.
    let expected=0;
    for(let bit=0;bit<8;bit++) {
      if(!(raw&styleBits&(1<<bit)))continue;
      const prev=(bit+7)%8,next=(bit+1)%8;
      if(bit%2 && (styleBits&(1<<prev)) && (styleBits&(1<<next)) && (!(raw&(1<<prev))||!(raw&(1<<next))))continue;
      expected|=1<<bit;
    }
    assert.equal(resolved.mask,expected);
    assert.equal(resolved.raw,raw,'Neighbor bit order must be clockwise from top');
    assert.ok(masks.includes(resolved.mask));reachable.add(resolved.mask);
  }
  assert.equal(reachable.size,masks.length,'Only reachable patterns may be listed');
}
const project=createProject();
project.field={width:3,height:2,cells:['grass','grass','water','water','grass','grass']};
assert.equal(resolveCell(project,0).raw,12,'N/W boundary must not wrap into another row');
assert.equal(resolveCell(project,2).mask,0,'Different types are disconnected');
project.field={width:4,height:4,cells:Array(16).fill('grass')};
assert.equal(resolveCell(project,5).mask,resolveCell(project,10).mask);
const type=project.types[0], mask=resolveCell(project,5).mask;
const shared=tilePixels(type,16,mask).slice();shared[0]='#abcdef';type.tiles[mask]=shared;
assert.equal(tilePixels(resolveCell(project,10).type,16,resolveCell(project,10).mask)[0],'#abcdef');
const untouched=tilePixels(type,16,0)[0];assert.notEqual(untouched,'#abcdef');
type.tiles[0]=Array(256).fill('#123456');
assert.ok(discardedMasks(type,85).includes(255));
setStyleBits(type,85);
assert.equal(type.styleBits,85);assert.equal(type.tiles[255],undefined,'Incompatible patterns are discarded');
assert.equal(type.tiles[0][0],'#123456','Compatible patterns retain their pixels');
setStyleBits(type,255);assert.notEqual(tilePixels(type,16,255)[0],'#abcdef','Discarded pixels must not resurrect on another style change');
const newType=makeType('new','Blank','#123456');assert.ok(tilePixels(newType,16,0).every(p=>p===null));
resizeField(project,5,3);assert.equal(project.field.cells.length,15);assert.equal(project.field.cells[4],null);assert.equal(project.field.cells[5],'grass');
removeType(project,'grass');assert.ok(project.field.cells.every(p=>p===null));
const roundTrip=createProject();
roundTrip.types[0].tiles[255]=Array(256).fill('#123456');
const serialize=value=>JSON.stringify(value);
assert.equal(serialize(validateProject(JSON.parse(serialize(roundTrip)))),serialize(roundTrip));
for(const corrupt of [
  p=>p.field.cells.push(null),p=>p.field.cells[0]='missing',p=>p.types.push(p.types[0]),
  p=>p.types[0].styleBits='invalid',p=>p.tileSize=999,p=>p.field.width=0,
  p=>p.types[0].tiles[2]=Array(256).fill(null),p=>p.types[0].tiles[0]=['#123456'],
  p=>p.types[0].tiles[0]=Array(256).fill('red'),p=>p.types[0].styleBits=256,p=>p.types[0].styleBits=-1,p=>p.types[0].styleBits=1.5,
]) {
  const invalid=createProject();corrupt(invalid);assert.throws(()=>validateProject(invalid));
}
console.log('Terrain checks passed: pixel tools, all 65,536 style/neighbor combinations, 47/16/16 patterns, shared tiles, style pruning, field resizing, type removal, project validation.');

// Palette imports accept mixed formats without requiring a file header.
const same=(actual,expected)=>assert.deepEqual(Array.from(actual),expected);
same(parsePaletteText('GIMP Palette\nName: example\nColumns: 4\n# header\n255 0 0 Red\n#AABBCC, 112233\n80445566\n0 128 255 Blue\n#ff0000'),
  ['#ff0000','#aabbcc','#112233','#445566','#0080ff']);
same(parsePaletteText('#ABCDEF abcdef FFabcdef #12ab34 #12345678'),['#abcdef','#12ab34','#345678']);
same(parsePaletteText('001 002 003\r\n255\t255\t255 White\r0 0 0 Black'),['#010203','#ffffff','#000000']);
same(parsePaletteText('#123 #12345 #1234567 #123456789 256 0 0\n-1 0 0\n1.5 2 3\n0 0 999\nnotabcdefword'),[]);
same(parsePaletteText('#ff0000 #00ff00 #ff0000 #0000ff'),['#ff0000','#00ff00','#0000ff']);
same(paletteFromPixels(new Uint8ClampedArray([255,0,0,255, 0,0,255,255, 255,0,0,20, 0,255,0,0])),['#ff0000','#0000ff','#00ff00']);
same(mergePalette(['#112233'],['#445566','#112233','#445566'],'append'),['#112233','#445566']);
same(mergePalette(['#112233'],['#445566','#445566'],'replace'),['#445566']);
same(normalizePalette([]),[]);
same(normalizePalette(['#ABCDEF']),['#abcdef']);
for(const value of [undefined,null,'#123456',['#123'],[123],['#123456','bad'],{}]) {
  same(normalizePalette(value),Array.from(DEFAULT_PALETTE));
  const invalidPalette=createProject();invalidPalette.palette=value;
  same(validateProject(invalidPalette).palette,Array.from(DEFAULT_PALETTE));
}
const fresh=createProject();assert.equal(fresh.palette.length,20);fresh.palette.pop();assert.equal(createProject().palette.length,20);
const custom=createProject();custom.palette=['#123456','#abcdef'];
same(validateProject(JSON.parse(JSON.stringify(custom))).palette,custom.palette);
custom.palette=[];same(validateProject(custom).palette,[]);
assert.equal(PALETTE_PRESETS.find(p=>p.id==='nature').colors,DEFAULT_PALETTE);
for(const preset of PALETTE_PRESETS) {
  assert.ok(preset.colors.every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/.test(c)));
  same(parsePaletteText(serializePaletteHex(preset.colors)),Array.from(preset.colors));
}
same(parsePaletteText(serializePaletteHex([])),[]);
assert.equal(nearestPaletteColor('#010000',['#000000','#ffffff']),'#000000');
assert.equal(nearestPaletteColor('#000000',['#000000','#ffffff']),'#000000');
assert.equal(nearestPaletteColor('#ffffff',['#000000','#ffffff']),'#ffffff');
const snapType=makeType('snap','寄せ','#010000');
snapType.symmetry=4;
snapType.tiles={1:Array.from({length:64},(_,i)=>i===0?'#010000':i===1?null:i===2?'#000000':null)};
snapTypeToPalette(snapType,['#000000','#ffffff']);
assert.equal(snapType.color,'#000000');
assert.equal(snapType.tiles[1][0],'#000000');
assert.equal(snapType.tiles[1][1],null);
assert.equal(snapType.tiles[1][2],'#000000');
assert.deepEqual(Object.keys(snapType.tiles),['1'],'Snapping must not materialize derived tiles');
console.log('Palette checks passed: mixed HEX/ARGB/RGB, bounds, ordering, PNG RGB pixels, duplicate handling, fresh defaults, JSON round-trip, fallback and empty palettes, presets, hex export, nearest-color snap.');


const atlasProject=createProject();
atlasProject.types[1].styleBits=85;atlasProject.types[2].styleBits=68;
const layout=atlasLayout(atlasProject),metadata=layout.metadata;
assert.equal(metadata.format,'dot-map-atlas');assert.equal(metadata.version,1);
same(metadata.bitOrder,['top','topRight','right','bottomRight','bottom','bottomLeft','left','topLeft']);
assert.equal(metadata.tileSize,16);assert.equal(metadata.columns,8);
same(metadata.types.map(t=>t.tiles.length),[47,16,4]);
same(metadata.types.map(t=>t.tiles[0].y),[0,6,8]);
assert.equal(layout.width,128);assert.equal(layout.height,144);
const coordinates=new Set();
metadata.types.forEach((t,typeIndex)=>{
  same(t.tiles.map(tile=>tile.mask),Array.from(patterns(atlasProject.types[typeIndex].styleBits)));
  t.tiles.forEach((tile,index)=>{
    assert.equal(tile.x,index%8);assert.equal(tile.y,t.tiles[0].y+Math.floor(index/8));
    assert.ok(!coordinates.has(`${tile.x},${tile.y}`));coordinates.add(`${tile.x},${tile.y}`);
    assert.ok(tile.x*16<layout.width&&tile.y*16<layout.height);
  });
});
assert.equal(coordinates.size,67,'No placeholder or unreachable tile records');
assert.ok(!JSON.stringify(metadata).includes('pixels'));
assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926,'Standard CRC32 check vector');

// Encode a valid blank RGBA atlas, then run the same PNG-byte insertion used after canvas.toBlob.
const header=Buffer.alloc(13);header.writeUInt32BE(layout.width,0);header.writeUInt32BE(layout.height,4);header[8]=8;header[9]=6;
const raw=Buffer.alloc((layout.width*4+1)*layout.height);
const original=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',new Uint8Array())]);
const written=Buffer.from(embedAtlasMetadata(original,metadata));
// Reader code independently walks the exported bytes; no reliance on the writer's CRC function.
function readerCRC(bytes) {
  const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;
}
let found=0,decoded,previousType='',metadataOffset=-1;
for(let offset=8;offset<written.length;) {
  const length=written.readUInt32BE(offset),type=written.toString('ascii',offset+4,offset+8),end=offset+12+length;
  assert.ok(end<=written.length);
  assert.equal(written.readUInt32BE(end-4),readerCRC(written.subarray(offset+4,end-4)),`CRC for ${type}`);
  if(type==='tEXt') {
    const data=written.subarray(offset+8,end-4),nul=data.indexOf(0);
    if(data.toString('ascii',0,nul)==='dot-map-atlas') {
      const json=data.toString('utf8',nul+1);assert.ok(!json.includes('\n'));
      decoded=JSON.parse(json);found++;metadataOffset=offset;
    }
  }
  if(type==='IEND'){assert.equal(previousType,'tEXt');assert.equal(end,written.length);}
  previousType=type;offset=end;
}
assert.equal(found,1);assert.equal(JSON.stringify(decoded),JSON.stringify(metadata));assert.equal(decoded.types[0].name,'草地');
assert.deepEqual(written.subarray(0,metadataOffset),original.subarray(0,original.length-12),'Original image chunks are preserved');
assert.deepEqual(written.subarray(-12),original.subarray(-12));
assert.throws(()=>embedAtlasMetadata(original.subarray(0,original.length-1),metadata));
console.log('Atlas PNG checks passed: packed rows, ascending masks, no placeholder records, one UTF-8 tEXt before IEND, JSON round-trip and independently verified CRCs.');

// Round trip: the exported bytes read back into a project as new types with the atlas pixels.
{
  const back=readAtlasMetadata(written);
  assert.equal(JSON.stringify(back),JSON.stringify(metadata));
  assert.throws(()=>readAtlasMetadata(original),/dot-map-atlas/);
  const rgba=new Uint8Array(layout.width*layout.height*4), size=atlasProject.tileSize, water=metadata.types[1], tile=water.tiles[3];
  rgba.set([0x12,0x34,0x56,255],((tile.y*size+1)*layout.width+tile.x*size+2)*4);   // one opaque pixel at (2,1) of that tile
  const target=createProject(size);
  const added=importAtlas(target,back,rgba,layout.width,layout.height);
  assert.equal(added.length,metadata.types.length);
  assert.equal(added.map(t=>t.id).join(),'grass-2,water-2,path-2','ids stay unique against the existing types');
  assert.equal(added[1].styleBits,85);
  assert.equal(Object.keys(added[1].tiles).length,water.tiles.length);
  const pixels=added[1].tiles[tile.mask];
  assert.equal(pixels[1*size+2],'#123456');assert.equal(pixels.filter(Boolean).length,1,'transparent pixels become null');
  assert.equal(added[1].color,'#123456');
  assert.throws(()=>importAtlas(createProject(size===8?16:8),back,rgba,layout.width,layout.height),/タイルサイズ/);
  console.log('Atlas import checks passed.');
}

// Native file permissions, cancellation and atomic replacement are shared by both editors.
{
  const {createFileIO,filename}=await import('./file-io.js').then(m=>m.default);
  const config={id:'test-editor',description:'JSON',accept:{'application/json':['.json']}};
  const source={name:'opened.json',getFile:async()=>({name:'opened.json'}),requestPermission:async options=>{
    assert.equal(options.mode,'readwrite');return 'granted';
  }};
  let options, pickerCalls=0;
  const destination={name:'renamed.json'};
  const io=createFileIO(config,{
    showOpenFilePicker:async opts=>{assert.equal(opts.multiple,true);return [source];},
    showSaveFilePicker:async opts=>{pickerCalls++;options=opts;return destination;},
  });
  assert.equal((await io.openFiles(true))[0].handle,source);
  assert.equal(await io.saveTarget('new.json',source),source);
  assert.equal(pickerCalls,0,'Overwrite must retain the opened file without another picker');
  assert.equal(await io.saveTarget('new.json',null,source),destination);
  assert.equal(options.suggestedName,'new.json');assert.equal(options.startIn,source);
  assert.equal(createFileIO(config,{}).canSave(),false);
  assert.equal(createFileIO(config,{}).canOpen(),false);
  await assert.rejects(io.saveTarget('x.json',{requestPermission:async()=> 'denied'}),/許可/);
  assert.equal(pickerCalls,1,'Permission rejection must not redirect the save');
  const cancelled=createFileIO(config,{showSaveFilePicker:async()=>{throw new DOMException('Cancelled','AbortError');}});
  await assert.rejects(cancelled.saveTarget('x.json'),{name:'AbortError'});
  const calls=[], blob=new Blob(['{"stage":1}'],{type:'application/json'});
  await io.write({createWritable:async()=>({write:async data=>calls.push(await data.text()),close:async()=>calls.push('close')})},blob);
  assert.deepEqual(calls,['{"stage":1}','close']);
  for(const failure of ['write','close']) {
    let aborted=false;
    await assert.rejects(io.write({createWritable:async()=>({
      write:async()=>{if(failure==='write')throw new Error('disk full');},
      close:async()=>{if(failure==='close')throw new Error('disk full');},
      abort:async()=>{aborted=true;},
    })},blob),/disk full/);
    assert.ok(aborted,'Failed writes must discard the temporary file');
  }
  assert.equal(filename('a/b','.json','untitled'),'a_b.json');
  assert.equal(filename('scene.JSON','.json','untitled'),'scene.JSON');
  assert.equal(filename(' ','.json','untitled'),'untitled.json');
  console.log('File I/O checks passed: handles, overwrite permission, save-as destination, cancellation and atomic writes.');
}

// D4 orientation: each pixel and its corresponding neighbor bit must travel together.
{
const transforms=TILE_TRANSFORMS;
const grids=[
  [0,1,2,3,4,5,6,7,8], [2,1,0,5,4,3,8,7,6], [6,7,8,3,4,5,0,1,2],
  [6,3,0,7,4,1,8,5,2], [8,7,6,5,4,3,2,1,0], [2,5,8,1,4,7,0,3,6],
  [0,3,6,1,4,7,2,5,8], [8,5,2,7,4,1,6,3,0],
];
const neighborPixels=[1,2,5,8,7,6,3,0];
transforms.forEach((transform,i)=>{
  same(transformPixels(grids[0],3,transform),grids[i]);
  neighborPixels.forEach((pixel,bit)=>{
    const destination=neighborPixels.indexOf(grids[i].indexOf(pixel));
    assert.equal(transformMask(1<<bit,transform),1<<destination);
  });
});
const symmetric=makeType('sym','対称','#123456');
symmetric.symmetry=7;
assert.equal(symmetryTransforms(symmetric).length,8);
for(let flags=0;flags<8;flags++) {
  symmetric.symmetry=flags;
  assert.equal(symmetryTransforms(symmetric).length,[1,2,2,4,4,8,8,8][flags]);
}
// Arbitrary custom styles must preserve both the style and the reduced masks.
for(let bits=0;bits<256;bits++) {
  symmetric.styleBits=bits;symmetric.symmetry=7;
  const allowed=symmetryTransforms(symmetric), valid=patterns(bits);
  for(const transform of allowed) {
    assert.equal(transformMask(bits,transform),bits);
    for(let raw=0;raw<256;raw++)assert.equal(transformMask(patternMask(bits,raw),transform),patternMask(bits,transformMask(raw,transform)));
    for(const mask of valid)assert.ok(valid.includes(transformMask(mask,transform)));
  }
}
assert.equal(supportedSymmetry(68),3,'Horizontal connections forbid quarter turns');
symmetric.styleBits=68;symmetric.symmetry=4;
assert.equal(symmetryTransforms(symmetric).length,1,'An unsupported rotation checkbox cannot enable 180° alone');
symmetric.styleBits=255;symmetric.symmetry=4;
symmetric.tiles={1:Array.from({length:64},(_,i)=>i===0?'#112233':i===10?'#abcdef':null)};
const sourcePixels=symmetric.tiles[1].slice();
assert.equal(derivedTile(symmetric,4).sourceMask,1);
assert.equal(derivedTile(symmetric,4).transform.id,'rotate90');
same(tilePixels(symmetric,8,4),Array.from(transformPixels(sourcePixels,8,transforms[3])));
assert.deepEqual(Object.keys(symmetric.tiles),['1'],'Reading derived pixels must not create saved tiles');
assert.equal(derivedTile(symmetric,0),null,'Unrelated masks stay placeholders');
symmetric.symmetry=0;assert.ok(tilePixels(symmetric,8,4).every(p=>p===null));
symmetric.symmetry=4;
const copy=materializeTile(symmetric,8,4);
assert.equal(derivedTile(symmetric,4),null);
assert.notEqual(copy,symmetric.tiles[1]);
copy[0]='#fedcba';assert.equal(symmetric.tiles[1][0],'#112233');
symmetric.tiles[1][0]='#aabbcc';assert.equal(copy[7],'#112233','Editing the source leaves an existing copy unchanged');
symmetric.tiles[16]=Array(64).fill(null);
assert.equal(derivedTile(symmetric,16),null,'Explicitly cleared tiles override derived pixels');
assert.ok(tilePixels(symmetric,8,16).every(p=>p===null));
const beforeSource=symmetric.tiles[1].slice(), beforeCopy=Array.from(copy);
assert.equal(bakeSymmetricTiles(symmetric,8,1),1,'Only the remaining unsaved counterpart is baked');
same(symmetric.tiles[1],beforeSource);same(symmetric.tiles[4],beforeCopy);
assert.ok(symmetric.tiles[16].every(p=>p===null),'Baking preserves saved transparency');
same(symmetric.tiles[64],Array.from(transformPixels(beforeSource,8,transforms[5])));
assert.equal(bakeSymmetricTiles(symmetric,8,1),0,'Baking again is a no-op');
symmetric.tiles[1][0]=null;assert.notEqual(symmetric.tiles[64][56],null,'Baked copies do not follow their source');
// A derived selection can itself be baked, without recursively deriving from unsaved tiles.
symmetric.tiles={1:sourcePixels.slice()};
assert.equal(bakeSymmetricTiles(symmetric,8,4),2);
assert.equal(Object.hasOwn(symmetric.tiles,4),false,'The selected derived tile stays derived');
same(symmetric.tiles[16],Array.from(transformPixels(sourcePixels,8,transforms[4])));
symmetric.tiles={1:sourcePixels.slice(),64:Array(64).fill('#445566')};
symmetric.symmetry=7;
assert.equal(derivedTile(symmetric,4).sourceMask,64,'Fixed transform order makes multiple sources deterministic');
const derivedBefore=JSON.stringify(tilePixels(symmetric,8,4));
const reverseEntries=Object.fromEntries(Object.entries(symmetric.tiles).reverse());
symmetric.tiles=reverseEntries;
assert.equal(JSON.stringify(tilePixels(symmetric,8,4)),derivedBefore);
const symmetryProject=createProject(8);symmetryProject.types=[symmetric];symmetryProject.field.cells.fill('sym');
const restored=validateProject(JSON.parse(JSON.stringify(symmetryProject)));
assert.equal(restored.types[0].symmetry,7);
assert.equal(JSON.stringify(tilePixels(restored.types[0],8,4)),derivedBefore);
const metadata=atlasLayout(symmetryProject).metadata;
assert.equal(Object.hasOwn(metadata.types[0],'symmetry'),false,'Atlas metadata contains only the final tile layout');
const legacy=JSON.parse(JSON.stringify(symmetryProject));delete legacy.types[0].symmetry;
assert.equal(validateProject(legacy).types[0].symmetry,0,'Missing symmetry keeps legacy projects visually unchanged');
for(const invalid of [-1,8,1.5,'7',null,true]) {
  const data=JSON.parse(JSON.stringify(symmetryProject));data.types[0].symmetry=invalid;
  assert.throws(()=>validateProject(data));
}
console.log('Symmetry checks passed: D4 bit/pixel orientation, all custom styles, allowed groups, derivation, copy-on-write, baking, deterministic sources and JSON validation.');
}
