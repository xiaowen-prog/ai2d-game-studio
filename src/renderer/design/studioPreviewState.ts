export const previewSteps = ['游戏方向', '角色与动作', '关卡场景', '核心试玩', '完整游戏', '导出交付'];
export const previewSuggestions = [
  ['单局约三分钟', '改成轻松探索'],
  ['主角放大一点', '主角缩小一点'],
  ['主角放大一点', '主角靠左一些'],
  ['记录：跳跃需要更轻盈', '记录：降低操作难度'],
  ['展示胜利界面', '展示暂停界面'],
  [],
];

export interface PreviewVersion {
  id: number;
  label: string;
  size: number;
  left: number;
  note: string;
  overlay: '' | 'victory' | 'pause';
}
export interface PreviewProject {
  idea: string;
  stage: number;
  confirmedThrough: number;
  versions: PreviewVersion[][];
  selected: number[];
  drafts: string[];
  messages: { stage: number; request: string; reply: string; applied: boolean }[];
}

export function newPreviewProject(idea: string, topdown = false): PreviewProject {
  return {
    idea, stage: 0, confirmedThrough: -1,
    versions: previewSteps.map((_, stage) => [{ id: 1, label: stage === 0 ? '方向草稿' : '原始示例', size: 1, left: topdown ? 43 : 27, note: '', overlay: '' }]),
    selected: previewSteps.map(() => 0), drafts: previewSteps.map(() => ''), messages: [],
  };
}

export function openPreviewStage(project: PreviewProject, stage: number): PreviewProject {
  if (!Number.isInteger(stage) || stage < 0 || stage >= previewSteps.length || stage > project.confirmedThrough + 1) return project;
  return { ...project, stage };
}

export function confirmPreviewStage(project: PreviewProject): PreviewProject {
  if (project.stage === 5) return project; // The preview cannot certify or export a game.
  const nextStage = project.stage + 1;
  let versions = project.versions;
  let selected = project.selected;
  if (project.stage >= 1 && project.stage <= 3) {
    const current = versions[project.stage][selected[project.stage]];
    const next = versions[nextStage][selected[nextStage]];
    if (next.size !== current.size || next.left !== current.left) {
      versions = [...versions]; selected = [...selected];
      versions[nextStage] = [...versions[nextStage], { ...next, id: versions[nextStage].length + 1,
        label: '沿用已确认构图', size: current.size, left: current.left }];
      selected[nextStage] = versions[nextStage].length - 1;
    }
  }
  return { ...project, versions, selected, confirmedThrough: Math.max(project.confirmedThrough, project.stage), stage: nextStage };
}

export function selectPreviewVersion(project: PreviewProject, index: number): PreviewProject {
  if (!project.versions[project.stage][index] || project.selected[project.stage] === index) return project;
  const selected = [...project.selected]; selected[project.stage] = index;
  return { ...project, selected, confirmedThrough: Math.min(project.confirmedThrough, project.stage - 1) };
}

/** Deliberately finite local actions; never pretend to understand arbitrary instructions. */
export function applyPreviewMessage(project: PreviewProject, request: string): PreviewProject {
  const text = request.trim();
  if (!text) return project;
  const stage = project.stage;
  const current = project.versions[stage][project.selected[stage]];
  const next = { ...current, id: project.versions[stage].length + 1, label: text };
  let reply = '';
  const supported = previewSuggestions[stage].includes(text);
  if (supported) {
    if (text === '主角放大一点') next.size = Math.min(1.8, current.size + .2);
    else if (text === '主角缩小一点') next.size = Math.max(.6, current.size - .2);
    else if (text === '主角靠左一些') next.left = Math.max(8, current.left - 8);
    else if (text === '展示胜利界面') next.overlay = 'victory';
    else if (text === '展示暂停界面') next.overlay = 'pause';
    else next.note = text;
    const changed = next.size !== current.size || next.left !== current.left || next.overlay !== current.overlay || next.note !== current.note;
    reply = changed
      ? stage === 3 ? '已将这条手感反馈记入演示版本。游戏参数没有改变，实际效果需要在正式制作台试玩。'
        : `已更新本地演示，新增 v${String(next.id).padStart(2, '0')}。画面和版本栏已同步变化。`
      : '当前演示已是这个状态，没有重复创建版本。';
    if (changed) {
      const versions = [...project.versions]; versions[stage] = [...versions[stage], next];
      const selected = [...project.selected]; selected[stage] = versions[stage].length - 1;
      const drafts = [...project.drafts]; drafts[stage] = '';
      return { ...project, versions, selected, drafts, confirmedThrough: Math.min(project.confirmedThrough, stage - 1),
        messages: [...project.messages, { stage, request: text, reply, applied: true }] };
    }
  } else {
    reply = stage === 5 ? '此页不生成导出文件。请使用正式制作台的交付步骤。'
      : '这条意见没有应用到画面。此预览只支持下方的演示修改；自由描述需要连接正式制作台的 AI。';
  }
  const drafts = [...project.drafts]; drafts[stage] = '';
  return { ...project, drafts, messages: [...project.messages, { stage, request: text, reply, applied: false }] };
}
