// Run with: node test.mjs (no dependencies required).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('./core.js', import.meta.url), 'utf8');
const { drawLine, floodFill, patternMask, patterns, createProject, resolveCell, tilePixels, makeType, resizeField, removeType, validateProject, DEFAULT_PALETTE, normalizePalette, parsePaletteText, paletteFromPixels, mergePalette } = runInNewContext(core + '\n({drawLine, floodFill, patternMask, patterns, createProject, resolveCell, tilePixels, makeType, resizeField, removeType, validateProject, DEFAULT_PALETTE, normalizePalette, parsePaletteText, paletteFromPixels, mergePalette})');
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


assert.equal(patterns('both').length,47);
assert.equal(patterns('sides').length,16);
assert.equal(patterns('corners').length,16);
assert.equal(patternMask('both',16),0,'Disconnected diagonal is ignored');
assert.equal(patternMask('both',17),1,'A diagonal with only one adjacent side is ignored');
assert.equal(patternMask('both',19),19,'A diagonal with both adjacent sides connects');
assert.equal(patternMask('both',255),255);
assert.equal(patternMask('sides',255),15);
assert.equal(patternMask('corners',16),1);
assert.equal(patternMask('corners',15),0);
for (const style of ['both','sides','corners']) {
  const masks=patterns(style),reachable=new Set();
  for(let raw=0;raw<256;raw++) {
    const project=createProject();
    project.types[0].style=style;
    project.field={width:3,height:3,cells:Array(9).fill(null)};project.field.cells[4]='grass';
    const positions=[1,5,7,3,2,8,6,0];
    positions.forEach((index,bit)=>{if(raw&(1<<bit))project.field.cells[index]='grass';});
    const resolved=resolveCell(project,4);
    assert.equal(resolved.mask,patternMask(style,raw));
    assert.ok(masks.includes(resolved.mask));reachable.add(resolved.mask);
  }
  assert.equal(reachable.size,masks.length,'Every listed tile must be reachable');
}
const project=createProject();
project.field={width:3,height:2,cells:['grass','grass','water','water','grass','grass']};
assert.equal(resolveCell(project,0).raw,34,'N/W boundary must not wrap into another row');
assert.equal(resolveCell(project,2).mask,0,'Different types are disconnected');
project.field={width:4,height:4,cells:Array(16).fill('grass')};
assert.equal(resolveCell(project,5).mask,resolveCell(project,10).mask);
const type=project.types[0], mask=resolveCell(project,5).mask;
const shared=tilePixels(type,16,mask).slice();shared[0]='#abcdef';type.tiles.both[mask]=shared;
assert.equal(tilePixels(resolveCell(project,10).type,16,resolveCell(project,10).mask)[0],'#abcdef');
const untouched=tilePixels(type,16,0)[0];assert.notEqual(untouched,'#abcdef');
type.style='sides';type.tiles.sides[15]=Array(256).fill('#123456');
type.style='both';assert.equal(tilePixels(type,16,mask)[0],'#abcdef','Style switch retains previous art');
const newType=makeType('new','Blank','#123456');assert.ok(tilePixels(newType,16,0).every(p=>p===null));
resizeField(project,5,3);assert.equal(project.field.cells.length,15);assert.equal(project.field.cells[4],null);assert.equal(project.field.cells[5],'grass');
removeType(project,'grass');assert.ok(project.field.cells.every(p=>p===null));
const roundTrip=createProject();
roundTrip.types[0].tiles.both[255]=Array(256).fill('#123456');
const serialize=value=>JSON.stringify(value);
assert.equal(serialize(validateProject(JSON.parse(serialize(roundTrip)))),serialize(roundTrip));
for(const corrupt of [
  p=>p.field.cells.push(null),p=>p.field.cells[0]='missing',p=>p.types.push(p.types[0]),
  p=>p.types[0].style='invalid',p=>p.tileSize=999,p=>p.field.width=0,
  p=>p.types[0].tiles.both[16]=Array(256).fill(null),p=>p.types[0].tiles.both[0]=['#123456'],
  p=>p.types[0].tiles.both[0]=Array(256).fill('red'),p=>p.types[0].tiles.corners[16]=Array(256).fill(null),
]) {
  const invalid=createProject();corrupt(invalid);assert.throws(()=>validateProject(invalid));
}
console.log('Terrain checks passed: pixel tools, all 768 neighbor cases, 47/16/16 patterns, shared tiles, style preservation, field resizing, type removal, project validation.');

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
console.log('Palette checks passed: mixed HEX/ARGB/RGB, bounds, ordering, PNG RGB pixels, duplicate handling, fresh defaults, JSON round-trip, fallback and empty palettes.');
