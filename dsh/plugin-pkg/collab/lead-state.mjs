import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The product-wide primary-role state shared with bridge and the optional
 * gate. An absent file means the configured fallback is still in effect.
 */
export class LeadState {
  constructor(path, logger) {
    this.path = path;
    this.logger = logger;
  }

  selected() {
    if (!existsSync(this.path)) return undefined;
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'));
      const lead = typeof value?.lead === 'string' ? value.lead.trim() : '';
      return lead || undefined;
    } catch (error) {
      this.logger?.warn?.('collab: cannot read lead state %s: %s', this.path, error?.message ?? error);
      return undefined;
    }
  }

  set(id, name) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify({ lead: id, name, at: new Date().toISOString() })}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
  }
}
