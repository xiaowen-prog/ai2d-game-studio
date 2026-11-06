'use strict';

// Isolated 3-0 design artifact. No model calls, project access or persistence.
const steps = ['方向', '人物', '场景', '核心试玩', '完整游戏', '交付'];
const headlines = ['你的想法，有了轮廓。', '选一个故事的主角。', '让故事在这里发生。', '先把好玩的部分做出来。', '一段完整的冒险。', '把你的游戏，带走。'];
const replies = [
  '我把你的想法整理成了一小局武侠冒险。先看看方向，确认后再开始制作人物。',
  '两位剑客准备好了。选一个喜欢的形象，也可以告诉我哪里需要调整。',
  '竹林场景准备好了。沿用你确认的青衣剑客和动作，先看看画面和人物比例。',
  '先体验移动和攻击，再决定玩法怎么改。你确认的人物和竹林会继续保留。',
  '从三波战斗到升级、胜负，一小局串起来了。你可以继续修改难度或外观。',
  '确认过的版本可以打包带走。实际打开工程和网页游戏后，再确认交付。'
];
const placeholders = ['改成手动攻击，其他不变……', '衣服改白，发型和武器不变……', '竹林改成雪山，人物保持不变……', '让剑气碰墙反弹一次……', '减少每波敌人，其他保持不变……'];
const suggestions = [['改成横版闯关', '换一个故事背景'], ['只改衣服颜色', '保留发型和武器'], ['换成黄昏', '角色再大一点'], ['剑气反弹一次', '降低移动速度'], ['减少每波敌人', '只改背景']];
const initial = new URLSearchParams(location.search).get('view');
const views = { direction: 0, characters: 1, scene: 2, core: 3, game: 4, delivery: 5 };
let stage = Object.hasOwn(views, initial) ? views[initial] : 2;
let selected = 'a';
let characterPhase = 'appearance';
let confirmed = false;
let draftedRequests = Array(6).fill('');
let welcomeDraft = '';
let toastTimeout;
const stateSelect = document.getElementById('preview-state');
const modal = document.getElementById('dialog');
if (initial === 'welcome') stateSelect.value = 'first';
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeText = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const personName = () => selected === 'a' ? '青篁' : '霜竹';

function toast(message) {
  document.getElementById('toast').textContent = message;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { document.getElementById('toast').textContent = ''; }, 6000);
}
function showDialog(title, body, picture = false) {
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-body').innerHTML = body;
  modal.classList.toggle('picture-dialog', picture);
  if (!modal.open) modal.showModal();
}
function images() {
  return `<img class="scene-bg" src="assets/scene.png" alt="已有竹林场景素材"><img class="scene-person" src="assets/character-${selected}.png" alt="${personName()}人物素材">`;
}
function artwork(expanded = false) {
  return `<div class="scene">${images()}<div class="scene-scrim"></div><div class="canvas-top"><span class="glass-label">${stage > 2 ? '游戏画面' : '场景'} · v03</span>${expanded ? '' : `<button class="icon-button" data-expand aria-label="放大查看画面" title="放大查看">${icon('expand')}</button>`}</div><div class="canvas-bottom"><div class="canvas-caption"><h2>竹林 · 午后</h2><p>${stage > 2 ? 'WASD 移动 · J 攻击 · R 重来' : '2D 俯视 · 像素风格'}</p></div><span class="glass-label">静态设计示意 · 非试玩</span></div></div>`;
}
function assetStrip() {
  return `<div class="asset-strip"><button class="asset" data-stage="1"><span class="asset-thumb"><img src="assets/character-${selected}.png" alt=""></span><span><span class="asset-name">${personName()} · 主角</span><span class="asset-detail">沿用已选形象</span></span></button><button class="asset ${stage===2?'active':''}" data-stage="2"><span class="asset-thumb scenic"><img src="assets/scene.png" alt=""></span><span><span class="asset-name">竹林 · 场景</span><span class="asset-detail">当前展示版本</span></span></button><button class="asset" data-actions><span class="asset-thumb"><img src="assets/character-${selected}.png" alt=""></span><span><span class="asset-name">移动与攻击</span><span class="asset-detail">查看动作页布局</span></span></button></div>`;
}
function characterCards() {
  return `<div class="characters">${[['a','青篁','青衣剑客 · 轻巧利落'],['b','霜竹','白衣剑客 · 红色发带']].map(([id,name,desc]) => `<button class="character-card ${selected===id?'selected':''}" data-character="${id}" aria-pressed="${selected===id}"><span class="selected-mark">${selected===id?icon('check'):''}</span><div class="character-art"><img src="assets/character-${id}.png" alt="${name}候选人物"></div><div class="character-caption"><h2>${name}</h2><p>${desc}</p></div></button>`).join('')}</div><div class="sub-tabs"><button class="sub-tab ${characterPhase==='appearance'?'active':''}" data-appearance>基础形象</button><button class="sub-tab ${characterPhase==='actions'?'active':''}" data-actions>人物动作</button></div>${characterPhase==='actions'?'<p class="muted" style="font-size:12px;margin-top:12px">动作页布局示意：此处展示已有静态形象，没有播放或生成动作。</p>':''}`;
}
function directionBoard() {
  return `<section class="direction-board"><div class="direction-copy"><span class="muted" style="font-size:11px">你的第一个游戏 · 方向草稿</span><h2>竹林剑客</h2><p>在竹林里移动、挥剑，击退三波敌人，完成一段短小的武侠冒险。</p><div class="direction-points"><div><span>怎么玩</span><strong>俯视移动，手动发射剑气</strong></div><div><span>怎么成长</span><strong>每波结束，选一次升级</strong></div><div><span>先做多少</span><strong>一个主角，一张地图，一小局</strong></div></div></div><div class="direction-art">${images()}</div></section>`;
}
function deliveryBoard() {
  return `<section class="delivery-board"><div class="delivery-cover">${images()}<h2>竹林剑客</h2></div>${[['folder','可编辑工程','在 Godot 中继续制作'],['play','网页游戏','附带本机打开方法'],['box','压缩包与说明','保存完整版本，旧包保留']].map(([i,a,b])=>`<div class="file-row"><span class="file-icon">${icon(i)}</span><div><strong>${a}</strong><small>${b}</small></div></div>`).join('')}<button class="button" data-folder style="margin-top:16px">${icon('folder')}打开交付文件夹</button></section>`;
}
function buttonText() {
  if (stage===1 && characterPhase==='actions') return '确认动作，开始制作场景';
  if (confirmed) return ({1:'开始制作人物动作',3:'开始制作完整游戏',4:'导出工程与网页游戏',5:'交付已确认'})[stage] || '已确认';
  return ['确认方向，开始制作人物','选定这个人物并保存','确认场景，开始核心试玩','确认核心试玩并保存','确认完整游戏并保存','我已验收，确认交付'][stage];
}
function decision() {
  return `<div class="decision"><strong>${confirmed?'这一版已确认（演示）':stage===1?'喜欢这个角色吗？':stage===2?'这个场景，符合你的想象吗？':stage===5?'实际打开检查后，再确认交付':'看过这一版，再决定下一步'}</strong><button class="button primary" data-approve ${stage===5&&confirmed?'disabled':''}>${buttonText()}${icon('arrow')}</button><small>${stage===2?'确认后保存场景，并开始制作核心试玩。':stage===1?'先确认形象，再由你开始制作人物动作。':stage===5?'此预览没有真实交付包，不会生成或下载文件。':'每次确认都保留版本，之后仍可修改。'}</small></div>`;
}
function chatPanel() {
  const mode = stateSelect.value;
  const unavailable = mode==='running' || mode==='failed';
  let response = stage===2 ? replies[stage].replace('青衣剑客',selected==='a'?'青衣剑客':'白衣剑客') : replies[stage];
  if (stage===1 && characterPhase==='actions') response='人物动作与形象放在同一步里。正式产品会在这里展示可操作的动作预览，让你确认后再制作场景。';
  const notice = mode==='running' ? `<div class="notice" role="status"><strong><span class="activity" aria-hidden="true"><i></i><i></i><i></i></span>正在${stage===5?'准备交付包':'制作'+steps[stage]}</strong><p>上一版仍保留。完成后会停下来，等你确认。</p><button class="button" data-stop>停止制作</button></div>` : mode==='failed' ? `<div class="notice" role="alert"><strong>这次${steps[stage]}修改没有完成</strong><p>上一版和修改要求仍保留。可以重试，也可以查看旧版本。</p><button class="button" data-retry>${icon('retry')}重试这一步</button><button class="quiet-button" data-history>查看已保存版本</button></div>` : decision();
  return `<aside class="chat-panel" aria-label="AI 创作对话"><header class="chat-header"><span class="assistant-symbol">${icon('spark')}</span><h2>创作搭档</h2><small>${mode==='running'?'制作中':mode==='failed'?'需处理':'等你决定'}</small></header><div class="conversation"><div class="user-message">我想做一个武侠类的俯视打怪游戏，主角是青衣剑客，在竹林里战斗。</div><div class="assistant-message"><p>${response}</p><div class="result-tags"><span class="result-tag">${icon('check')}${stage>1?'沿用已选人物':'分步制作'}</span><span class="result-tag">${icon('history')}保留历史版本</span></div></div>${notice}</div>${stage<5?`<div class="suggestions">${suggestions[stage].map(s=>`<button class="suggestion" data-suggest="${s}" ${unavailable?'disabled':''}>${s}</button>`).join('')}</div><form class="composer" id="modify-form">${stage===4?'<select class="scope-select" id="scope" aria-label="修改范围"><option>玩法与难度</option><option>只改人物外观</option><option>只改背景</option></select>':''}<textarea id="request" aria-label="告诉 AI 想改什么" placeholder="${placeholders[stage]}" maxlength="2000" ${unavailable?'disabled':''}>${escapeText(draftedRequests[stage])}</textarea><div class="composer-footer"><small>Enter 发送 · Shift + Enter 换行</small><button class="send-button" type="submit" aria-label="发送修改要求" ${unavailable?'disabled':''}>${icon('up')}</button></div></form>`:`<button class="quiet-button" data-stage="4">返回完整游戏，继续修改 ${icon('arrow')}</button>`}</aside>`;
}
function welcome() {
  return `<section class="welcome"><div class="welcome-art left" aria-hidden="true"><img src="assets/character-a.png" alt=""></div><div class="welcome-art right" aria-hidden="true"><img src="assets/character-b.png" alt=""></div><span class="status-pill" style="margin-bottom:24px">你的第一个游戏，从这里开始</span><h1>让想象，<br>变成你的游戏。</h1><p>你说想法，AI 分步制作。每一步，看过再继续。</p><form class="welcome-form" id="welcome-form"><textarea id="welcome-request" aria-label="描述你的游戏想法" placeholder="我想做一个武侠类的俯视打怪游戏……" maxlength="2000">${escapeText(welcomeDraft)}</textarea><div class="welcome-footer"><small>先连接 AI 账户，写好的想法会保留。</small><button class="button primary" type="submit">连接 AI，开始创作 ${icon('arrow')}</button></div></form><div class="welcome-examples"><button data-example="我想做一个在森林里收集星星的 2D 横版闯关游戏。">森林里的横版冒险</button><button data-example="我想做一个青衣剑客在竹林里战斗的 2D 俯视打怪游戏。">竹林里的剑客</button><button data-example="我想做一个在太空中躲避陨石、击退敌人的 2D 俯视游戏。">太空里的小小英雄</button></div><div class="welcome-label">支持 2D 横版闯关和俯视打怪，题材不限。</div></section>`;
}
function render() {
  const mode=stateSelect.value;
  document.getElementById('steps').innerHTML=steps.map((name,i)=>`${i?'<span class="step-link" aria-hidden="true">›</span>':''}<button class="step ${mode!=='first'&&i===stage?'active':mode!=='first'&&i<stage?'done':''}" data-stage="${i}" ${mode!=='first'&&i===stage?'aria-current="step"':''}><span class="step-number">${mode!=='first'&&i<stage?icon('check'):i+1}</span>${name}</button>`).join('');
  if(mode==='first') { document.getElementById('workspace').innerHTML=welcome(); return; }
  const status=mode==='running'?'制作中':mode==='failed'?'修改未完成':confirmed?'已确认 · 演示':'待你确认';
  document.getElementById('workspace').innerHTML=`<div class="workspace"><section class="art-column"><div class="art-heading"><div><div class="overline">${steps[stage]} ${stage===1&&characterPhase==='actions'?'/ 人物动作':'/ 竹林剑客'}</div><h1>${headlines[stage]}</h1></div><span class="status-pill">${status}</span></div>${stage===0?directionBoard():stage===1?characterCards():stage===5?deliveryBoard():`<div class="stage-frame">${artwork()}</div>`}${stage===1||stage===5?'':assetStrip()}<div class="art-footer"><span>${stage===5?'示例交付内容，未连接真实工程':'复用已有项目素材 · 这次没有重新生图'}</span><span>静态设计预览</span></div></section>${chatPanel()}</div>`;
  const scope=document.getElementById('scope');
  if(scope) scope.disabled=mode==='running'||mode==='failed';
}
function go(next, phase='appearance') {
  stage=next; characterPhase=phase; confirmed=false; stateSelect.value='ready'; render();
}
function approve() {
  if(stage===1 && characterPhase==='appearance') {
    if(confirmed) { characterPhase='actions'; confirmed=false; render(); toast('动作页仅展示布局，没有生成或播放动作。'); }
    else { confirmed=true; render(); toast('已选定人物（设计演示），没有写入真实项目。'); }
  } else if(stage===0||stage===2||(stage===1&&characterPhase==='actions')) {
    go(stage+1); toast('已切换下一步的设计示意，没有启动真实制作。');
  } else if(confirmed && stage===3) { go(4); }
  else if(confirmed && stage===4) { go(5); toast('交付页是内容示意，没有导出文件。'); }
  else { confirmed=true; render(); toast('确认状态只用于设计演示，没有写入真实项目。'); }
}
function historyDialog() {
  showDialog('每一步，都可以回头看看', `<p>版本列表为设计示例，恢复时会说明影响。</p>${[['当前场景草稿','场景 v03 · 当前展示'],['已确认人物动作','人物、动作与确认记录'],['已确认人物形象','基础形象与选择记录']].map(([a,b])=>`<div class="history-row"><div><strong>${a}</strong><small>${b}</small></div><button class="button" data-restore="${a}">查看</button></div>`).join('')}`);
}
function accountDialog() {
  showDialog('连接你的 AI 账户', '<p>正式产品会使用已有账户登录，登录回来继续制作，写好的想法会保留。</p><p>当前是独立设计预览，不会读取账户或启动登录。</p><div class="dialog-actions"><button class="button" data-close>返回预览</button></div>');
}
document.addEventListener('input', event => {
  if(event.target.id==='request') draftedRequests[stage]=event.target.value;
  if(event.target.id==='welcome-request') welcomeDraft=event.target.value;
});
document.addEventListener('click', event => {
  const button=event.target.closest('button'); if(!button||button.disabled) return;
  if(button.hasAttribute('data-stage')) go(Number(button.dataset.stage));
  if(button.hasAttribute('data-character')) { selected=button.dataset.character; confirmed=false; render(); }
  if(button.hasAttribute('data-home')) { stateSelect.value='first'; render(); }
  if(button.hasAttribute('data-actions')) go(1,'actions');
  if(button.hasAttribute('data-appearance')) go(1,'appearance');
  if(button.hasAttribute('data-approve')) approve();
  if(button.hasAttribute('data-history')) historyDialog();
  if(button.hasAttribute('data-account')) accountDialog();
  if(button.hasAttribute('data-expand')) showDialog('竹林场景 · 静态设计示意',artwork(true),true);
  if(button.hasAttribute('data-close')) modal.close();
  if(button.hasAttribute('data-retry')) { stateSelect.value='running'; render(); toast('正在展示制作中状态，没有启动 AI 任务。'); }
  if(button.hasAttribute('data-stop')) { stateSelect.value='ready'; render(); toast('已回到上一版画面，修改草稿仍保留。'); }
  if(button.hasAttribute('data-folder')) toast('这是交付页设计示例，不会打开真实文件夹。');
  if(button.hasAttribute('data-suggest')) { const input=document.getElementById('request'); input.value=button.dataset.suggest; draftedRequests[stage]=input.value; input.focus(); }
  if(button.hasAttribute('data-example')) { welcomeDraft=button.dataset.example; const input=document.getElementById('welcome-request'); input.value=welcomeDraft; input.focus(); }
  if(button.hasAttribute('data-restore')) showDialog('恢复前，看看会影响什么',`<p>所选版本：${escapeText(button.dataset.restore)}</p><p>人物、场景、玩法和确认记录会一起恢复；较新的版本仍保留。</p><p>设计演示不会覆盖或恢复任何真实项目。</p><div class="dialog-actions"><button class="button" data-close>先不恢复</button><button class="button primary" data-demo-done>恢复整套版本</button></div>`);
  if(button.hasAttribute('data-demo-done')) { modal.close(); toast('交互示意结束，没有调用 AI 或改动真实项目。'); }
});
document.addEventListener('submit', event => {
  if(event.target.id==='welcome-form') { event.preventDefault(); accountDialog(); }
  if(event.target.id==='modify-form') {
    event.preventDefault(); const input=document.getElementById('request'); const request=input.value.trim();
    if(!request) { toast('先写下你想修改的内容。'); input.focus(); return; }
    const scope=document.getElementById('scope')?.value;
    showDialog('这次修改，影响哪些内容',`<p class="request-quote">${escapeText(request)}</p><p>${scope?`修改范围：${escapeText(scope)}。`:''}会保留已有版本；修改完成后，需要你重新确认。涉及后续成果时，会先提示哪些步骤需要更新。</p><p>这是设计预览，要求不会发送给 AI。</p><div class="dialog-actions"><button class="button" data-close>返回编辑</button><button class="button primary" data-demo-done>确认影响，继续修改</button></div>`);
  }
});
document.addEventListener('keydown', event => {
  if((event.target.id==='request'||event.target.id==='welcome-request') && event.key==='Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229) {
    event.preventDefault(); if(!event.repeat&&!event.target.disabled) event.target.form.requestSubmit();
  }
});
stateSelect.addEventListener('change',()=>{confirmed=false;render();});
render();
