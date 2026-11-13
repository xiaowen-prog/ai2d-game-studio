import type { NoobiApi } from '../shared/contracts';
import type { CreationReply } from '../shared/creation';

const DEFAULT_LOCAL_BRIDGE = 'http://127.0.0.1:47621';

export function installBrowserBridge(endpoint = ''): void {
  if (window.noobi) return;
  const sameOrigin = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  const bridgeUrl = (endpoint || new URLSearchParams(location.search).get('bridge') || (sameOrigin ? '' : DEFAULT_LOCAL_BRIDGE)).replace(/\/$/u, '');
  if (!sameOrigin && !bridgeUrl) return;
  const events = new EventSource(`${bridgeUrl}/studio/events`);
  function subscribe<T>(channel: string, listener: (data: T) => void) {
    const receive = (event: MessageEvent<string>) => listener(JSON.parse(event.data) as T);
    events.addEventListener(channel, receive);
    return () => events.removeEventListener(channel, receive);
  }
  async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
    const response = await fetch(`${bridgeUrl}/studio/noobi:${channel}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '操作失败。');
    return body as T;
  }
  async function creation<T>(channel: string, ...args: unknown[]): Promise<CreationReply<T>> {
    try {
      return await call(channel, ...args);
    } catch (error) {
      return { ok: false, error: { code: 'CONNECTION_ERROR', message: error instanceof Error ? error.message : '无法连接本机制作台。' } };
    }
  }
  const api: Partial<NoobiApi> = {
    bootstrap: () => call('bootstrap'),
    refreshRuntime: () => call('runtime:refresh'),
    startLogin: () => call('runtime:login'),
    logout: () => call('runtime:logout'),
    chooseDirectory: () => call('dialog:directory'),
    chooseProjectDirectory: () => call('dialog:project-directory'),
    createProject: input => call('project:create', input, []),
    getEnvironmentStatus: () => call('environment:get'),
    refreshEnvironmentStatus: () => call('environment:refresh'),
    chooseGodotExecutable: () => call('environment:godot:choose'),
    saveGodotExecutable: path => call('environment:godot:save', path),
    deleteProject: projectId => call('project:delete', projectId),
    renameProject: (...args) => call('project:rename', ...args),
    setProjectPinned: (...args) => call('project:pin', ...args),
    runProject: input => call('project:run', input),
    stopProject: projectId => call('project:stop', projectId),
    revealProject: projectId => call('project:reveal', projectId),
    importProjectAssets: projectId => call('project:assets:import', projectId),
    retryAssetPlan: (...args) => call('project:asset-plan:retry', ...args),
    inspectProject: projectId => call('project:inspect', projectId),
    evaluateProjectExperience: projectId => call('project:experience:evaluate', projectId),
    cancelProjectExperience: projectId => call('project:experience:cancel', projectId),
    readProjectFile: (...args) => call('project:read', ...args),
    getProjectIcon: projectId => call('project:icon', projectId),
    saveProjectNoobiPack: (...args) => call('project:noobi-pack:save', ...args),
    saveProjectNoobiCrew: (...args) => call('project:noobi-crew:save', ...args),
    saveSettings: patch => call('settings:save', patch),
    getExtensionSettings: () => call('extensions:get'),
    saveMediaProvider: input => call('media-provider:save', input),
    testMediaProvider: capability => call('media-provider:test', capability),
    listSkills: () => call('skills:list'),
    setSkillEnabled: input => call('skills:set-enabled', input),
    listMcpServers: () => call('mcp:list'),
    saveMcpServer: input => call('mcp:save', input),
    removeMcpServer: id => call('mcp:remove', id),
    listPromptTemplates: () => call('prompts:list'),
    savePromptTemplate: input => call('prompts:save', input),
    resetPromptTemplate: id => call('prompts:reset', id),
    resolveApproval: (...args) => call('approval:resolve', ...args),
    onAgentEvent: listener => subscribe('noobi:event:agent', listener),
    onProjectChanged: listener => subscribe('noobi:event:project', listener),
    onRuntimeChanged: listener => subscribe('noobi:event:runtime', listener),
    onApproval: listener => subscribe('noobi:event:approval', listener),
    onApprovalClosed: listener => subscribe('noobi:event:approval-closed', listener),
    onAssetsChanged: listener => subscribe('noobi:event:assets', listener),
    onAssetPlansChanged: listener => subscribe('noobi:event:asset-plans', listener),
    creation: {
      get: projectId => creation('creation:get', projectId),
      act: input => creation('creation:act', input),
      preview: (projectId, versionId) => creation('creation:preview', projectId, versionId),
      revealDelivery: async (projectId, versionId) => {
        const link = document.createElement('a');
        link.href = `${bridgeUrl}/studio/download?` + new URLSearchParams({ project: projectId, version: versionId });
        link.download = 'game-package.zip';
        link.click();
        return { ok: true, value: undefined };
      },
      onChanged: listener => subscribe('noobi:event:creation', listener),
    },
  };
  window.noobi = new Proxy(api as NoobiApi, {
    get(target, key, receiver) {
      return Reflect.get(target, key, receiver) ?? (() => Promise.reject(new Error('这项桌面操作请在 Mac 制作台使用。')));
    },
  });
}
