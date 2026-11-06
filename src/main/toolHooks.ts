/** Host dynamic tools only; Codex owns its native shell/MCP tool lifecycle. */
export interface ToolHookContext {
  readonly projectId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly tool: string;
}

export interface ToolHooks {
  /** Fail closed. No side effects: this policy check may time out. */
  before?(context: Readonly<ToolHookContext>): void | Promise<void>;
  /** Metadata only: no prompts, credentials, paths or provider responses. */
  after?(context: Readonly<ToolHookContext & { success: boolean; durationMs: number }>): void | Promise<void>;
  timeoutMs?: number;
}

export class ToolPolicyError extends Error {}

export async function checkToolPolicy(hooks: ToolHooks | undefined, context: ToolHookContext): Promise<void> {
  if (!hooks?.before) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => hooks.before!(Object.freeze({ ...context }))),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ToolPolicyError('工具权限检查超时，本次未执行。')), hooks.timeoutMs ?? 3_000);
      }),
    ]);
  } catch (error) {
    // Custom policy errors are deliberately public; unexpected errors stay private.
    throw error instanceof ToolPolicyError ? error : new ToolPolicyError('工具权限检查未通过，本次未执行。');
  } finally {
    clearTimeout(timer);
  }
}

export function observeTool(hooks: ToolHooks | undefined, context: ToolHookContext, success: boolean, started: number): void {
  // A broken observer must never change the tool result or trigger a second paid action.
  void Promise.resolve().then(() => hooks?.after?.(Object.freeze({ ...context, success, durationMs: Date.now() - started }))).catch(() => undefined);
}
