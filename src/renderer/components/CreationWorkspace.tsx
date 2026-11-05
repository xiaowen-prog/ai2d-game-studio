import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, RotateCcw, Square } from 'lucide-react';
import type { ProjectRecord } from '../../shared/contracts';
import {
  CREATION_STAGES, CREATION_LAST_ENABLED_STAGE, creationStageLimit, isCreationStageEnabled, affectedStages, type CreationAction, type CreationPreview,
  type CreationStage, type CreationWorkflow,
} from '../../shared/creation';
import './creation.css';
import { isSendKey } from '../sendKey';

const STATUS = { idle: '未开始', running: '制作中', 'awaiting-confirmation': '待确认', confirmed: '已确认',
  'needs-update': '需要更新', failed: '制作失败', stopped: '已停止' } as const;
interface Props { project: ProjectRecord; workflow: CreationWorkflow; onChanged: (value: CreationWorkflow) => void; onSettings: () => void; lastEnabledStage?: CreationStage }
export function CreationWorkspace({ project, workflow, onChanged, onSettings, lastEnabledStage: requestedLastEnabledStage = CREATION_LAST_ENABLED_STAGE }: Props) {
  const lastEnabledStage = creationStageLimit(workflow.steps.direction.artifact?.direction?.genre, requestedLastEnabledStage);
  const [view, setView] = useState<CreationStage>(workflow.currentStage);
  const draftKey = `creation-draft:${project.id}`;
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(draftKey) ?? ''; } catch { return ''; } });
  const [preview, setPreview] = useState<CreationPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [pending, setPending] = useState(false);
  const [impact, setImpact] = useState<Partial<CreationAction> | null>(null);
  const [checkpointId, setCheckpointId] = useState('');
  const guard = useRef(false);
  const priorStage = useRef(workflow.currentStage);
  const step = workflow.steps[view];
  const artifact = step.artifact;
  const busy = workflow.task?.state === 'running';
  const isCurrent = view === workflow.currentStage;
  const atReleaseBoundary = view === lastEnabledStage;
  const candidateOnly = view === 'character' && artifact?.characterPhase === 'candidates';
  const actionsMode = view === 'character' && (artifact?.characterPhase === 'actions' || (isCurrent && workflow.task?.characterPhase === 'actions'));
  const needsSelection = view === 'character' && Boolean(artifact) && !artifact?.selectedCharacterId;
  useEffect(() => { try { localStorage.setItem(draftKey, draft); } catch { /* Current text remains editable if local storage is unavailable. */ } }, [draftKey, draft]);
  useEffect(() => {
    if (priorStage.current !== workflow.currentStage) {
      setView(workflow.currentStage); priorStage.current = workflow.currentStage;
    }
  }, [workflow.currentStage]);
  useEffect(() => {
    let active = true;
    setPreview(null); setPreviewError('');
    if (artifact) void window.noobi.creation.preview(project.id, artifact.id).then((reply) => {
      if (!active) return;
      if (reply.ok) setPreview(reply.value); else setPreviewError(reply.error.message);
    }).catch(() => { if (active) setPreviewError('预览加载失败，请重新打开这个阶段。'); });
    return () => { active = false; };
  }, [project.id, artifact?.id]);
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
    if (needsSelection) { setError('请先选一个人物，再告诉 AI 要改哪里。'); return; }
    if (!isCurrent || step.confirmedVersionId) {
      setImpact({ action: 'revise', stage: view, prompt: draft.trim(), expectedRevision: workflow.revision }); return;
    }
    if (await act({ action: 'run', prompt: draft.trim(), versionId: artifact?.id })) setDraft('');
  }
  const title = actionsMode ? '人物动作' : CREATION_STAGES.find((stage) => stage.id === view)!.label;
  return <div className="creation-workspace" data-testid="creation-workspace">
    <aside className="creation-sidebar" aria-label="游戏创作阶段">
      <p className="creation-eyebrow">你的游戏想法</p>
      <h2>{lastEnabledStage === 'playable' ? '让游戏真正玩起来' : lastEnabledStage === 'direction' ? '先确定制作方向' : lastEnabledStage === 'scene' ? '让人物进入游戏场景' : '让你的人物动起来'}</h2>
      <p>看一看，改一改，再确认保存。</p>
      <ol className="creation-steps">
        {CREATION_STAGES.filter(({ id }) => isCreationStageEnabled(id, lastEnabledStage)).map(({ id, label }, index) => <li key={id}>
          <button type="button" className={view === id ? 'is-selected' : ''} aria-current={view === id ? 'step' : undefined}
            disabled={!workflow.steps[id].artifact && id !== workflow.currentStage}
            onClick={() => { setView(id); setDraft(''); setImpact(null); }}>
            <span className="creation-step-number">{workflow.steps[id].confirmedVersionId ? <Check size={16} /> : index + 1}</span>
            <span><strong>{label}</strong><small>{STATUS[workflow.steps[id].status]}</small></span>
          </button>
        </li>)}
      </ol>
      <div className="creation-history">
        <label htmlFor="creation-history">已保存版本</label>
        <select id="creation-history" value={checkpointId} disabled={busy || pending} onChange={(event) => setCheckpointId(event.target.value)}>
          <option value="">选择要恢复的版本</option>
          {[...workflow.history].reverse().filter((item) => isCreationStageEnabled(item.stage, lastEnabledStage)).map((item, index) => <option key={item.id} value={item.id}>{workflow.history.length - index}. {item.label}</option>)}
        </select>
        <button type="button" disabled={!checkpointId || busy || pending}
          onClick={() => setImpact({ action: 'restore', checkpointId, expectedRevision: workflow.revision })}><RotateCcw size={14} /> 恢复这个版本</button>
      </div>
    </aside>
    <section className="creation-main" aria-label={`${title}成果`}>
      <header className="creation-heading"><div><p className="creation-eyebrow">{workflow.completed ? '你的游戏已完成' : `当前查看 · ${title}`}</p>
        <h1>{artifact?.title ?? `一起确定${title}`}</h1></div>
        <span className={`creation-status status-${step.status}`}>{STATUS[step.status]}</span>
      </header>
      <div className="creation-content">
        {step.status === 'confirmed' && atReleaseBoundary ? <div className="creation-notice" role="status">{view === 'character' ? actionsMode ? '人物动作已确认并保存。本版停在这里，场景尚未开放。' : '基础人物已确认并保存，可以开始制作人物动作。' : view === 'playable' ? '核心试玩已确认并保存。本版停在这里，完整游戏尚未开放。' : view === 'scene' ? '场景已确认并保存。本版停在这里，俯视核心试玩尚未开放。' : '方向已确认并保存。'}你可以继续修改，或恢复以前的版本。</div> : null}
        {view === 'character' && isCurrent && step.status === 'confirmed' && artifact?.characterPhase === 'candidates' && !busy ? <div className="creation-action-start"><p>下一步：让选中的人物移动、{workflow.steps.direction.artifact?.direction?.genre === 'platformer' ? '跳跃' : '攻击'}，预览后再确认。</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'animate', versionId: artifact.id })}>制作人物动作</button></div> : null}
        {view === 'scene' && isCurrent && step.status === 'confirmed' && artifact && isCreationStageEnabled('playable', lastEnabledStage) && !busy ? <div className="creation-action-start"><p>人物和场景已保存。下一步让 AI 制作能跑跳、收集、越过障碍和到达目标的小样。</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'continue', versionId: artifact.id })}>开始核心试玩</button></div> : null}
        {view === 'character' && isCurrent && step.status === 'confirmed' && artifact?.characterPhase === 'actions' && isCreationStageEnabled('scene', lastEnabledStage) && !busy ? <div className="creation-action-start"><p>人物和动作已保存。下一步由 AI 制作场景，把原人物放进去预览。</p><button type="button" className="creation-primary" disabled={pending || !preview || Boolean(previewError)} onClick={() => void act({ action: 'continue', versionId: artifact.id })}>开始制作场景</button></div> : null}
        {busy && isCurrent ? <div className="creation-notice" role="status">正在制作{title}，完成后会停下来等你确认。已有成果仍保留。
          <button type="button" disabled={pending} onClick={() => void act({ action: 'stop' })}><Square size={12} /> 停止制作</button></div> : null}
        {workflow.error || error ? <div className="creation-error" role="alert">{error || workflow.error?.message}
          {['ACCOUNT_REQUIRED', 'IMAGE_REQUIRED', 'IMAGE_EDIT_REQUIRED', 'GODOT_REQUIRED'].includes(error ? errorCode : workflow.error?.code ?? '')
            ? <button type="button" onClick={onSettings}>查看账户与环境设置</button> : null}</div> : null}
        {!artifact ? <div className="creation-empty"><span>✦</span><h2>{busy ? `AI 正在制作${title}` : step.status === 'failed' ? `${title}制作失败` : step.status === 'stopped' ? `${title}制作已停止` : `${title}还没有开始`}</h2>
          <p>{view === 'playable' ? 'AI 使用已确认人物和场景制作跑跳小样。完成后可以试玩，再用一句话增加或修改玩法。' : view === 'direction' ? '先把你的想法整理成一张短卡片。确认方向之前，不生成图片或游戏。' : view === 'scene' ? 'AI 根据已确认方向制作场景，并放入原人物和动作。完成后你可以看画面、改背景、确认保存。' : '按已确认的方向生成两个基础人物。选好并确认后，可以制作这个人物的基础动作。'}</p>
          {isCurrent && !busy ? <button type="button" className="creation-primary" disabled={pending}
            onClick={() => void act({ action: 'run' })}>{step.status === 'failed' || step.status === 'stopped' ? '重试当前阶段' : `开始${title}`}</button> : null}</div> : <>
          {artifact.direction ? <div className="creation-direction">
            <div className="creation-genre">{artifact.direction.genre === 'topdown' ? '2D 俯视打怪' : '2D 横版闯关'}<span>{artifact.direction.theme}</span></div>
            <dl><div><dt>怎么玩</dt><dd>{artifact.direction.controls}</dd></div><div><dt>游戏目标</dt><dd>{artifact.direction.goal}</dd></div>
              <div><dt>画面风格</dt><dd>{artifact.direction.style}</dd></div><div><dt>这次做多少</dt><dd><ul>{artifact.direction.scope.map((item) => <li key={item}>{item}</li>)}</ul></dd></div></dl>
            <p className="creation-footnote">喜欢这个方向就确认；想调整，直接在下方告诉 AI。</p>
          </div> : <p className="creation-summary">{artifact.summary}</p>}
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
          {view === 'character' && artifact.candidates.length && !actionsMode ? <p className="creation-footnote">{needsSelection ? '先选一个人物，再修改或确认。选择不会生成新图。' : '下方修改只针对选中的人物；另一个候选保留。确认只保存基础形象。'}</p> : null}
          {view === 'scene' ? <p className="creation-footnote">当前检查场景画面和人物比例；原人物动作可以操作，完整关卡尚未制作。</p> : null}
          {artifact.playable ? <p className="creation-footnote">{artifact.playable.maxJumps === 2 ? '支持二段跳，落地后恢复；空中不能无限跳。' : '当前是单次跳跃，可以告诉 AI 增加二段跳。'} A/D 移动，空格跳跃，R 重来。完整小局尚未制作。</p> : null}
          {artifact.actions ? <div className="creation-action-controls" aria-label="动作操作说明">{artifact.actions.states.map(state => <span key={state.id}><strong>{state.label}</strong> {state.key}</span>)}</div> : null}
          {actionsMode && !busy && isCurrent ? <button type="button" className="creation-return-character" onClick={() => setImpact({ action: 'edit-character', versionId: artifact.id, expectedRevision: workflow.revision })}>返回修改人物形象</button> : null}
          {preview?.images.filter((image) => !artifact.candidates.some((candidate) => candidate.image === image.path)).map((image) => <details className="creation-image-details" key={image.path}><summary>{image.label}（查看素材）</summary><figure className="creation-image"><img src={image.url} alt={image.label} /><figcaption>{image.label}</figcaption></figure></details>)}
          {previewError ? <p className="creation-error" role="alert">{previewError}</p> : null}
          {preview?.playableUrl ? <div className="creation-playable"><p>{view === 'character' ? '当前人物的真实动作预览' : view === 'scene' ? '人物与场景预览' : '点击画面后，按成果说明操作试玩'}</p>
            <iframe src={preview.playableUrl} title={`${title}真实预览`} sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="autoplay; fullscreen" />
          </div> : null}
          {artifact.changes.length ? <div className="creation-changes"><strong>这次改了什么</strong><ul>{artifact.changes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {preview?.exportDirectory ? <div className="creation-export"><strong>工程和网页游戏包已保存</strong><p>{preview.exportDirectory}</p>
            <button type="button" onClick={() => void window.noobi.revealProject(project.id)}>打开项目文件夹，查看 exports</button><small>网页包尚未托管，不是公网分享链接。</small></div> : null}
          {isCurrent && !busy && artifact.ready && step.status === 'awaiting-confirmation' ? <div className="creation-approval">
            <span>{candidateOnly ? '确认只保存基础人物，再由你开始制作动作。' : atReleaseBoundary ? `确认后保存这一版${view === 'character' ? (actionsMode ? '人物动作' : '基础人物') : title}，停在这里。` : `确认这一版后，${CREATION_STAGES.find((item) => item.id === view)!.next}。`}</span>
            <button type="button" className="creation-primary" disabled={pending || Boolean(previewError) || !preview}
              onClick={() => void act({ action: 'confirm', versionId: artifact.id })}>{candidateOnly ? '确认基础人物并保存' : actionsMode && !atReleaseBoundary ? '确认人物动作，制作场景' : atReleaseBoundary ? `确认${view === 'character' ? (actionsMode ? '人物动作' : '基础人物') : title}并保存` : view === 'delivery' ? '确认完成' : `确认${title}，继续`}<ChevronRight size={16} /></button>
          </div> : null}
          {isCurrent && !busy && ['failed', 'stopped'].includes(step.status) ? <button type="button" disabled={pending} onClick={() => void act({ action: 'run' })}>重试本阶段，保留上一版成果</button> : null}
        </>}
      </div>
      <footer className="creation-composer">
        <label htmlFor="creation-request">{step.confirmedVersionId || !isCurrent ? `返回修改${title}` : '想改哪里，直接告诉 AI'}</label>
        <textarea id="creation-request" value={draft} disabled={busy || pending} maxLength={20_000} rows={2}
          placeholder={view === 'playable' ? '例如：加入落地恢复的二段跳，保留人物、场景和其他规则' : view === 'scene' ? '例如：竹林改成雪山，人物和动作保持不变' : view === 'direction' ? '例如：改成手动攻击，人物是一位白衣剑客' : needsSelection ? '先选一个人物，再输入修改要求' : actionsMode ? '例如：走路慢一点；保持人物外观不变' : '例如：衣服改白，保留发型和武器'}
          onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (isSendKey(event)) {
              event.preventDefault(); if (!event.repeat) void submit();
            }
          }} />
        <div><small>Enter 发送 · Shift + Enter 换行</small><button type="button" disabled={!draft.trim() || busy || pending || needsSelection} onClick={() => void submit()}>发送修改</button></div>
      </footer>
      {impact ? <div className="creation-impact" role="dialog" aria-modal="true" aria-labelledby="creation-impact-title">
        <h2 id="creation-impact-title">{impact.action === 'restore' ? '恢复已保存的成果' : impact.action === 'edit-character' ? '返回修改人物形象' : impact.action === 'select' ? '更换已确认人物' : `修改已确认的${title}`}</h2>
        <p>{impact.action === 'restore' ? '图片、选择和确认状态会一起恢复；较新的版本仍保留，不会发起新的 AI 生成。'
          : impact.action === 'edit-character' ? '返回后可修改衣服、发型或更换人物；需要重新确认基础人物并制作动作。当前人物与动作版本仍可恢复，不会立即调用 AI。'
          : impact.action === 'select' ? '只更换选择，不生成图片。新的选择需要重新确认，原版本可以恢复。'
          : atReleaseBoundary ? `AI 会根据你的要求修改，新的${title}需要重新确认。当前已确认版本仍可恢复。`
          : `需要重新检查或确认：${affectedStages(impact.stage ?? view).filter(id => isCreationStageEnabled(id, lastEnabledStage)).map((id) => CREATION_STAGES.find((item) => item.id === id)!.label).join('、')}。上一版可以恢复。`}</p>
        <div><button type="button" onClick={() => setImpact(null)}>先不改</button><button type="button" className="creation-primary" disabled={pending || busy}
          onClick={async () => { if (await act({ ...impact, action: impact.action!, impactAccepted: true })) { setImpact(null); setDraft(''); } }}>确认影响，继续</button></div>
      </div> : null}
    </section>
  </div>;
}
