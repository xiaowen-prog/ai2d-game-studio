import {
  ArrowUp,
  ArrowRight,
  Bot,
  FileText,
  Gamepad2,
  ImagePlus,
  Menu,
  Moon,
  Paperclip,
  Settings,
  Sparkles,
  Square,
  Sun,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import type {
  AppSettings,
  ModelOption,
  ProjectRecord,
  RuntimeStatus,
} from '../../shared/contracts';
import { formatRelative, PROJECT_STATUS_LABELS } from '../ui';
import { ModelPicker } from './ModelPicker';
import { ProjectIconImage } from './ProjectIcon';
import { RotatingIdeaInput } from './RotatingIdeaInput';
import { HomeScene } from './HomeScene';
import { isSendKey } from '../sendKey';

const IDEA_STARTERS = [
  {
    label: '平台动作',
    prompt: '制作一个横版平台动作游戏，拥有流畅移动、冲刺、收集目标和可立即重玩的完整关卡。',
  },
  {
    label: '武侠打怪',
    prompt: '我想做一个 2D 俯视武侠游戏，白衣剑客在竹林发射剑气，击败三波敌人，每波结束选一次升级。',
  },
] as const;

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
const FILE_ACCEPT = IMAGE_ACCEPT;
const SUPPORTED_ATTACHMENT = /\.(?:png|jpe?g|webp)$/iu;
const MAX_HOME_ATTACHMENTS = 20;

export interface HomeLaunchInput {
  idea: string;
  model: string | null;
  effort: string | null;
  attachments: readonly File[];
}

interface HomeDashboardProps {
  runtime: RuntimeStatus;
  settings: AppSettings;
  projects: readonly ProjectRecord[];
  models: readonly ModelOption[];
  imageGenerationAvailable: boolean;
  busy: boolean;
  focusSignal: number;
  onLaunch: (input: HomeLaunchInput) => Promise<void>;
  onOpenProject: (project: ProjectRecord) => void;
  onOpenRail: () => void;
  onOpenSettings: (section?: 'account' | 'environment' | 'media') => void;
  onToggleTheme: () => void;
}

export function HomeDashboard({
  runtime,
  settings,
  projects,
  models,
  imageGenerationAvailable,
  busy,
  focusSignal,
  onLaunch,
  onOpenProject,
  onOpenRail,
  onOpenSettings,
  onToggleTheme,
}: HomeDashboardProps) {
  const [idea, setIdea] = useState(() => { try { return localStorage.getItem('creation-home-idea') ?? ''; } catch { return ''; } });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const ideaInputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [model, setModel] = useState(
    settings.defaultModel ?? models.find((item) => item.isDefault)?.model ?? models[0]?.model ?? '',
  );
  const [effort, setEffort] = useState(settings.defaultEffort);
  const activeModel = useMemo(
    () => models.find((item) => item.model === model) ?? models[0] ?? null,
    [model, models],
  );
  const runtimeReady = runtime.state === 'ready' && Boolean(runtime.account);
  const launchReady = idea.trim().length > 0 && !busy;
  useEffect(() => { try { localStorage.setItem('creation-home-idea', idea); } catch { /* Keep the current text in memory. */ } }, [idea]);

  useEffect(() => {
    if (models.length === 0) {
      setModel('');
      return;
    }
    if (!models.some((item) => item.model === model)) {
      setModel(settings.defaultModel ?? models.find((item) => item.isDefault)?.model ?? models[0]?.model ?? '');
    }
  }, [model, models, settings.defaultModel]);

  useEffect(() => {
    if (focusSignal === 0) return;
    ideaInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ideaInputRef.current?.focus({ preventScroll: true });
  }, [focusSignal]);

  useEffect(() => {
    if (!activeModel) return;
    if (!activeModel.efforts.includes(effort)) {
      setEffort(
        activeModel.efforts.includes(settings.defaultEffort)
          ? settings.defaultEffort
          : activeModel.defaultEffort,
      );
    }
  }, [activeModel, effort, settings.defaultEffort]);

  async function submit() {
    if (!launchReady) return;
    if (!runtimeReady) { onOpenSettings('account'); return; }
    await onLaunch({
      idea: idea.trim(),
      model: activeModel?.model ?? null,
      effort: effort || null,
      attachments,
    });
  }

  function addAttachments(files: readonly File[]) {
    if (busy || files.length === 0) return;
    const supported = files.filter((file) => SUPPORTED_ATTACHMENT.test(file.name) && file.size <= 10 * 1024 * 1024);
    const unsupportedCount = files.length - supported.length;
    const known = new Set(attachments.map(attachmentKey));
    const added: File[] = [];
    for (const file of supported) {
      if (attachments.length + added.length >= MAX_HOME_ATTACHMENTS) break;
      const key = attachmentKey(file);
      if (known.has(key)) continue;
      known.add(key);
      added.push(file);
    }
    if (added.length > 0) setAttachments((current) => [...current, ...added]);
    const messages = [
      added.length > 0 ? `已添加 ${added.length} 个附件` : '',
      unsupportedCount > 0 ? `忽略 ${unsupportedCount} 个格式不支持或超过 10 MB 的文件` : '',
      attachments.length + supported.length > MAX_HOME_ATTACHMENTS ? `最多 ${MAX_HOME_ATTACHMENTS} 个` : '',
    ].filter(Boolean);
    setAttachmentNotice(messages.join('；'));
  }

  function removeAttachment(file: File) {
    const key = attachmentKey(file);
    setAttachments((current) => current.filter((item) => attachmentKey(item) !== key));
    setAttachmentNotice('');
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    addAttachments(Array.from(event.dataTransfer.files));
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey(event)) {
      event.preventDefault();
      if (!event.repeat) void submit();
    }
  }

  return (
    <section className="home-dashboard">
      <header className="home-toolbar">
        <button
          className="home-mobile-menu"
          type="button"
          aria-label="打开导航"
          onClick={onOpenRail}
        >
          <Menu size={18} />
        </button>
        <span className="studio-brand"><span className="studio-brand-mark" aria-hidden="true" />造境</span>
        <div className="home-toolbar-actions">
          <button type="button" aria-label="切换主题" title="切换主题" onClick={onToggleTheme}>
            {settings.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button type="button" aria-label="设置" title="设置" onClick={() => onOpenSettings()}>
            <Settings size={17} />
          </button>
        </div>
      </header>

      <div className="home-scroll">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-content">
            <span className={`home-loop-status ${runtimeReady ? 'is-ready' : 'is-attention'}`}>
              <i /> {runtimeReady ? 'AI 已连接，可以开始' : '先连接 AI，想法可以先写'} <ArrowRight size={13} />
            </span>
            <h1 id="home-title">把脑海里的世界，<wbr />做成能玩的游戏。</h1>
            <p>从一句话开始。AI 分步制作，每一步都由你确认。</p>
            <div
              className={`home-prompt-card${dragActive ? ' is-dragging' : ''}`}
              onDragEnter={handleDragEnter}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={imageInputRef}
                className="sr-only"
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                tabIndex={-1}
                onChange={(event) => {
                  addAttachments(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept={FILE_ACCEPT}
                multiple
                tabIndex={-1}
                onChange={(event) => {
                  addAttachments(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              <RotatingIdeaInput
                ref={ideaInputRef}
                placeholder="例如：做一个 2D 俯视武侠游戏，白衣剑客在竹林里用剑气打怪"
                value={idea}
                busy={busy}
                onChange={(event) => setIdea(event.target.value)}
                onKeyDown={handlePromptKeyDown}
              />
              {attachments.length > 0 ? (
                <div className="home-attachment-list" aria-label="已添加的参考附件">
                  {attachments.map((file) => (
                    <div className="home-attachment" key={attachmentKey(file)}>
                      <AttachmentPreview file={file} />
                      <span>
                        <strong title={file.name}>{file.name}</strong>
                        <small>{formatFileSize(file.size)}</small>
                      </span>
                      <button
                        type="button"
                        aria-label={`移除 ${file.name}`}
                        disabled={busy}
                        onClick={() => removeAttachment(file)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {attachmentNotice ? <div className="home-attachment-notice" role="status">{attachmentNotice}</div> : null}
              <div className="home-prompt-controls">
                <div className="home-attachment-actions">
                  <button type="button" disabled={busy} onClick={() => imageInputRef.current?.click()}>
                    <ImagePlus size={15} /> 图片
                  </button>
                  <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={15} /> 文件
                  </button>
                </div>
                <ModelPicker
                  models={models}
                  value={activeModel?.model ?? ''}
                  effort={effort}
                  defaultModel={settings.defaultModel}
                  defaultEffort={settings.defaultEffort}
                  disabled={busy}
                  onChange={setModel}
                  onEffortChange={setEffort}
                />
                <span className="home-prompt-spacer" aria-hidden="true" />
                <span className="home-engine-advisor" title="支持2D横版闯关和俯视打怪，题材不限">
                  <Bot size={15} /> 先确认方向
                </span>
                <button
                  className="home-create-button"
                  type="button"
                  aria-label={busy ? '正在创建游戏' : '发送游戏创意'}
                  disabled={!launchReady}
                  title={idea.trim() ? '保存想法，先确认制作方向' : '先描述游戏创意'}
                  onClick={() => void submit()}
                >
                  {busy
                    ? <Square size={12} fill="currentColor" />
                    : <ArrowUp size={20} strokeWidth={2.2} />}
                </button>
              </div>
              {dragActive ? (
                <div className="home-attachment-drop" role="status">
                  <Paperclip size={22} />
                  <strong>松开即可添加到游戏需求</strong>
                  <span>支持 PNG、JPEG、WebP 参考图，单张不超过 10 MB</span>
                </div>
              ) : null}
            </div>

            <small className="home-send-hint">Enter 发送 · Shift + Enter 换行 · 想法会自动保存</small>
            {!runtimeReady ? <section className="home-first-use" aria-label="首次使用指引">
              <div><strong>{runtime.account ? 'AI 连接暂时不可用' : '第一次使用？先登录 Codex'}</strong>
                <p>{runtime.account ? '打开账户设置检查连接，再回来发送。你的想法会保留。' : '用已有 ChatGPT 账号连接 AI，不需要写代码。登录后回来发送想法，AI 会先给你方向卡。'}</p>
                <ol><li>打开账户设置</li><li>在官方页面完成登录</li><li>回来发送游戏想法</li></ol></div>
              <button type="button" className="primary-button" onClick={() => onOpenSettings('account')}>{runtime.account ? '检查连接' : '去登录'}</button>
            </section> : null}
            <p className="studio-home-scope">支持 2D 横版闯关和俯视打怪，题材不限</p>
            <div className="home-idea-starters" aria-label="游戏创意快捷选项">
              {IDEA_STARTERS.map((starter) => (
                <button key={starter.label} type="button" onClick={() => {
                  setIdea(starter.prompt);
                  ideaInputRef.current?.focus();
                }}>
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
          <HomeScene />
        </section>

        <section className="home-projects" aria-labelledby="recent-projects-title">
          <header>
            <div>
              <span>你的作品</span>
              <h2 id="recent-projects-title">继续最近的制作</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setIdea('');
                ideaInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ideaInputRef.current?.focus({ preventScroll: true });
              }}
            >
              写一个新创意 <ArrowRight size={14} />
            </button>
          </header>
          {projects.length > 0 ? (
            <div className="home-project-grid">
              {projects.slice(0, 6).map((project, index) => (
                <button key={project.id} type="button" onClick={() => onOpenProject(project)}>
                  <span className={`home-project-art art-${index % 4}`}>
                    {project.icon ? (
                      <ProjectIconImage project={project} className="project-icon-img" />
                    ) : (
                      <Gamepad2 size={22} />
                    )}
                    <i className={`status-dot status-${project.status}`} />
                  </span>
                  <span className="home-project-copy">
                    <strong>{project.name}</strong>
                    <small>{project.engine === 'godot' ? 'GODOT 4' : 'WEB'} · {PROJECT_STATUS_LABELS[project.status]}</small>
                    <time dateTime={project.updatedAt}>{formatRelative(project.updatedAt)}</time>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="home-project-empty">
              <Sparkles size={20} />
              <strong>第一个游戏会出现在这里</strong>
              <span>从一句话开始，AI 先给你一张可以修改的方向卡。</span>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function AttachmentPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  const image = /^image\//iu.test(file.type) || /\.(?:png|jpe?g|webp)$/iu.test(file.name);

  useEffect(() => {
    if (!image) {
      setUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, image]);

  return url ? <img src={url} alt="" /> : <span><FileText size={15} /></span>;
}

function attachmentKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
