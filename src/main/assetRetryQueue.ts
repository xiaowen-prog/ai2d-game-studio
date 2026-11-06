import type { AssetPlanStore } from './assetPlanStore.js';
import type { MediaToolProject } from './mediaToolBroker.js';
import type { AssetPlanRecord } from '../shared/contracts.js';

interface RetryJob {
  project: MediaToolProject;
  planId: string;
  controller: AbortController;
  ready: boolean;
}

interface AssetRetryQueueOptions {
  store: Pick<AssetPlanStore, 'queue' | 'get' | 'fail'>;
  run(project: MediaToolProject, planId: string, signal: AbortSignal): Promise<unknown>;
  onChanged?(projectId: string): void | Promise<void>;
  onSettled?(plan: AssetPlanRecord): void | Promise<void>;
  timeoutMs?: number;
}

/** Explicit user retries only. One writer at a time; never auto-replay paid jobs on restart. */
export class AssetRetryQueue {
  readonly #jobs = new Map<string, RetryJob>();
  #running: Promise<void> | null = null;
  #closed = false;
  constructor(private readonly options: AssetRetryQueueOptions) {}

  hasProject(projectId: string): boolean { return this.#jobs.has(projectId); }

  signalFor(projectId: string): AbortSignal | undefined { return this.#jobs.get(projectId)?.controller.signal; }
  cancel(projectId: string): void { this.#jobs.get(projectId)?.controller.abort(); }

  async enqueue(project: MediaToolProject, planId: string): Promise<AssetPlanRecord> {
    if (this.#closed) throw new Error('应用正在退出，请下次打开后重试。');
    if (this.#jobs.has(project.id)) throw new Error('这个项目已有素材重试任务，请等待完成。');
    if (this.#jobs.size >= 20) throw new Error('素材队列已满，请等待当前任务完成。');
    const job = { project, planId, controller: new AbortController(), ready: false };
    // Reserve before the first await: two clicks cannot enqueue the same project.
    this.#jobs.set(project.id, job);
    try {
      const queued = await this.options.store.queue(project.id, planId);
      job.ready = true;
      this.#notify(project.id);
      this.#pump();
      return queued;
    } catch (error) {
      this.#jobs.delete(project.id);
      throw error;
    }
  }

  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const job of this.#jobs.values()) job.controller.abort();
    await this.idle();
  }

  #pump(): void {
    if (this.#running) return;
    const job = [...this.#jobs.values()].find(item => item.ready);
    if (!job) return;
    this.#running = this.#execute(job).finally(() => {
      this.#jobs.delete(job.project.id);
      this.#running = null;
      this.#pump();
    });
  }

  async #execute(job: RetryJob): Promise<void> {
    const timer = setTimeout(() => job.controller.abort(), this.options.timeoutMs ?? 180_000);
    try {
      job.controller.signal.throwIfAborted();
      await this.options.run(job.project, job.planId, job.controller.signal);
      const settled = await this.options.store.get(job.project.id, job.planId);
      if (settled.status === 'queued' || settled.status === 'generating') {
        throw new Error('Retry worker returned without a settled asset result');
      }
    } catch {
      // Do not release the project when abort fires: a writer may still be unwinding.
      // Only completion of run() releases it. The durable result wins over late aborts.
      try {
        const plan = await this.options.store.get(job.project.id, job.planId);
        if (plan.status === 'queued' || plan.status === 'generating') {
          await this.options.store.fail(job.project.id, job.planId, {
            code: job.controller.signal.aborted ? 'generation-interrupted' : 'media-generation-failed',
            message: job.controller.signal.aborted
              ? '本次生成已停止或超时；远端可能已处理请求，请检查结果后再决定是否重试。'
              : '本次生成未完成，请查看素材状态后再重试。',
            retryable: true,
          });
        }
      } catch { /* Leave interrupted durable state for recovery on next launch. */ }
    } finally {
      clearTimeout(timer);
      this.#notify(job.project.id);
      void this.options.store.get(job.project.id, job.planId)
        .then(plan => this.options.onSettled?.(plan)).catch(() => undefined);
    }
  }

  #notify(projectId: string): void {
    void Promise.resolve().then(() => this.options.onChanged?.(projectId)).catch(() => undefined);
  }
}
