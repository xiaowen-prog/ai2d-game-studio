import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, Expand, Maximize2, Minus, Plus, Send, Sparkles, X } from 'lucide-react';
import forest from '../../../docs/product/设计参考/spline-preview/assets/scene.png';
import character from '../../../docs/product/设计参考/spline-preview/assets/character-a.png';
import twilight from '../assets/noobi-packs/twilight/scene.png';
import starforge from '../assets/noobi-packs/starforge/scene.png';
import './design-preview.css';

const themes = [
  { id: 'field', number: '01', name: '战术指挥', english: 'FIELD OPERATIONS', location: '竹林遗迹', art: forest },
  { id: 'archive', number: '02', name: '秘境图鉴', english: 'THE WORLD ARCHIVE', location: '暮色工坊', art: twilight },
  { id: 'orbit', number: '03', name: '轨道造物', english: 'ORBITAL WORKSHOP', location: '星铸观测站', art: starforge },
] as const;

const stages = [
  { name: '方向', caption: '确定核心玩法', brief: '一局短节奏的冒险。穿过场地，收集碎片，抵达出口。', kind: 'brief', prompt: '把一局的时长控制在两分钟以内' },
  { name: '角色', caption: '角色与动作', brief: '用剪影和颜色区分角色。先确认移动、攻击和受击反馈。', kind: 'character', prompt: '让角色的攻击动作更干脆' },
  { name: '场景', caption: '搭建关卡空间', brief: '保留清晰的主要路线，在边缘安排可探索区域。', kind: 'scene', prompt: '把入口附近的障碍移远一点' },
  { name: '核心试玩', caption: '检查路线与手感', brief: '先看玩家能否一眼认出起点与出口，再调整中段的节奏。', kind: 'scene', prompt: '让中段的挑战简单一点' },
  { name: '完整游戏', caption: '串联开局与结局', brief: '把胜负、重开与关卡进度串成完整的一局。', kind: 'scene', prompt: '在结束时显示本局用时' },
  { name: '交付', caption: '确认并导出作品', brief: '对照当前确认版本，检查需要交付的工程和网页内容。', kind: 'brief', prompt: '列一下交付前要检查的项目' },
] as const;

export function DesignPreview({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(themes.find(item => item.id === initial) ?? themes[0]);
  const [view, setView] = useState<'home' | 'studio'>(new URLSearchParams(location.search).get('view') === 'studio' ? 'studio' : 'home');
  const [stageIndex, setStageIndex] = useState(3);
  const [zoom, setZoom] = useState(100);
  const [confirmed, setConfirmed] = useState([0, 1, 2]);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<{ stage: number; text: string }[]>([]);
  const [guides, setGuides] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const stage = stages[stageIndex];

  function selectStage(index: number) {
    setStageIndex(index);
    setZoom(100);
    setGuides(false);
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages(previous => [...previous, { stage: stageIndex, text: draft.trim() }]);
    setDraft('');
  }

  return (
    <div className={`design-preview design-${theme.id}`}>
      <header className="design-bar">
        <a href="/" className="design-wordmark"><span>◇</span> 造境</a>
        <nav aria-label="切换设计方案" className="design-variants">
          {themes.map(item => (
            <button key={item.id} type="button" aria-pressed={item.id === theme.id} onClick={() => setTheme(item)}>
              <small>{item.number}</small>{item.name}
            </button>
          ))}
        </nav>
        <button className="design-view-toggle" type="button" onClick={() => setView(view === 'home' ? 'studio' : 'home')}>
          {view === 'home' ? '项目制作台' : '返回首页'} {view === 'home' ? <ArrowUpRight size={16} /> : <ArrowLeft size={16} />}
        </button>
      </header>

      {view === 'home' ? (
        <main className="design-home">
          <section className="design-cover" key={theme.id}>
            <div className="design-cover-art"><img src={theme.art} alt="" /></div>
            <div className="design-cover-content">
              <p className="design-kicker"><span>{theme.number}</span> {theme.english}</p>
              <h1>把脑海里的世界，<br />做成<span>能玩的游戏。</span></h1>
              <p className="design-intro">从一个想法开始。设计角色、搭建关卡，再亲手玩一遍。</p>
              <button className="design-primary" type="button" onClick={() => setView('studio')}>进入示例制作台 <ArrowRight size={19} /></button>
            </div>
            <div className="design-cover-caption"><small>造境 / 示例世界 {theme.number}</small><strong>{theme.location}</strong></div>
          </section>
          <section className="design-home-footer" aria-label="制作流程">
            <span><ArrowDown size={16} /> 一款游戏，从这里开始</span>
            <ol><li>01 · 想法</li><li>02 · 角色与关卡</li><li>03 · 试玩与调整</li></ol>
            <span>交互设计预览</span>
          </section>
        </main>
      ) : (
        <main className="design-workspace">
          <div className="design-project-title">
            <div><p className="design-kicker">{theme.english} / 项目 01</p><h1>{theme.location}</h1></div>
            <span className="design-prototype-tag">交互设计预览</span>
          </div>
          <div className="design-workgrid">
            <nav className="design-steps" aria-label="制作步骤">
              {stages.map((item, index) => (
                <button key={item.name} type="button" aria-current={index === stageIndex ? 'step' : undefined} onClick={() => selectStage(index)}>
                  <span className="design-step-number">{confirmed.includes(index) ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span>
                  <span><strong>{item.name}</strong><small>{item.caption}</small></span>
                </button>
              ))}
            </nav>
            <section className="design-stage" aria-label="关卡与成果预览">
              <header><span>成果预览 <ChevronRight size={13} /> <strong>{stage.name}</strong></span><button type="button" title="放大预览" aria-label="放大预览" onClick={() => dialog.current?.showModal()}><Expand size={16} /></button></header>
              <div className="design-canvas">
                <div className="design-canvas-visual" key={`${theme.id}-${stageIndex}`} data-kind={stage.kind}>
                  {stage.kind === 'brief' ? <div className="design-brief"><span>{String(stageIndex + 1).padStart(2, '0')} / {stage.name}</span><h2>{stage.caption}</h2><p>{stage.brief}</p></div>
                    : <img src={stage.kind === 'character' ? character : theme.art} alt={stage.kind === 'character' ? '示例角色' : `${theme.location}示例场景`} style={{ transform: `scale(${zoom / 100})` }} />}
                  {guides && stage.kind === 'scene' ? <div className="design-guides"><span>01 入口</span><span>02 交战区</span><span>03 出口</span></div> : null}
                </div>
              </div>
              <footer>
                <span className="design-canvas-note">{stage.caption}</span>
                {stage.kind === 'scene' ? <button type="button" aria-pressed={guides} onClick={() => setGuides(!guides)}>路线标记</button> : null}
                {stage.kind !== 'brief' ? <div className="design-zoom">
                  <button type="button" aria-label="缩小" disabled={zoom <= 80} onClick={() => setZoom(zoom - 20)}><Minus size={14} /></button>
                  <button type="button" aria-label="恢复原尺寸" onClick={() => setZoom(100)}>{zoom}%</button>
                  <button type="button" aria-label="放大" disabled={zoom >= 160} onClick={() => setZoom(zoom + 20)}><Plus size={14} /></button>
                </div> : null}
              </footer>
            </section>
            <aside className="design-assistant" aria-label="AI 对话">
              <header><span className="design-ai-icon"><Sparkles size={17} /></span><div><strong>AI 制作搭档</strong><small>当前在看 · {stage.name}</small></div></header>
              <div className="design-chat" aria-live="polite">
                <p className="design-chat-note">{stage.brief}</p>
                {messages.filter(item => item.stage === stageIndex).map((item, index) => <div key={index} className="design-exchange"><p>{item.text}</p><small>已记下这条调整意见 · 交互演示</small></div>)}
                <button className="design-suggestion" type="button" onClick={() => { setDraft(stage.prompt); composer.current?.focus(); }}>{stage.prompt} <ArrowUpRight size={13} /></button>
              </div>
              <form className="design-composer" onSubmit={send}>
                <input ref={composer} aria-label="输入调整意见" placeholder="说说你想改哪里…" value={draft} onChange={event => setDraft(event.target.value)} />
                <button type="submit" aria-label="发送演示消息" disabled={!draft.trim()}><Send size={17} /></button>
              </form>
              <button className="design-primary design-confirm" type="button" onClick={() => {
                setConfirmed(previous => previous.includes(stageIndex) ? previous : [...previous, stageIndex]);
                if (stageIndex < stages.length - 1) selectStage(stageIndex + 1);
              }}>{stageIndex === 5 ? confirmed.includes(5) ? '已确认示例' : '确认示例' : '确认并前往下一步'} <ArrowRight size={16} /></button>
            </aside>
          </div>
        </main>
      )}
      <dialog ref={dialog} className="design-lightbox" aria-labelledby="design-lightbox-title">
        <header><span id="design-lightbox-title"><Maximize2 size={16} /> {theme.location} / {stage.name}</span><button type="button" aria-label="关闭放大预览" onClick={() => dialog.current?.close()}><X size={20} /></button></header>
        {stage.kind === 'brief' ? <div className="design-brief"><h2>{stage.caption}</h2><p>{stage.brief}</p></div> : <img src={stage.kind === 'character' ? character : theme.art} alt="放大的示例成果" />}
      </dialog>
    </div>
  );
}
