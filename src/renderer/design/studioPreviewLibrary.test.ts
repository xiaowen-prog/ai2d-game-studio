import { describe, expect, it } from 'vitest';
import { applyPreviewMessage, confirmPreviewStage, openPreviewStage } from './studioPreviewState';
import { createPreviewItem, initialPreviewLibrary, parsePreviewLibrary, previewProgress, removePreviewItem, renamePreviewItem, restorePreviewItem, serializePreviewLibrary } from './studioPreviewLibrary';

describe('design-preview project library', () => {
  it('creates independent projects without replacing either example, then survives serialization', () => {
    const examples = initialPreviewLibrary();
    const first = createPreviewItem('星港', 'forest', '登上飞船', 'project-one', 10);
    const second = createPreviewItem('星港', 'bamboo', '躲避陨石', 'project-two', 20);
    first.workflow = applyPreviewMessage(confirmPreviewStage(first.workflow), '主角放大一点');
    const restored = parsePreviewLibrary(serializePreviewLibrary([first, second, ...examples]));
    expect(restored.map(item => item.id)).toEqual(['project-one', 'project-two', 'forest', 'bamboo']);
    expect(restored[0].workflow.versions[1]).toHaveLength(2);
    expect(restored[1].workflow).toMatchObject({ stage: 0, confirmedThrough: -1, idea: '躲避陨石' });
    expect(restored.slice(2)).toEqual(initialPreviewLibrary());
  });
  it('renames, removes and restores one project without losing its steps or version history', () => {
    const item = createPreviewItem('星港', 'forest', '', 'project-one', 10);
    item.workflow = applyPreviewMessage(confirmPreviewStage(item.workflow), '主角放大一点');
    const renamed = renamePreviewItem([item, ...initialPreviewLibrary()], item.id, '星港漫游', 20);
    const removed = removePreviewItem(renamed, item.id, 30);
    const restored = restorePreviewItem(parsePreviewLibrary(serializePreviewLibrary(removed)), item.id);
    expect(restored[0]).toMatchObject({ name: '星港漫游', deletedAt: null, updatedAt: 20, workflow: item.workflow });
    expect(restored.slice(1)).toEqual(initialPreviewLibrary());
    expect(renamePreviewItem(restored, item.id, '  ')).toBe(restored);
  });
  it('keeps an empty library empty after reload instead of resurrecting deleted examples', () => {
    let items = initialPreviewLibrary();
    for (const item of items) items = removePreviewItem(items, item.id, 10);
    const restored = parsePreviewLibrary(serializePreviewLibrary(items));
    expect(restored.filter(item => item.deletedAt === null)).toHaveLength(0);
    expect(restored).toHaveLength(2);
    expect(parsePreviewLibrary(serializePreviewLibrary([]))).toEqual([]);
  });
  it('reports the confirmation status of the selected step, including revisited steps', () => {
    const initial = createPreviewItem('星港', 'forest').workflow;
    expect(previewProgress(initial)).toEqual({ step: 1, label: '游戏方向', status: '待确认' });
    const next = confirmPreviewStage(initial);
    expect(previewProgress(next)).toEqual({ step: 2, label: '角色与动作', status: '待确认' });
    expect(previewProgress(openPreviewStage(next, 0)).status).toBe('已确认');
  });
  it('rejects corrupt storage rather than accepting broken workflow indexes or duplicate identities', () => {
    const items = initialPreviewLibrary();
    items[0].workflow.selected[0] = 99;
    expect(() => parsePreviewLibrary(serializePreviewLibrary(items))).toThrow();
    const [item] = initialPreviewLibrary();
    expect(() => parsePreviewLibrary(serializePreviewLibrary([item, item]))).toThrow();
    expect(() => parsePreviewLibrary('{broken')).toThrow();
  });
});
