import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDesktopAuth, type DesktopSession } from './desktop-auth.ts';

test('only the local main renderer receives the capability, scoped to the API origin', () => {
  let listener: Parameters<DesktopSession['webRequest']['onBeforeSendHeaders']>[0] | undefined;
  const rendererPath = resolve('runtime/electron-helper/index.html');
  const renderer = pathToFileURL(rendererPath).href;
  installDesktopAuth(
    {
      webRequest: {
        onBeforeSendHeaders(fn) {
          listener = fn;
        },
      },
    },
    'http://127.0.0.1:3080',
    rendererPath,
    'private-token',
  );
  assert.ok(listener);
  const send = (url: string, frame?: { url: string; parent: unknown } | null) => {
    let result: Record<string, string> = {};
    listener!(
      { url, frame, requestHeaders: { 'content-type': 'application/json', 'x-dsh-pet-token': 'stale-token' } },
      (response) => {
        result = response.requestHeaders;
      },
    );
    return result;
  };
  const endpoint = 'http://127.0.0.1:3080/dsh-pet-7340/chat';
  const ownFrame = { url: renderer + '?petIndex=0', parent: null };
  assert.equal(send(endpoint, ownFrame)['X-DSH-Pet-Token'], 'private-token');
  for (const frame of [
    undefined,
    null,
    { url: 'about:srcdoc', parent: {} },
    { url: renderer, parent: {} },
    { url: 'https://example.invalid/', parent: null },
    { url: renderer + '.other', parent: null },
  ]) {
    const headers = send(endpoint, frame);
    assert.equal(
      Object.keys(headers).some((name) => name.toLowerCase() === 'x-dsh-pet-token'),
      false,
    );
    assert.equal(headers['content-type'], 'application/json');
  }
  for (const url of [
    'http://127.0.0.1:3081/dsh-pet-7340/chat',
    'http://localhost:3080/dsh-pet-7340/chat',
    'https://example.invalid/dsh-pet-7340/chat',
    'http://127.0.0.1:3080/standalone-ai/settings',
    'invalid-url',
  ]) {
    assert.equal(send(url, ownFrame)['X-DSH-Pet-Token'], undefined);
  }
});
