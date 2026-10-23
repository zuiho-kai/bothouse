// Only the host package boundary is fake. Hub, Store, Gateway and plugin routes
// are imported unchanged. These gateway-only tests must never start an agent.
export function createUserMessage() { throw Error('entry test must not create DSH input'); }
export class ClientSideConnection {
  constructor() { throw Error('entry test must not start an ACP client'); }
}
export function ndJsonStream() { throw Error('entry test must not open an ACP stream'); }
