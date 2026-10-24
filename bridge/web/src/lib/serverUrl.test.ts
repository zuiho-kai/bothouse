import { beforeEach, describe, expect, it } from 'vitest';
import { initialServerUrl } from './serverUrl';

beforeEach(() => {
  localStorage.clear();
});

describe('initialServerUrl', () => {
  it('defaults to the address the page was opened from', () => {
    expect(initialServerUrl()).toBe(window.location.origin);
    expect(initialServerUrl()).not.toContain('localhost:9820');
  });

  it('keeps a server URL saved on a previous login', () => {
    localStorage.setItem('cc_server_url', 'http://100.64.0.7:9820');
    expect(initialServerUrl()).toBe('http://100.64.0.7:9820');
  });
});
