import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp,
  Download, Expand, FileArchive, FolderOpen, Gamepad2, Globe2, Layers3,
  LockKeyhole, MapPin, MessageSquareText, Minus, Play, Plus, Settings2, Trash2, Undo2, X,
} from 'lucide-react';
import forest from './assets/forest-level.png';
import runner from './assets/forest-runner.png';
import bamboo from './assets/bamboo-scene.png';
import swordsman from './assets/bamboo-character.png';
import {
  applyPreviewMessage, confirmPreviewStage, newPreviewProject, openPreviewStage, selectPreviewVersion,
  previewSteps as steps, previewSuggestions as suggestions, type PreviewProject, type PreviewVersion,
} from './studioPreviewState';
import {
  PREVIEW_LIBRARY_BACKUP_KEY, PREVIEW_LIBRARY_KEY, PREVIEW_LIBRARY_LEGACY_KEYS, createPreviewItem,
  initialPreviewLibrary, parsePreviewLibrary, previewProgress, removePreviewItem, renamePreviewItem,
  restorePreviewItem, serializePreviewLibrary, sortPreviewLibraryItems, type PreviewKind,
} from './studioPreviewLibrary';
import './studio-preview.css';

const worlds = [
  { id: 'forest', name: '林间跃迁', genre: '横版闯关', image: forest, character: runner, idea: '一个清晨森林里的横版闯关游戏，主角可以二段跳，沿途收集光点。' },
  { id: 'bamboo', name: '竹影行', genre: '俯视冒险', image: bamboo, character: swordsman, idea: '一个俯视角武侠游戏，在竹林里用剑气迎战敌人。' },
] as const;
const stepDetails = [
  ['方向草稿', '先确定玩法与单局目标。', '想做一局怎样的游戏？下面两条示例会直接更新方向卡。'],
  ['角色比例', '检查角色是否清楚、比例是否合适。', '可以先试着放大或缩小主角。这里调整的是已有素材在画面中的比例。'],
  ['人物与路线', '检查主角比例和位置；路线标注仅供查看。', '主角是否足够清楚？试试放大主角或调整位置，再对比演示版本。'],
  ['操作与手感', '试玩入口已就位，当前示例尚未接入可运行游戏。', '这里应该真正打开游戏检查操作手感。当前先演示反馈如何被记录，不改变游戏参数。'],
  ['一局的反馈', '查看胜利与暂停界面的呈现。', '试着切换胜利和暂停界面。这是界面组合演示，不是已完成的游戏。'],
  ['交付方式', '正式制作台会导出当前确认的游戏版本。', '此预览可以查看交付选项，不会生成工程或压缩包。'],
];

function StudioMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'zp-mark zp-mark-small' : 'zp-mark'} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 5h24v7H12v15H4V5Z" fill="currentColor"/><path d="M17 17h11v10H17V17Z" fill="currentColor"/></svg>;
}

type PreviewView = 'home' | 'projects' | 'studio';
function readRoute(): { view: PreviewView; project: string | null } {
  const params = new URLSearchParams(location.search);
  const project = params.get('project');
  const value = params.get('view');
  return { view: value === 'studio' ? project ? 'studio' : 'projects' : value === 'projects' ? 'projects' : 'home', project };
}
function viewHref(view: PreviewView, project?: string) {
  const url = new URL(location.href);
  if (view === 'home') url.searchParams.delete('view'); else url.searchParams.set('view', view);
  if (view === 'studio' && project) url.searchParams.set('project', project); else url.searchParams.delete('project');
  return `${url.pathname}${url.search}${url.hash}`;
}
function liveHref() {
  const url = new URL(location.href);
  url.searchParams.set('live', '1');
  url.searchParams.delete('design');
  return `${url.pathname}${url.search}${url.hash}`;
}
function loadLibrary() {
  const keys = [PREVIEW_LIBRARY_KEY, PREVIEW_LIBRARY_BACKUP_KEY, ...PREVIEW_LIBRARY_LEGACY_KEYS];
  let hadStoredData = false;
  try {
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      hadStoredData = true;
      try {
        const items = parsePreviewLibrary(raw);
        return { items, error: false, migrated: key !== PREVIEW_LIBRARY_KEY };
      } catch { /* Try the backup or legacy key before showing a recovery warning. */ }
    }
  } catch { hadStoredData = true; }
  return { items: initialPreviewLibrary(), error: hadStoredData, migrated: false };
}
function updatedLabel(time: number | null) {
  return time === null ? '尚未修改' : `更新于 ${new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(time)}`;
}

export function StudioPreview() {
  const [route, setRoute] = useState(readRoute);
  const [worldChoice, setWorldChoice] = useState(0);
  const [loaded] = useState(loadLibrary);
  const [library, setLibrary] = useState(() => sortPreviewLibraryItems(loaded.items));
  const [saveError, setSaveError] = useState(loaded.error);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<PreviewKind>('forest');
  const [newIdea, setNewIdea] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [idea, setIdea] = useState('');
  const [guides, setGuides] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [modal, setModal] = useState<'history' | 'export' | 'help' | 'fullscreen' | 'create' | 'manage' | 'trash' | null>(null);
  const [notice, setNotice] = useState('');
  const page = useRef<HTMLDivElement>(null);
  const ideaInput = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const activeItem = library.find(item => item.id === route.project && item.deletedAt === null);
  const view = route.view === 'studio' && !activeItem ? 'projects' : route.view;
  const worldIndex = view === 'studio' ? activeItem!.kind === 'bamboo' ? 1 : 0 : worldChoice;
  const world = { ...worlds[worldIndex], name: view === 'studio' ? activeItem!.name : worlds[worldIndex].name };
  const fallbackProject = useRef(newPreviewProject(''));
  const project = activeItem?.workflow ?? fallbackProject.current;
  const step = project.stage;
  const versions = project.versions[step];
  const versionIndex = project.selected[step];
  const version = versions[versionIndex];
  const draft = project.drafts[step];
  const activeProjects = sortPreviewLibraryItems(library.filter(item => item.deletedAt === null));
  const removedProjects = sortPreviewLibraryItems(library.filter(item => item.deletedAt !== null));
  const showsScene = step >= 2 && step <= 4;
  const visibleVersions = versions.slice(-3);
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `造境 · ${{ home: '创作大厅', projects: '我的项目', studio: world.name }[view]}设计预览`;
    page.current?.scrollTo({ top: 0 });
  }, [view, world.name]);
  useEffect(() => {
    if (view === 'projects' && new URLSearchParams(location.search).get('view') === 'studio') history.replaceState(null, '', viewHref('projects'));
  }, [route, view]);
  useEffect(() => {
    if (loaded.error) return; // Preserve unreadable storage instead of overwriting it.
    try {
      const serialized = serializePreviewLibrary(library);
      localStorage.setItem(PREVIEW_LIBRARY_BACKUP_KEY, serialized);
      localStorage.setItem(PREVIEW_LIBRARY_KEY, serialized);
      setSaveError(false);
    }
    catch { setSaveError(true); }
  }, [library, loaded.error]);
  useEffect(() => {
    const restore = () => { setRoute(readRoute()); setModal(null); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => page.current?.style.setProperty('--zp-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    resize(); viewport?.addEventListener('resize', resize); window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    setZoom(100); setGuides(false);
    sceneRef.current?.scrollTo({ left: 0, top: 0 });
  }, [step, activeItem?.id]);
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
    if (!modal && dialog.current?.open) dialog.current.close();
  }, [modal]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4200); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight }); }, [project.messages, step, activeItem?.id]);

  function updateProject(update: (previous: PreviewProject) => PreviewProject, recordEdit = true) {
    setLibrary(previous => previous.map(item => {
      if (item.id !== activeItem?.id) return item;
      const workflow = update(item.workflow);
      return workflow === item.workflow ? item : { ...item, workflow, updatedAt: recordEdit ? Date.now() : item.updatedAt };
    }));
  }
  function navigate(next: PreviewView, id?: string) {
    history.pushState(null, '', viewHref(next, id)); setRoute(readRoute()); setModal(null);
  }
  function followLink(event: MouseEvent<HTMLAnchorElement>, next: PreviewView, id?: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(next, id);
  }
  function startProject(seed = '') {
    setNewName(seed.trim().slice(0, 18)); setNewIdea(seed); setNewKind(worlds[worldChoice].id); setModal('create');
  }
  function createProject(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    const item = createPreviewItem(newName, newKind, newIdea);
    setLibrary(previous => [item, ...previous]); setIdea(''); navigate('projects');
    setNotice(`已创建「${item.name}」，可以继续制作。`);
  }
  function enterStudio(id: string) { navigate('studio', id); }
  function openExample() {
    const sample = activeProjects.find(item => item.sample && item.kind === worlds[worldChoice].id);
    if (sample) enterStudio(sample.id); else startProject(world.idea);
  }
  function manageProject(id: string) {
    const item = library.find(item => item.id === id);
    if (!item) return;
    setEditId(id); setEditName(item.name); setModal('manage');
  }
  function updateDraft(text: string) {
    updateProject(previous => { const drafts = [...previous.drafts]; drafts[previous.stage] = text; return { ...previous, drafts }; });
  }
  function send(event: FormEvent) { event.preventDefault(); if (draft.trim()) updateProject(previous => applyPreviewMessage(previous, draft)); }
  function chooseVersion(index: number) {
    if (index === versionIndex) return;
    updateProject(previous => selectPreviewVersion(previous, index));
    setNotice('已切换演示版本；确认此版本后才能继续后续步骤。');
  }
  function panStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || zoom === 100) return;
    const element = event.currentTarget;
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function panMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
    event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
  }
  function panEnd(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function panKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (zoom === 100) return;
    const distance = event.shiftKey ? 96 : 36;
    const movement = event.key === 'ArrowLeft' ? { left: -distance, top: 0 }
      : event.key === 'ArrowRight' ? { left: distance, top: 0 }
        : event.key === 'ArrowUp' ? { left: 0, top: -distance }
          : event.key === 'ArrowDown' ? { left: 0, top: distance } : null;
    if (!movement) return;
    event.preventDefault();
    event.currentTarget.scrollBy({ ...movement, behavior: 'auto' });
  }

  function keepComposerLayout(event: PointerEvent<HTMLDivElement>) {
    // Keep the focused-input layout stable until the button's click is handled.
    // Otherwise blur can move the button between pointer-down and pointer-up.
    if (event.button === 0 && document.activeElement === input.current
      && event.target instanceof Element && event.target.closest('.zp-work-grid button')) event.preventDefault();
  }

  function renderProjects(recent = false) {
    const items = recent ? activeProjects.slice(0, 2) : activeProjects;
    return <div className="zp-project-grid">{items.map(item => {
      const progress = previewProgress(item.workflow);
      const template = worlds[item.kind === 'bamboo' ? 1 : 0];
      return <article className="zp-project-card" key={item.id} aria-label={`${item.name}项目`}>
        <a className="zp-project-open" href={viewHref('studio', item.id)} onClick={event => followLink(event, 'studio', item.id)} aria-label={`继续制作 ${item.name}`}>
          <div className={`zp-project-image ${item.sample ? '' : `zp-project-placeholder zp-placeholder-${item.kind}`}`}>
            {item.sample ? <img src={template.image} alt="" /> : <><Gamepad2 size={38} /><span>方向草稿</span></>}
            {item.sample && <span className="zp-sample-label">示例</span>}
          </div>
          <div className="zp-project-info"><span className="zp-project-genre">{template.genre}</span><h3>{item.name}</h3>
            <p className="zp-project-progress">第 {progress.step}/6 步 · {progress.label}</p><span className={`zp-project-status ${progress.status === '已确认' ? 'is-confirmed' : ''}`}>{progress.status}</span>
            <div className="zp-project-meter" aria-hidden="true">{steps.map((_, index) => <i key={index} className={index <= item.workflow.confirmedThrough ? 'done' : index === item.workflow.stage ? 'current' : ''} />)}</div>
            <time dateTime={item.updatedAt === null ? undefined : new Date(item.updatedAt).toISOString()}>{updatedLabel(item.updatedAt)}</time>
          </div>
        </a>
        <footer><a href={viewHref('studio', item.id)} onClick={event => followLink(event, 'studio', item.id)}>继续制作 <ArrowRight size={15} /></a><button aria-label={`管理 ${item.name}`} onClick={() => manageProject(item.id)}><Settings2 size={14} />管理</button></footer>
      </article>;
    })}<button className="zp-new-project" onClick={() => startProject()}><span><Plus size={28} /></span><h3>新建项目</h3><p>给下一个游戏，留一个位置 <ArrowRight size={17} /></p></button></div>;
  }

  function renderComposition(item: PreviewVersion, thumbnail = false) {
    return <div className={`zp-composition ${worldIndex === 1 ? 'zp-scene-topdown' : ''} ${thumbnail ? 'zp-composition-thumb' : ''}`}>
      <img className="zp-scene-background" draggable={false} src={world.image} alt={thumbnail ? '' : `${world.name}已有场景素材`} />
      <img className="zp-scene-runner" draggable={false} src={world.character} alt={thumbnail ? '' : '场景中的角色'} style={{ left: `${item.left}%`, transform: `scale(${item.size})` }} />
      {guides && !thumbnail && <div className="zp-scene-guides" role="group" aria-label="只读路线标注"><svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><path d="M175 428 Q350 190 500 340 T840 220" /></svg>{['起点', worldIndex === 0 ? '跳跃区' : '交战区', '终点'].map((name, index) => <span className={`zp-marker zp-marker-${index}`} key={name}>{name}</span>)}</div>}
      {step === 4 && item.overlay && <div className="zp-game-overlay"><span>界面演示</span><strong>{item.overlay === 'victory' ? '抵达新的风景' : '稍作休息'}</strong><p>{item.overlay === 'victory' ? '这一段旅程，完成了。' : '游戏已暂停的界面样式'}</p></div>}
    </div>;
  }
  function renderScene(large = false) {
    return <div ref={large ? undefined : sceneRef} className={`zp-scene ${zoom > 100 ? 'zp-scene-zoomed' : ''}`} tabIndex={zoom > 100 ? 0 : undefined} role={zoom > 100 ? 'region' : undefined} aria-label={zoom > 100 ? '放大画面，可拖动或用方向键查看' : undefined}
      onKeyDown={panKeyDown} onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="zp-scene-picture" style={{ width: `${zoom}%`, height: `${zoom}%` }}>{renderComposition(version)}</div>
    </div>;
  }
  function renderVersionThumb(item: PreviewVersion) {
    return showsScene ? <span className="zp-version-thumbnail">{renderComposition(item, true)}</span>
      : step === 1 ? <span className="zp-version-thumbnail zp-version-character"><img src={world.character} alt="" style={{ transform: `scale(${item.size})` }} /></span>
        : <span className="zp-version-note"><Layers3 size={16} /></span>;
  }

  return <div className={`zp zp-view-${view}`} ref={page} onPointerDownCapture={keepComposerLayout}>
    <header className="zp-header"><button className="zp-brand" aria-label="造境，返回创作大厅" onClick={() => navigate('home')}><StudioMark /><strong>造境</strong></button>
      <nav className="zp-nav" aria-label="主要导航">{([['home', '创作大厅'], ['projects', '我的项目']] as const).map(([target, label]) => <a key={target} href={viewHref(target)} aria-current={view === target ? 'page' : undefined} onClick={event => followLink(event, target)}>{label}</a>)}</nav>
      <div className="zp-header-end"><a className="zp-live-link" href={liveHref()}><span>打开实时制作台</span><ArrowUpRight size={15} /></a><button className="zp-preview-badge" aria-label="设计预览说明" onClick={() => setModal('help')}><span className="zp-preview-label">设计预览</span><CircleHelp size={15} /></button></div>
    </header>
    {view === 'home' ? <main>
      <section className="zp-home-hero"><div className="zp-hero-copy"><h1>把脑海里的世界，<br />做成能玩的游戏。</h1><p className="zp-hero-description">用一句话描述想法，和 AI 一起完成角色、关卡与游戏。</p>
        <form className="zp-idea" onSubmit={event => { event.preventDefault(); startProject(idea); }}>
          <label htmlFor="zp-idea-input">想做什么样的游戏？</label><textarea ref={ideaInput} id="zp-idea-input" value={idea} onChange={event => setIdea(event.target.value)} placeholder="例如：在清晨的森林里，做一个可以二段跳的闯关游戏…" rows={2} />
          <div className="zp-idea-bottom"><div className="zp-genre-toggle" aria-label="游戏类型">{worlds.map((item, index) => <button key={item.genre} type="button" aria-pressed={worldChoice === index} onClick={() => setWorldChoice(index)}><Gamepad2 size={13} />{item.genre}</button>)}</div><button className="zp-primary" type="submit">创建项目 <ArrowUpRight size={17} /></button></div>
        </form></div><div className="zp-hero-art"><div className="zp-art-window" key={world.id}><img className="zp-hero-landscape" src={world.image} alt={`${world.name}场景作品`} /><div className="zp-art-shade" /><div className="zp-art-caption"><span>{world.genre}</span><h2>{world.name}</h2></div><button className="zp-art-open" onClick={openExample}>打开示例制作台 <ArrowUpRight size={20} /></button></div></div></section>
      <section className="zp-projects"><header className="zp-section-heading"><h2>最近的项目</h2><a className="zp-projects-link" href={viewHref('projects')} onClick={event => followLink(event, 'projects')}>查看全部 <ArrowRight size={17} /></a></header>{renderProjects(true)}</section>
    </main> : view === 'projects' ? <main className="zp-project-library"><header className="zp-library-heading"><div><h1>我的项目</h1><p>{activeProjects.length} 个项目 · 预览记录保存在此浏览器</p></div><div className="zp-library-actions">{removedProjects.length > 0 && <button className="zp-trash-link" onClick={() => setModal('trash')}><Trash2 size={15} />最近删除 · {removedProjects.length}</button>}<button className="zp-primary" onClick={() => startProject()}><Plus size={18} />新建项目</button></div></header>{saveError && <p className="zp-storage-error" role="alert">浏览器保存不可用，本次更改尚未保存；原有记录未覆盖，请先不要关闭页面。</p>}{renderProjects()}</main>
      : <main className="zp-workspace">
        <div className="zp-project-bar"><div className="zp-project-breadcrumb"><button aria-label="返回我的项目" onClick={() => navigate('projects')}><ArrowLeft size={18} /></button><a href={viewHref('projects')} onClick={event => followLink(event, 'projects')}>我的项目</a><ChevronRight size={14} /><strong>{world.name}</strong><span className="zp-project-type">{world.genre}{activeItem?.sample ? ' · 示例' : ' · 预览项目'}</span></div><button className="zp-export-button" onClick={() => setModal('export')}><Download size={15} />导出说明</button></div>
        <nav className="zp-stepper" aria-label="制作步骤">{steps.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} disabled={index > project.confirmedThrough + 1} title={index > project.confirmedThrough + 1 ? '确认前一步后开放' : undefined} onClick={() => updateProject(previous => openPreviewStage(previous, index), false)}>
          <span className={`zp-step-index ${index <= project.confirmedThrough ? 'zp-step-before' : ''}`}>{index <= project.confirmedThrough ? <Check size={13} /> : index + 1}</span><strong>{label}</strong>{step === index && <span className="zp-current-step">当前</span>}</button>)}</nav>
        <div className="zp-work-grid">
          <section className="zp-preview-area" aria-label="成果预览">
            <header className="zp-canvas-toolbar"><span className="zp-canvas-tab"><Layers3 size={15} />{stepDetails[step][0]}</span><div>{showsScene && <button aria-pressed={guides} onClick={() => setGuides(!guides)}><MapPin size={15} />路线标注</button>}{step >= 1 && step <= 4 && <button onClick={() => setModal('fullscreen')}><Expand size={15} />放大查看</button>}</div></header>
            {showsScene && <div className="zp-playbar"><button disabled aria-describedby="zp-play-reason"><Play size={15} />试玩</button><span id="zp-play-reason">{step === 2 ? '确认场景后进入核心试玩；示例未接游戏' : '示例未接入游戏，请在正式制作台试玩'}</span></div>}
            <div className="zp-canvas-well">
              {step === 0 ? <article className="zp-direction"><span>游戏方向 · 草稿</span><h2>{world.name}</h2><p>{project.idea}</p><div><span><Gamepad2 size={16} />{world.genre}</span><span><Layers3 size={16} />2D 世界</span></div><hr /><h3>{version.note || (worldIndex === 0 ? '探索、跳跃，抵达更远的地方。' : '移动、出招，在竹影中迎战。')}</h3></article>
                : step === 1 ? <div className="zp-character-sheet"><div className="zp-character-image"><img src={world.character} alt="已有角色素材展示" style={{ transform: `scale(${version.size})` }} /></div><div><h2>角色外观</h2><p>比例 {Math.round(version.size * 100)}%</p><span className="zp-character-caption">已有素材 · 尚未编辑原图</span></div></div>
                  : step === 5 ? <div className="zp-delivery-card"><FileArchive size={32} /><h2>让作品走出制作台</h2><p>这里展示交付方式。<br />实际文件在正式制作台生成。</p><button className="zp-primary" onClick={() => setModal('export')}>查看导出方式 <ArrowUpRight size={17} /></button></div> : renderScene()}
            </div>
            <div className="zp-canvas-bottomline"><span>{showsScene ? version.note || (guides ? '路线标注为只读参考' : `主角比例 ${Math.round(version.size * 100)}%${zoom > 100 ? ' · 拖动查看' : ''}`) : stepDetails[step][1]}</span>{showsScene && <div className="zp-zoom"><button aria-label="缩小画面" disabled={zoom <= 100} onClick={() => setZoom(value => value - 25)}><Minus size={14} /></button><button aria-label="适应画布" onClick={() => { setZoom(100); sceneRef.current?.scrollTo({ left: 0, top: 0 }); }}>{zoom === 100 ? '适应' : `${zoom}%`}</button><button aria-label="放大画面" disabled={zoom >= 200} onClick={() => setZoom(value => value + 25)}><Plus size={14} /></button></div>}</div>
            {step !== 5 && <div className="zp-versions-strip"><div className="zp-version-heading"><strong>{step === 2 ? '场景演示版本' : '演示版本'}</strong><button onClick={() => setModal('history')}>全部版本 · {versions.length} <ChevronRight size={13} /></button></div><div className="zp-version-items">{visibleVersions.map(item => <button key={item.id} aria-label={`切换演示 v${String(item.id).padStart(2, '0')} ${item.label}`} aria-pressed={version.id === item.id} onClick={() => chooseVersion(versions.indexOf(item))}>{renderVersionThumb(item)}<span><strong>v{String(item.id).padStart(2, '0')}</strong><small>{item.label}</small></span>{version.id === item.id && <Check size={13} />}</button>)}</div></div>}
          </section>
          <aside className="zp-assistant" aria-label="AI 对话设计预览"><header><MessageSquareText size={19} /><h2>AI 制作搭档</h2><span>本地演示</span></header>
            <div className="zp-chat-scroll" ref={chat}><div className="zp-chat-intro" key={`${world.id}-${step}`}><div className="zp-chat-author"><StudioMark small /><strong>造境</strong></div><p>{stepDetails[step][2]}</p></div>{project.messages.filter(item => item.stage === step).map((item, index) => <div className="zp-message-pair" key={`${step}-${index}`}><div className="zp-user-message">{item.request}</div><p className={item.applied ? 'zp-applied-message' : ''}>{item.applied && <Check size={14} />}{item.reply}</p></div>)}</div>
            <div className="zp-chat-controls">{suggestions[step].length > 0 && <div className="zp-suggestions" aria-label="点击立即应用演示修改">{suggestions[step].map(text => <button key={text} onClick={() => updateProject(previous => applyPreviewMessage(previous, text))}>{text}<ArrowUpRight size={13} /></button>)}</div>}
              {step !== 5 && <form className="zp-composer" onSubmit={send}><textarea ref={input} aria-label="输入演示修改意见" placeholder="试试上方示例；自由描述需连接 AI" value={draft} onChange={event => updateDraft(event.target.value)} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>仅更新本页演示</span><button type="submit" disabled={!draft.trim()}>发送修改 <ArrowRight size={15} /></button></div></form>}
              <div className="zp-confirm-row"><span>{step === 5 ? '实际导出在正式制作台完成' : project.confirmedThrough >= step ? '本步已在演示中确认' : '确认仅用于本页流程演示'}</span>{step !== 5 && <button onClick={() => updateProject(confirmPreviewStage)}>确认本步，继续 <ArrowRight size={15} /></button>}</div>
            </div>
          </aside>
        </div>
      </main>}
    {(notice || saveError) && <div className="zp-toast" role={saveError ? "alert" : "status"}>{saveError ? "浏览器保存不可用，更改暂存在此页；请先不要关闭。" : notice}</div>}
    <dialog ref={dialog} className={`zp-dialog ${modal === 'fullscreen' ? 'zp-dialog-wide' : ''}`} aria-labelledby="zp-dialog-title" onCancel={() => setModal(null)} onClose={() => setModal(null)} onClick={event => { if (event.target === event.currentTarget) setModal(null); }}>
      <header><h2 id="zp-dialog-title">{modal === 'create' ? '新建项目' : modal === 'manage' ? '管理项目' : modal === 'trash' ? '最近删除' : modal === 'history' ? `${steps[step]} · 演示版本` : modal === 'export' ? '导出说明' : modal === 'fullscreen' ? `${world.name} · 放大查看` : '关于此预览'}</h2><button aria-label="关闭面板" onClick={() => setModal(null)}><X size={20} /></button></header>
      {modal === 'create' && <form className="zp-project-form" onSubmit={createProject}>
        <label htmlFor="zp-new-name">项目名称</label><input id="zp-new-name" autoFocus required maxLength={40} value={newName} onChange={event => setNewName(event.target.value)} placeholder="给你的游戏起个名字" />
        <fieldset><legend>游戏类型</legend><div className="zp-create-genres">{worlds.map(item => <label key={item.id}><input type="radio" name="project-kind" value={item.id} checked={newKind === item.id} onChange={() => setNewKind(item.id)} /><Gamepad2 size={16} />{item.genre}</label>)}</div></fieldset>
        <label htmlFor="zp-new-idea">游戏想法 <span>选填</span></label><textarea id="zp-new-idea" rows={3} value={newIdea} onChange={event => setNewIdea(event.target.value)} placeholder="想让玩家在什么世界里，做什么事？" />
        <p>创建独立的本机预览项目，不会覆盖已有项目。</p><div className="zp-form-actions"><button type="button" onClick={() => setModal(null)}>取消</button><button className="zp-primary" type="submit" disabled={!newName.trim()}>创建项目 <Plus size={16} /></button></div>
      </form>}
      {modal === 'manage' && <form className="zp-project-form" onSubmit={event => { event.preventDefault(); if (!editId || !editName.trim()) return; setLibrary(previous => renamePreviewItem(previous, editId, editName)); setModal(null); setNotice('项目名称已更新。'); }}>
        <label htmlFor="zp-edit-name">项目名称</label><input id="zp-edit-name" autoFocus required maxLength={40} value={editName} onChange={event => setEditName(event.target.value)} />
        <div className="zp-form-actions"><button className="zp-delete-project" type="button" onClick={() => { if (!editId) return; setLibrary(previous => removePreviewItem(previous, editId)); setModal(null); setNotice('项目已移到最近删除，可随时恢复。'); }}><Trash2 size={16} />删除项目</button><button className="zp-primary" type="submit" disabled={!editName.trim()}>保存名称 <Check size={16} /></button></div><p>删除后可从「最近删除」恢复，步骤和版本会一起保留。</p>
      </form>}
      {modal === 'trash' && <div className="zp-trash-content"><p>删除的预览项目保留在这里，可以随时恢复。</p>{removedProjects.length === 0 ? <p>没有已删除的项目。</p> : removedProjects.map(item => <div key={item.id}><strong>{item.name}</strong><button onClick={() => { setLibrary(previous => restorePreviewItem(previous, item.id)); setNotice(`已恢复「${item.name}」。`); }} aria-label={`恢复 ${item.name}`}><Undo2 size={15} />恢复</button></div>)}</div>}
      {modal === 'history' && <div className="zp-history-content"><p>只有实际应用过的演示修改才会新增版本。选择后可以继续修改，原版本仍保留。</p>{versions.map((item, index) => <button className={versionIndex === index ? 'active' : ''} key={item.id} onClick={() => { chooseVersion(index); setModal(null); }}>{renderVersionThumb(item)}<div><strong>v{String(item.id).padStart(2, '0')} · {item.label}</strong><p>{showsScene || step === 1 ? `主角比例 ${Math.round(item.size * 100)}%` : item.note || '初始示例内容'}</p></div>{versionIndex === index && <Check size={18} />}</button>)}<small>仅切换本页演示，不恢复或覆盖真实项目。演示记录保存在当前浏览器，刷新后可继续。</small></div>}
      {modal === 'export' && <div className="zp-export-content"><p>这是交付方式预览，当前没有可下载的游戏文件。</p>{[{ icon: FolderOpen, name: 'Godot 工程', note: '继续编辑角色、场景与游戏逻辑', ext: '.godot' }, { icon: Globe2, name: '网页游戏', note: '在浏览器中打开与游玩', ext: 'HTML' }, { icon: FileArchive, name: '完整压缩包', note: '游戏文件与打开说明一起打包', ext: '.zip' }].map(({ icon: Icon, name, note, ext }) => <div className="zp-export-option" key={name}><Icon size={23} /><div><h3>{name}</h3><p>{note}</p></div><span>{ext}</span></div>)}<div className="zp-export-note"><LockKeyhole size={16} />在正式制作台确认完整游戏后，再执行真实导出。</div></div>}
      {modal === 'help' && <div className="zp-help-content"><p>这是「造境」的交互设计预览。示例项目从方向待确认开始，只有你点击确认，后面的步骤才会开放。</p><p>快捷建议会直接应用本地演示修改，形成可对比的版本；自由描述不会被假装成 AI 已完成。路线标记是只读参考，放大后可拖动画面。</p><p>预览不连接模型、不运行游戏、不修改真实项目。演示进度按项目隔离，保存在当前浏览器，刷新后仍可继续；不跨浏览器同步。真实试玩与导出请使用正式制作台。</p><button className="zp-primary" onClick={() => setModal(null)}>知道了 <ArrowRight size={16} /></button></div>}
      {modal === 'fullscreen' && <div className="zp-fullscreen-content">{step === 1 ? <img className="zp-full-character" src={world.character} alt="角色原图" /> : renderScene(true)}{showsScene && <div className="zp-fullscreen-controls"><button disabled={zoom <= 100} onClick={() => setZoom(value => value - 25)}><Minus size={15} />缩小</button><span>{zoom}% · 放大后可拖动</span><button disabled={zoom >= 200} onClick={() => setZoom(value => value + 25)}>放大<Plus size={15} /></button></div>}</div>}
    </dialog>
  </div>;
}
