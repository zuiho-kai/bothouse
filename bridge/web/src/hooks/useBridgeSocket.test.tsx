import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useBridgeSocket } from './useBridgeSocket';

it('addresses a web chat message to the selected role', () => {
  const send = vi.fn();
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send = send;
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const bridgeCfg = { port: 9810, path: '/bridge/ws', token: 'test' };
  let sendMessage: ((text: string) => void) | undefined;
  function TestChat() {
    sendMessage = useBridgeSocket({
      bridgeCfg,
      projectName: 'cc',
      sessionKey: 'bridge:web-admin:cc',
      onMessage: () => {},
    }).sendMessage;
    return null;
  }
  try {
    act(() => root.render(<TestChat />));
    sendMessage?.('Reply to this test');
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({
      type: 'message',
      project: 'cc',
      session_key: 'bridge:web-admin:cc',
      mentioned: true,
    });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('registers separate connections without changing their session routing', () => {
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    send = vi.fn<(payload: string) => void>();
    constructor() { sockets.push(this); }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const roots = [createRoot(document.createElement('div')), createRoot(document.createElement('div'))];
  const bridgeCfg = { port: 9810, path: '/bridge/ws', token: 'test' };
  const sends: ((text: string) => void)[] = [];
  function Chat({ index, sessionKey }: { index: number; sessionKey: string }) {
    sends[index] = useBridgeSocket({ bridgeCfg, projectName: 'cc', sessionKey, onMessage: () => {} }).sendMessage;
    return null;
  }
  try {
    act(() => {
      roots[0].render(<Chat index={0} sessionKey="bridge:web-admin:cc" />);
      roots[1].render(<Chat index={1} sessionKey="bridge:web-admin:cc-new" />);
    });
    act(() => sockets.forEach(socket => socket.onopen?.()));
    const registrations = sockets.map(socket => JSON.parse(socket.send.mock.calls[0][0]));
    expect(registrations.map(message => message.type)).toEqual(['register', 'register']);
    expect(new Set(registrations.map(message => message.platform)).size).toBe(2);

    act(() => roots[1].render(<Chat index={1} sessionKey="bridge:web-admin:cc-older" />));
    expect(sockets).toHaveLength(2);
    sends[1]('Test');
    expect(JSON.parse(sockets[1].send.mock.calls[1][0])).toMatchObject({
      type: 'message',
      project: 'cc',
      session_key: 'bridge:web-admin:cc-older',
      reply_ctx: 'bridge:web-admin:cc-older',
    });
  } finally {
    act(() => roots.forEach(root => root.unmount()));
    vi.unstubAllGlobals();
  }
});
