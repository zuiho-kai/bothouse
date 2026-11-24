import {createHash, randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {RequestError} from './errors.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const accountPattern = /^[a-z0-9_]{4,24}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const unavailable = () => new RequestError(503, 'Friends identity verification is unavailable. Try again later.');
const denied = () => new RequestError(403, 'The signed-in account could not be verified for this world.');
const conflict = () => new RequestError(409, 'Reopen your original world profile to confirm ownership.');
const year = 365 * 24 * 60 * 60 * 1000;

export function friendsIdentity({issuer,audience}:{issuer:string|null;audience:string|null}) {
  return {
    audience,
    async verify(body: Record<string, unknown>) {
      if (!issuer || !audience) throw unavailable();
      if (Object.keys(body).length !== 2 || typeof body.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(body.ticket) ||
          typeof body.expectedAccount !== 'string' || !accountPattern.test(body.expectedAccount)) throw denied();
      const url = issuer + '/api/v1/world-session-ticket/redeem';
      let record;
      try {
        const response = await fetch(url, {method:'POST', redirect:'error', signal:AbortSignal.timeout(5000),
          headers:{'Content-Type':'application/json'}, body:JSON.stringify({ticket:body.ticket,worldOrigin:audience})});
        if (!response.ok) {
          await response.body?.cancel();
          if ([400,401,403,409,410].includes(response.status)) throw denied();
          throw unavailable();
        }
        record = await response.json();
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw unavailable();
      }
      if (!record || record.account !== body.expectedAccount || record.worldOrigin !== audience ||
          typeof record.instanceId !== 'string' || !uuid.test(record.instanceId)) throw denied();
      const legacy = record.legacy;
      if (legacy !== null && (!legacy || typeof legacy.sourceId !== 'string' || !uuid.test(legacy.sourceId) ||
          typeof legacy.planetId !== 'string' || !legacy.planetId.startsWith('p-') || !uuid.test(legacy.planetId.slice(2)))) throw denied();
      return {account:body.expectedAccount, issuer, instance:record.instanceId as string,
        legacy: legacy as {sourceId:string;planetId:string} | null};
    },
  };
}

type Identity = Awaited<ReturnType<ReturnType<typeof friendsIdentity>['verify']>>;

type PrepareHome = (player:string, bind:()=>void)=>Promise<unknown>;

export function friendsPlayers(db:DatabaseSync, enroll:(player:string)=>void, prepareHome?:PrepareHome) {
  db.exec(`CREATE TABLE IF NOT EXISTS friends_players (
    issuer TEXT NOT NULL, instance TEXT NOT NULL, account TEXT NOT NULL,
    player TEXT NOT NULL UNIQUE REFERENCES players(id), PRIMARY KEY(issuer,instance,account));
    CREATE TABLE IF NOT EXISTS friends_world_sessions (
    digest TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES friends_players(player), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS friends_world_sessions_expiry ON friends_world_sessions(expires);`);
  const binding = db.prepare('SELECT player FROM friends_players WHERE issuer=? AND instance=? AND account=?');
  const bindingOf = db.prepare('SELECT issuer,instance,account FROM friends_players WHERE player=?');
  const oldLinks = `FROM app_resident_links l JOIN planet_resident_sources s ON s.id=l.source AND s.planet=l.planet
    JOIN planets p ON p.id=s.planet AND p.owner_id=s.owner AND p.kind='garden'`;
  const activeSession=db.prepare('SELECT player FROM friends_world_sessions WHERE digest=? AND expires>?');
  const legacyPlayer=db.prepare('SELECT id FROM players WHERE id=?');
  function resolve(cookieDigest:string) {
    if (!cookieDigest) return '';
    const session = activeSession.get(cookieDigest,Date.now());
    if (session) return String(session.player);
    return legacyPlayer.get(cookieDigest) ? cookieDigest : '';
  }
  const preparing=new Map<string,Promise<unknown>>();
  const insert=db.prepare('INSERT INTO friends_players(issuer,instance,account,player) VALUES(?,?,?,?)');
  return {
    resolve,
    destination(identity:Identity) {
      const home=db.prepare(`SELECT p.id FROM friends_players f JOIN planets p ON p.owner_id=f.player AND p.kind='garden'
        WHERE f.issuer=? AND f.instance=? AND f.account=?`).get(identity.issuer,identity.instance,identity.account);
      return {ok:true,account:identity.account,planetId:home ? String(home.id) : null};
    },
    async open(identity:Identity, cookieDigest:string):Promise<string|null> {
      const {issuer,instance,account,legacy} = identity;
      const scope=digest(JSON.stringify([issuer,account]));
      db.exec('BEGIN IMMEDIATE');
      try {
        const current=resolve(cookieDigest);
        const existing=binding.get(issuer,instance,account)?.player as string | undefined;
        const currentBinding=current && bindingOf.get(current);
        if (currentBinding && current !== existing) throw conflict();
        let player=existing;
        if (!player) {
          const proof=legacy && db.prepare('SELECT s.owner '+oldLinks+' WHERE l.scope=? AND l.source=? AND l.planet=?')
            .get(scope,legacy.sourceId,legacy.planetId);
          if (legacy && !proof) throw conflict();
          if (proof) {
            player=String(proof.owner);
          } else {
            const currentLink=current && db.prepare('SELECT l.scope '+oldLinks+' WHERE s.owner=?').get(current);
            if (currentLink && currentLink.scope !== scope) throw conflict();
            const unresolved=db.prepare('SELECT s.owner '+oldLinks+
              ' WHERE l.scope=? AND NOT EXISTS (SELECT 1 FROM friends_players f WHERE f.player=s.owner) LIMIT 1').get(scope);
            if (unresolved && !currentLink) throw conflict();
            player=current || randomBytes(32).toString('hex');
          }
          if (bindingOf.get(player)) throw conflict();
          if (!legacyPlayer.get(player)) {
            if (prepareHome) {
              // The home-sample worker can take several seconds. Never wait with a
              // SQLite transaction open. Attach ownership in the worker's save.
              db.exec('ROLLBACK');
              const key=JSON.stringify([issuer,instance,account]);
              let pending=preparing.get(key);
              if (!pending) {
                const next=player;
                pending=prepareHome(next,()=>{
                  if (db.prepare('SELECT 1 '+oldLinks+' WHERE l.scope=? AND NOT EXISTS (SELECT 1 FROM friends_players f WHERE f.player=s.owner)').get(scope)) throw conflict();
                  insert.run(issuer,instance,account,next);
                }).finally(()=>preparing.delete(key));
                preparing.set(key,pending);
              }
              try { await pending; }
              catch (error) { if (!binding.get(issuer,instance,account)) throw error; }
              return this.open(identity,cookieDigest);
            }
            enroll(player);
          }
          insert.run(issuer,instance,account,player);
        }
        // Never replace the sole local credential for a different historical player.
        if (current && current !== player) throw conflict();
        // An existing cookie remains valid on its own device; a new device gets its own bearer.
        let token=null;
        if (current !== player) {
          token=randomBytes(32).toString('hex');
          const now=Date.now();
          db.prepare('DELETE FROM friends_world_sessions WHERE expires<=?').run(now);
          db.prepare('INSERT INTO friends_world_sessions VALUES(?,?,?)').run(digest(token),player,now+year);
        }
        db.exec('COMMIT');
        return token;
      } catch (error) {
        if(db.isTransaction)db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
