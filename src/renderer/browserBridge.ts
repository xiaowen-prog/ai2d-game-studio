import type { NoobiApi } from '../shared/contracts';
import type { CreationReply } from '../shared/creation';

export function installBrowserBridge(): void {
  if (window.noobi || location.hostname !== '127.0.0.1') return;
  const events = new EventSource('/studio/events');
  function subscribe<T>(channel: string, listener: (data: T) => void) {
    const receive = (event: MessageEvent<string>) => listener(JSON.parse(event.data) as T);
    events.addEventListener(channel, receive);
    return () => events.removeEventListener(channel, receive);
  }
  async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
    const response = await fetch(`/studio/noobi:${channel}`, {
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
    getEnvironmentStatus: () => call('environment:get'),
    refreshEnvironmentStatus: () => call('environment:refresh'),
    renameProject: (...args) => call('project:rename', ...args),
    setProjectPinned: (...args) => call('project:pin', ...args),
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
        link.href = '/studio/download?' + new URLSearchParams({ project: projectId, version: versionId });
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
