export const CREATION_STAGES = [
  { id: 'direction', label: '方向', next: '生成候选人物' },
  { id: 'character', label: '人物', next: '制作场景' },
  { id: 'scene', label: '场景', next: '制作核心试玩' },
  { id: 'playable', label: '核心试玩', next: '制作完整游戏' },
  { id: 'game', label: '完整游戏', next: '检查与导出' },
  { id: 'delivery', label: '交付', next: '确认完成' },
] as const;
export type CreationStage = typeof CREATION_STAGES[number]['id'];
/** Release boundary owned by the host; requests cannot unlock unaccepted development nodes. */
export const CREATION_LAST_ENABLED_STAGE: CreationStage = 'delivery';
export function isCreationStageEnabled(stage: CreationStage, last: CreationStage = CREATION_LAST_ENABLED_STAGE): boolean {
  const index = CREATION_STAGES.findIndex((item) => item.id === stage);
  return index >= 0 && index <= CREATION_STAGES.findIndex((item) => item.id === last);
}
/** Both confirmed 2D directions can export; an unknown direction cannot skip the scene gate. */
export function creationStageLimit(genre: CreationGenre | undefined, last: CreationStage = CREATION_LAST_ENABLED_STAGE): CreationStage {
  if (last === 'game' || last === 'delivery') return genre === 'platformer' || genre === 'topdown' ? last : 'scene';
  return last === 'playable' && genre !== 'platformer' && genre !== 'topdown' ? 'scene' : last;
}
export type CreationStatus = 'idle' | 'running' | 'awaiting-confirmation' | 'confirmed' | 'needs-update' | 'failed' | 'stopped';
export type CreationGenre = 'platformer' | 'topdown';
export type AppearanceTarget = 'character' | 'scene';
export interface CreationDirection {
  title: string;
  genre: CreationGenre;
  theme: string;
  controls: string;
  goal: string;
  style: string;
  scope: string[];
}
export interface CreationCandidate { id: string; name: string; image: string; description?: string }
export interface CreationActions { manifest: string; states: Array<{ id: 'idle' | 'walk' | 'jump' | 'attack'; label: string; key: string }>; }
export interface CreationMedia { path: string; label: string; kind: 'image' | 'animation' }
export interface CreationDelivery {
  bundleId: string;
  sourceVersionId: string;
  sourceSnapshotId: string;
  manifestSha256: string;
  archiveSha256: string;
  fileCount: number;
}
export interface CreationArtifact {
  id: string;
  stage: CreationStage;
  title: string;
  summary: string;
  changes: string[];
  createdAt: string;
  direction?: CreationDirection;
  candidates: CreationCandidate[];
  selectedCharacterId: string | null;
  /** Candidate approval does not approve animations or unlock scenes. */
  characterPhase?: 'candidates' | 'actions';
  actions?: CreationActions;
  scene?: { manifest: string; background: string; genre: CreationGenre };
  playable?: { manifest: string; genre: 'platformer'; maxJumps: 1 | 2 }
    | { manifest: string; genre: 'topdown'; maxBounces: 0 | 1 };
  round?: { manifest: '.noobi/platformer-round.json'; genre: 'platformer'; timeLimitSeconds: number; maxJumps: 1 | 2 }
    | { manifest: '.noobi/topdown-round.json'; genre: 'topdown'; waveCounts: number[]; playerHealth: number; maxBounces: 0 | 1 };
  media: CreationMedia[];
  ready: boolean;
  snapshotId: string | null;
  checks: string[];
  /** Host-recorded hashes of assets which later stages must preserve. */
  lockedAssets: Record<string, string>;
  /** Host-created linked revision, approved together from the full-game screen. */
  appearanceChange?: { target: AppearanceTarget; checkpointId: string; stages: CreationStage[] };
  delivery?: CreationDelivery;
}
/** Transient generator result; linked artifacts are stored as ordinary stage records. */
export type CreationGenerationResult = CreationArtifact & { linkedArtifacts?: Partial<Record<CreationStage, CreationArtifact>> };
export interface CreationStep {
  status: CreationStatus;
  artifact: CreationArtifact | null;
  confirmedVersionId: string | null;
}
export interface CreationTask {
  id: string;
  operationId: string;
  stage: CreationStage;
  characterPhase?: 'candidates' | 'actions';
  appearanceTarget?: AppearanceTarget;
  sourceCheckpointId?: string;
  prompt: string;
  startedAt: string;
  state: 'running' | 'succeeded' | 'failed' | 'stopped';
  baseVersionId: string | null;
  error: string | null;
}
export interface CreationCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  stage: CreationStage;
  steps: Record<CreationStage, CreationStep>;
  snapshotId: string | null;
  completed: boolean;
}
export interface CreationWorkflow {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  idea: string;
  currentStage: CreationStage;
  workingSnapshotId: string | null;
  steps: Record<CreationStage, CreationStep>;
  task: CreationTask | null;
  history: CreationCheckpoint[];
  operations: Array<{ id: string; fingerprint: string }>;
  error: { code: string; message: string } | null;
  completed: boolean;
  updatedAt: string;
}
export interface CreationAction {
  projectId: string;
  operationId: string;
  expectedRevision: number;
  action: 'run' | 'confirm' | 'select' | 'revise' | 'restore' | 'stop' | 'animate' | 'edit-character' | 'continue' | 'revise-appearance' | 'export' | 'return-game';
  appearanceTarget?: AppearanceTarget;
  prompt?: string;
  versionId?: string;
  candidateId?: string;
  stage?: CreationStage;
  checkpointId?: string;
  /** Required when returning to an earlier or already approved stage. */
  impactAccepted?: boolean;
}
export interface CreationPreview {
  images: Array<{ path: string; url: string; label: string }>;
  playableUrl: string | null;
  exportDirectory: string | null;
}
export type CreationReply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export interface CreationApi {
  get(projectId: string): Promise<CreationReply<CreationWorkflow | null>>;
  act(input: CreationAction): Promise<CreationReply<CreationWorkflow>>;
  preview(projectId: string, versionId: string): Promise<CreationReply<CreationPreview>>;
  revealDelivery(projectId: string, versionId: string): Promise<CreationReply<void>>;
  onChanged(listener: (workflow: CreationWorkflow) => void): () => void;
}
export function isCreationStage(value: unknown): value is CreationStage {
  return CREATION_STAGES.some((stage) => stage.id === value);
}
export function affectedStages(stage: CreationStage): CreationStage[] {
  return CREATION_STAGES.slice(CREATION_STAGES.findIndex((item) => item.id === stage)).map((item) => item.id);
}
/** Only unambiguous assent can be a confirmation. Mixed assent + edits stays an edit. */
export function isExplicitConfirmation(text: string): boolean {
  return /^(确认|确认继续|确认完成|可以|继续|可以继续|这个版本可以|这个版本可以继续|按这个方向开始|确认人物继续场景)$/u
    .test(text.trim().replace(/[\s，。！、,.!]/gu, ''));
}

export function isCharacterActionTask(workflow: CreationWorkflow): boolean {
  return workflow.currentStage === 'character' && workflow.task?.characterPhase === 'actions';
}
