import { describe, expect, it } from 'vitest';
import { formatSSHArgs, parseSSHArgs } from './ZuluRemoteFields';

describe('ZuluRemoteFields SSH args helpers', () => {
  it('parses whitespace-separated and quoted SSH args', () => {
    expect(parseSSHArgs('')).toEqual([]);
    expect(parseSSHArgs('  -p 2222 -o "ControlPath=~/.ssh/cm %r@%h" ')).toEqual([
      '-p',
      '2222',
      '-o',
      'ControlPath=~/.ssh/cm %r@%h',
    ]);
  });

  it('round-trips formatted SSH args', () => {
    const args = ['-p', '2222', '-o', 'ProxyCommand=ssh -W %h:%p bastion'];
    const formatted = formatSSHArgs(args);
    expect(parseSSHArgs(formatted)).toEqual(args);
  });
});
