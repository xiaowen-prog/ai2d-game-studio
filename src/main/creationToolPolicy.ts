import { isCharacterActionTask, type CreationWorkflow } from '../shared/creation.js';

/** Same allowlist for advertisement and execution, including resumed threads. */
export function creationMediaToolNames(workflow: CreationWorkflow): Set<string> {
  const read = ['noobi_asset_list', 'noobi_asset_register'];
  if (['direction', 'playable', 'delivery'].includes(workflow.currentStage)) return new Set();
  if (workflow.task?.appearanceTarget) return new Set(read);
  if (workflow.currentStage === 'game') return new Set([...read, 'noobi_asset_plan', 'noobi_audio_synthesize']);
  const editingCharacter = workflow.currentStage === 'character' && !isCharacterActionTask(workflow)
    && Boolean(workflow.steps.character.artifact?.selectedCharacterId);
  return new Set(editingCharacter ? [...read, 'noobi_character_edit_preview']
    : [...read, 'noobi_asset_plan', 'noobi_image_generate']);
}
