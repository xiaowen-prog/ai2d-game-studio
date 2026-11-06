import { readFile, stat } from 'node:fs/promises';
import { CreationError } from './creationWorkflowStore.js';
import { safeCreationFile } from './creationVersionStore.js';

/** Complete rounds share local WAV validation; playback remains an engine/reviewer check. */
export async function validateRoundAudio(root: string, audio: unknown, kinds: readonly string[]): Promise<void> {
  const paths = audio && typeof audio === 'object' ? audio as Record<string, unknown> : {};
  for (const kind of kinds) {
    const path = paths[kind];
    if (typeof path !== 'string' || !/^public\/assets\/audio\/[A-Za-z0-9_-]+\.wav$/u.test(path)) throw new CreationError('INVALID_GAME_AUDIO', '完整小局缺少必要音效。');
    const file = await safeCreationFile(root, path), size = (await stat(file)).size;
    if (size <= 44 || size > 4_000_000) throw new CreationError('INVALID_GAME_AUDIO', '音效文件为空或过大。');
    const bytes = await readFile(file);
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
      throw new CreationError('INVALID_GAME_AUDIO', '音效不是有效的 WAV 文件。');
    }
  }
}
