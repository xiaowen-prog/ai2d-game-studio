import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreationWorkflow } from '../shared/creation.js';
import { creationStageTask, STAGED_INSTRUCTIONS } from './creationPrompts.js';

const START = '<!-- NOOBI_CREATION_CONTEXT_START -->';
const END = '<!-- NOOBI_CREATION_CONTEXT_END -->';
const managed = /<!-- NOOBI_CREATION_CONTEXT_START -->[\s\S]*?<!-- NOOBI_CREATION_CONTEXT_END -->\s*/gu;
const read = (path: string) => readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });

/** Keep project decisions in the chosen snapshot; only replace our own current-node block. */
export async function synchronizeCreationContext(root: string, workflow: CreationWorkflow): Promise<void> {
  let agents = await read(join(root, 'AGENTS.md'));
  // Migrate the exact legacy host-generated document, not arbitrary user instructions.
  if (agents.startsWith(`${STAGED_INSTRUCTIONS.implementer}\n\nHOST NODE 2-2:`)) agents = '';
  agents = agents.replace(managed, '').trimEnd();
  await writeFile(join(root, 'AGENTS.md'), `${agents}${agents ? '\n\n' : ''}${START}
${STAGED_INSTRUCTIONS.implementer}
The active node contract limits the scope of older full-game instructions below or above. Keep their applicable
quality rules, but do not produce deferred stages. GAME_DESIGN.md holds previous implementation decisions.
${creationStageTask(workflow)}
${END}\n`);
  const design = (await read(join(root, 'GAME_DESIGN.md'))).replace(managed, '').trimEnd();
  await writeFile(join(root, 'GAME_DESIGN.md'), `${design}${design ? '\n\n' : ''}${START}
## Current confirmed direction (host-managed)
${JSON.stringify(workflow.steps.direction.artifact?.direction ?? null, null, 2)}
Current task: ${workflow.task!.id}; stage: ${workflow.currentStage}.
Selected character: ${workflow.steps.character.artifact?.selectedCharacterId ?? 'not selected'}.
Existing decisions outside this block belong to the selected snapshot. Preserve them unless the current request changes them.
${END}\n`);
}
