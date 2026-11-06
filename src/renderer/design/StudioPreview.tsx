import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check,
  ChevronRight, CircleHelp, Clock3, Download, Expand, FileArchive, FolderOpen,
  Gamepad2, Globe2, Layers3, MapPin, MessageSquareText, Minus, MousePointer2, Plus,
  RotateCcw, SlidersHorizontal, X,
} from 'lucide-react';
import forest from './assets/forest-level.png';
import runner from './assets/forest-runner.png';
import bamboo from '../../../docs/product/设计参考/spline-preview/assets/scene.png';
import swordsman from '../../../docs/product/设计参考/spline-preview/assets/character-a.png';
import './studio-preview.css';

const worlds = [
  { name: '林间跃迁', genre: '横版闯关', image: forest, character: runner, idea: '一个清晨森林里的横版闯关游戏，主角可以二段跳，沿途收集光点。' },
  { name: '竹影行', genre: '俯视冒险', image: bamboo, character: swordsman, idea: '一个俯视角武侠游戏，在竹林里用剑气迎战敌人。' },
] as const;
const steps = ['游戏方向', '角色与动作', '关卡场景', '核心试玩', '完整游戏', '导出交付'];
const stepDetails = [
  ['确认游戏方向', '确定玩法、风格和这一局的目标。', '把你的想法写下来，我们先一起确定游戏方向。'],
  ['角色与动作', '检查角色外观和动作是否符合你的想法。', '主角需要清楚的轮廓，让玩家一眼就能认出来。你可以继续调整衣服、配色和动作。'],
  ['检查关卡场景', '查看路线和角色比例，再提出修改。', '场景里已放入选中的角色。你可以继续调整光线、布局和细节。'],
  ['核心试玩', '正式制作时，在这里打开核心试玩并提出修改。', '这一阶段关注操作手感、路线和挑战节奏。预览中展示的是关卡画面，不会启动游戏。'],
  ['完整游戏', '串联开局、挑战与结束，让一局游戏完整。', '将已确认的角色、场景与核心玩法组合起来，再检查胜负、暂停和重新开始。'],
  ['导出游戏', '整理确认版本，选择要导出的内容。', '正式制作台支持工程、网页游戏和压缩包。这里可以先查看导出面板的设计。'],
];
const suggestions = [
  ['更轻松的玩法', '缩短单局时长'],
  ['调整角色配色', '动作更干脆'],
  ['让光线更柔和', '减少一些障碍'],
  ['跳跃距离更远', '降低操作难度'],
  ['增加胜利提示', '让节奏更紧凑'],
  ['需要网页游戏', '保留可编辑工程'],
];
const versions = [
  { number: '03', name: '晨光与层次', description: '调整光线，让远近景更清楚', filter: 'none' },
  { number: '02', name: '柔和的林间', description: '降低饱和度，保留关卡布局', filter: 'saturate(.65) brightness(.94)' },
  { number: '01', name: '初始场景', description: '第一版场景与角色组合', filter: 'saturate(.8) brightness(.8)' },
];

function StudioMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'zp-mark zp-mark-small' : 'zp-mark'} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 5h24v7H12v15H4V5Z" fill="currentColor"/><path d="M17 17h11v10H17V17Z" fill="currentColor"/></svg>;
}

type PreviewView = 'home' | 'projects' | 'studio';

function readView(): PreviewView {
  const value = new URLSearchParams(location.search).get('view');
  return value === 'studio' || value === 'projects' ? value : 'home';
}

function viewHref(view: PreviewView) {
  const url = new URL(location.href);
  if (view === 'home') url.searchParams.delete('view'); else url.searchParams.set('view', view);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function StudioPreview() {
  const [view, setView] = useState<PreviewView>(readView);
  const [worldIndex, setWorldIndex] = useState(0);
  const [step, setStep] = useState(2);
  const [idea, setIdea] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<{ stage: number; text: string }[]>([]);
  const [version, setVersion] = useState(0);
  const [guides, setGuides] = useState(false);
  const [point, setPoint] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [modal, setModal] = useState<'history' | 'export' | 'help' | 'fullscreen' | null>(null);
  const [notice, setNotice] = useState('');
  const page = useRef<HTMLDivElement>(null);
  const ideaInput = useRef<HTMLTextAreaElement>(null);
  const focusIdea = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const world = worlds[worldIndex];
  const draft = drafts[step] ?? '';
  const showsScene = step >= 2 && step <= 4;

  useEffect(() => {
    document.title = `造境 · ${{ home: '创作大厅', projects: '我的项目', studio: '制作台' }[view]}视觉预览`;
    page.current?.scrollTo({ top: 0 });
    if (view === 'home' && focusIdea.current) {
      ideaInput.current?.focus({ preventScroll: true });
      focusIdea.current = false;
    }
  }, [view]);

  useEffect(() => {
    const restoreView = () => { setView(readView()); setModal(null); };
    window.addEventListener('popstate', restoreView);
    return () => window.removeEventListener('popstate', restoreView);
  }, []);

  function navigate(next: PreviewView) {
    if (next === view) return;
    history.pushState(null, '', viewHref(next));
    setView(next);
  }

  function followLink(event: MouseEvent<HTMLAnchorElement>, next: PreviewView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(next);
  }

  function startProject() {
    setIdea('');
    if (view === 'home') {
      page.current?.scrollTo({ top: 0 });
      ideaInput.current?.focus({ preventScroll: true });
    } else {
      focusIdea.current = true;
      navigate('home');
    }
  }

  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
    if (!modal && dialog.current?.open) dialog.current.close();
  }, [modal]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3600); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight }); }, [messages, step]);

  function enterStudio(index = worldIndex, stage = 2) {
    setWorldIndex(index); setStep(stage); navigate('studio'); setZoom(100);
  }

  function updateDraft(text: string) { setDrafts(previous => ({ ...previous, [step]: text })); }
  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages(previous => [...previous, { stage: step, text: draft.trim() }]);
    updateDraft('');
    setNotice('已展示这条修改意见。这是视觉预览，未调用 AI。');
  }

  function renderProjects(includeNew = false) {
    return <div className="zp-project-grid">
      {worlds.map((item, index) => <button className="zp-project-card" key={item.name} onClick={() => enterStudio(index)}>
        <div className="zp-project-image"><img src={item.image} alt="" /><span className="zp-project-arrow"><ArrowUpRight size={23} /></span></div>
        <div className="zp-project-info"><div><span>{item.genre}</span><h3>{item.name}</h3></div><p>关卡场景 <ChevronRight size={15} /></p></div>
      </button>)}
      {includeNew && <button className="zp-new-project" onClick={startProject}><span><Plus size={28} /></span><h3>新建项目</h3><p>从一个新想法开始 <ArrowUpRight size={17} /></p></button>}
    </div>;
  }

  function renderScene(large = false) {
    return <div className={`zp-scene ${large ? 'zp-scene-large' : ''} ${worldIndex === 1 ? 'zp-scene-topdown' : ''}`}>
      <div className="zp-scene-picture" style={{ transform: `scale(${zoom / 100})`, filter: versions[version].filter }}>
        <img className="zp-scene-background" src={world.image} alt={`${world.name}已有场景素材`} />
        <img className="zp-scene-runner" src={world.character} alt="场景中的角色" />
      </div>
      {guides && <div className="zp-scene-guides" aria-label="关卡标记示例">
        <svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><path d="M175 428 Q350 190 500 340 T840 220" /></svg>
        {['起点', '跳跃区', '终点'].map((name, index) => <button className={`zp-marker zp-marker-${index}`} key={name} aria-pressed={point === index} onClick={() => setPoint(index)}>{name}</button>)}
      </div>}
    </div>;
  }

  return <div className={`zp zp-view-${view}`} ref={page}>
    <header className="zp-header">
      <button className="zp-brand" aria-label="造境，返回创作大厅" onClick={() => navigate('home')}><StudioMark /><strong>造境</strong></button>
      <nav className="zp-nav" aria-label="主要导航">
        {([['home', '创作大厅'], ['projects', '我的项目'], ['studio', '制作台']] as const).map(([target, label]) => <a key={target} href={viewHref(target)} aria-current={view === target ? 'page' : undefined} onClick={event => followLink(event, target)}>{label}</a>)}
      </nav>
      <div className="zp-header-end"><button className="zp-preview-badge" aria-label="设计预览说明" title="关于此预览" onClick={() => setModal('help')}><span className="zp-preview-label">设计预览</span><CircleHelp size={15} /></button></div>
    </header>

    {view === 'home' ? <main>
      <section className="zp-home-hero">
        <div className="zp-hero-copy">
          <h1>把脑海里的世界，<br />做成能玩的游戏。</h1>
          <p className="zp-hero-description">用一句话描述想法，和 AI 一起完成角色、关卡与游戏。</p>
          <form className="zp-idea" onSubmit={event => { event.preventDefault(); enterStudio(worldIndex, 0); }}>
            <label htmlFor="zp-idea-input">想做什么样的游戏？</label>
            <textarea ref={ideaInput} id="zp-idea-input" value={idea} onChange={event => setIdea(event.target.value)} placeholder="例如：在清晨的森林里，做一个可以二段跳的闯关游戏…" rows={2} />
            <div className="zp-idea-bottom"><div className="zp-genre-toggle" aria-label="游戏类型">{worlds.map((item, index) => <button key={item.genre} type="button" aria-pressed={worldIndex === index} onClick={() => setWorldIndex(index)}><Gamepad2 size={13} />{item.genre}</button>)}</div><button className="zp-primary" type="submit">开始构思 <ArrowUpRight size={17} /></button></div>
          </form>
        </div>
        <div className="zp-hero-art">
          <div className="zp-art-window" key={world.name}>
            <img className="zp-hero-landscape" src={world.image} alt={`${world.name}场景作品`} />
            <div className="zp-art-shade" />
            <div className="zp-art-caption"><span>{world.genre}</span><h2>{world.name}</h2></div>
            <button className="zp-art-open" aria-label={`打开${world.name}示例制作台`} onClick={() => enterStudio()}>打开制作台 <ArrowUpRight size={20} /></button>
          </div>
        </div>
      </section>

      <section className="zp-projects">
        <header className="zp-section-heading"><h2>最近的项目</h2><a className="zp-projects-link" href={viewHref('projects')} onClick={event => followLink(event, 'projects')}>查看全部 <ArrowRight size={17} /></a></header>
        {renderProjects(true)}
      </section>
    </main> : view === 'projects' ? <main className="zp-project-library">
      <header className="zp-library-heading"><div><h1>我的项目</h1><p>当前展示两个示例项目，选择一个继续查看制作台。</p></div><button className="zp-primary" onClick={startProject}><Plus size={18} />新建项目</button></header>
      {renderProjects()}
    </main> : <main className="zp-workspace">
      <div className="zp-project-bar"><div className="zp-project-breadcrumb"><button aria-label="返回我的项目" onClick={() => navigate('projects')}><ArrowLeft size={18} /></button><a href={viewHref('projects')} onClick={event => followLink(event, 'projects')}>我的项目</a><ChevronRight size={14} /><strong>{world.name}</strong><span className="zp-project-type">{world.genre} · 示例</span></div><div className="zp-project-actions"><button onClick={() => setModal('history')}><Clock3 size={15} />历史版本</button><button className="zp-export-button" onClick={() => setModal('export')}><Download size={15} />导出</button></div></div>
      <nav className="zp-stepper" aria-label="制作步骤">
        {steps.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} onClick={() => { setStep(index); setZoom(100); }}><span className={`zp-step-index ${index < step ? 'zp-step-before' : ''}`}>{index < step ? <Check size={13} /> : index + 1}</span><strong>{label}</strong>{step === index && <span className="zp-current-step">当前</span>}</button>)}
      </nav>
      <div className="zp-work-grid">
        <section className="zp-preview-area" aria-label="成果预览">
          <header className="zp-canvas-toolbar"><div><span className="zp-canvas-tab"><Layers3 size={14} />{step === 1 ? '角色预览' : step === 0 ? '方向卡' : step === 5 ? '交付预览' : '关卡预览'}</span><span className="zp-canvas-filename">{world.name}{showsScene && <> <span>/</span> v{versions[version].number}</>}</span></div><div>{showsScene && <button className={guides ? 'selected' : ''} aria-label="显示关卡标记" aria-pressed={guides} onClick={() => setGuides(!guides)}><MapPin size={15} /></button>}{step >= 1 && step <= 4 && <button aria-label="放大查看成果" onClick={() => setModal('fullscreen')}><Expand size={16} /></button>}</div></header>
          <div className="zp-canvas-well">
            {step === 0 ? <article className="zp-direction"><h2>{world.name}</h2><p>{idea || world.idea}</p><div><span><Gamepad2 size={16} />{world.genre}</span><span><Layers3 size={16} />2D 世界</span></div><hr /><small>核心体验</small><h3>{worldIndex === 0 ? '探索、跳跃，抵达更远的地方。' : '移动、出招，在竹影中迎战。'}</h3></article>
            : step === 1 ? <div className="zp-character-sheet"><div className="zp-character-image"><img src={world.character} alt="已有角色素材展示" /></div><div><h2>角色外观</h2><p>查看角色比例和配色，<br />在右侧提出修改。</p><span className="zp-character-caption">角色图 · 已有素材</span></div></div>
            : step === 5 ? <div className="zp-delivery-card"><h2>导出游戏</h2><p>选择导出格式，保存当前确认的游戏版本。</p><button className="zp-primary" onClick={() => setModal('export')}>查看导出面板 <ArrowUpRight size={17} /></button></div>
            : renderScene()}
            {showsScene && <div className="zp-canvas-bottomline"><span><MousePointer2 size={13} />{guides ? ['起点：进入关卡的位置', '跳跃区：调整挑战节奏', '终点：完成本局的目标'][point] : '场景素材组合 · 未运行游戏'}</span><div className="zp-zoom"><button aria-label="缩小画面" disabled={zoom <= 80} onClick={() => setZoom(value => value - 10)}><Minus size={13} /></button><button aria-label="恢复百分之百" onClick={() => setZoom(100)}>{zoom}%</button><button aria-label="放大画面" disabled={zoom >= 130} onClick={() => setZoom(value => value + 10)}><Plus size={13} /></button></div></div>}
          </div>
          <div className="zp-scene-summary"><div><h2>{stepDetails[step][0]}</h2><p>{stepDetails[step][1]}</p></div><button aria-label="查看版本与调整记录" onClick={() => setModal('history')}><SlidersHorizontal size={19} /></button></div>
          {step === 2 && <div className="zp-versions-strip"><span>场景版本</span>{versions.map((item, index) => <button key={item.number} aria-pressed={version === index} onClick={() => setVersion(index)}><img src={world.image} style={{ filter: item.filter }} alt="" /><span><strong>v{item.number}</strong><small>{item.name}</small></span>{version === index && <Check size={13} />}</button>)}</div>}
        </section>
        <aside className="zp-assistant" aria-label="AI 对话设计预览">
          <header><MessageSquareText size={20} /><div><h2>AI 制作搭档</h2><p>随时提出你的修改意见。</p></div></header>
          <div className="zp-chat-scroll" ref={chat}>
            <div className="zp-chat-author"><StudioMark small /><strong>造境</strong></div>
            <div className="zp-chat-intro" key={`intro-${step}`}><h3>{stepDetails[step][0]}</h3><p>{stepDetails[step][2]}</p></div>
            {step >= 1 && step <= 4 && <button className="zp-chat-artifact" onClick={() => setModal('fullscreen')}><img src={step === 1 ? world.character : world.image} alt="" /><span><strong>{world.name}</strong><small>{steps[step]} · 查看成果</small></span><ArrowUpRight size={15} /></button>}
            {messages.filter(item => item.stage === step).map((item, index) => <div className="zp-message-pair" key={`${step}-${index}`}><div className="zp-user-message">{item.text}</div><p>修改意见已展示，未执行生成。</p></div>)}
          </div>
          <div className="zp-chat-controls"><div className="zp-suggestions">{suggestions[step].map(text => <button key={text} onClick={() => { updateDraft(text); input.current?.focus(); }}>{text}</button>)}</div>
            <form className="zp-composer" onSubmit={send}><textarea ref={input} aria-label="输入修改意见" placeholder="告诉我，你想改哪里…" value={draft} onChange={event => updateDraft(event.target.value)} rows={3} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>Enter 发送，Shift+Enter 换行</span><button type="submit" aria-label="发送示例修改意见" disabled={!draft.trim()}><ArrowUp size={18} /></button></div></form>
            <button className="zp-next-step" onClick={() => step === 5 ? setModal('export') : setStep(step + 1)}>{step === 5 ? '查看导出选项' : '查看下一步'}<ArrowRight size={16} /></button><p className="zp-demo-note">本页仅演示界面，不执行生成。</p>
          </div>
        </aside>
      </div>
    </main>}

    {notice && <div className="zp-toast" role="status"><Check size={16} />{notice}</div>}
    <dialog ref={dialog} className={`zp-dialog ${modal === 'fullscreen' ? 'zp-dialog-wide' : ''}`} onCancel={() => setModal(null)} onClose={() => setModal(null)} onClick={event => { if (event.target === event.currentTarget) setModal(null); }}>
      <header><div><h2>{modal === 'history' ? '历史版本' : modal === 'export' ? '导出游戏' : modal === 'fullscreen' ? `${world.name} · 成果预览` : '关于此预览'}</h2></div><button aria-label="关闭面板" onClick={() => setModal(null)}><X size={20} /></button></header>
      {modal === 'history' && <div className="zp-history-content"><p>选择一个示例版本，查看画面的变化。</p>{versions.map((item, index) => <button className={version === index ? 'active' : ''} key={item.number} onClick={() => { setVersion(index); setModal(null); setNotice(`已切换至示例 v${item.number}，旧项目未发生改变。`); }}><img src={world.image} alt="" style={{ filter: item.filter }} /><div><strong>v{item.number} · {item.name}</strong><p>{item.description}</p></div>{version === index ? <Check size={18} /> : <RotateCcw size={17} />}</button>)}<small>这里仅演示版本面板，不会恢复或覆盖你的真实项目。</small></div>}
      {modal === 'export' && <div className="zp-export-content"><p>支持以下三种导出方式。</p>{[{ icon: FolderOpen, name: 'Godot 工程', note: '继续编辑角色、场景与游戏逻辑', ext: '.godot' }, { icon: Globe2, name: '网页游戏', note: '在浏览器中打开与游玩', ext: 'HTML' }, { icon: FileArchive, name: '完整压缩包', note: '游戏文件与打开说明一起打包', ext: '.zip' }].map(({ icon: Icon, name, note, ext }) => <div className="zp-export-option" key={name}><Icon size={23} /><div><h3>{name}</h3><p>{note}</p></div><span>{ext}</span></div>)}<div className="zp-export-note"><CircleHelp size={16} />这是导出面板的设计预览，实际导出请使用原制作台。</div></div>}
      {modal === 'help' && <div className="zp-help-content"><p>这是「造境」的新视觉预览，包含创作大厅、独立项目页、六个制作步骤、AI 对话区、版本面板与导出面板。</p><p>场景与角色复用已有素材，示例交互只在当前页面中生效。真实生成、项目保存、试玩与导出仍使用原制作台。</p><button className="zp-primary" onClick={() => setModal(null)}>开始看看 <ArrowRight size={16} /></button></div>}
      {modal === 'fullscreen' && <div className="zp-fullscreen-content">{step === 1 ? <img className="zp-full-character" src={world.character} alt="角色原图" /> : renderScene(true)}</div>}
    </dialog>
  </div>;
}
