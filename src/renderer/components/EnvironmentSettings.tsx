import {
  Boxes,
  Check,
  CircleAlert,
  CircleX,
  Code2,
  Cpu,
  FolderOpen,
  Gamepad2,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  EnvironmentStatusSnapshot,
  EnvironmentToolStatus,
} from '../../shared/contracts';
import { toMessage } from '../ui';

interface EnvironmentSettingsProps {
  onMessage: (message: string) => void;
}

type EnvironmentTone = 'ready' | 'attention' | 'blocked' | 'checking';

const TOOL_ICONS: Record<EnvironmentToolStatus['id'], LucideIcon> = {
  codex: SquareTerminal,
  node: Code2,
  godot: Gamepad2,
};

const TOOL_DESCRIPTIONS: Record<EnvironmentToolStatus['id'], string> = {
  codex: '让 AI 理解需求并制作游戏；测试包已内置运行程序，账户在“Codex 账户”中登录',
  node: '制作台自带的运行环境，无需为了打开应用单独安装',
  godot: '把 AI 制作的人物、场景和规则变成能玩的 2D 游戏',
};

const TARGET_LABELS = {
  web: 'WEB',
  macos: 'MACOS',
  windows: 'WINDOWS',
  linux: 'LINUX',
} as const;

export function EnvironmentSettings({ onMessage }: EnvironmentSettingsProps) {
  const [snapshot, setSnapshot] = useState<EnvironmentStatusSnapshot | null>(null);
  const [busy, setBusy] = useState<'loading' | 'refreshing' | 'choosing' | 'resetting' | null>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async (refresh: boolean) => {
    setBusy(refresh ? 'refreshing' : 'loading');
    setError('');
    try {
      const result = refresh
        ? await window.noobi.refreshEnvironmentStatus()
        : await window.noobi.getEnvironmentStatus();
      setSnapshot(result);
      if (refresh) onMessage(environmentRefreshMessage(result));
    } catch (reason) {
      const nextError = toMessage(reason);
      setError(nextError);
      onMessage(nextError);
    } finally {
      setBusy(null);
    }
  }, [onMessage]);

  useEffect(() => {
    void load(false);
  }, [load]);

  async function chooseGodot() {
    setBusy('choosing');
    setError('');
    try {
      const binaryPath = await window.noobi.chooseGodotExecutable();
      if (!binaryPath) return;
      const result = await window.noobi.saveGodotExecutable(binaryPath);
      setSnapshot(result);
      onMessage(result.canCreateGodotProjects
        ? 'Godot 可执行文件已配置并通过检查。'
        : '路径已保存，但 Godot 环境仍需处理。');
    } catch (reason) {
      const nextError = toMessage(reason);
      setError(nextError);
      onMessage(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function resetGodot() {
    setBusy('resetting');
    setError('');
    try {
      const result = await window.noobi.saveGodotExecutable(null);
      setSnapshot(result);
      onMessage('已恢复自动查找 Godot。');
    } catch (reason) {
      const nextError = toMessage(reason);
      setError(nextError);
      onMessage(nextError);
    } finally {
      setBusy(null);
    }
  }

  const sortedTools = useMemo(() => {
    if (!snapshot) return [];
    const order: EnvironmentToolStatus['id'][] = ['codex', 'node', 'godot'];
    return order.flatMap((id) => snapshot.tools.find((tool) => tool.id === id) ?? []);
  }, [snapshot]);

  const summary = environmentSummary(snapshot, busy === 'loading');
  const godot = snapshot?.tools.find((tool) => tool.id === 'godot');
  const configuredManually = Boolean(godot?.configuredPath);

  return (
    <section className="environment-settings" aria-busy={busy !== null}>
      <header className="settings-page-heading environment-heading">
        <div>
          <span>首次使用准备</span>
          <h3>环境管理</h3>
          <p>登录 AI 后，再准备游戏引擎。下面会告诉你哪一项已就绪、哪一项还需要处理。</p>
        </div>
        <button
          className="secondary-button compact"
          type="button"
          disabled={busy !== null}
          onClick={() => void load(true)}
        >
          <RefreshCw size={13} className={busy === 'refreshing' ? 'spin' : ''} />
          {busy === 'refreshing' ? '检查中…' : '重新检查'}
        </button>
      </header>

      <div className={`environment-summary tone-${summary.tone}`} role="status">
        <StatusGlyph tone={summary.tone} />
        <div>
          <span>{summary.code}</span>
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </div>
        {snapshot?.checkedAt ? <time dateTime={snapshot.checkedAt}>{formatCheckedAt(snapshot.checkedAt)}</time> : null}
      </div>

      {error ? (
        <div className="environment-error" role="alert">
          <CircleAlert size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => void load(true)}>重试</button>
        </div>
      ) : null}

      {snapshot && !snapshot.canExportGodotProjects ? <section className="environment-install-guide" aria-label="准备游戏引擎">
        <h4>让游戏能预览，还差这些准备</h4>
        <ol>
          <li>下载 <a href="https://godotengine.org/download/archive/4.5.1-stable/" target="_blank" rel="noreferrer">Godot 4.5.1 标准版</a>：Windows 解压到固定文件夹，点下方“选择程序”选中 Godot 的 .exe；Mac 放进“应用程序”。已有 Godot 4 可直接选择。</li>
          <li>打开 Godot，在“编辑器 → 管理导出模板”下载并安装与引擎同版本的模板。<a href="https://docs.godotengine.org/zh-cn/stable/tutorials/export/exporting_projects.html" target="_blank" rel="noreferrer">查看官方说明</a></li>
          <li>回来点“重新检查”。游戏引擎和网页导出模板均就绪，就可以开始制作。</li>
        </ol>
        <p>应用不会替你下载大文件，也不会新增付费服务；以前装好的引擎可以继续使用。</p>
      </section> : null}

      <div className="environment-tool-list" aria-label="生产工具状态">
        {busy === 'loading' && !snapshot ? (
          <EnvironmentSkeleton />
        ) : sortedTools.map((tool, index) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            index={index + 1}
            action={tool.id === 'godot' ? (
              <div className="environment-tool-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void chooseGodot()}
                >
                  <FolderOpen size={13} />
                  {busy === 'choosing' ? '选择中…' : '选择程序'}
                </button>
                {configuredManually ? (
                  <button
                    className="icon-button compact"
                    type="button"
                    aria-label="恢复自动查找 Godot"
                    title="恢复自动查找"
                    disabled={busy !== null}
                    onClick={() => void resetGodot()}
                  >
                    <RotateCcw size={13} className={busy === 'resetting' ? 'spin' : ''} />
                  </button>
                ) : null}
              </div>
            ) : null}
          />
        ))}
      </div>

      {snapshot ? (
        <section className={`export-templates-panel state-${snapshot.exportTemplates.state}`}>
          <header>
            <div className="export-templates-icon"><Boxes size={18} /></div>
            <div>
              <span>预览与交付所需文件</span>
              <strong>游戏导出模板</strong>
              <small>{exportTemplateDescription(snapshot)}</small>
            </div>
            <EnvironmentBadge tone={templateTone(snapshot.exportTemplates.state)}>
              {templateStateLabel(snapshot.exportTemplates.state)}
            </EnvironmentBadge>
          </header>

          <div className="export-target-grid">
            {Object.entries(TARGET_LABELS).map(([id, label]) => {
              const available = snapshot.exportTemplates.targets[id as keyof typeof TARGET_LABELS];
              return (
                <div className={available ? 'is-ready' : 'is-missing'} key={id}>
                  {available ? <Check size={13} /> : <CircleX size={13} />}
                  <span>{label}</span>
                  <small>{available ? 'READY' : 'MISSING'}</small>
                </div>
              );
            })}
          </div>

          <dl className="export-template-meta">
            <div>
              <dt>Required</dt>
              <dd>{snapshot.exportTemplates.expectedVersion ?? '等待 Godot 版本检查'}</dd>
            </div>
            <div>
              <dt>Installed</dt>
              <dd>
                {snapshot.exportTemplates.installedVersions.length
                  ? snapshot.exportTemplates.installedVersions.join(' / ')
                  : '未发现已安装版本'}
              </dd>
            </div>
            <div>
              <dt>Base path</dt>
              <dd title={snapshot.exportTemplates.basePath ?? undefined}>
                {snapshot.exportTemplates.basePath ?? '尚未定位模板目录'}
              </dd>
            </div>
            <div>
              <dt>Version path</dt>
              <dd title={snapshot.exportTemplates.versionPath ?? undefined}>
                {snapshot.exportTemplates.versionPath ?? '当前 Godot 版本没有匹配模板'}
              </dd>
            </div>
          </dl>
          {snapshot.exportTemplates.issues.length ? (
            <ul className="export-template-issues" aria-label="导出模板问题">
              {snapshot.exportTemplates.issues.map((issue) => (
                <li key={issue}><CircleAlert size={12} /> <span>{issue}</span></li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {snapshot ? (
        <div className="environment-capability-strip" aria-label="Godot 能力检查">
          <CapabilityItem
            ready={snapshot.canCreateGodotProjects}
            label="创建 Godot 项目"
            detail="生成 project.godot、场景和 GDScript"
          />
          <CapabilityItem
            ready={snapshot.canExportGodotProjects}
            label="导出可交付游戏"
            detail="Web 与桌面构建需要匹配的 Export Templates"
          />
        </div>
      ) : null}
    </section>
  );
}

function ToolCard({
  tool,
  index,
  action,
}: {
  tool: EnvironmentToolStatus;
  index: number;
  action: React.ReactNode;
}) {
  const Icon = TOOL_ICONS[tool.id];
  const tone = toolStateTone(tool.state);
  const path = tool.binaryPath ?? tool.configuredPath;
  return (
    <article className={`environment-tool-card tone-${tone}`}>
      <div className="environment-tool-index">{String(index).padStart(2, '0')}</div>
      <div className="environment-tool-icon"><Icon size={20} /></div>
      <div className="environment-tool-copy">
        <div className="environment-tool-title">
          <div>
            <span>{tool.id.toUpperCase()} / RUNTIME</span>
            <strong>{tool.label}</strong>
          </div>
          <EnvironmentBadge tone={tone}>{toolStateLabel(tool.state)}</EnvironmentBadge>
        </div>
        <p>{TOOL_DESCRIPTIONS[tool.id]}</p>
        <div className="environment-tool-facts">
          <div>
            <span>VERSION</span>
            <strong>{tool.version ?? 'UNKNOWN'}</strong>
          </div>
          <div>
            <span>SOURCE</span>
            <strong>{sourceLabel(tool.source)}</strong>
          </div>
        </div>
        <div className="environment-path-row">
          <Cpu size={13} />
          <code title={path ?? undefined}>{path ?? '尚未找到可执行文件'}</code>
          {action}
        </div>
        {tool.message ? <small className="environment-tool-message">{tool.message}</small> : null}
      </div>
    </article>
  );
}

function CapabilityItem({ ready, label, detail }: { ready: boolean; label: string; detail: string }) {
  return (
    <div className={ready ? 'is-ready' : 'is-blocked'}>
      <span>{ready ? <Check size={13} /> : <CircleX size={13} />}</span>
      <div><strong>{label}</strong><small>{detail}</small></div>
      <code>{ready ? 'PASS' : 'BLOCKED'}</code>
    </div>
  );
}

function EnvironmentSkeleton() {
  return (
    <div className="environment-skeleton" aria-label="正在读取环境">
      {[0, 1, 2].map((item) => <span key={item} />)}
    </div>
  );
}

function StatusGlyph({ tone }: { tone: EnvironmentTone }) {
  if (tone === 'ready') return <Check size={17} />;
  if (tone === 'blocked') return <CircleX size={17} />;
  return <CircleAlert size={17} />;
}

function EnvironmentBadge({ tone, children }: { tone: EnvironmentTone; children: React.ReactNode }) {
  return <span className={`environment-badge tone-${tone}`}>{children}</span>;
}

export function environmentSummary(
  snapshot: EnvironmentStatusSnapshot | null,
  loading = false,
): { tone: EnvironmentTone; code: string; title: string; detail: string } {
  if (loading || !snapshot) {
    return {
      tone: 'checking',
      code: 'ENV / SCANNING',
      title: '正在读取本机工具链',
      detail: '检查 Codex、Node.js、Godot 与导出模板。',
    };
  }
  if (snapshot.state === 'ready') {
    return {
      tone: 'ready',
      code: 'ENV / OPERATIONAL',
      title: '游戏生产环境已就绪',
      detail: snapshot.canExportGodotProjects
        ? 'Godot 项目创建、验证和多平台导出均可使用。'
        : '核心工具已就绪；安装导出模板后即可交付多平台游戏。',
    };
  }
  if (snapshot.state === 'blocked') {
    return {
      tone: 'blocked',
      code: 'ENV / BLOCKED',
      title: '关键工具缺失或不兼容',
      detail: '请处理下方红色项目，再启动 Godot 游戏 Agent。',
    };
  }
  return {
    tone: 'attention',
    code: 'ENV / ATTENTION',
    title: '环境可以运行，但仍需完善',
    detail: '下方项目不会阻止基础制作，但可能限制验证或导出。',
  };
}

function environmentRefreshMessage(snapshot: EnvironmentStatusSnapshot): string {
  if (snapshot.state === 'ready') return '环境检查完成：所有生产工具已就绪。';
  if (snapshot.state === 'blocked') return '环境检查完成：存在会阻止游戏生产的问题。';
  return '环境检查完成：部分能力仍需配置。';
}

function toolStateTone(state: EnvironmentToolStatus['state']): EnvironmentTone {
  if (state === 'ready') return 'ready';
  if (state === 'missing' || state === 'incompatible' || state === 'error') return 'blocked';
  return 'attention';
}

function toolStateLabel(state: EnvironmentToolStatus['state']): string {
  const labels: Record<EnvironmentToolStatus['state'], string> = {
    ready: '已就绪',
    missing: '未找到',
    incompatible: '版本不兼容',
    error: '检查异常',
  };
  return labels[state];
}

function templateTone(state: EnvironmentStatusSnapshot['exportTemplates']['state']): EnvironmentTone {
  if (state === 'ready') return 'ready';
  if (state === 'missing') return 'blocked';
  return 'attention';
}

function templateStateLabel(state: EnvironmentStatusSnapshot['exportTemplates']['state']): string {
  if (state === 'ready') return '已安装';
  if (state === 'missing') return '需要安装';
  return '等待 Godot';
}

function exportTemplateDescription(snapshot: EnvironmentStatusSnapshot): string {
  if (snapshot.exportTemplates.state === 'ready') return '模板版本与当前 Godot 匹配，可执行正式导出。';
  if (snapshot.exportTemplates.state === 'missing') return 'Godot 可以创建和预览项目，但正式导出会被阻止。';
  return '定位到兼容的 Godot 后，将自动检查对应版本的模板。';
}

function sourceLabel(source: EnvironmentToolStatus['source']): string {
  return source ? source.replaceAll('-', ' ').toUpperCase() : 'AUTO DISCOVERY';
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'CHECKED';
  return `CHECKED ${new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)}`;
}
