'use strict';
const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const storageKey = 'dot-map-project-v2';
const fileIO = EditorFileIO.createFileIO({id:'dot-map-project',description:'DOT プロジェクト',accept:{'application/json':['.json','.dotmap']}});
const pngIO = EditorFileIO.createFileIO({id:'dot-map-atlas',description:'アトラス PNG',accept:{'image/png':['.png']}});
const paletteIO = EditorFileIO.createFileIO({id:'dot-map-palette',description:'カラーパレット',accept:{'text/plain':['.hex']}});
let fileTarget={handle:null,name:null}, fileBusy=false, downloadKind='project';
let project = createProject();
let selection = { typeId:project.types[0].id, mask:255, cell:9, layerId:project.field.layers[0].id };
let tool='pen', lastDrawTool='pen', fieldTool='select', color='#628b53', brush=1, zoom=16, previewScale=2;
let undoStack=[], redoStack=[], gesture=null, toastTimer, marquee=null, clipboard=null;
let tileCards=new Map(), fieldButtons=[];
let paletteIndex=2, importedPalette=[], paletteReadId=0, exporting=false, pendingStyleChange=null, snapMode='rgb';
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function currentType() { return project.types.find(t=>t.id===selection.typeId)||project.types[0]; }
function activeLayer() { return project.field.layers.find(l=>l.id===selection.layerId)||project.field.layers.at(-1); }
function selectedTile() {
  if(selection.cell!==null) return resolveCell(project,selection.cell,activeLayer());
  return {type:currentType(),mask:selection.mask};
}
function normalizeSelection() {
  if(!project.types.some(t=>t.id===selection.typeId)) selection.typeId=project.types[0].id;
  if(!project.field.layers.some(l=>l.id===selection.layerId)) selection.layerId=project.field.layers.at(-1).id;
  if(selection.cell!==null) {
    if(selection.cell<0||selection.cell>=project.field.width*project.field.height) selection.cell=null;
    else {
      const match=resolveCell(project,selection.cell,activeLayer());
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
  const {width,height,layers}=project.field, size=project.tileSize;
  target.width=width*size;target.height=height*size;
  const context=target.getContext('2d'), cache=new Map();
  context.clearRect(0,0,target.width,target.height);
  for(const layer of layers) {
    if(!layer.visible)continue;
    layer.cells.forEach((id,index)=>{
      const match=resolveCell(project,index,layer);if(!match)return;
      const key=match.type.id+':'+match.mask;
      if(!cache.has(key))cache.set(key,tileCanvas(match.type,match.mask));
      context.drawImage(cache.get(key),(index%width)*size,Math.floor(index/width)*size);
    });
  }
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
  for(const layer of project.field.layers) layer.cells.forEach((id,index)=>{
    if(id!==typeId)return;
    const match=resolveCell(project,index,layer);counts.set(match.mask,(counts.get(match.mask)||0)+1);
  });
  return counts;
}
function beginRename(row, current, fallback, apply) {
  const name=row.querySelector('.type-name'), input=document.createElement('input');
  input.className='type-name-input';input.maxLength=40;input.value=current;input.setAttribute('aria-label',fallback==='名前のないレイヤー'?'レイヤー名':'マップチップ名');
  name.replaceWith(input);row.draggable=false;row.querySelector('.type-rename').hidden=true;
  input.focus();input.select();
  let done=false;
  const finish=save=>{
    if(done)return;done=true;
    const value=input.value.trim()||fallback;
    if(!save||value===current){renderAll();return;}
    apply(value);
  };
  input.onblur=()=>finish(true);
  input.addEventListener('compositionend',()=>{
    const swallow=event=>{
      input.removeEventListener('keydown',swallow,true);
      if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();}
    };
    input.addEventListener('keydown',swallow,true);
    setTimeout(()=>input.removeEventListener('keydown',swallow,true));
  });
  input.onkeydown=event=>{
    event.stopPropagation();
    if(event.isComposing||event.keyCode===229)return;
    if(event.key==='Enter'){event.preventDefault();finish(true);}
    else if(event.key==='Escape'){event.preventDefault();finish(false);}
  };
  input.onclick=event=>event.stopPropagation();
}
function renameType(row, type) {
  beginRename(row,type.name,'名前のないマップチップ',value=>change(()=>{const found=project.types.find(t=>t.id===type.id);if(found)found.name=value;}));
}
let dragFrom=-1, dragKind='';
function clearDropLine() {
  document.querySelectorAll('.drop-before,.drop-after').forEach(row=>row.classList.remove('drop-before','drop-after'));
}
function dropAt(event, index) {
  const rect=event.currentTarget.getBoundingClientRect();
  let to=event.clientY>rect.top+rect.height/2?index+1:index;
  if(dragFrom<to)to-=1;
  return to;
}
function showDropLine(event, row, index) {
  clearDropLine();
  const to=dropAt(event,index);
  if(dragFrom<0||dragFrom===to)return;
  row.classList.add(event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2?'drop-after':'drop-before');
}
function renderTypes() {
  $('type-list').replaceChildren();
  project.types.forEach((type,index)=>{
    const row=document.createElement('div');row.className='type-button';row.dataset.type=type.id;row.draggable=true;row.tabIndex=0;row.setAttribute('aria-pressed',type.id===selection.typeId);
    const dot=document.createElement('span');dot.className='type-dot';dot.style.background=type.color;
    const name=document.createElement('span');name.className='type-name';name.textContent=type.name;
    const edit=document.createElement('button');edit.type='button';edit.className='type-rename';edit.title='名前を編集';edit.setAttribute('aria-label',type.name+'の名前を編集');edit.innerHTML='<svg><use href="#i-pen"/></svg>';
    const number=document.createElement('small');number.textContent=String(index+1).padStart(2,'0');
    edit.onclick=event=>{
      event.stopPropagation();event.preventDefault();finishGesture();
      if(selection.typeId!==type.id){selection={typeId:type.id,mask:0,cell:null,layerId:selection.layerId};renderAll();}
      renameType(document.querySelector(`[data-type="${CSS.escape(type.id)}"]`),type);
    };
    row.append(dot,name,edit,number);
    row.onclick=()=>{finishGesture();selection={typeId:type.id,mask:0,cell:null,layerId:selection.layerId};renderAll();};
    row.onkeydown=event=>{if(event.target===row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();row.click();}};
    row.ondragstart=event=>{dragKind='type';dragFrom=index;event.dataTransfer.setData('text/plain',type.id);event.dataTransfer.effectAllowed='move';row.classList.add('dragging');};
    row.ondragend=()=>{dragKind='';dragFrom=-1;row.classList.remove('dragging');clearDropLine();};
    row.ondragover=event=>{if(dragKind!=='type')return;event.preventDefault();event.dataTransfer.dropEffect='move';showDropLine(event,row,index);};
    row.ondragleave=event=>{if(dragKind==='type'&&!$('type-list').contains(event.relatedTarget))clearDropLine();};
    row.ondrop=event=>{
      event.preventDefault();
      const to=dropAt(event,index),from=dragFrom;
      clearDropLine();
      if(dragKind!=='type'||from<0||from===to)return;
      change(()=>{const [item]=project.types.splice(from,1);project.types.splice(to,0,item);});
    };
    $('type-list').append(row);
  });
  $('type-count').textContent=project.types.length+' 種類';
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
  $('center-fill').checked=Boolean(currentType().centerFill);
  $('delete-type').disabled=project.types.length===1;$('add-type').disabled=project.types.length>=32;
}
function renderTileList() {
  const type=currentType(), counts=usageCounts(type.id), list=patterns(type.styleBits);
  $('tile-list').replaceChildren();tileCards=new Map();
  const visible=list.filter(mask=>!$('used-only').checked||counts.has(mask));
  $('tile-count').textContent=`${visible.length} / ${list.length}`;
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
function editorCell(index) {
  const layers=project.field.layers, active=activeLayer(), at=layers.indexOf(active);
  if(active.cells[index]) return {id:active.cells[index],under:false};
  for(let i=at-1;i>=0;i--) if(layers[i].visible&&layers[i].cells[index]) return {id:layers[i].cells[index],under:true};
  return {id:null,under:false};
}
function faded(hex) {
  const value=parseInt(hex.slice(1),16), mix=(channel,paper)=>Math.round(channel+(paper-channel)*.55);
  return '#'+[mix(value>>16,0xef),mix((value>>8)&255,0xe6),mix(value&255,0xd6)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function renderFieldGrid() {
  $('field-grid').replaceChildren();fieldButtons=[];
  $('field-grid').style.gridTemplateColumns=`repeat(${project.field.width}, 1fr)`;
  for(let index=0;index<project.field.width*project.field.height;index++) {
    const button=document.createElement('button');button.className='field-cell';button.dataset.cell=index;
    button.onclick=event=>{if(event.detail===0) keyboardFieldEdit(index);};
    $('field-grid').append(button);fieldButtons.push(button);
  }
  $('field-width').value=project.field.width;$('field-height').value=project.field.height;
}
function refreshFieldGrid(match) {
  const types=new Map(project.types.map((type,index)=>[type.id,{...type,number:index+1}]));
  const layer=activeLayer();
  fieldButtons.forEach((button,index)=>{
    const shown=editorCell(index), type=types.get(shown.id);
    button.textContent=type?type.number:'·';button.style.background=type?(shown.under?faded(type.color):type.color):'';
    button.classList.toggle('empty',!type);button.classList.toggle('under',shown.under);button.setAttribute('aria-pressed',selection.cell===index);
    button.setAttribute('aria-label',`列${index%project.field.width+1} 行${Math.floor(index/project.field.width)+1}：${type?type.name:'空'}${shown.under?'（下のレイヤー）':''}`);
    const cellMatch=match&&layer.cells[index]===match.type.id?resolveCell(project,index,layer):null;
    button.classList.toggle('related',Boolean(cellMatch&&cellMatch.mask===match.mask));
  });
}
function renderLayers() {
  $('layer-list').replaceChildren();
  [...project.field.layers].reverse().forEach((layer,visual)=>{
    const row=document.createElement('div');row.className='type-button';row.dataset.layer=layer.id;row.draggable=true;row.tabIndex=0;row.setAttribute('aria-pressed',layer.id===activeLayer().id);
    const eye=document.createElement('button');eye.type='button';eye.className='layer-eye';eye.setAttribute('aria-pressed',layer.visible);eye.title=layer.visible?'表示中':'非表示';eye.setAttribute('aria-label',layer.name+(layer.visible?'を非表示':'を表示'));eye.innerHTML=`<svg><use href="#${layer.visible?'i-eye':'i-eye-off'}"/></svg>`;
    const name=document.createElement('span');name.className='type-name';name.textContent=layer.name;
    const edit=document.createElement('button');edit.type='button';edit.className='type-rename';edit.title='名前を編集';edit.setAttribute('aria-label',layer.name+'の名前を編集');edit.innerHTML='<svg><use href="#i-pen"/></svg>';
    eye.onclick=event=>{event.stopPropagation();event.preventDefault();finishGesture();change(()=>{const found=project.field.layers.find(l=>l.id===layer.id);if(found)found.visible=!found.visible;});};
    edit.onclick=event=>{
      event.stopPropagation();event.preventDefault();finishGesture();
      if(selection.layerId!==layer.id){selection.layerId=layer.id;renderAll();}
      beginRename(document.querySelector(`[data-layer="${CSS.escape(layer.id)}"]`),layer.name,'名前のないレイヤー',value=>change(()=>{const found=project.field.layers.find(l=>l.id===layer.id);if(found)found.name=value;}));
    };
    row.append(eye,name,edit);
    row.onclick=()=>{finishGesture();selection.layerId=layer.id;renderAll();};
    row.onkeydown=event=>{if(event.target===row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();row.click();}};
    row.ondragstart=event=>{dragKind='layer';dragFrom=visual;event.dataTransfer.setData('text/plain',layer.id);event.dataTransfer.effectAllowed='move';row.classList.add('dragging');};
    row.ondragend=()=>{dragKind='';dragFrom=-1;row.classList.remove('dragging');clearDropLine();};
    row.ondragover=event=>{if(dragKind!=='layer')return;event.preventDefault();event.dataTransfer.dropEffect='move';showDropLine(event,row,visual);};
    row.ondragleave=event=>{if(dragKind==='layer'&&!$('layer-list').contains(event.relatedTarget))clearDropLine();};
    row.ondrop=event=>{
      event.preventDefault();
      const to=dropAt(event,visual),from=dragFrom;
      clearDropLine();
      if(dragKind!=='layer'||from<0||from===to)return;
      change(()=>{
        const layers=project.field.layers, origin=layers.length-1-from, dest=layers.length-1-to;
        const [item]=layers.splice(origin,1);layers.splice(dest,0,item);
      });
    };
    $('layer-list').append(row);
  });
  $('add-layer').disabled=project.field.layers.length>=8;
  $('delete-layer').disabled=project.field.layers.length<=1;
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
  $('tile-subtitle').textContent=match?`${styleLabel(match.type.styleBits)} · ${list.length}枚`:'「配置」でマップチップを置いてください';
  const derived=match&&derivedTile(match.type,match.mask);
  $('tile-origin').textContent=!match?'':derived?`導出：タイル #${String(list.indexOf(derived.sourceMask)+1).padStart(2,'0')} → ${derived.transform.label}（描くと独立）`:Object.hasOwn(match.type.tiles,match.mask)?'実体タイル':'未編集';
  $('tile-origin').classList.toggle('derived',Boolean(derived));
  const targets=match?symmetryTargets(match.type,match.mask).size:0;
  $('bake-symmetry').disabled=!targets;
  $('bake-symmetry').textContent=`対称タイルへ焼き込む${targets?`（${targets}枚）`:''}`;
  if(marquee&&(marquee.x+marquee.w<=0||marquee.y+marquee.h<=0||marquee.x>=project.tileSize||marquee.y>=project.tileSize))marquee=null;
  updateMarquee();
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
  renderTypes();renderLayers();renderTileList();renderFieldGrid();renderPalette();renderGraphics();
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
  $('palette-export').disabled=!project.palette.length;
  $('palette-snap').disabled=!project.palette.length;
}
function renderPalette() {
  const fragment=document.createDocumentFragment();
  project.palette.forEach((value,index)=>{
    const button=document.createElement('button');button.className='swatch';button.dataset.color=value;button.style.background=value;
    button.setAttribute('aria-label',`色 ${value}`);button.title=value.toUpperCase();button.onclick=()=>setColor(value,index);fragment.append(button);
  });
  $('palette').replaceChildren(fragment);
  const preset=matchPalettePreset(project.palette);
  $('palette-count').textContent=(preset?preset.name+' · ':'')+project.palette.length+'色';
  updatePaletteSelection();
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
const drawTools=new Set(['pen','line','fill']);
function setTool(value) {
  finishGesture();
  if(drawTools.has(value))lastDrawTool=value;
  tool=value;document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));
  if(value!=='select')canvas.style.cursor='';
}
function pointOnCanvas(event) {
  const r=canvas.getBoundingClientRect();return [Math.floor((event.clientX-r.left)/r.width*project.tileSize),Math.floor((event.clientY-r.top)/r.height*project.tileSize)];
}
function inside([x,y]) { return x>=0&&y>=0&&x<project.tileSize&&y<project.tileSize; }
function clampPoint([x,y]) {
  const s=project.tileSize;return [Math.max(0,Math.min(s-1,x)),Math.max(0,Math.min(s-1,y))];
}
function rectFromPoints(a,b) {
  const x=Math.min(a[0],b[0]), y=Math.min(a[1],b[1]);
  return {x,y,w:Math.abs(a[0]-b[0])+1,h:Math.abs(a[1]-b[1])+1};
}
function updateMarquee() {
  const el=$('marquee'), rect=gesture?.kind==='marquee'||gesture?.kind==='move'?gesture.rect:marquee;
  const show=Boolean(rect&&selectedTile());
  el.hidden=!show;
  if(!show)return;
  el.style.left=rect.x*zoom+'px';el.style.top=rect.y*zoom+'px';
  el.style.width=rect.w*zoom+'px';el.style.height=rect.h*zoom+'px';
  const pixels=gesture?.kind==='marquee'?null:gesture?.kind==='move'?gesture.data||gesture.pixels:marquee?.pixels;
  el.style.background=pixels?'transparent':'';
  let preview=el.querySelector('canvas');
  if(!pixels){if(preview)preview.remove();return;}
  if(!preview){preview=document.createElement('canvas');el.append(preview);}
  if(preview.width!==rect.w||preview.height!==rect.h){preview.width=rect.w;preview.height=rect.h;}
  paintPixels(preview,pixels,rect.w);
}
function hitMarquee(point, rect) {
  return rect&&point[0]>=rect.x&&point[0]<rect.x+rect.w&&point[1]>=rect.y&&point[1]<rect.y+rect.h;
}
function extractRect(pixels, size, rect) {
  const data=[];
  for(let y=0;y<rect.h;y++) for(let x=0;x<rect.w;x++) {
    const tx=rect.x+x, ty=rect.y+y;
    data.push(tx>=0&&ty>=0&&tx<size&&ty<size?pixels[ty*size+tx]:null);
  }
  return data;
}
function stampRect(pixels, size, data, x, y, w, h) {
  for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
    const tx=x+px, ty=y+py;
    if(tx>=0&&ty>=0&&tx<size&&ty<size)pixels[ty*size+tx]=data?data[py*w+px]:null;
  }
}
function pngBlob(pixels, w, h) {
  return new Promise(resolve=>{
    const target=document.createElement('canvas');target.width=w;target.height=h;
    paintPixels(target,pixels,w);target.toBlob(resolve,'image/png');
  });
}
function writeOsClipboard(clip) {
  if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')return;
  try {navigator.clipboard.write([new ClipboardItem({'image/png':pngBlob(clip.pixels,clip.w,clip.h)})]).catch(()=>{});}
  catch {}
}
async function clipFromBlob(blob) {
  const bitmap=await createImageBitmap(blob);
  const w=bitmap.width, h=bitmap.height;
  const target=document.createElement('canvas');target.width=w;target.height=h;
  target.getContext('2d').drawImage(bitmap,0,0);
  if(bitmap.close)bitmap.close();
  const rgba=target.getContext('2d').getImageData(0,0,w,h).data, pixels=[];
  for(let i=0;i<rgba.length;i+=4) pixels.push(rgba[i+3]===0?null:'#'+[rgba[i],rgba[i+1],rgba[i+2]].map(n=>n.toString(16).padStart(2,'0')).join(''));
  return {w,h,pixels};
}
async function readOsClipboard() {
  if(!navigator.clipboard?.read)return null;
  try {
    for(const item of await navigator.clipboard.read()) {
      const type=item.types.find(t=>t.startsWith('image/'));
      if(type)return await clipFromBlob(await item.getType(type));
    }
  } catch {}
  return null;
}
function copyMarquee(quiet=false) {
  const match=selectedTile();
  if(!match||!marquee){if(!quiet)toast('先に範囲を選択してください');return false;}
  clipboard={w:marquee.w,h:marquee.h,pixels:(marquee.pixels||extractRect(tilePixels(match.type,project.tileSize,match.mask),project.tileSize,marquee)).slice()};
  writeOsClipboard(clipboard);
  if(!quiet)toast(`${marquee.w}×${marquee.h} をコピーしました`);
  return true;
}
function cutMarquee() {
  if(!copyMarquee(true))return;
  const rect=marquee;
  change(()=>{const match=selectedTile();if(match)stampRect(editablePixels(match),project.tileSize,null,rect.x,rect.y,rect.w,rect.h);});
  toast('切り取りました');
}
async function pasteMarquee() {
  const match=selectedTile();
  if(!match){toast('タイルがありません');return;}
  const clip=await readOsClipboard()||clipboard;
  if(!clip){toast('コピーしたものがありません');return;}
  clipboard=clip;
  const size=project.tileSize;
  const x=Math.max(1-clip.w,Math.min(size-1,marquee?marquee.x:0));
  const y=Math.max(1-clip.h,Math.min(size-1,marquee?marquee.y:0));
  const ground=tilePixels(match.type,size,match.mask).slice();
  change(()=>stampRect(editablePixels(match),size,clip.pixels,x,y,clip.w,clip.h));
  marquee={x,y,w:clip.w,h:clip.h,pixels:clip.pixels.slice(),ground};
  setTool('select');updateMarquee();
}
function eraseMarquee() {
  const match=selectedTile();if(!match||!marquee)return;
  const rect=marquee;
  change(()=>stampRect(editablePixels(match),project.tileSize,null,rect.x,rect.y,rect.w,rect.h));
}
function applyMove(g, point) {
  const size=project.tileSize;
  const x=Math.max(1-g.w,Math.min(size-1,point[0]-g.grab[0]));
  const y=Math.max(1-g.h,Math.min(size-1,point[1]-g.grab[1]));
  if(!g.moved) {
    if(x===g.origin.x&&y===g.origin.y){g.rect={x,y,w:g.w,h:g.h,pixels:g.pixels,ground:g.ground};updateMarquee();return;}
    g.moved=true;g.before=snapshot();
    const pixels=editablePixels(g.match);
    if(g.ground) g.data=g.pixels.slice();
    else {g.base=pixels.slice();g.data=(g.pixels||extractRect(g.base,size,{x:g.origin.x,y:g.origin.y,w:g.w,h:g.h})).slice();}
  }
  const pixels=editablePixels(g.match);
  if(g.ground) for(let i=0;i<pixels.length;i++)pixels[i]=g.ground[i];
  else {
    for(let i=0;i<pixels.length;i++)pixels[i]=g.base[i];
    stampRect(pixels,size,null,g.origin.x,g.origin.y,g.w,g.h);
  }
  stampRect(pixels,size,g.data,x,y,g.w,g.h);
  g.rect=marquee={x,y,w:g.w,h:g.h,pixels:g.data,ground:g.ground};renderGraphics();
}
function editablePixels(match) {
  return materializeTile(match.type,project.tileSize,match.mask);
}
function finishGesture(event) {
  if(!gesture||(event&&event.pointerId!==gesture.pointerId))return;
  const completed=gesture;gesture=null;
  if(completed.element.hasPointerCapture(completed.pointerId))completed.element.releasePointerCapture(completed.pointerId);
  if(completed.kind==='marquee'){
    const dragged=completed.rect.w>1||completed.rect.h>1;
    marquee=dragged?completed.rect:completed.prior?null:completed.rect;
    canvas.style.cursor='';updateMarquee();return;
  }
  if(completed.kind==='move') {
    marquee=completed.rect;canvas.style.cursor=tool==='select'?'move':'';updateMarquee();
    if(!completed.moved)return;
  }
  commit(completed.before,completed.kind==='field');
}
canvas.addEventListener('pointerdown',event=>{
  if(gesture||event.button!==0)return;
  const point=pointOnCanvas(event),match=selectedTile();if(!match||!inside(point))return;event.preventDefault();
  if(tool==='picker'||event.altKey) {
    const value=tilePixels(match.type,project.tileSize,match.mask)[point[1]*project.tileSize+point[0]];
    if(value){setColor(value);if(tool==='picker')setTool(lastDrawTool);}
    else toast('ここは透明です');
    return;
  }
  if(tool==='select') {
    canvas.setPointerCapture(event.pointerId);
    if(hitMarquee(point,marquee)) {
      gesture={kind:'move',pointerId:event.pointerId,element:canvas,match,grab:[point[0]-marquee.x,point[1]-marquee.y],origin:{x:marquee.x,y:marquee.y},w:marquee.w,h:marquee.h,pixels:marquee.pixels,ground:marquee.ground,rect:{x:marquee.x,y:marquee.y,w:marquee.w,h:marquee.h,pixels:marquee.pixels},moved:false};
      canvas.style.cursor='grabbing';return;
    }
    gesture={kind:'marquee',pointerId:event.pointerId,element:canvas,start:point,rect:rectFromPoints(point,point),prior:marquee&&{...marquee}};
    updateMarquee();return;
  }
  const before=snapshot();
  if(tool==='fill') {
    if(tilePixels(match.type,project.tileSize,match.mask)[point[1]*project.tileSize+point[0]]===color)return;
    floodFill(editablePixels(match),project.tileSize,...point,color);commit(before,false);return;
  }
  const pixels=editablePixels(match);
  if(tool==='line') {
    gesture={kind:'line',pointerId:event.pointerId,element:canvas,before,start:point,match,base:pixels.slice()};
    canvas.setPointerCapture(event.pointerId);
    drawLine(pixels,project.tileSize,point,point,color,brush);renderGraphics();
    return;
  }
  gesture={kind:'pixel',pointerId:event.pointerId,element:canvas,before,previous:point,match};canvas.setPointerCapture(event.pointerId);
  drawLine(pixels,project.tileSize,point,point,tool==='eraser'?null:color,brush);renderGraphics();
});
canvas.addEventListener('pointermove',event=>{
  const point=pointOnCanvas(event),valid=inside(point);$('coordinates').textContent=valid?`X: ${point[0]}　Y: ${point[1]}`:'X: —　Y: —';
  canvas.style.cursor=gesture?.kind==='move'?'grabbing':tool==='select'&&valid&&hitMarquee(point,marquee)?'move':'';
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  if(gesture.kind==='marquee') {
    gesture.rect=rectFromPoints(gesture.start,clampPoint(point));updateMarquee();return;
  }
  if(gesture.kind==='move') {applyMove(gesture,point);return;}
  if(gesture.kind==='line') {
    const size=project.tileSize, end=valid?point:[Math.max(0,Math.min(size-1,point[0])),Math.max(0,Math.min(size-1,point[1]))];
    const pixels=editablePixels(gesture.match);
    for(let i=0;i<pixels.length;i++)pixels[i]=gesture.base[i];
    drawLine(pixels,size,gesture.start,end,color,brush);renderGraphics();
    return;
  }
  if(gesture.kind!=='pixel')return;
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
  activeLayer().cells[index]=fieldTool==='erase'?null:selection.typeId;
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
  $('field-hint').textContent={select:'選択中のレイヤーに配置します。下の表示中レイヤーは薄く見えます。マスを選ぶと、その場所のタイルを編集できます。',paint:'選択中のレイヤーに配置します。下の表示中レイヤーは薄く見えます。',erase:'選択中のレイヤーを空に戻します。下の表示中レイヤーは薄く見えます。'}[value];
}
$('add-layer').onclick=()=>change(()=>{
  const layer=makeLayer('レイヤー '+(project.field.layers.length+1),Array(project.field.width*project.field.height).fill(null));
  project.field.layers.push(layer);selection.layerId=layer.id;
});
$('delete-layer').onclick=()=>change(()=>{
  const layers=project.field.layers, at=layers.findIndex(l=>l.id===selection.layerId);
  if(layers.length<2||at<0)return;
  layers.splice(at,1);selection.layerId=layers[Math.min(at,layers.length-1)].id;
});
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
  change(()=>{const id=typeId();const type=makeType(id,'マップチップ '+(project.types.length+1),DEFAULT_PALETTE[(project.types.length*3)%DEFAULT_PALETTE.length]);project.types.push(type);selection={typeId:id,mask:0,cell:null,layerId:selection.layerId};$('used-only').checked=false;});
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
    change(()=>{added=importAtlas(project,metadata,rgba,canvas.width,canvas.height);if(added.length)selection={typeId:added[0].id,mask:0,cell:null,layerId:selection.layerId};$('used-only').checked=false;});
    toast(added.length?`アトラスから${added.length}種類を追加しました（${added.map(t=>t.name).join('、')}）`:'追加できる種類がありませんでした（上限32種類）。');
  } catch(error) {toast(error.message||'アトラスPNGを読み込めませんでした。');}
  finally {URL.revokeObjectURL(url);}
};
$('delete-type').onclick=()=>{
  const type=currentType();if(project.types.length===1)return;
  if(!confirm(`「${type.name}」とそのタイルを削除しますか？ 配置済みのマスは空になります。元に戻すことができます。`))return;
  change(()=>{removeType(project,type.id);selection={typeId:project.types[0].id,mask:0,cell:null,layerId:selection.layerId};});
};
document.querySelectorAll('[data-direction]').forEach(input=>input.onchange=()=>{
  const bits=[...document.querySelectorAll('[data-direction]:checked')].reduce((mask,el)=>mask|(1<<Number(el.dataset.direction)),0);changeStyle(bits);
});
document.querySelectorAll('[data-style-preset]').forEach(button=>button.onclick=()=>changeStyle(Number(button.dataset.stylePreset)));
document.querySelectorAll('[data-symmetry]').forEach(input=>input.onchange=()=>{
  const bit=Number(input.dataset.symmetry),checked=input.checked;
  change(()=>{const type=currentType();type.symmetry=checked?type.symmetry|bit:type.symmetry&~bit;});
});
$('center-fill').onchange=()=>{const checked=$('center-fill').checked;change(()=>{currentType().centerFill=checked;});};
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
  finishGesture();paletteReadId++;$('palette-text').value='';$('palette-file').value='';$('palette-preset').value='';
  previewPaletteImport([],'テキストを貼り付けるか、ファイルを選んでください。');$('palette-dialog').showModal();
};
$('palette-cancel').onclick=()=>$('palette-dialog').close();
$('palette-dialog').addEventListener('close',()=>paletteReadId++);
$('palette-preset').onchange=()=>{
  paletteReadId++;$('palette-text').value='';$('palette-file').value='';
  const preset=PALETTE_PRESETS.find(p=>p.id===$('palette-preset').value);
  if(!preset){previewPaletteImport([],'テキストを貼り付けるか、ファイルを選んでください。');return;}
  previewPaletteImport(preset.colors.slice(),`プリセット「${preset.name}」：${preset.colors.length}色`);
};
$('palette-text').oninput=()=>{paletteReadId++;$('palette-file').value='';$('palette-preset').value='';previewPaletteImport(parsePaletteText($('palette-text').value));};
$('palette-file').onchange=async()=>{
  const file=$('palette-file').files[0];if(!file)return;
  const readId=++paletteReadId;previewPaletteImport([],'読み込み中…');$('palette-text').value='';$('palette-preset').value='';
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
$('palette-snap').onclick=()=>{
  if(!project.palette.length)return;
  finishGesture();
  const type=currentType(), match=selectedTile(), size=project.tileSize;
  for(const mode of ['rgb','lab','luma']) {
    const preview=clone(type);
    snapTypeToPalette(preview,project.palette,mode);
    const canvas=$(`snap-preview-${mode}`);
    canvas.width=canvas.height=size;
    paintPixels(canvas,match?tilePixels(preview,size,match.mask):[],size);
  }
  document.querySelectorAll('#snap-choices [data-snap]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.snap===snapMode));
  $('snap-dialog').showModal();
};
document.querySelectorAll('#snap-choices [data-snap]').forEach(b=>b.onclick=()=>{
  snapMode=b.dataset.snap;
  document.querySelectorAll('#snap-choices [data-snap]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.snap===snapMode));
});
$('snap-cancel').onclick=()=>$('snap-dialog').close();
$('snap-form').onsubmit=event=>{
  event.preventDefault();
  const type=currentType();
  change(()=>snapTypeToPalette(type,project.palette,snapMode));
  $('snap-dialog').close();
  toast(`「${type.name}」の色をパレットに寄せました`);
};
async function savePalette(downloadName=null) {
  if(fileBusy||document.querySelector('dialog[open]')||!project.palette.length)return;
  finishGesture();
  const name=EditorFileIO.filename(project.name,'.hex','palette');
  if(!downloadName&&!paletteIO.canSave()) {showDownload('palette',name);return;}
  fileBusy=true;refreshFileControls();
  try {
    const target=downloadName ? null : await paletteIO.saveTarget(name);
    const blob=new Blob([serializePaletteHex(project.palette)],{type:'text/plain'});
    if(target)await paletteIO.write(target,blob);
    else downloadBlob(blob,EditorFileIO.filename(downloadName,'.hex','palette'));
    toast(`パレットを${target?'保存':'ダウンロード'}しました（${project.palette.length}色）`);
  } catch(error) {if(error.name!=='AbortError')toast(`保存できませんでした。${error.message}`);}
  finally {fileBusy=false;refreshFileControls();}
}
$('palette-export').onclick=()=>savePalette();
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
document.querySelectorAll('[data-field-tool]').forEach(b=>b.onclick=()=>setFieldTool(b.dataset.fieldTool));
document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{finishGesture();brush=Number(b.dataset.size);$('brush-label').textContent=brush+' px';document.querySelectorAll('[data-size]').forEach(el=>el.setAttribute('aria-pressed',el===b));});
document.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>{previewScale=Number(b.dataset.preview);document.querySelectorAll('[data-preview]').forEach(el=>el.setAttribute('aria-pressed',el===b));renderGraphics();});
document.querySelectorAll('[data-preview-bg]').forEach(b=>b.onclick=()=>{
  $('map-preview-wrap').className='map-preview '+(b.dataset.previewBg==='dark'?'checker-dark':b.dataset.previewBg==='gray'?'gray':'checker');
  document.querySelectorAll('[data-preview-bg]').forEach(el=>el.setAttribute('aria-pressed',el===b));
});
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
  change(()=>{project=loaded;fileTarget={handle,name:file.name};selection={typeId:project.types[0].id,mask:0,cell:null,layerId:project.field.layers.at(-1).id};$('used-only').checked=false;fit();});
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
$('download-form').onsubmit=event=>{event.preventDefault();const name=$('download-name').value;$('download-dialog').close();if(downloadKind==='png')exportPNG(name);else if(downloadKind==='palette')savePalette(name);else saveProject(true,name);};
$('new-project').onclick=()=>{finishGesture();$('new-dialog').showModal();};$('cancel-new').onclick=()=>$('new-dialog').close();
$('new-form').onsubmit=event=>{
  event.preventDefault();change(()=>{const id=typeId();project=createProject(Number($('new-size').value));fileTarget={handle:null,name:null};project.name=$('new-name').value.trim()||'無題の世界';project.types=[makeType(id,'マップチップ 1','#789563')];project.field.layers=[makeLayer('レイヤー 1',Array(project.field.width*project.field.height).fill(null))];selection={typeId:id,mask:0,cell:null,layerId:project.field.layers[0].id};$('used-only').checked=false;fit();});refreshFileControls();$('new-dialog').close();toast('新しいプロジェクトを作成しました');
};
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&!document.querySelector('dialog[open]')) {
    event.preventDefault();if(!event.repeat)saveProject(event.shiftKey);return;
  }
  if(fileBusy)return;
  if(event.target.matches('input,select,textarea')||event.isComposing||document.querySelector('dialog[open]'))return;
  const key=event.key.toLowerCase();
  if(event.metaKey||event.ctrlKey){
    if(key==='z'){event.preventDefault();history(event.shiftKey?'redo':'undo');}
    else if(key==='y'){event.preventDefault();history('redo');}
    else if(key==='c'){if(!marquee)return;event.preventDefault();if(!event.repeat)copyMarquee();}
    else if(key==='x'){if(!marquee)return;event.preventDefault();if(!event.repeat)cutMarquee();}
    else if(key==='v'){event.preventDefault();if(!event.repeat)pasteMarquee();}
    else if(key==='a'){
      event.preventDefault();
      if(!event.repeat&&selectedTile()){setTool('select');const s=project.tileSize;marquee={x:0,y:0,w:s,h:s};updateMarquee();}
    }
    return;
  }
  if(gesture)return;
  if(key==='escape'){event.preventDefault();marquee=null;canvas.style.cursor='';updateMarquee();return;}
  if((key==='delete'||key==='backspace')&&marquee){event.preventDefault();eraseMarquee();return;}
  const shortcut={b:'pen',l:'line',e:'eraser',g:'fill',i:'picker',m:'select'}[key];if(!event.altKey&&shortcut){event.preventDefault();setTool(shortcut);}
});
let loadWarning='';
try {const data=localStorage.getItem(storageKey);if(data){project=validateProject(JSON.parse(data));selection={typeId:project.types[0].id,mask:0,cell:null,layerId:project.field.layers.at(-1).id};}}
catch {loadWarning='保存データを読み込めませんでした。サンプルを表示しています。';}
PALETTE_PRESETS.forEach(preset=>{const option=document.createElement('option');option.value=preset.id;option.textContent=preset.name;$('palette-preset').append(option);});
fit();renderAll();setColor(color);refreshFileControls();if(loadWarning)toast(loadWarning);
