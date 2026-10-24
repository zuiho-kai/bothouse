/**
 * Reusable fake EventSource for client-ui-discord data-layer tests.
 *
 * The channel client only depends on the narrow `EventStreamLike` surface
 * (`onopen`/`onmessage`/`onerror`/`close`), so a test can drive a stream's whole
 * lifecycle without a browser. `FakeEventSourceHub` hands out one stream per
 * connection attempt, which lets a test express "the socket dropped, the client
 * opened a new one, then it caught up" instead of only asserting on error.
 *
 * Usage:
 *   const hub = new FakeEventSourceHub()
 *   // ...pass `hub.openEvents` as ChannelTransport.openEvents
 *   hub.drop()                          // current stream errors like a dead socket
 *   hub.open()                          // next stream reports open
 *   hub.emit({ type: 'message', ... })  // deliver one SSE frame
 */
import type { EventStreamLike } from '../src/client/channel-source.ts'

export class FakeEventStream implements EventStreamLike {
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent<string>) => unknown) | null = null
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null
  /** True once the client called `close()`; a closed stream never fires again. */
  closed = false
  /** Set when the hub produced this stream, so tests can label attempts. */
  readonly attempt: number

  constructor(attempt: number) {
    this.attempt = attempt
  }

  close(): void {
    this.closed = true
  }

  /** Simulate a server-sent frame. Ignored after close, like a real EventSource. */
  deliver(data: unknown): boolean {
    if (this.closed || this.onmessage === null) return false
    this.onmessage.call({} as EventSource, { data: JSON.stringify(data) } as MessageEvent<string>)
    return true
  }

  /** Simulate the connection opening successfully. */
  open(): boolean {
    if (this.closed || this.onopen === null) return false
    this.onopen.call({} as EventSource, new Event('open'))
    return true
  }

  /** Simulate a transport-level failure. Ignored after close. */
  fail(): boolean {
    if (this.closed || this.onerror === null) return false
    this.onerror.call({} as EventSource, new Event('error'))
    return true
  }
}

export class FakeEventSourceHub {
  /** Every stream handed out, oldest first. */
  readonly streams: FakeEventStream[] = []
  private attempt = 0

  /** Bind this to `ChannelTransport.openEvents`. */
  readonly openEvents = (): EventStreamLike => {
    const stream = new FakeEventStream(++this.attempt)
    this.streams.push(stream)
    return stream
  }

  /** The stream the client is currently using, if any. */
  get current(): FakeEventStream | undefined {
    for (let i = this.streams.length - 1; i >= 0; i -= 1) {
      const stream = this.streams[i]
      if (stream !== undefined && !stream.closed) return stream
    }
    return undefined
  }

  /** How many connection attempts the client has made. */
  get attempts(): number {
    return this.streams.length
  }

  /** Close the current stream and fire its error handler: a dropped socket. */
  drop(): boolean {
    const stream = this.current
    if (stream === undefined) return false
    return stream.fail()
  }

  /** Report the current stream as open (the client usually backfills on this). */
  open(): boolean {
    const stream = this.current
    if (stream === undefined) return false
    return stream.open()
  }

  /** Deliver a frame on the current stream. */
  emit(data: unknown): boolean {
    const stream = this.current
    if (stream === undefined) return false
    return stream.deliver(data)
  }

  /** Streams the client abandoned by calling close(). */
  get closedStreams(): FakeEventStream[] {
    return this.streams.filter(stream => stream.closed)
  }
}
