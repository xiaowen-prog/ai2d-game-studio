import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBrowserStudio } from './browserStudio';

describe('browser studio session boundary', () => {
  let directory: string;
  let studio: Awaited<ReturnType<typeof startBrowserStudio>>;
  let origin: string;
  let token: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zaojing-browser-studio-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>造境</title>');
    process.env.NOOBI_BROWSER_PORT = String(47000 + Math.floor(Math.random() * 1000));
    studio = await startBrowserStudio(directory, new Map([
      ['test', async () => ({ ok: true })],
    ]), async () => directory);
    const url = new URL(studio.url);
    origin = url.origin;
    token = url.searchParams.get('studioToken') ?? '';
  });

  afterAll(async () => {
    studio.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('requires the session token for browser operations', async () => {
    const response = await fetch(`${origin}/studio/test`, {
      method: 'POST',
      headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: '[]',
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'SESSION_REQUIRED' });
  });

  it('allows a valid session and hides operation details on failure', async () => {
    const success = await fetch(`${origin}/studio/test`, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-noobi-session': token,
      },
      body: '[]',
    });
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ ok: true });

    const failure = await fetch(`${origin}/studio/test`, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-noobi-session': token,
      },
      body: '{',
    });
    expect(failure.status).toBe(400);
    expect(await failure.json()).toMatchObject({ code: 'INVALID_JSON', error: '请求格式有误。' });
  });
});
