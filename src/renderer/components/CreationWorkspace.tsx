import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, History, LoaderCircle, RotateCcw, Sparkles, Square } from 'lucide-react';
import type { ProjectRecord } from '../../shared/contracts';
import {
  CREATION_STAGES, CREATION_LAST_ENABLED_STAGE, creationStageLimit, isCreationStageEnabled, affectedStages, type CreationAction, type CreationPreview,
  type AppearanceTarget, type CreationStage, type CreationWorkflow,
} from '../../shared/creation';
import { Modal } from './Modal';
import './creation.css';
import { isSendKey } from '../sendKey';

const STATUS = { idle: '未开始', running: '制作中', 'awaiting-confirmation': '待确认', confirmed: '已确认',
  'needs-update': '需要更新', failed: '制作失败', stopped: '已停止' } as const;
interface Props { project: ProjectRecord; workflow: CreationWorkflow; onChanged: (value: CreationWorkflow) => void; onSettings: () => void; lastEnabledStage?: CreationStage }
export function CreationWorkspace({ project, workflow, onChanged, onSettings, lastEnabledStage: requestedLastEnabledStage = CREATION_LAST_ENABLED_STAGE }: Props) {
  const lastEnabledStage = creationStageLimit(workflow.steps.direction.artifact?.direction?.genre, requestedLastEnabledStage);
  const [view, setView] = useState<CreationStage>(workflow.currentStage);
  const draftKey = `creation-stage-drafts:${project.id}`;
  const [drafts, setDrafts] = useState<Partial<Record<CreationStage, string>>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        return Object.fromEntries(CREATION_STAGES.map(({ id }) => [id,
          typeof (saved as Record<string, unknown>)[id] === 'string' ? (saved as Record<string, string>)[id] : '']));
      }
      return { [workflow.currentStage]: localStorage.getItem(`creation-draft:${project.id}`) ?? '' };
    } catch { return {}; }
  });
  const draft = drafts[view] ?? '';
  const setDraft = (value: string) => setDrafts(current => ({ ...current, [view]: value }));
  const [previewResult, setPreviewResult] = useState<{ versionId: string; value: CreationPreview } | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [pending, setPending] = useState(false);
  const [impact, setImpact] = useState<Partial<CreationAction> | null>(null);
  const [checkpointId, setCheckpointId] = useState('');
  const [editTarget, setEditTarget] = useState<'gameplay' | AppearanceTarget>('gameplay');
  const guard = useRef(false);
  const priorStage = useRef(workflow.currentStage);
  const step = workflow.steps[view];
  const artifact = step.artifact;
  const preview = previewResult?.versionId === artifact?.id ? previewResult?.value ?? null : null;
  const busy = workflow.task?.state === 'running';
  const isCurrent = view === workflow.currentStage;
  const atReleaseBoundary = view === lastEnabledStage;
  const confirmKeepsStage = atReleaseBoundary || view === 'playable' || view === 'game';
  const isTopdown = workflow.steps.direction.artifact?.direction?.genre === 'topdown';
  const candidateOnly = view === 'character' && artifact?.characterPhase === 'candidates';
  const actionsMode = view === 'character' && (artifact?.characterPhase === 'actions' || (isCurrent && workflow.task?.characterPhase === 'actions'));
  const needsSelection = view === 'character' && Boolean(artifact) && !artifact?.selectedCharacterId;
  const linkedPending = workflow.steps.game.status === 'awaiting-confirmation' && Boolean(workflow.steps.game.artifact?.appearanceChange);
  const canEditAppearance = isCurrent && view === 'game' && step.status === 'confirmed' && Boolean(artifact?.round);
  const restorePoint = workflow.history.find(point => point.id === impact?.checkpointId);
  const returnPoint = workflow.task?.sourceCheckpointId ?? artifact?.appearanceChange?.checkpointId;
  const retryAppearance = isCurrent && ['failed', 'stopped'].includes(step.status) ? workflow.task?.appearanceTarget : undefined;
  const appearanceTarget = canEditAppearance ? editTarget : retryAppearance;
  const gameStep = workflow.steps.game;
  const canExport = isCreationStageEnabled('delivery', lastEnabledStage) && gameStep.status === 'confirmed' && Boolean(gameStep.artifact?.round);
  const deliveryLauncher = typeof navigator !== 'undefined' && /Win/u.test(navigator.platform)
    ? '打开网页游戏.cmd'
    : '打开网页游戏.command';
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify(drafts)); localStorage.removeItem(`creation-draft:${project.id}`); } catch { /* Current text remains editable if local storage is unavailable. */ } }, [draftKey, drafts, project.id]);
  useEffect(() => {
    if (priorStage.current !== workflow.currentStage) {
      setView(workflow.currentStage); priorStage.current = workflow.currentStage;
    }
  }, [workflow.currentStage]);
  useEffect(() => {
    if (checkpointId && !workflow.history.some((item) => item.id === checkpointId)) setCheckpointId('');
  }, [checkpointId, workflow.history]);
  useEffect(() => {
    let active = true;
    setPreviewResult(null); setPreviewError('');
    if (artifact) void window.noobi.creation.preview(project.id, artifact.id).then((reply) => {
      if (!active) return;
      if (reply.ok) setPreviewResult({ versionId: artifact.id, value: reply.value }); else setPreviewError(reply.error.message);
    }).catch(() => { if (active) setPreviewError('预览加载失败。可以重新读取，已有成果不会改变。'); });
    return () => { active = false; };
  }, [project.id, artifact?.id, previewRetry]);
  async function act(action: Partial<CreationAction> & Pick<CreationAction, 'action'>): Promise<boolean> {
    if (guard.current) return false;
    guard.current = true; setPending(true); setError(''); setErrorCode('');
    try {
      const reply = await window.noobi.creation.act({ projectId: project.id, operationId: crypto.randomUUID(),
        expectedRevision: workflow.revision, ...action });
      if (!reply.ok) { setError(reply.error.message); setErrorCode(reply.error.code); return false; }
      onChanged(reply.value); return true;
    } catch { setError('操作未完成，草稿已保留。请重新打开项目查看最新状态后再试。'); return false; }
    finally { guard.current = false; setPending(false); }
  }
  async function submit() {
    if (!draft.trim() || busy || pending) return;
    if (linkedPending) { setError('请先确认整套外观修改，或恢复修改前版本。'); return; }
    if (needsSelection) { setError('请先选一个人物，再告诉 AI 要改哪里。'); return; }
    if (canEditAppearance && editTarget !== 'gameplay') {
      setImpact({ action: 'revise-appearance', appearanceTarget: editTarget, versionId: artifact!.id, prompt: draft.trim(), expectedRevision: workflow.revision }); return;
    }
    if (!isCurrent || step.confirmedVersionId) {
      setImpact({ action: 'revise', stage: view, prompt: draft.trim(), expectedRevision: workflow.revision }); return;
    }
    if (await act({ action: 'run', prompt: draft.trim(), versionId: artifact?.id })) setDraft('');
  }
  async function revealDelivery() {
    if (!artifact || pending) return;
    setPending(true); setError('');
    try {
      const reply = await window.noobi.creation.revealDelivery(project.id, artifact.id);
      if (!reply.ok) { setError(reply.error.message); setErrorCode(reply.error.code); }
    } catch { setError('文件夹未能打开，请按交付路径查找或重新导出。'); }
    finally { setPending(false); }
  }
  const title = actionsMode ? '人物动作' : CREATION_STAGES.find((stage) => stage.id === view)!.label;
  return <div className="creation-workspace" data-testid="creation-workspace">
    <nav className="creation-navigation" aria-label="游戏创作阶段">
      <ol className="creation-steps" aria-label="游戏制作进度">
        {CREATION_STAGES.filter(({ id }) => isCreationStageEnabled(id, lastEnabledStage)).map(({ id, label }, index) => <li key={id}>
          <button type="button" className={view === id ? 'is-selected' : ''} aria-current={view === id ? 'step' : undefined}
            disabled={!workflow.steps[id].artifact && id !== workflow.currentStage}
            onClick={() => { setView(id); setImpact(null); setError(''); setErrorCode(''); }}>
            <span className="creation-step-number">{workflow.steps[id].confirmedVersionId ? <Check size={16} /> : index + 1}</span>
            <span><strong>{label}</strong><small>{STATUS[workflow.steps[id].status]}</small></span>
          </button>
        </li>)}
      </ol>
    </nav>
    <div className="creation-layout">
      <section className="creation-main" aria-label={`${title}成果`}>
      <header className="creation-heading"><div><p className="creation-eyebrow">{workflow.completed ? '你的游戏已完成' : `当前查看 · ${title}`}</p>
        <h1>{artifact?.title ?? `一起确定${title}`}</h1></div>
        <span className={`creation-status status-${step.status}`}>{STATUS[step.status]}</span>
      </header>
        <div className="creation-canvas">
          {step.status === 'needs-update' ? <p className="creation-canvas-note">保留的旧版 · 等待重新制作</p> : busy && artifact ? <p className="creation-canvas-note">正在制作新版 · 这里保留上一版成果</p> : null}
        {!artifact ? <div className="creation-empty"><span>✦</span><h2>{busy ? view === 'delivery' ? '正在准备交付包' : `AI 正在制作${title}` : step.status === 'failed' ? `${title}制作失败` : step.status === 'stopped' ? `${title}制作已停止` : `${title}还没有开始`}</h2>
          <p>{view === 'delivery' ? '把确认的 Godot 工程和网页游戏打包，附上打开说明。导出不修改游戏，也不调用 AI。' : view === 'game' ? isTopdown ? 'AI 把原来的练习场做成三波战斗：清完前两波各选一次升级，第三波清完获胜，生命归零失败。人物、背景和剑气沿用原版，完成后等你确认。' : 'AI 在你确认的横版试玩上补齐一小局：限时收集、到达终点、胜负、暂停、重来和音效。人物、背景和跳跃规则沿用原版，完成后等你确认。' : view === 'playable' ? 'AI 使用已确认人物和场景制作核心试玩。完成后可以试玩，再用一句话增加或修改玩法。' : view === 'direction' ? '先把你的想法整理成一张短卡片。确认方向之前，不生成图片或游戏。' : view === 'scene' ? 'AI 根据已确认方向制作场景，并放入原人物和动作。完成后你可以看画面、改背景、确认保存。' : '按已确认的方向生成两个基础人物。选好并确认后，可以制作这个人物的基础动作。'}</p>
</div> : null}
          {artifact ? <>
            {!preview && !previewError ? <p className="creation-loading" role="status"><LoaderCircle size={16} /> 正在读取已保存的成果…</p> : null}
            {previewError ? <div className="creation-error" role="alert"><p>{previewError}</p><button type="button" onClick={() => setPreviewRetry(value => value + 1)}>重新读取预览</button></div> : null}
          {preview?.playableUrl ? <div className="creation-playable"><p>{view === 'character' ? '当前人物的真实动作预览' : view === 'scene' ? '人物与场景预览' : '点击画面后操作 · 具体按键见下方'}</p>
            <iframe src={preview.playableUrl} title={`${title}真实预览`} sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="autoplay; fullscreen" />
          </div> : null}
          {artifact.direction ? <div className="creation-direction">
            <div className="creation-genre">{artifact.direction.genre === 'topdown' ? '2D 俯视打怪' : '2D 横版闯关'}<span>{artifact.direction.theme}</span></div>
            <dl><div><dt>怎么玩</dt><dd>{artifact.direction.controls}</dd></div><div><dt>游戏目标</dt><dd>{artifact.direction.goal}</dd></div>
              <div><dt>画面风格</dt><dd>{artifact.direction.style}</dd></div><div><dt>这次做多少</dt><dd><ul>{artifact.direction.scope.map((item) => <li key={item}>{item}</li>)}</ul></dd></div></dl>
            <p className="creation-footnote">喜欢这个方向就确认；想调整，在创作搭档里告诉 AI。</p>
          </div> : null}
          {artifact.candidates.length ? <div className={`creation-candidates${actionsMode ? ' is-action-reference' : ''}`}>{artifact.candidates.filter(candidate => !actionsMode || candidate.id === artifact.selectedCharacterId).map((candidate) => <article key={candidate.id} className={artifact.selectedCharacterId === candidate.id ? 'is-picked' : ''}>
            {preview?.images.find((image) => image.path === candidate.image) ? <img src={preview.images.find((image) => image.path === candidate.image)!.url} alt={candidate.name} onError={() => setPreviewError('人物图片无法显示，请恢复以前的版本或重试，不能确认当前图片。')} /> : <div className="creation-image-loading">正在读取人物图片</div>}
            <strong>{actionsMode ? '原人物 · ' : ''}{candidate.name}</strong>
            {candidate.description ? <p>{candidate.description}</p> : null}
            {view === 'character' && isCurrent && !actionsMode ? <button type="button" aria-pressed={artifact.selectedCharacterId === candidate.id}
              disabled={busy || pending || !preview || Boolean(previewError) || artifact.selectedCharacterId === candidate.id || ['failed', 'stopped', 'needs-update'].includes(step.status)}
              onClick={() => {
                const choice = { action: 'select' as const, versionId: artifact.id, candidateId: candidate.id };
                if (step.confirmedVersionId) setImpact({ ...choice, expectedRevision: workflow.revision }); else void act(choice);
              }}>{artifact.selectedCharacterId === candidate.id ? '已选中' : '选这个人物'}</button> : null}
          </article>)}</div> : null}
          {view === 'character' && artifact.candidates.length && !actionsMode ? <p className="creation-footnote">{needsSelection ? '先选一个人物，再修改或确认。选择不会生成新图。' : '输入修改只针对选中的人物；另一个候选保留。确认只保存基础形象。'}</p> : null}
          {view === 'scene' ? <p className="creation-footnote">当前检查场景画面和人物比例；原人物动作可以操作，完整关卡尚未制作。</p> : null}
          {artifact.playable ? <p className="creation-footnote">{artifact.playable.genre === 'topdown' ? `${artifact.playable.maxBounces === 1 ? '剑气最多反弹一次，第二次碰墙消失。' : '当前剑气碰墙消失，可以告诉 AI 增加一次反弹。'} WASD 移动，J 朝最近移动方向攻击，R 重来。` : `${artifact.playable.maxJumps === 2 ? '支持二段跳，落地后恢复；空中不能无限跳。' : '当前是单次跳跃，可以告诉 AI 增加二段跳。'} A/D 移动，空格跳跃，R 重来。`}{isCreationStageEnabled('game', lastEnabledStage) ? '确认保存后，可以继续制作完整小局。' : '完整小局尚未开放。'}</p> : null}
          {artifact.round ? <p className="creation-footnote">{artifact.round.genre === 'topdown' ? `三波敌人分别为 ${artifact.round.waveCounts.join('、')} 个，初始生命 ${artifact.round.playerHealth}。清完前两波各选一次升级，第三波清完获胜；生命归零失败。Enter 开始，WASD 移动，J 攻击，1/2/3 选升级，Esc 暂停或继续，R 重来。` : `本局限时 ${artifact.round.timeLimitSeconds} 秒：收齐物品并到达终点获胜，超时失败。Enter 开始，A/D 移动，空格跳跃，Esc 暂停或继续，R 重来。`}游戏内可静音和调整音量。效果由你试玩确认。</p> : null}
          {artifact.actions ? <div className="creation-action-controls" aria-label="动作操作说明">{artifact.actions.states.map(state => <span key={state.id}><strong>{state.label}</strong> {state.key}</span>)}</div> : null}
          {actionsMode && !busy && isCurrent ? <button type="button" className="creation-return-character" onClick={() => setImpact({ action: 'edit-character', versionId: artifact.id, expectedRevision: workflow.revision })}>返回修改人物形象</button> : null}
          {preview?.images.filter((image) => !artifact.candidates.some((candidate) => candidate.image === image.path)).map((image) => <details className="creation-image-details" key={image.path}><summary>{image.label}（查看素材）</summary><figure className="creation-image"><img src={image.url} alt={image.label} /><figcaption>{image.label}</figcaption></figure></details>)}
          {artifact.delivery ? <div className="creation-export"><strong>工程、网页与 ZIP 交付包</strong>
            <p>来源游戏版本：{artifact.delivery.sourceVersionId.slice(0, 8)} · {artifact.delivery.fileCount} 个文件<br />导出时间：{new Date(artifact.createdAt).toLocaleString()}</p>
            {preview?.exportDirectory ? <p>{preview.exportDirectory}</p> : null}
            <button type="button" disabled={pending || !preview?.exportDirectory} onClick={() => void revealDelivery()}>{location.protocol === 'file:' || import.meta.env.DEV ? '打开交付文件夹' : '下载交付 ZIP'}</button>
            <small>此页预览使用导出包中的网页文件。文件夹内双击“{deliveryLauncher}”运行，需要 Python 3。工程用 Godot 4 打开。尚未托管为公网链接。</small></div> : null}
          </> : null}
        </div>
      <footer className="creation-canvas-footer"><span>每一步，由你确认</span><button type="button" disabled={!workflow.history.length || busy || pending} title={workflow.history.length ? '打开版本记录' : '完成第一步后可恢复'} aria-label={workflow.history.length ? `打开版本记录，共 ${workflow.history.length} 个版本` : '暂无可恢复版本，完成第一步后可恢复'} onClick={() => { setCheckpointId(''); setHistoryOpen(true); }}><History size={14} /> {workflow.history.length ? `已保存版本 · ${workflow.history.length}` : '暂无可恢复版本'}</button></footer>
      </section>
      <aside className="creation-assistant" aria-label="AI 创作搭档">
        <header className="creation-assistant-heading"><span className="creation-assistant-mark"><Sparkles size={18} /></span><div><h2>创作搭档</h2><p>{busy ? '正在制作，完成后等你确认' : '说出想法，一起做成游戏'}</p></div></header>
        <div className="creation-conversation">
          {artifact?.summary ? <div className="creation-assistant-message"><span>当前成果</span><p className="creation-summary">{artifact.summary}</p></div> : null}
          {!isCurrent ? <div className="creation-notice">你正在查看之前的{title}。修改前会说明对后续内容的影响。<button type="button" onClick={() => setView(workflow.currentStage)}>回到当前进度</button></div> : null}
        {retryAppearance ? <div className="creation-notice" role="status">上次是只改{retryAppearance === 'character' ? '人物外观' : '背景'}，重试仍沿用这个范围；旧游戏仍保留。要改其他内容，可先恢复修改前整套版本。</div> : null}
        {step.status === 'needs-update' ? <div className="creation-notice" role="status">前面的内容已修改。下面是保留的旧版，尚未与新内容同步，不能直接确认为最新成果。</div> : null}
        {linkedPending ? <div className="creation-action-start" role="status"><p>外观修改已同步到关联阶段，整套仍待你确认。查看修改前后图片和游戏，确认后一起保存。</p>
          {view !== 'game' ? <button type="button" onClick={() => setView('game')}>回到完整游戏确认</button> : null}</div> : null}
        {view === 'game' && returnPoint && !busy ? <button type="button" disabled={pending} onClick={() => setImpact({ action: 'restore', checkpointId: returnPoint, expectedRevision: workflow.revision })}>恢复外观修改前整套版本</button> : null}
        {step.status === 'confirmed' && atReleaseBoundary ? <div className="creation-notice" role="status">{view === 'delivery' ? '交付包已由你确认并保存，可返回完整游戏继续修改，旧包会保留。' : view === 'game' ? '完整小局已确认并保存。' : view === 'character' ? actionsMode ? '人物动作已确认并保存。本版停在这里，场景尚未开放。' : '基础人物已确认并保存，可以开始制作人物动作。' : view === 'playable' ? '核心试玩已确认并保存，本次停在这里。' : view === 'scene' ? '场景已确认并保存。本版停在这里，核心试玩尚未开放。' : '方向已确认并保存。'}你可以继续修改，或恢复以前的版本。</div> : null}
        {view === 'game' && canExport && !busy ? <div className="creation-action-start"><p>完整游戏已确认。导出工程与网页游戏，直接使用这一版，不再调用 AI。每次导出另存，旧包保留。</p>
          <button type="button" className="creation-primary" disabled={pending} onClick={() => void act({ action: 'export', versionId: gameStep.artifact!.id })}>导出工程与网页游戏</button>
          {!isCurrent && workflow.currentStage === 'delivery' ? <button type="button" disabled={pending} onClick={() => void act({ action: 'return-game', versionId: gameStep.artifact!.id })}>返回完整游戏继续修改</button> : null}</div> : null}
        {view === 'playable' && isCurrent && step.status === 'confirmed' && artifact && isCreationStageEnabled('game', lastEnabledStage) && !busy ? <div className="creation-action-start"><p>{isTopdown ? '试玩已保存。下一步由 AI 沿用人物、场地和剑气，做成三波训练战斗，加入升级、胜负、暂停、重来和音效。' : '试玩已保存。下一步由 AI 沿用人物、地图和跳跃玩法，补上开始、进度、胜负、暂停、重来和音效。'}</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'continue', versionId: artifact.id })}>制作完整小局</button></div> : null}
        {view === 'character' && isCurrent && step.status === 'confirmed' && artifact?.characterPhase === 'candidates' && !busy ? <div className="creation-action-start"><p>下一步：让选中的人物移动、{workflow.steps.direction.artifact?.direction?.genre === 'platformer' ? '跳跃' : '攻击'}，预览后再确认。</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'animate', versionId: artifact.id })}>制作人物动作</button></div> : null}
        {view === 'scene' && isCurrent && step.status === 'confirmed' && artifact && isCreationStageEnabled('playable', lastEnabledStage) && !busy ? <div className="creation-action-start"><p>人物和场景已保存。{workflow.steps.direction.artifact?.direction?.genre === 'topdown' ? '下一步让 AI 制作能移动、攻击和击中目标的小样。' : '下一步让 AI 制作能跑跳、收集、越过障碍和到达目标的小样。'}</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'continue', versionId: artifact.id })}>开始核心试玩</button></div> : null}
        {view === 'character' && isCurrent && step.status === 'confirmed' && artifact?.characterPhase === 'actions' && isCreationStageEnabled('scene', lastEnabledStage) && !busy ? <div className="creation-action-start"><p>人物和动作已保存。下一步由 AI 制作场景，把原人物放进去预览。</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'continue', versionId: artifact.id })}>开始制作场景</button></div> : null}
        {busy && isCurrent ? <div className="creation-notice" role="status">{view === 'delivery' ? '正在复制确认版本、核对文件并准备压缩包；没有调用 AI，完成后等你验收。' : `正在制作${title}，完成后会停下来等你确认。`}已有成果仍保留。
          <button type="button" disabled={pending} onClick={() => void act({ action: 'stop' })}><Square size={12} /> 停止制作</button></div> : null}
        {workflow.error || error ? <div className="creation-error" role="alert">{error || workflow.error?.message}
          {['ACCOUNT_REQUIRED', 'IMAGE_REQUIRED', 'IMAGE_EDIT_REQUIRED', 'GODOT_REQUIRED'].includes(error ? errorCode : workflow.error?.code ?? '')
            ? <button type="button" onClick={onSettings}>查看账户与环境设置</button> : null}</div> : null}
{!artifact ? <div className="creation-start">          {isCurrent && !busy ? <button type="button" className="creation-primary" disabled={pending}
            onClick={() => void act({ action: 'run' })}>{step.status === 'failed' || step.status === 'stopped' ? '重试当前阶段' : `开始${title}`}</button> : null}</div> : null}
          {artifact ? <>
          {artifact.changes.length ? <details className="creation-changes"><summary>这次改了什么</summary><ul>{artifact.changes.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
          {isCurrent && !busy && artifact.ready && step.status === 'awaiting-confirmation' ? <div className="creation-approval">
            <span>{view === 'delivery' ? '请先打开工程和网页游戏核对；确认后标记交付完成。' : linkedPending ? '人物、场景和游戏中受影响的版本将一起确认；方向和玩法保持。' : candidateOnly ? '确认只保存基础人物，再由你开始制作动作。' : confirmKeepsStage ? `确认后保存这一版${view === 'character' ? (actionsMode ? '人物动作' : '基础人物') : title}，停在这里。` : `确认这一版后，${CREATION_STAGES.find((item) => item.id === view)!.next}。`}</span>
            <button type="button" className="creation-primary" disabled={pending || needsSelection || Boolean(previewError) || !preview}
              onClick={() => void act({ action: 'confirm', versionId: artifact.id })}>{view === 'delivery' ? '我已验收，确认交付' : linkedPending ? '确认整套外观修改并保存' : candidateOnly ? '确认基础人物并保存' : actionsMode && !atReleaseBoundary ? '确认人物动作，制作场景' : confirmKeepsStage ? `确认${view === 'character' ? (actionsMode ? '人物动作' : '基础人物') : title}并保存` : `确认${title}，继续`}<ChevronRight size={16} /></button>
          </div> : null}
          {isCurrent && !busy && ['failed', 'stopped'].includes(step.status) ? <button type="button" disabled={pending} onClick={() => void act({ action: 'run' })}>重试本阶段，保留上一版成果</button> : null}
          </> : null}
        </div>
      {view === 'delivery' ? <footer className="creation-composer"><p>交付只打包已确认的游戏。想改内容，请返回完整游戏；原交付包会保留。</p><div>
        <button type="button" disabled={busy || pending || gameStep.status !== 'confirmed'} onClick={() => workflow.currentStage === 'delivery' ? void act({ action: 'return-game', versionId: gameStep.artifact?.id }) : setView('game')}>返回完整游戏</button>
        <button type="button" disabled={busy || pending || !canExport} onClick={() => void act({ action: 'export', versionId: gameStep.artifact?.id })}>重新导出一份</button>
      </div></footer> : <footer className="creation-composer">
        {canEditAppearance ? <div className="creation-edit-target"><label htmlFor="creation-edit-target">这次改什么</label><select id="creation-edit-target" value={editTarget} disabled={busy || pending}
          onChange={event => setEditTarget(event.target.value as 'gameplay' | AppearanceTarget)}><option value="gameplay">玩法与难度</option><option value="character">只改人物外观，保留玩法</option><option value="scene">只改背景，保留玩法</option></select></div> : null}
        <label htmlFor="creation-request">{step.confirmedVersionId || !isCurrent ? `返回修改${title}` : '想改哪里，直接告诉 AI'}</label>
        <textarea id="creation-request" value={draft} disabled={busy || pending || linkedPending} maxLength={20_000} rows={3}
          placeholder={appearanceTarget === 'character' ? '例如：只把衣服改成白色，发型、武器、动作和玩法保持不变' : appearanceTarget === 'scene' ? '例如：背景改成雪山，保留原视角、人物和玩法' : view === 'game' ? isTopdown ? '例如：降低难度，每波改成3、4、5个敌人，人物和剑气规则保持不变' : '例如：把倒计时改成120秒，人物、地图和跳跃规则保持不变' : view === 'playable' ? isTopdown ? '例如：剑气碰墙反弹一次，人物、背景和其他规则保持不变' : '例如：加入落地恢复的二段跳，保留人物、场景和其他规则' : view === 'scene' ? '例如：竹林改成雪山，人物和动作保持不变' : view === 'direction' ? '例如：改成手动攻击，人物是一位白衣剑客' : needsSelection ? '先选一个人物，再输入修改要求' : actionsMode ? '例如：走路慢一点；保持人物外观不变' : '例如：衣服改白，保留发型和武器'}
          onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (isSendKey(event)) {
              event.preventDefault(); if (!event.repeat) void submit();
            }
          }} />
        <div><small>Enter 发送 · Shift + Enter 换行</small><button type="button" disabled={!draft.trim() || busy || pending || needsSelection || linkedPending} onClick={() => void submit()}>发送修改</button></div>
      </footer>}
      </aside>
    </div>
    {historyOpen ? <Modal eyebrow="版本记录" title="恢复已保存的成果" className="creation-dialog" onClose={() => { setHistoryOpen(false); setCheckpointId(''); }} description="恢复前会再次说明影响，较新的版本仍会保留。">
      <div className="creation-history">
        <label htmlFor="creation-history">已保存版本</label>
        <select id="creation-history" value={checkpointId} disabled={busy || pending} onChange={(event) => setCheckpointId(event.target.value)}>
          <option value="">选择要恢复的版本</option>
          {[...workflow.history].reverse().filter((item) => isCreationStageEnabled(item.stage, lastEnabledStage)).map((item) => <option key={item.id} value={item.id}>{item.label} · {new Date(item.createdAt).toLocaleString()}</option>)}
        </select>
        <button type="button" disabled={!checkpointId || busy || pending}
          onClick={() => { setHistoryOpen(false); setCheckpointId(''); setImpact({ action: 'restore', checkpointId, expectedRevision: workflow.revision }); }}><RotateCcw size={14} /> 恢复这个版本</button>
      </div>
    </Modal> : null}
      {impact ? <Modal eyebrow="修改影响" className="creation-dialog" title={impact.action === 'restore' ? '恢复整套已保存成果' : impact.action === 'revise-appearance' ? '只修改外观，保留玩法' : impact.action === 'edit-character' ? '返回修改人物形象' : impact.action === 'select' ? '更换已确认人物' : `修改已确认的${title}`} onClose={pending ? undefined : () => setImpact(null)}
        footer={<><button type="button" disabled={pending} onClick={() => setImpact(null)}>取消</button><button type="button" className="primary-button" disabled={pending || busy}
          onClick={async () => { if (await act({ ...impact, action: impact.action!, impactAccepted: true })) { setImpact(null); setDraft(''); } }}>确认影响，继续</button></>}>
        <p>{impact.action === 'restore' ? `将恢复“${restorePoint?.label ?? '所选版本'}”。人物、场景、玩法和确认状态一起切换；较新的版本仍保留，不调用 AI。`
          : impact.action === 'revise-appearance' ? `${impact.appearanceTarget === 'character' ? 'AI 将修改人物原图和动作图集，同步到场景、试玩与完整游戏，预计编辑两张图片。' : 'AI 将修改一张背景图，同步到试玩与完整游戏，人物保持。'}玩法、碰撞、动作速度和音效保持原文件。完成后整套待你确认，修改前版本可恢复。`
          : impact.action === 'edit-character' ? '返回后可修改衣服、发型或更换人物；需要重新确认基础人物并制作动作。当前人物与动作版本仍可恢复，不会立即调用 AI。'
          : impact.action === 'select' ? '只更换选择，不生成图片。新的选择需要重新确认，原版本可以恢复。'
          : atReleaseBoundary ? `AI 会根据你的要求修改，新的${title}需要重新确认。当前已确认版本仍可恢复。`
          : `需要重新检查或确认：${affectedStages(impact.stage ?? view).filter(id => isCreationStageEnabled(id, lastEnabledStage)).map((id) => CREATION_STAGES.find((item) => item.id === id)!.label).join('、')}。上一版可以恢复。`}</p>

        {error ? <p className="creation-error" role="alert">{error}</p> : null}
      </Modal> : null}
  </div>;
}
