import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { CreationWorkspace } from '../../src/renderer/components/CreationWorkspace';
import type { CreationWorkflow } from '../../src/shared/creation';
import type { NoobiApi, ProjectRecord } from '../../src/shared/contracts';
import './review.css';
async function request(path: string, value?: unknown) {
  const response = await fetch(path, value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? '操作失败');
  return result;
}
window.noobi = { creation: {
  get: async (id) => ({ ok: true, value: await request(`/api/record?id=${encodeURIComponent(id)}`) }),
  act: async (input) => request('/api/act', input),
  preview: async () => ({ ok: true, value: { images: [], playableUrl: null, exportDirectory: null } }),
  onChanged: () => () => {},
} } as NoobiApi;
function App() {
  const [workflow, setWorkflow] = useState<CreationWorkflow | null>(null);
  const [idea, setIdea] = useState('我想做一个武侠主题的 2D 俯视打怪游戏');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [calls, setCalls] = useState(0);
  useEffect(() => {
    let active = true;
    async function refresh() { try { const state = await request('/api/state'); if (active) { setWorkflow(state.workflow); setCalls(state.calls); } } catch { if (active) setError('验收服务未连接，请重新启动。'); } }
    void refresh(); const timer = setInterval(refresh, 300);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function create() {
    if (pending || !idea.trim()) return;
    setPending(true); setError('');
    try { const state = await request('/api/new', { idea }); setWorkflow(state); }
    catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  return <div className="review-app">
    <header className="review-banner"><strong>方向卡 · 离线交互验收</strong><span>预置示例，不调用 AI；用于检查操作、保存与恢复，不代表 AI 生成效果。</span><small>本次进程示例生成：{calls} 次 · 真实模型：0 次</small></header>
    <div className="review-start"><label htmlFor="review-idea">一句话说出游戏想法</label><textarea id="review-idea" value={idea} maxLength={2000} onChange={(e) => setIdea(e.target.value)} /><button onClick={() => void create()} disabled={pending || !idea.trim() || workflow?.task?.state === 'running'}>保存为新想法</button><small>先保存，再点“开始方向”。可以试着修改“改成手动攻击”。示例返回固定逻辑，真实 AI 待验。</small></div>
    {error ? <p role="alert">{error}</p> : null}
    {workflow ? <><p className="review-idea">当前想法：{workflow.idea}</p><CreationWorkspace lastEnabledStage="direction" key={workflow.projectId} project={{ id: workflow.projectId } as ProjectRecord} workflow={workflow} onChanged={setWorkflow} onSettings={() => setError('这是不连接真实账户的离线验收入口。')} /></> : <p className="review-empty">先保存一个想法，查看当前节点的完整操作。</p>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
