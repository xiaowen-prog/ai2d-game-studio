import { newPreviewProject, previewSteps, type PreviewProject } from './studioPreviewState';

export type PreviewKind = 'forest' | 'bamboo';
export interface PreviewLibraryItem {
  id: string;
  name: string;
  kind: PreviewKind;
  sample: boolean;
  updatedAt: number | null;
  deletedAt: number | null;
  workflow: PreviewProject;
}
export const PREVIEW_LIBRARY_VERSION = 1;
export const PREVIEW_LIBRARY_KEY = 'zaojing.refined.library.v1';
export const PREVIEW_LIBRARY_BACKUP_KEY = 'zaojing.refined.library.backup.v1';
export const PREVIEW_LIBRARY_LEGACY_KEYS = ['zaojing.refined.library'] as const;
export function initialPreviewLibrary(): PreviewLibraryItem[] {
  return [
    { id: 'forest', name: '林间跃迁', kind: 'forest', idea: '一个清晨森林里的横版闯关游戏，主角可以二段跳，沿途收集光点。' },
    { id: 'bamboo', name: '竹影行', kind: 'bamboo', idea: '一个俯视角武侠游戏，在竹林里用剑气迎战敌人。' },
  ].map(item => ({ id: item.id, name: item.name, kind: item.kind as PreviewKind, sample: true, updatedAt: null, deletedAt: null, workflow: newPreviewProject(item.idea, item.kind === 'bamboo') }));
}
export function createPreviewItem(name: string, kind: PreviewKind, idea = '', id: string = crypto.randomUUID(), now = Date.now()): PreviewLibraryItem {
  return { id, name: name.trim() || '未命名项目', kind, sample: false, updatedAt: now, deletedAt: null,
    workflow: newPreviewProject(idea.trim() || '先写下游戏的玩法与目标，再确认方向。', kind === 'bamboo') };
}
export function renamePreviewItem(items: PreviewLibraryItem[], id: string, name: string, now = Date.now()): PreviewLibraryItem[] {
  const trimmed = name.trim();
  if (!trimmed) return items;
  return items.map(item => item.id === id && item.name !== trimmed ? { ...item, name: trimmed, updatedAt: now } : item);
}
export function removePreviewItem(items: PreviewLibraryItem[], id: string, now = Date.now()): PreviewLibraryItem[] {
  return items.map(item => item.id === id ? { ...item, deletedAt: now } : item);
}
export function restorePreviewItem(items: PreviewLibraryItem[], id: string): PreviewLibraryItem[] {
  return items.map(item => item.id === id ? { ...item, deletedAt: null } : item);
}
/** Keep user-created projects recent-first while leaving bundled examples in their authored order. */
export function sortPreviewLibraryItems(items: readonly PreviewLibraryItem[]): PreviewLibraryItem[] {
  const userItems = items.filter(item => !item.sample).sort((a, b) => {
    const timeA = a.updatedAt ?? 0;
    const timeB = b.updatedAt ?? 0;
    return timeB - timeA;
  });
  return [...userItems, ...items.filter(item => item.sample)];
}
export function previewProgress(project: PreviewProject) {
  return { step: project.stage + 1, label: previewSteps[project.stage], status: project.stage === 5 ? '待导出 · 仅预览' : project.confirmedThrough >= project.stage ? '已确认' : '待确认' };
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validWorkflow(value: unknown): value is PreviewProject {
  if (!object(value) || typeof value.idea !== 'string' || !Number.isInteger(value.stage) || Number(value.stage) < 0 || Number(value.stage) > 5
    || !Number.isInteger(value.confirmedThrough) || Number(value.confirmedThrough) < -1 || Number(value.confirmedThrough) > 4
    || Number(value.stage) > Number(value.confirmedThrough) + 1) return false;
  if (!Array.isArray(value.versions) || value.versions.length !== 6 || !value.versions.every(list => Array.isArray(list) && list.length > 0 && list.every(version => object(version)
    && Number.isInteger(version.id) && Number(version.id) > 0 && typeof version.label === 'string' && typeof version.note === 'string'
    && typeof version.size === 'number' && version.size >= .6 && version.size <= 1.8 && typeof version.left === 'number' && version.left >= 0 && version.left <= 100
    && ['', 'victory', 'pause'].includes(String(version.overlay))))) return false;
  const versions = value.versions as PreviewProject['versions'];
  return Array.isArray(value.selected) && value.selected.length === 6 && value.selected.every((index, stage) => Number.isInteger(index) && index >= 0 && index < versions[stage].length)
    && Array.isArray(value.drafts) && value.drafts.length === 6 && value.drafts.every(draft => typeof draft === 'string')
    && Array.isArray(value.messages) && value.messages.every(message => object(message) && Number.isInteger(message.stage) && Number(message.stage) >= 0 && Number(message.stage) <= 5
      && typeof message.request === 'string' && typeof message.reply === 'string' && typeof message.applied === 'boolean');
}
/** Reject invalid records without overwriting the original browser storage. */
export function parsePreviewLibrary(raw: string): PreviewLibraryItem[] {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.version !== PREVIEW_LIBRARY_VERSION || !Array.isArray(data.items) || !data.items.every(item => object(item)
    && typeof item.id === 'string' && item.id.length > 0 && typeof item.name === 'string' && item.name.trim().length > 0
    && (item.kind === 'forest' || item.kind === 'bamboo') && typeof item.sample === 'boolean'
    && (item.updatedAt === null || typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt))
    && (item.deletedAt === null || typeof item.deletedAt === 'number' && Number.isFinite(item.deletedAt)) && validWorkflow(item.workflow))
    || new Set(data.items.map(item => item.id)).size !== data.items.length) throw new Error('Invalid preview library');
  return data.items as unknown as PreviewLibraryItem[];
}
export function serializePreviewLibrary(items: PreviewLibraryItem[]): string {
  return JSON.stringify({ version: PREVIEW_LIBRARY_VERSION, items });
}
