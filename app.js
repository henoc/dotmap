'use strict';
const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const storageKey = 'dot-map-project-v2';
const fileIO = EditorFileIO.createFileIO({id:'dot-map-project',description:'DOT プロジェクト',accept:{'application/json':['.json','.dotmap']}});
const pngIO = EditorFileIO.createFileIO({id:'dot-map-atlas',description:'アトラス PNG',accept:{'image/png':['.png']}});
let fileTarget={handle:null,name:null}, fileBusy=false, downloadKind='project';
let project = createProject();
let selection = { typeId:'grass', mask:255, cell:9 };
let tool='pen', fieldTool='select', color='#628b53', brush=1, zoom=16, previewScale=2;
let undoStack=[], redoStack=[], gesture=null, toastTimer;
let tileCards=new Map(), fieldButtons=[];
let paletteIndex=2, importedPalette=[], paletteReadId=0, exporting=false, pendingStyleChange=null;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function currentType() { return project.types.find(t=>t.id===selection.typeId)||project.types[0]; }
function selectedTile() {
  if(selection.cell!==null) return resolveCell(project,selection.cell);
  return {type:currentType(),mask:selection.mask};
}
function normalizeSelection() {
  if(!project.types.some(t=>t.id===selection.typeId)) selection.typeId=project.types[0].id;
  if(selection.cell!==null) {
    if(selection.cell<0||selection.cell>=project.field.cells.length) selection.cell=null;
    else {
      const match=resolveCell(project,selection.cell);
      if(match) { selection.typeId=match.type.id;selection.mask=match.mask; }
    }
  }
  if(!patterns(currentType().styleBits).includes(selection.mask)) selection.mask=0;
}
// Snapshots of the same document share its latest save target; open/new creates another target.
function snapshot() { return {project:clone(project),selection:{...selection},fileTarget}; }
function persist() {
  try { localStorage.setItem(storageKey,JSON.stringify(project));$('save-status').textContent='このブラウザに保存済み'; }
  catch { $('save-status').textContent='自動保存できません';toast('自動保存できません。「上書き保存」または「名前を付けて保存」でファイルに残してください。'); }
}
function commit(before, rebuild=true) {
  if(before.fileTarget!==fileTarget || JSON.stringify(before.project)!==JSON.stringify(project)) {
    undoStack.push(before);
    // ponytail: 40 whole-project snapshots; switch to pixel deltas for much larger projects.
    if(undoStack.length>40) undoStack.shift();
    redoStack=[];persist();
  }
  if(rebuild) renderAll(); else renderGraphics();
}
function change(action) {
  finishGesture();const before=snapshot();action();normalizeSelection();commit(before);
}
function history(direction) {
  finishGesture();
  const from=direction==='undo'?undoStack:redoStack,to=direction==='undo'?redoStack:undoStack;
  if(!from.length)return;
  to.push(snapshot());const state=from.pop();project=state.project;selection=state.selection;
  fileTarget=state.fileTarget;refreshFileControls();
  persist();renderAll();
}
function toast(message) {
  $('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',4000);
}
function paintPixels(target, pixels, size) {
  const context=target.getContext('2d');context.clearRect(0,0,target.width,target.height);
  pixels.forEach((value,index)=>{if(value){context.fillStyle=value;context.fillRect(index%size,Math.floor(index/size),1,1);}});
}
function tileCanvas(type, mask) {
  const target=document.createElement('canvas');target.width=target.height=project.tileSize;
  paintPixels(target,tilePixels(type,project.tileSize,mask),project.tileSize);return target;
}
function drawMap(target) {
  const {width,height,cells}=project.field, size=project.tileSize;
  target.width=width*size;target.height=height*size;
  const context=target.getContext('2d'), cache=new Map();
  cells.forEach((id,index)=>{
    const match=resolveCell(project,index);if(!match)return;
    const key=match.type.id+':'+match.mask;
    if(!cache.has(key))cache.set(key,tileCanvas(match.type,match.mask));
    context.drawImage(cache.get(key),(index%width)*size,Math.floor(index/width)*size);
  });
}
function peering(element, styleBits, mask) {
  const bits=[128,1,2,64,-1,4,32,16,8];
  element.replaceChildren();
  bits.forEach(bit=>{
    const cell=document.createElement('i');
    if(bit===-1||Boolean(mask&bit))cell.className='on';
    if(bit!==-1&&!(styleBits&bit))cell.className='off';
    element.append(cell);
  });
}
function usageCounts(typeId) {
  const counts=new Map();
  project.field.cells.forEach((id,index)=>{
    if(id!==typeId)return;
    const match=resolveCell(project,index);counts.set(match.mask,(counts.get(match.mask)||0)+1);
  });return counts;
}
function renderTypes() {
  $('type-list').replaceChildren();
  project.types.forEach((type,index)=>{
    const button=document.createElement('button');button.className='type-button';button.dataset.type=type.id;button.setAttribute('aria-pressed',type.id===selection.typeId);
    const dot=document.createElement('span');dot.className='type-dot';dot.style.background=type.color;
    const name=document.createElement('span');name.className='type-name';name.textContent=type.name;
    const number=document.createElement('small');number.textContent=String(index+1).padStart(2,'0');
    button.append(dot,name,number);button.onclick=()=>{finishGesture();selection={typeId:type.id,mask:0,cell:null};renderAll();};
    $('type-list').append(button);
  });
  $('type-count').textContent=project.types.length+' TYPES';
  $('type-name').value=currentType().name;
  const bits=currentType().styleBits;
  document.querySelectorAll('[data-direction]').forEach(input=>input.checked=Boolean(bits & (1<<Number(input.dataset.direction))));
  document.querySelectorAll('[data-style-preset]').forEach(button=>button.setAttribute('aria-pressed',Number(button.dataset.stylePreset)===bits));
  $('style-description').textContent=`${patterns(bits).length}枚 · ${styleLabel(bits)}`;
  const supported=supportedSymmetry(bits);
  document.querySelectorAll('[data-symmetry]').forEach(input=>{
    const bit=Number(input.dataset.symmetry);
    input.disabled=!(supported&bit);input.checked=!input.disabled&&Boolean(currentType().symmetry&bit);
    input.closest('label').title=input.disabled?'この接続スタイルでは使えません。':bit===4?'90°・180°・270°の回転を許可します。':'左右・上下を両方許可すると180°反転も使います。';
  });
  $('delete-type').disabled=project.types.length===1;$('add-type').disabled=project.types.length>=32;
}
function renderTileList() {
  const type=currentType(), counts=usageCounts(type.id), list=patterns(type.styleBits);
  $('tile-list').replaceChildren();tileCards=new Map();
  const visible=list.filter(mask=>!$('used-only').checked||counts.has(mask));
  $('tile-count').textContent=`${visible.length} / ${list.length} TILES`;
  visible.forEach(mask=>{
    const index=list.indexOf(mask),button=document.createElement('button');button.className='tile-card';button.dataset.mask=mask;
    button.setAttribute('aria-label',`タイル ${index+1}、パターン ${mask}、${counts.get(mask)||0}マスで使用`);
    const thumb=tileCanvas(type,mask);thumb.className='checker';
    const diagram=document.createElement('span');diagram.className='peering';peering(diagram,type.styleBits,mask);diagram.setAttribute('aria-hidden','true');
    const name=document.createElement('small');name.textContent='#'+String(index+1).padStart(2,'0');
    const usage=document.createElement('span');usage.className='usage';usage.textContent=counts.has(mask)?counts.get(mask):'';
    const badge=document.createElement('span');badge.className='derived-badge';badge.textContent='導出';badge.hidden=true;
    button.append(thumb,diagram,name,usage,badge);button.onclick=()=>{finishGesture();selection.cell=null;selection.mask=mask;renderGraphics();};
    $('tile-list').append(button);tileCards.set(mask,button);
  });
  if(!visible.length){const p=document.createElement('p');p.className='empty-message';p.textContent='この種類はフィールドに未配置です。';$('tile-list').append(p);}
}
function renderFieldGrid() {
  $('field-grid').replaceChildren();fieldButtons=[];
  $('field-grid').style.gridTemplateColumns=`repeat(${project.field.width}, 1fr)`;
  project.field.cells.forEach((id,index)=>{
    const button=document.createElement('button');button.className='field-cell';button.dataset.cell=index;
    button.onclick=event=>{if(event.detail===0) keyboardFieldEdit(index);};
    $('field-grid').append(button);fieldButtons.push(button);
  });
  $('field-width').value=project.field.width;$('field-height').value=project.field.height;
}
function refreshFieldGrid(match) {
  const types=new Map(project.types.map((type,index)=>[type.id,{...type,number:index+1}]));
  project.field.cells.forEach((id,index)=>{
    const button=fieldButtons[index],type=types.get(id);
    button.textContent=type?type.number:'·';button.style.background=type?type.color:'';
    button.classList.toggle('empty',!type);button.setAttribute('aria-pressed',selection.cell===index);
    button.setAttribute('aria-label',`列${index%project.field.width+1} 行${Math.floor(index/project.field.width)+1}：${type?type.name:'空'}`);
    const cellMatch=match&&id===match.type.id?resolveCell(project,index):null;
    button.classList.toggle('related',Boolean(cellMatch&&cellMatch.mask===match.mask));
  });
}
function renderGraphics() {
  normalizeSelection();const match=selectedTile(),size=project.tileSize;
  canvas.width=canvas.height=size;canvas.style.width=canvas.style.height=size*zoom+'px';
  $('canvas-wrap').classList.toggle('inactive',!match);
  if(match)paintPixels(canvas,tilePixels(match.type,size,match.mask),size);
  $('grid-overlay').style.backgroundSize=`${zoom}px ${zoom}px`;
  $('canvas-info').textContent=`${size} × ${size} px`;$('zoom-label').textContent=zoom*100+'%';
  $('zoom-out').disabled=zoom<=2;$('zoom-in').disabled=zoom>=32;
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;$('clear').disabled=!match||!Object.hasOwn(match.type.tiles,match.mask);
  const counts=usageCounts(currentType().id), list=patterns(currentType().styleBits);
  for(const [mask,card] of tileCards) {
    const derived=derivedTile(currentType(),mask);
    card.setAttribute('aria-pressed',Boolean(match&&mask===match.mask));
    card.classList.toggle('edited',Object.hasOwn(currentType().tiles,mask));
    card.classList.toggle('derived',Boolean(derived));card.querySelector('.derived-badge').hidden=!derived;
    const origin=derived?`タイル #${String(list.indexOf(derived.sourceMask)+1).padStart(2,'0')} の${derived.transform.label}から導出`:Object.hasOwn(currentType().tiles,mask)?'実体タイル':'未編集';
    card.title=origin;card.setAttribute('aria-label',`タイル ${list.indexOf(mask)+1}、パターン ${mask}、${counts.get(mask)||0}マスで使用、${origin}`);
    card.querySelector('.usage').textContent=counts.get(mask)||'';
    paintPixels(card.querySelector('canvas'),tilePixels(currentType(),size,mask),size);
  }
  $('tile-title').textContent=match?`${match.type.name} / タイル #${String(list.indexOf(match.mask)+1).padStart(2,'0')}`:'空のマス';
  $('tile-subtitle').textContent=match?`${styleLabel(match.type.styleBits)} · ${list.length} tiles`:'「配置」でマップチップを置いてください';
  const derived=match&&derivedTile(match.type,match.mask);
  $('tile-origin').textContent=!match?'':derived?`導出：タイル #${String(list.indexOf(derived.sourceMask)+1).padStart(2,'0')} → ${derived.transform.label}（描くと独立）`:Object.hasOwn(match.type.tiles,match.mask)?'実体タイル':'未編集';
  $('tile-origin').classList.toggle('derived',Boolean(derived));
  const targets=match?symmetryTargets(match.type,match.mask).size:0;
  $('bake-symmetry').disabled=!targets;
  $('bake-symmetry').textContent=`対称タイルへ焼き込む${targets?`（${targets}枚）`:''}`;
  $('shared-count').textContent=match?`${counts.get(match.mask)||0} マスがこのタイルを共有`:'このマスにはタイルがありません';
  $('selection-description').textContent=selection.cell!==null?`選択：列 ${selection.cell%project.field.width+1}・行 ${Math.floor(selection.cell/project.field.width)+1} ／ 同じ接続パターンへ一括反映`:'タイル一覧から選択中 ／ 未使用のパターンも編集できます';
  peering($('selected-peering'),currentType().styleBits,match?match.mask:0);
  refreshFieldGrid(match);
  drawMap($('map-preview'));
  $('map-preview').style.width=project.field.width*size*previewScale+'px';$('map-preview').style.height=project.field.height*size*previewScale+'px';
  $('field-dimensions').textContent=`${project.field.width} × ${project.field.height} マス`;
  updateExportInfo();
}
function renderAll() {
  normalizeSelection();$('filename').value=project.name;
  renderTypes();renderTileList();renderFieldGrid();renderPalette();renderGraphics();
}
function fit() { zoom=Math.max(2,Math.min(20,Math.floor(Math.min($('stage').clientWidth-56,$('stage').clientHeight-56)/project.tileSize))); }
function setColor(value, index=project.palette.indexOf(value.toLowerCase())) {
  if(!/^#[0-9a-f]{6}$/i.test(value))return false;
  color=value.toLowerCase();$('color').value=color;$('hex').value=color.toUpperCase();
  paletteIndex=index;updatePaletteSelection();return true;
}
function updatePaletteSelection() {
  if(project.palette[paletteIndex]!==color)paletteIndex=project.palette.indexOf(color);
  document.querySelectorAll('#palette [data-color]').forEach((b,i)=>b.setAttribute('aria-pressed',i===paletteIndex));
  $('palette-add').disabled=project.palette.includes(color);
  $('palette-delete').disabled=paletteIndex<0;
}
function renderPalette() {
  const fragment=document.createDocumentFragment();
  project.palette.forEach((value,index)=>{
    const button=document.createElement('button');button.className='swatch';button.dataset.color=value;button.style.background=value;
    button.setAttribute('aria-label',`色 ${value}`);button.title=value.toUpperCase();button.onclick=()=>setColor(value,index);fragment.append(button);
  });
  $('palette').replaceChildren(fragment);$('palette-count').textContent=project.palette.length+' COLORS';updatePaletteSelection();
}
function previewPaletteImport(colors, message) {
  importedPalette=colors;$('palette-import-status').textContent=message||`${colors.length}色を検出（重複除去済み）`;
  $('palette-apply').disabled=!colors.length;
  const fragment=document.createDocumentFragment();
  colors.slice(0,40).forEach(value=>{const swatch=document.createElement('span');swatch.style.background=value;swatch.title=value;fragment.append(swatch);});
  $('palette-import-preview').replaceChildren(fragment);
}
async function readPalettePNG(file) {
  const url=URL.createObjectURL(file), image=new Image();
  try {
    image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    return paletteFromPixels(context.getImageData(0,0,canvas.width,canvas.height).data);
  } finally {URL.revokeObjectURL(url);}
}
function setTool(value) {
  finishGesture();tool=value;document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));
}
function pointOnCanvas(event) {
  const r=canvas.getBoundingClientRect();return [Math.floor((event.clientX-r.left)/r.width*project.tileSize),Math.floor((event.clientY-r.top)/r.height*project.tileSize)];
}
function inside([x,y]) { return x>=0&&y>=0&&x<project.tileSize&&y<project.tileSize; }
function editablePixels(match) {
  return materializeTile(match.type,project.tileSize,match.mask);
}
function finishGesture(event) {
  if(!gesture||(event&&event.pointerId!==gesture.pointerId))return;
  const completed=gesture;gesture=null;
  if(completed.element.hasPointerCapture(completed.pointerId))completed.element.releasePointerCapture(completed.pointerId);
  commit(completed.before,completed.kind==='field');
}
canvas.addEventListener('pointerdown',event=>{
  if(gesture||event.button!==0)return;
  const point=pointOnCanvas(event),match=selectedTile();if(!match||!inside(point))return;event.preventDefault();
  if(tool==='picker'||event.altKey) {const value=tilePixels(match.type,project.tileSize,match.mask)[point[1]*project.tileSize+point[0]];if(value)setColor(value);else toast('ここは透明です');return;}
  const before=snapshot();
  if(tool==='fill') {
    if(tilePixels(match.type,project.tileSize,match.mask)[point[1]*project.tileSize+point[0]]===color)return;
    floodFill(editablePixels(match),project.tileSize,...point,color);commit(before,false);return;
  }
  gesture={kind:'pixel',pointerId:event.pointerId,element:canvas,before,previous:point,match};canvas.setPointerCapture(event.pointerId);
  drawLine(editablePixels(match),project.tileSize,point,point,tool==='eraser'?null:color,brush);renderGraphics();
});
canvas.addEventListener('pointermove',event=>{
  const point=pointOnCanvas(event),valid=inside(point);$('coordinates').textContent=valid?`X: ${point[0]}　Y: ${point[1]}`:'X: —　Y: —';
  if(!gesture||gesture.kind!=='pixel'||gesture.pointerId!==event.pointerId)return;
  if(!valid){gesture.previous=null;return;}
  drawLine(editablePixels(gesture.match),project.tileSize,gesture.previous||point,point,tool==='eraser'?null:color,brush);gesture.previous=point;renderGraphics();
});
function fieldCellAt(event) {
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-cell]');
  return target&&$('field-grid').contains(target)?Number(target.dataset.cell):null;
}
function selectCell(index) {
  finishGesture();selection.cell=index;normalizeSelection();renderAll();
}
function paintFieldCell(index) {
  project.field.cells[index]=fieldTool==='erase'?null:selection.typeId;
  selection.cell=index;normalizeSelection();
}
function keyboardFieldEdit(index) {
  if(fieldTool==='select'){selectCell(index);return;}
  change(()=>paintFieldCell(index));
}
$('field-grid').addEventListener('pointerdown',event=>{
  if(gesture||event.button!==0)return;const index=fieldCellAt(event);if(index===null)return;event.preventDefault();
  if(fieldTool==='select'){selectCell(index);return;}
  gesture={kind:'field',pointerId:event.pointerId,element:$('field-grid'),before:snapshot(),previous:index};
  $('field-grid').setPointerCapture(event.pointerId);paintFieldCell(index);renderGraphics();
});
$('field-grid').addEventListener('pointermove',event=>{
  if(!gesture||gesture.kind!=='field'||gesture.pointerId!==event.pointerId)return;
  const index=fieldCellAt(event);if(index===null||index===gesture.previous)return;
  // Reuse line rasterization so a fast drag cannot skip field cells.
  const w=project.field.width, side=Math.max(w,project.field.height), stroke=Array(side*side).fill(null);
  drawLine(stroke,side,[gesture.previous%w,Math.floor(gesture.previous/w)],[index%w,Math.floor(index/w)],true);
  stroke.forEach((value,i)=>{if(value)paintFieldCell(Math.floor(i/side)*w+i%side);});
  paintFieldCell(index);gesture.previous=index;renderGraphics();
});
for(const element of [canvas,$('field-grid')])for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,finishGesture);
window.addEventListener('blur',()=>finishGesture());
window.addEventListener('pagehide',()=>{if(gesture)finishGesture();});
$('map-preview').onclick=event=>{
  const rect=$('map-preview').getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)/rect.width*project.field.width),y=Math.floor((event.clientY-rect.top)/rect.height*project.field.height);
  if(x>=0&&x<project.field.width&&y>=0&&y<project.field.height)selectCell(y*project.field.width+x);
};
function setFieldTool(value) {
  finishGesture();fieldTool=value;
  document.querySelectorAll('[data-field-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.fieldTool===value));
  $('field-hint').textContent={select:'マスを選ぶと、その場所のタイルを編集できます。',paint:'左の種類を選び、クリック・ドラッグで配置します。',erase:'クリック・ドラッグで空のマスに戻します。'}[value];
}
function updateExportInfo() {
  const layout=atlasLayout(project), count=layout.metadata.types.reduce((n,type)=>n+type.tiles.length,0);
  $('export-info').textContent=`全${project.types.length}種類・${count}枚 ／ ${layout.width} × ${layout.height} px・横8列`;
  $('export').disabled=exporting;
}
function downloadBlob(blob, filename) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function safeName(value) { return (value.trim()||'dot-map').replace(/[\\/:*?"<>|]/g,'_'); }
async function exportPNG(downloadName=null) {
  if(exporting||fileBusy||document.querySelector('dialog[open]'))return;
  finishGesture();
  const filename=safeName(project.name)+'-atlas.png';
  if(!downloadName&&!pngIO.canSave()) {showDownload('png',filename);return;}
  exporting=true;fileBusy=true;refreshFileControls();updateExportInfo();
  try {
    // Choose the destination before asynchronous canvas encoding consumes the user gesture.
    const target=downloadName ? null : await pngIO.saveTarget(filename);
    const {width,height,metadata}=atlasLayout(project), size=project.tileSize;
    const output=document.createElement('canvas');output.width=width;output.height=height;
    const context=output.getContext('2d');
    metadata.types.forEach((entry,index)=>entry.tiles.forEach(tile=>{
      context.drawImage(tileCanvas(project.types[index],tile.mask),tile.x*size,tile.y*size);
    }));
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('PNGを書き出せませんでした。');
    const bytes=embedAtlasMetadata(new Uint8Array(await blob.arrayBuffer()),metadata);
    const result=new Blob([bytes],{type:'image/png'});
    if(target)await pngIO.write(target,result);
    else downloadBlob(result,EditorFileIO.filename(downloadName,'.png','atlas'));
    toast(`対応表を埋め込んだアトラスPNGを書き出しました（${width} × ${height} px）`);
  } catch(error) { if(error.name!=='AbortError')toast(error.message || 'PNGを書き出せませんでした。'); }
  finally {exporting=false;fileBusy=false;refreshFileControls();updateExportInfo();}
}
function changeStyle(styleBits) {
  finishGesture();const type=currentType(), discarded=discardedMasks(type,styleBits);
  if(discarded.length) {
    pendingStyleChange={typeId:type.id,styleBits};renderTypes();
    $('style-confirm-message').textContent=`「${type.name}」の編集済みタイル${discarded.length}枚は、新しい接続スタイルでは使えないため破棄されます。変更後もUndoで復元できます。`;
    $('style-dialog').showModal();return;
  }
  change(()=>setStyleBits(type,styleBits));
}
$('style-cancel').onclick=()=>$('style-dialog').close();
$('style-dialog').addEventListener('close',()=>pendingStyleChange=null);
$('style-form').onsubmit=event=>{
  event.preventDefault();if(!pendingStyleChange)return;
  const {typeId,styleBits}=pendingStyleChange, type=project.types.find(t=>t.id===typeId);
  if(type)change(()=>setStyleBits(type,styleBits));
  $('style-dialog').close();
};
$('add-type').onclick=()=>{
  if(project.types.length>=32)return;
  change(()=>{const id='type-'+crypto.randomUUID();const type=makeType(id,'マップチップ '+(project.types.length+1),DEFAULT_PALETTE[(project.types.length*3)%DEFAULT_PALETTE.length]);project.types.push(type);selection={typeId:id,mask:0,cell:null};$('used-only').checked=false;});
  toast('新しい種類を追加しました。タイル一覧から描き始められます。');
};
$('import-atlas').onclick=()=>$('atlas-file').click();
$('atlas-file').onchange=async()=>{
  const file=$('atlas-file').files[0];$('atlas-file').value='';if(!file)return;
  const url=URL.createObjectURL(file), image=new Image();
  try {
    if(file.size>24*1024*1024)throw new Error('ファイルは24MB以下にしてください。');
    const metadata=readAtlasMetadata(new Uint8Array(await file.arrayBuffer()));
    image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;
    let added=[];
    change(()=>{added=importAtlas(project,metadata,rgba,canvas.width,canvas.height);if(added.length)selection={typeId:added[0].id,mask:0,cell:null};$('used-only').checked=false;});
    toast(added.length?`アトラスから${added.length}種類を追加しました（${added.map(t=>t.name).join('、')}）`:'追加できる種類がありませんでした（上限32種類）。');
  } catch(error) {toast(error.message||'アトラスPNGを読み込めませんでした。');}
  finally {URL.revokeObjectURL(url);}
};
$('delete-type').onclick=()=>{
  const type=currentType();if(project.types.length===1)return;
  if(!confirm(`「${type.name}」とそのタイルを削除しますか？ 配置済みのマスは空になります。元に戻すことができます。`))return;
  change(()=>{removeType(project,type.id);selection={typeId:project.types[0].id,mask:0,cell:null};});
};
$('type-name').onchange=()=>{const value=$('type-name').value.trim();change(()=>currentType().name=value||'名前のないマップチップ');};
document.querySelectorAll('[data-direction]').forEach(input=>input.onchange=()=>{
  const bits=[...document.querySelectorAll('[data-direction]:checked')].reduce((mask,el)=>mask|(1<<Number(el.dataset.direction)),0);changeStyle(bits);
});
document.querySelectorAll('[data-style-preset]').forEach(button=>button.onclick=()=>changeStyle(Number(button.dataset.stylePreset)));
document.querySelectorAll('[data-symmetry]').forEach(input=>input.onchange=()=>{
  const bit=Number(input.dataset.symmetry),checked=input.checked;
  change(()=>{const type=currentType();type.symmetry=checked?type.symmetry|bit:type.symmetry&~bit;});
});
$('bake-symmetry').onclick=()=>{
  const match=selectedTile();if(!match)return;
  let count=0;change(()=>{count=bakeSymmetricTiles(match.type,project.tileSize,match.mask);});
  toast(`${count}枚の対称タイルを焼き込みました。元タイルを変更しても、このコピーは変わりません。`);
};
$('filename').onchange=()=>{const value=$('filename').value.trim();change(()=>project.name=value||'無題の世界');};
$('resize-field').onclick=()=>{
  const width=Number($('field-width').value),height=Number($('field-height').value);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>32||height>32){toast('フィールドの縦・横は1〜32の整数を指定してください。');return;}
  if((width<project.field.width||height<project.field.height)&&!confirm('範囲の外のマスは削除されます。サイズを変更しますか？ 元に戻すことができます。'))return;
  change(()=>{resizeField(project,width,height);selection.cell=null;});
};
$('clear').onclick=()=>{
  const match=selectedTile();if(!match)return;
  if(!Object.hasOwn(match.type.tiles,match.mask))return;
  if(!confirm('このタイルを未編集に戻しますか？ 対称タイルがあればそこから導出されます。元に戻すことができます。'))return;
  change(()=>{delete match.type.tiles[match.mask];});
};
$('undo').onclick=()=>history('undo');$('redo').onclick=()=>history('redo');
$('used-only').onchange=()=>{renderTileList();renderGraphics();};
$('grid').onclick=()=>{const visible=$('grid').getAttribute('aria-pressed')!=='true';$('grid').setAttribute('aria-pressed',visible);$('grid-overlay').hidden=!visible;};
$('zoom-in').onclick=()=>{zoom=Math.min(32,zoom+2);renderGraphics();};$('zoom-out').onclick=()=>{zoom=Math.max(2,zoom-2);renderGraphics();};
$('export').onclick=()=>exportPNG();
$('color').oninput=event=>setColor(event.target.value);
$('hex').oninput=()=>{const value=$('hex').value.trim();if(/^#?[0-9a-f]{6}$/i.test(value))setColor(value.startsWith('#')?value:'#'+value);};
$('hex').onchange=()=>{let value=$('hex').value.trim();if(!value.startsWith('#'))value='#'+value;if(!setColor(value)){toast('6桁のカラーコードを入力してください');$('hex').value=color.toUpperCase();}};
$('palette-add').onclick=()=>{if(!project.palette.includes(color))change(()=>project.palette.push(color));};
$('palette-delete').onclick=()=>{if(paletteIndex>=0)change(()=>project.palette.splice(paletteIndex,1));};
$('palette-import').onclick=()=>{
  finishGesture();paletteReadId++;$('palette-text').value='';$('palette-file').value='';
  previewPaletteImport([],'テキストを貼り付けるか、ファイルを選んでください。');$('palette-dialog').showModal();
};
$('palette-cancel').onclick=()=>$('palette-dialog').close();
$('palette-dialog').addEventListener('close',()=>paletteReadId++);
$('palette-text').oninput=()=>{paletteReadId++;$('palette-file').value='';previewPaletteImport(parsePaletteText($('palette-text').value));};
$('palette-file').onchange=async()=>{
  const file=$('palette-file').files[0];if(!file)return;
  const readId=++paletteReadId;previewPaletteImport([],'読み込み中…');$('palette-text').value='';
  try {
    let colors;
    if(/\.png$/i.test(file.name)||file.type==='image/png')colors=await readPalettePNG(file);
    else {
      const text=await file.text();if(readId!==paletteReadId)return;
      $('palette-text').value=text;colors=parsePaletteText(text);
    }
    if(readId===paletteReadId)previewPaletteImport(colors,`${file.name}：${colors.length}色を検出（重複除去済み）`);
  } catch {if(readId===paletteReadId)previewPaletteImport([],'ファイルを読み込めませんでした。別のファイルを選んでください。');}
};
$('palette-form').onsubmit=event=>{
  event.preventDefault();if(!importedPalette.length)return;
  const mode=$('palette-import-mode').value;
  change(()=>project.palette=mergePalette(project.palette,importedPalette,mode));
  $('palette-dialog').close();toast(`パレットを${mode==='append'?'追加':'置き換え'}しました（${project.palette.length}色）`);
};
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
document.querySelectorAll('[data-field-tool]').forEach(b=>b.onclick=()=>setFieldTool(b.dataset.fieldTool));
document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{finishGesture();brush=Number(b.dataset.size);$('brush-label').textContent=brush+' px';document.querySelectorAll('[data-size]').forEach(el=>el.setAttribute('aria-pressed',el===b));});
document.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>{previewScale=Number(b.dataset.preview);document.querySelectorAll('[data-preview]').forEach(el=>el.setAttribute('aria-pressed',el===b));renderGraphics();});
function refreshFileControls() {
  for(const id of ['new-project','open-project','save-project','save-project-as'])$(id).disabled=fileBusy;
  document.querySelector('main').inert=fileBusy;
  $('save-project').title=fileTarget.handle ? `${fileTarget.handle.name} に上書き保存 (Ctrl / ⌘ S)` : '保存先とファイル名を選択 (Ctrl / ⌘ S)';
}
function showDownload(kind,name) {
  downloadKind=kind;$('download-name').value=name;$('download-dialog').showModal();$('download-name').focus();
}
async function saveProject(saveAs=false,downloadName=null) {
  if(fileBusy||document.querySelector('dialog[open]'))return;
  finishGesture();
  const name=fileTarget.name||safeName(project.name)+'.dotmap.json';
  if(!downloadName&&!fileIO.canSave()) {showDownload('project',name);return;}
  fileBusy=true;refreshFileControls();
  try {
    const target=downloadName ? null : await fileIO.saveTarget(name,saveAs ? null : fileTarget.handle,fileTarget.handle);
    const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'});
    if(target) {
      await fileIO.write(target,blob);fileTarget.handle=target;fileTarget.name=target.name;
    } else {
      fileTarget.name=/\.(json|dotmap)$/i.test(downloadName) ? safeName(downloadName) : EditorFileIO.filename(downloadName,'.dotmap.json','dot-map');
      downloadBlob(blob,fileTarget.name);
    }
    toast(`${fileTarget.name} ${target?'に保存しました':'をダウンロードしました'}`);
  } catch(error) {if(error.name!=='AbortError')toast(`保存できませんでした。${error.message}`);}
  finally {fileBusy=false;refreshFileControls();}
}
async function loadProjectFile(file,handle=null) {
  if(file.size>24*1024*1024)throw new Error('ファイルは24MB以下にしてください。');
  const loaded=validateProject(JSON.parse(await file.text()));
  if(!confirm('ファイルを開き、現在のプロジェクトを置き換えますか？ 元に戻すことができます。'))return;
  change(()=>{project=loaded;fileTarget={handle,name:file.name};selection={typeId:project.types[0].id,mask:0,cell:null};$('used-only').checked=false;fit();});
  toast('プロジェクトを読み込みました');
}
async function openProject(file=null) {
  if(fileBusy)return;
  if(!file&&!fileIO.canOpen()) {$('project-file').click();return;}
  finishGesture();fileBusy=true;refreshFileControls();
  try {
    if(file)await loadProjectFile(file);
    else {const [entry]=await fileIO.openFiles();await loadProjectFile(entry.file,entry.handle);}
  } catch(error) {if(error.name!=='AbortError')toast(error instanceof SyntaxError?'JSONファイルを読み取れませんでした。':error.message);}
  finally {fileBusy=false;refreshFileControls();}
}
$('save-project').onclick=()=>saveProject();
$('save-project-as').onclick=()=>saveProject(true);
$('open-project').onclick=()=>openProject();
$('project-file').onchange=()=>{const file=$('project-file').files[0];$('project-file').value='';if(file)openProject(file);};
$('download-cancel').onclick=()=>$('download-dialog').close();
$('download-form').onsubmit=event=>{event.preventDefault();const name=$('download-name').value;$('download-dialog').close();if(downloadKind==='png')exportPNG(name);else saveProject(true,name);};
$('new-project').onclick=()=>{finishGesture();$('new-dialog').showModal();};$('cancel-new').onclick=()=>$('new-dialog').close();
$('new-form').onsubmit=event=>{
  event.preventDefault();change(()=>{project=createProject(Number($('new-size').value));fileTarget={handle:null,name:null};project.name=$('new-name').value.trim()||'無題の世界';project.types=[makeType('terrain','マップチップ 1','#789563')];project.field.cells.fill(null);selection={typeId:'terrain',mask:0,cell:null};$('used-only').checked=false;fit();});refreshFileControls();$('new-dialog').close();toast('新しいプロジェクトを作成しました');
};
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&!document.querySelector('dialog[open]')) {
    event.preventDefault();if(!event.repeat)saveProject(event.shiftKey);return;
  }
  if(fileBusy)return;
  if(event.target.matches('input,select,textarea')||event.isComposing||document.querySelector('dialog[open]'))return;
  const key=event.key.toLowerCase();
  if(event.metaKey||event.ctrlKey){if(key==='z'){event.preventDefault();history(event.shiftKey?'redo':'undo');}else if(key==='y'){event.preventDefault();history('redo');}return;}
  if(gesture)return;
  const shortcut={b:'pen',e:'eraser',g:'fill',i:'picker'}[key];if(!event.altKey&&shortcut){event.preventDefault();setTool(shortcut);}
});
let loadWarning='';
try {const data=localStorage.getItem(storageKey);if(data){project=validateProject(JSON.parse(data));selection={typeId:project.types[0].id,mask:0,cell:null};}}
catch {loadWarning='保存データを読み込めませんでした。サンプルを表示しています。';}
fit();renderAll();setColor(color);refreshFileControls();if(loadWarning)toast(loadWarning);
