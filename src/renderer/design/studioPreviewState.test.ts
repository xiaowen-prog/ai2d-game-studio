import { describe, expect, it } from 'vitest';
import { applyPreviewMessage, confirmPreviewStage, newPreviewProject, openPreviewStage, selectPreviewVersion } from './studioPreviewState';

describe('isolated design-preview workflow', () => {
  it('starts unconfirmed and rejects future-step navigation', () => {
    const project = newPreviewProject('forest');
    expect(project.confirmedThrough).toBe(-1);
    expect(project.stage).toBe(0);
    expect(openPreviewStage(project, 2)).toBe(project);
    const next = confirmPreviewStage(project);
    expect(next).toMatchObject({ stage: 1, confirmedThrough: 0 });
    expect(openPreviewStage(next, 2)).toBe(next);
  });
  it('only creates versions for actual supported changes', () => {
    const project = confirmPreviewStage(confirmPreviewStage(newPreviewProject('forest')));
    const changed = applyPreviewMessage(project, '主角放大一点');
    expect(changed.versions[2]).toHaveLength(2);
    expect(changed.versions[2][1].size).toBe(1.2);
    expect(project.versions[2]).toHaveLength(1);
    const unsupported = applyPreviewMessage(changed, '生成一座真正的城堡');
    expect(unsupported.versions).toEqual(changed.versions);
    expect(unsupported.messages.at(-1)).toMatchObject({ applied: false, reply: expect.stringContaining('没有应用') });
  });
  it('restores a real composition snapshot and re-locks downstream steps without deleting history', () => {
    let project = confirmPreviewStage(confirmPreviewStage(newPreviewProject('forest')));
    project = applyPreviewMessage(project, '主角放大一点');
    project = applyPreviewMessage(project, '主角靠左一些');
    project = confirmPreviewStage(project);
    project = openPreviewStage(project, 2);
    const restored = selectPreviewVersion(project, 0);
    expect(restored.versions[2]).toHaveLength(3);
    expect(restored.versions[2][restored.selected[2]]).toMatchObject({ size: 1, left: 27 });
    expect(restored.confirmedThrough).toBe(1);
    expect(openPreviewStage(restored, 3)).toBe(restored);
    expect(applyPreviewMessage(restored, '主角放大一点').versions[2]).toHaveLength(4);
  });
  it('carries the confirmed character composition into following steps', () => {
    let project = confirmPreviewStage(newPreviewProject('forest'));
    project = applyPreviewMessage(project, '主角放大一点');
    project = confirmPreviewStage(project);
    expect(project.versions[2][project.selected[2]].size).toBe(1.2);
    project = applyPreviewMessage(project, '主角靠左一些');
    project = confirmPreviewStage(project);
    expect(project.versions[3][project.selected[3]]).toMatchObject({ size: 1.2, left: 19 });
  });
  it('keeps project messages, versions, and confirmation isolated', () => {
    const first = newPreviewProject('forest');
    const second = newPreviewProject('bamboo', true);
    const edited = applyPreviewMessage(confirmPreviewStage(first), '主角放大一点');
    expect(edited.messages).toHaveLength(1);
    expect(second).toMatchObject({ stage: 0, confirmedThrough: -1, messages: [] });
    expect(second.versions[1][0]).toMatchObject({ left: 43, size: 1 });
  });
  it('records play feedback without claiming that game parameters changed or an export exists', () => {
    let project = newPreviewProject('forest');
    for (let i = 0; i < 3; i++) project = confirmPreviewStage(project);
    project = applyPreviewMessage(project, '记录：跳跃需要更轻盈');
    expect(project.messages.at(-1)?.reply).toContain('游戏参数没有改变');
    project = confirmPreviewStage(confirmPreviewStage(project));
    expect(project.stage).toBe(5);
    expect(confirmPreviewStage(project)).toBe(project);
    expect(project.confirmedThrough).toBe(4);
  });
});
