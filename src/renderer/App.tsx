import {
  FolderOpen,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import type {
  AgentEvent,
  AppSettings,
  AssetPlanRecord,
  ApprovalAnswers,
  ApprovalDecision,
  ApprovalRequest,
  BootstrapPayload,
  ProjectRecord,
  RuntimeStatus,
} from '../shared/contracts';
import { ApprovalModal } from './components/ApprovalModal';
import { Composer } from './components/Composer';
import { CreationWorkspace } from './components/CreationWorkspace';
import type { CreationWorkflow } from '../shared/creation';
import { DeleteProjectModal } from './components/DeleteProjectModal';
import { EventStream } from './components/EventStream';
import { HomeDashboard, type HomeLaunchInput } from './components/HomeDashboard';
import { Inspector } from './components/Inspector';
import { LaunchTransition, type LaunchTransitionPhase } from './components/LaunchTransition';
import { Pipeline } from './components/Pipeline';
import {
  PIXEL_COVER_DURATION_MS,
  PIXEL_REVEAL_DURATION_MS,
  PixelPageTransition,
  type PixelTransitionDirection,
} from './components/PixelPageTransition';
import { ProjectRail } from './components/ProjectRail';
import { RenameProjectModal } from './components/RenameProjectModal';
import { SettingsModal, type SettingsSection } from './components/SettingsModal';
import { PROJECT_STATUS_LABELS, runtimeLabel, toMessage } from './ui';
import {
  WORKSPACE_HOME_TARGET,
  createWorkspaceViewTransitionState,
  workspaceProjectTarget,
  workspaceViewTransitionReducer,
  type WorkspaceViewAnimatedPhase,
} from './workspaceViewTransition';

type EventMap = Record<string, AgentEvent[]>;
type LaunchTransitionState = LaunchTransitionPhase | 'hidden';

const MIN_LAUNCH_TRANSITION_MS = 1_600;
const LAUNCH_TRANSITION_EXIT_MS = 420;

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [viewTransition, dispatchViewTransition] = useReducer(
    workspaceViewTransitionReducer,
    undefined,
    () => createWorkspaceViewTransitionState(
      WORKSPACE_HOME_TARGET,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  );
  const [events, setEvents] = useState<EventMap>({});
  const [creationWorkflows, setCreationWorkflows] = useState<Record<string, CreationWorkflow | null>>({});
  const [creationLoadError, setCreationLoadError] = useState('');
  const [creationReload, setCreationReload] = useState(0);
  const homeLaunchGuard = useRef(false);
  const updateCreation = useCallback((workflow: CreationWorkflow) => {
    setCreationWorkflows((current) => (current[workflow.projectId]?.revision ?? -1) > workflow.revision
      ? current : { ...current, [workflow.projectId]: workflow });
  }, []);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [homeFocusSignal, setHomeFocusSignal] = useState(0);
  const [homeLaunching, setHomeLaunching] = useState(false);
  const [launchTransition, setLaunchTransition] = useState<LaunchTransitionState>('hidden');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>('account');
  const [railOpen, setRailOpen] = useState(false);
  const [homeRailCollapsed, setHomeRailCollapsed] = useState(false);
  const [error, setError] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [loadingError, setLoadingError] = useState('');
  const [renameTarget, setRenameTarget] = useState<ProjectRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const launchTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const focusHomeCreatorRef = useRef(false);

  const selectedId = viewTransition.visible.kind === 'project'
    ? viewTransition.visible.projectId
    : undefined;

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId),
    [projects, selectedId],
  );
  const selectedEvents = selected ? (events[selected.id] ?? []) : [];
  const creationWorkflow = selected ? creationWorkflows[selected.id] : null;
  const splineStudio = !selected || creationWorkflow !== null;
  useEffect(() => {
    document.documentElement.dataset.studio = String(splineStudio);
    return () => { delete document.documentElement.dataset.studio; };
  }, [splineStudio]);
  useEffect(() => {
    let active = true;
    setCreationLoadError('');
    if (selectedId) void window.noobi.creation.get(selectedId).then((reply) => {
      if (!active) return;
      if (reply.ok && reply.value) updateCreation(reply.value);
      else if (reply.ok) setCreationWorkflows((current) => ({ ...current, [selectedId]: null }));
      else setCreationLoadError(reply.error.message);
    }).catch(() => { if (active) setCreationLoadError('创作记录加载失败，已有项目仍保留。请重新读取。'); });
    return () => { active = false; };
  }, [selectedId, updateCreation, creationReload]);
  useEffect(() => window.noobi.creation.onChanged(updateCreation), [updateCreation]);
  const latestSelectedEvent = selectedEvents[selectedEvents.length - 1] ?? null;
  const studioStage = selected
    ? selected.status === 'running' && latestSelectedEvent
      ? latestSelectedEvent.stage
      : selected.stage
    : null;
  const imageGenerationAvailable = Boolean(
    runtime?.capabilities.imageGeneration || runtime?.capabilities.externalImageGeneration,
  );

  const loadBootstrap = useCallback(async () => {
    setLoadingError('');
    try {
      const state = await window.noobi.bootstrap();
      setBootstrap(state);
      setProjects(state.projects);
      setSettings(state.settings);
      setRuntime(state.runtime);
      setEvents(state.events ?? {});
      dispatchViewTransition({
        type: 'SYNC_PROJECTS',
        projectIds: state.projects.map((project) => project.id),
      });
    } catch (reason) {
      setLoadingError(toMessage(reason));
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();

    const stopAgentEvents = window.noobi.onAgentEvent((event) => {
      setEvents((current) => ({
        ...current,
        [event.projectId]: mergeEvent(current[event.projectId] ?? [], event),
      }));
      if (event.kind === 'file' || event.kind === 'lifecycle') {
        setRefreshSignal((value) => value + 1);
      }
    });

    const stopProjects = window.noobi.onProjectChanged((project) => {
      setProjects((current) => upsertProject(current, project));
    });

    const stopRuntime = window.noobi.onRuntimeChanged((status) => {
      setRuntime(status);
    });

    const stopApprovals = window.noobi.onApproval((approval) => {
      setApprovals((current) =>
        current.some((item) => item.token === approval.token)
          ? current
          : [...current, approval],
      );
    });
    const stopApprovalClosed = window.noobi.onApprovalClosed((token) => {
      setApprovals((current) => current.filter((item) => item.token !== token));
    });

    return () => {
      stopAgentEvents();
      stopProjects();
      stopRuntime();
      stopApprovals();
      stopApprovalClosed();
    };
  }, [loadBootstrap]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', settings.theme === 'dark' ? '#151611' : '#f2f1eb');
  }, [settings]);

  useEffect(() => () => {
    if (launchTransitionTimer.current) clearTimeout(launchTransitionTimer.current);
  }, []);

  useEffect(() => {
    dispatchViewTransition({
      type: 'SYNC_PROJECTS',
      projectIds: projects.map((project) => project.id),
    });
  }, [projects]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      dispatchViewTransition({
        type: 'SET_REDUCED_MOTION',
        enabled: preference.matches,
      });
    };
    preference.addEventListener('change', syncPreference);
    return () => preference.removeEventListener('change', syncPreference);
  }, []);

  function openSettings(initialSection: SettingsSection = 'account') {
    setSettingsInitialSection(initialSection);
    setShowSettings(true);
  }

  function navigateHome() {
    focusHomeCreatorRef.current = false;
    dispatchViewTransition({ type: 'NAVIGATE', target: WORKSPACE_HOME_TARGET });
    setRailOpen(false);
  }

  function navigateToProject(project: ProjectRecord) {
    focusHomeCreatorRef.current = false;
    dispatchViewTransition({ type: 'NAVIGATE', target: workspaceProjectTarget(project.id) });
    setRailOpen(false);
  }

  function openHomeCreator() {
    focusHomeCreatorRef.current = true;
    dispatchViewTransition({ type: 'NAVIGATE', target: WORKSPACE_HOME_TARGET });
    setRailOpen(false);
    setHomeFocusSignal((value) => value + 1);
  }

  const completeViewTransition = useCallback((
    phase: WorkspaceViewAnimatedPhase,
    runId: number,
  ) => {
    dispatchViewTransition({ type: 'PHASE_COMPLETE', phase, runId });
    if (phase === 'revealing') {
      const creatorWillOwnFocus = viewTransition.visible.kind === 'home'
        && focusHomeCreatorRef.current;
      focusHomeCreatorRef.current = false;
      if (!creatorWillOwnFocus) {
        window.requestAnimationFrame(() => workspaceRef.current?.focus({ preventScroll: true }));
      }
    }
  }, [viewTransition.visible.kind]);

  async function runProject(
    prompt: string,
    model: string | null,
    effort: string | null,
  ) {
    if (!selected) return;
    await runProjectFor(selected, prompt, model, effort);
  }

  function ensureRunReady(): boolean {
    setError('');
    if (!runtime) {
      setError('造境正在读取 Codex 运行时，请稍后再试。');
      return false;
    }
    if (runtime.state !== 'ready') {
      setError('Codex App Server 尚未就绪，请先检查运行时或完成登录。');
      openSettings();
      return false;
    }
    if (!runtime.account) {
      setError('请先登录 ChatGPT，再启动游戏 Agent。');
      openSettings();
      return false;
    }
    if (!runtime.capabilities.imageGeneration && !runtime.capabilities.externalImageGeneration) {
      setError('图像 API 与 Codex ImageGen 均不可用，请先在设置中配置图像服务或修复运行时。');
      openSettings('media');
      return false;
    }
    return true;
  }

  async function runProjectFor(
    project: ProjectRecord,
    prompt: string,
    model: string | null,
    effort: string | null,
  ) {
    if (!ensureRunReady()) return;
    try {
      const running = await window.noobi.runProject({
        projectId: project.id,
        prompt,
        model,
        effort,
      });
      setProjects((current) => upsertProject(current, running));
    } catch (reason) {
      setError(toMessage(reason));
      throw reason;
    }
  }

  async function launchFromHome(input: HomeLaunchInput) {
    if (!settings || homeLaunchGuard.current) return;
    homeLaunchGuard.current = true;
    setHomeLaunching(true);
    setError('');
    try {
      const projectDirectory = await window.noobi.chooseProjectDirectory();
      if (!projectDirectory) return;
      const transitionStartedAt = Date.now();
      setLaunchTransition('running');
      const project = await window.noobi.createProject({
        idea: input.idea,
        projectDirectory,
        model: input.model,
        stagedCreation: true,
      }, input.attachments);
      setProjects((current) => upsertProject(current, project));
      navigateToProject(project);
      if (project.status === 'failed') {
        throw new Error(project.lastError ?? '项目创建失败');
      }
      await waitForMinimumDuration(transitionStartedAt, MIN_LAUNCH_TRANSITION_MS);
      setProjects((current) => upsertProject(current, project));
      finishLaunchTransition();
      navigateToProject(project);
      const state = await window.noobi.creation.get(project.id);
      if (!state.ok) throw new Error(state.error.message);
      if (state.value) {
        updateCreation(state.value);
        const running = await window.noobi.creation.act({ projectId: project.id, action: 'run',
          operationId: crypto.randomUUID(), expectedRevision: state.value.revision });
        if (running.ok) updateCreation(running.value); else setError(running.error.message);
      }
    } catch (reason) {
      setError(toMessage(reason));
      finishLaunchTransition();
    } finally {
      homeLaunchGuard.current = false;
      setHomeLaunching(false);
    }
  }

  function finishLaunchTransition() {
    setLaunchTransition('leaving');
    if (launchTransitionTimer.current) clearTimeout(launchTransitionTimer.current);
    launchTransitionTimer.current = setTimeout(() => {
      setLaunchTransition('hidden');
      launchTransitionTimer.current = null;
    }, LAUNCH_TRANSITION_EXIT_MS);
  }

  async function revealProject(projectId: string) {
    setError('');
    try {
      const relocated = await window.noobi.revealProject(projectId);
      if (relocated) setProjects((current) => upsertProject(current, relocated));
    } catch (reason) {
      setError(toMessage(reason));
    }
  }

  async function stopProject() {
    if (!selected) return;
    try {
      const project = await window.noobi.stopProject(selected.id);
      setProjects((current) => upsertProject(current, project));
    } catch (reason) {
      setError(toMessage(reason));
    }
  }

  async function regenerateAsset(plan: AssetPlanRecord) {
    if (!selected || !settings || selected.status === 'running') return;
    setError('');
    try {
      await window.noobi.retryAssetPlan(selected.id, plan.id);
      setRefreshSignal((value) => value + 1);

    } catch (reason) {
      setError(toMessage(reason));
      setRefreshSignal((value) => value + 1);
    }
  }

  async function toggleTheme() {
    if (!settings) return;
    const theme = settings.theme === 'dark' ? 'light' : 'dark';
    setSettings((current) => (current ? { ...current, theme } : current));
    try {
      setSettings(await window.noobi.saveSettings({ theme }));
    } catch (reason) {
      setError(toMessage(reason));
    }
  }

  async function renameProject(name: string) {
    if (!renameTarget || projectActionBusy) return;
    setProjectActionBusy(true);
    setError('');
    try {
      const project = await window.noobi.renameProject(renameTarget.id, name);
      setProjects((current) => upsertProject(current, project));
      setRenameTarget(null);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function toggleProjectPinned(project: ProjectRecord) {
    setError('');
    try {
      const updated = await window.noobi.setProjectPinned(project.id, !project.pinned);
      setProjects((current) => upsertProject(current, updated));
    } catch (reason) {
      setError(toMessage(reason));
    }
  }

  async function deleteProject() {
    if (!deleteTarget || projectActionBusy) return;
    const projectId = deleteTarget.id;
    setProjectActionBusy(true);
    setError('');
    try {
      await window.noobi.deleteProject(projectId);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setEvents((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
      setDeleteTarget(null);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function resolveApproval(
    token: string,
    decision: ApprovalDecision,
    answers?: ApprovalAnswers,
  ) {
    await window.noobi.resolveApproval(token, decision, answers);
    setApprovals((current) => current.filter((item) => item.token !== token));
  }

  if (!bootstrap || !settings || !runtime) {
    return (
      <main className="loading-screen">
        <div className="loading-brand">
          <div><strong>造境</strong><small>AI 游戏制作台</small></div>
        </div>
        {loadingError ? (
          <div className="loading-error" role="alert">
            <strong>无法连接桌面运行时</strong>
            <p>{loadingError}</p>
            <button className="primary-button" type="button" onClick={() => void loadBootstrap()}>
              重试连接
            </button>
          </div>
        ) : (
          <div className="loading-progress"><span /> 正在连接 Codex App Server…</div>
        )}
      </main>
    );
  }

  const transitionDirection: PixelTransitionDirection = viewTransition.phase === 'covering'
    ? viewTransition.visible.kind === 'home' ? 'forward' : 'backward'
    : viewTransition.visible.kind === 'project' ? 'forward' : 'backward';
  const transitionClass = viewTransition.phase === 'idle'
    ? ''
    : ` is-page-transitioning phase-${viewTransition.phase} direction-${transitionDirection}`;
  const transitionStyle = viewTransition.phase === 'idle'
    ? undefined
    : {
        '--pixel-phase-duration': `${viewTransition.phase === 'covering'
          ? PIXEL_COVER_DURATION_MS
          : PIXEL_REVEAL_DURATION_MS}ms`,
      } as CSSProperties;

  return (
    <div
      className={`app-shell${splineStudio ? ' studio-mode' : ''} ${selected ? 'view-workbench' : 'view-home'}${transitionClass}`}
      style={transitionStyle}
    >
      <ProjectRail
        projects={projects}
        selectedId={selectedId}
        runtime={runtime}
        open={railOpen}
        collapsed={splineStudio ? false : !selected && homeRailCollapsed}
        variant={selected ? 'workbench' : 'dashboard'}
        onOpen={() => setRailOpen(true)}
        onClose={() => setRailOpen(false)}
        onToggleCollapse={() => setHomeRailCollapsed((current) => !current)}
        onHome={navigateHome}
        onSelect={navigateToProject}
        onRename={setRenameTarget}
        onTogglePinned={(project) => void toggleProjectPinned(project)}
        onDelete={setDeleteTarget}
        onCreate={openHomeCreator}
        onSettings={openSettings}
      />

      <main ref={workspaceRef} className="workspace" tabIndex={-1}>
        {selected ? <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-label="打开项目导航"
            onClick={() => setRailOpen(true)}
          >
            <Menu size={18} />
          </button>
          {splineStudio ? <button type="button" className="studio-brand" onClick={navigateHome} aria-label="返回创作首页"><span className="studio-brand-mark" aria-hidden="true" /><span>游戏制作台</span></button> : null}
          <button
            className="runtime-status"
            type="button"
            title={runtime.error ?? runtimeLabel(runtime)}
            onClick={() => openSettings()}
          >
            <span className={`runtime-dot state-${runtime.state}`} />
            <span>{runtimeLabel(runtime)}</span>
          </button>

          <div className="topbar-project">
            <strong>{selected?.name ?? '造境工作区'}</strong>
            {selected ? (
              <>
                <span className={`engine-chip engine-${selected.engine}`}>
                  {selected.engine === 'godot' ? 'GODOT 4' : 'WEB'}
                </span>
                <span className={`status-chip status-${selected.status}`}>
                  {PROJECT_STATUS_LABELS[selected.status]}
                </span>
              </>
            ) : null}
          </div>

          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="在 Finder 中打开项目"
              title="在 Finder 中打开项目"
              disabled={!selected}
              onClick={() => selected && void revealProject(selected.id)}
            >
              <FolderOpen size={15} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="切换主题"
              title="切换主题"
              onClick={() => void toggleTheme()}
            >
              {settings.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="打开设置"
              title="打开设置"
              onClick={() => openSettings()}
            >
              <Settings size={15} />
            </button>
          </div>
        </header> : null}

        {selected && (creationWorkflow === undefined || creationLoadError) ? <section className="studio-loading" aria-label="读取项目">
          <h1>{creationLoadError ? '暂时没有读取到项目' : '正在打开你的游戏'}</h1>
          <p role={creationLoadError ? 'alert' : 'status'}>{creationLoadError || '读取已保存的进度与成果…'}</p>
          {creationLoadError ? <button type="button" className="primary-button" onClick={() => setCreationReload(value => value + 1)}>重新读取</button> : null}
          <button type="button" className="secondary-button" onClick={navigateHome}>返回首页</button>
        </section> : selected && creationWorkflow ? (
          <CreationWorkspace key={selected.id} project={selected} workflow={creationWorkflow}
            onChanged={updateCreation} onSettings={() => openSettings()} />
        ) : selected ? (
          <div className={`production-layout status-${selected.status}`}>
            <section className="production-center">
              <header className="agent-pane-heading">
                <div>
                  <span>NOOBI AGENT</span>
                  <button
                    className="agent-project-name"
                    type="button"
                    title="重命名游戏"
                    aria-label={`重命名 ${selected.name}`}
                    onClick={() => setRenameTarget(selected)}
                  >
                    {selected.name}
                  </button>
                  <small>{selected.status === 'running' ? '正在持续制作与验证' : '可以继续提出修改要求'}</small>
                </div>
                <span className={`status-chip status-${selected.status}`}>
                  {PROJECT_STATUS_LABELS[selected.status]}
                </span>
              </header>
              <EventStream project={selected} events={selectedEvents} />
              <Composer
                key={selected.id}
                project={selected}
                models={runtime.models}
                settings={settings}
                imageGenerationAvailable={imageGenerationAvailable}
                disabled={
                  runtime.state !== 'ready' ||
                  !runtime.account ||
                  !imageGenerationAvailable
                }
                onRun={runProject}
                onStop={stopProject}
              />
            </section>
            <section className="studio-canvas">
              <Pipeline stage={studioStage ?? selected.stage} status={selected.status} compact />
              <Inspector
                project={selected}
                settings={settings}
                activityStage={studioStage ?? selected.stage}
                refreshSignal={refreshSignal}
                onError={setError}
                onRegenerate={regenerateAsset}
                onRevealProject={() => revealProject(selected.id)}
                onProjectUpdated={(project) => {
                  setProjects((current) => upsertProject(current, project));
                }}
              />
            </section>
          </div>
        ) : (
          <HomeDashboard
            runtime={runtime}
            settings={settings}
            projects={projects}
            models={runtime.models}
            imageGenerationAvailable={imageGenerationAvailable}
            busy={homeLaunching}
            focusSignal={homeFocusSignal}
            onLaunch={launchFromHome}
            onOpenProject={navigateToProject}
            onOpenRail={() => setRailOpen(true)}
            onOpenSettings={openSettings}
            onToggleTheme={() => void toggleTheme()}
          />
        )}
      </main>

      {showSettings ? (
        <SettingsModal
          value={settings}
          runtime={runtime}
          initialSection={settingsInitialSection}
          onClose={() => setShowSettings(false)}
          onSaved={setSettings}
          onRuntime={setRuntime}
        />
      ) : null}

      {renameTarget ? (
        <RenameProjectModal
          project={renameTarget}
          busy={projectActionBusy}
          onClose={() => setRenameTarget(null)}
          onRename={(name) => void renameProject(name)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteProjectModal
          project={deleteTarget}
          busy={projectActionBusy}
          onClose={() => setDeleteTarget(null)}
          onDelete={() => void deleteProject()}
        />
      ) : null}

      {approvals[0] ? (
        <ApprovalModal
          key={approvals[0].token}
          approval={approvals[0]}
          pendingCount={approvals.length}
          onResolve={resolveApproval}
        />
      ) : null}

      {error ? (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="关闭错误提示" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      {launchTransition !== 'hidden' ? (
        <LaunchTransition phase={launchTransition} />
      ) : null}

      {viewTransition.phase !== 'idle' ? (
        <PixelPageTransition
          direction={transitionDirection}
          phase={viewTransition.phase}
          runId={viewTransition.runId}
          onComplete={completeViewTransition}
        />
      ) : null}
    </div>
  );
}

function upsertProject(
  projects: readonly ProjectRecord[],
  project: ProjectRecord,
): ProjectRecord[] {
  const next = projects.some((item) => item.id === project.id)
    ? projects.map((item) => (item.id === project.id ? project : item))
    : [project, ...projects];
  return [...next].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || b.updatedAt.localeCompare(a.updatedAt));
}

function mergeEvent(events: readonly AgentEvent[], incoming: AgentEvent): AgentEvent[] {
  const index = events.findIndex((event) => event.id === incoming.id);
  const next = [...events];
  if (index >= 0) {
    const previous = next[index]!;
    next[index] = {
      ...previous,
      ...incoming,
      message: incoming.isDelta
        ? `${previous.message}${incoming.message}`.slice(-120_000)
        : incoming.message,
    };
  } else {
    next.push(incoming);
  }
  return next
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-500);
}

async function waitForMinimumDuration(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = Math.max(0, minimumMs - (Date.now() - startedAt));
  if (remaining === 0) return;
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, remaining));
}
