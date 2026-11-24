import {createHash,randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {RequestError} from './errors.ts';
import {residentFreshMs,type planetResidents} from './planet-residents.ts';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function friendScope(body:Record<string,unknown>){
  const {account,socialOrigin}=body;
  if(typeof account!=='string'||!/^[a-z0-9_]{4,24}$/.test(account)||typeof socialOrigin!=='string')
    throw new RequestError(400,'Expected the signed-in Friends account and service.');
  let url:URL;
  try{url=new URL(socialOrigin);}catch{throw new RequestError(400,'Invalid Friends service origin.');}
  if(url.origin!==socialOrigin||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))
    throw new RequestError(400,'Invalid Friends service origin.');
  return digest(JSON.stringify([socialOrigin,account]));
}

export function appResidents(db:DatabaseSync, residents:ReturnType<typeof planetResidents>){
  db.exec(`CREATE TABLE IF NOT EXISTS app_resident_links (
    source TEXT PRIMARY KEY REFERENCES planet_resident_sources(id) ON DELETE CASCADE,
    planet TEXT NOT NULL UNIQUE REFERENCES planets(id) ON DELETE CASCADE,
    scope TEXT NOT NULL, lease TEXT NOT NULL)`);
  function home(owner:string){
    const row=db.prepare(`SELECT p.id FROM planets p JOIN players u ON p.id=u.planet_id
      WHERE p.kind='garden' AND p.owner_id=? AND u.id=p.owner_id
      AND COALESCE(json_extract(u.flight,'$.mode'),'')<>'space'`).get(owner);
    return row?String(row.id):null;
  }
  function link(owner:string,planet:string){
    return db.prepare(`SELECT l.source,l.scope,l.lease FROM app_resident_links l
      JOIN planet_resident_sources s ON s.id=l.source AND s.planet=l.planet
      WHERE l.planet=? AND s.owner=?`).get(planet,owner);
  }
  function transact<T>(run:()=>T){
    db.exec('SAVEPOINT app_residents');
    try{const result=run();db.exec('RELEASE app_residents');return result;}
    catch(e){db.exec('ROLLBACK TO app_residents; RELEASE app_residents');throw e;}
  }
  function rotate(source:string){
    const token=randomBytes(32).toString('hex');
    // Rotation also makes a slow heartbeat or PNG upload from the old service harmless.
    db.prepare("UPDATE planet_resident_sources SET credential=?,roster='[]',sampled=0 WHERE id=?").run(digest(token),source);
    db.prepare('DELETE FROM resident_portraits WHERE slot=?').run(source);
    return token;
  }
  function publisher(token:string){
    residents.authorize(token);
    const row=db.prepare(`SELECT l.source,l.scope FROM app_resident_links l
      JOIN planet_resident_sources s ON l.source=s.id AND l.planet=s.planet WHERE s.credential=?`).get(digest(token));
    if(!row)throw new RequestError(403,'This publisher does not belong to the App.');
    return row;
  }
  return {
    read(viewer:string,planet:string){
      const visible=residents.read(viewer,planet);
      // If Friends shut down while the world was unreachable, an old authorized
      // directory must not survive indefinitely. Independent sources keep their
      // usual unknown activity after a missed heartbeat.
      const stale=db.prepare(`SELECT s.id FROM app_resident_links l JOIN planet_resident_sources s ON l.source=s.id
        WHERE l.planet=? AND s.sampled>0 AND s.sampled<=?`).get(planet,Date.now()-residentFreshMs);
      if(!stale)return visible;
      transact(()=>{
        db.prepare("UPDATE planet_resident_sources SET roster='[]',sampled=0 WHERE id=?").run(stale.id);
        db.prepare('DELETE FROM resident_portraits WHERE slot=?').run(stale.id);
      });
      return residents.read(viewer,planet);
    },
    status(owner:string){
      const planet=home(owner),sourceId=planet?link(owner,planet)?.source??null:null;
      return {owned:!!planet,connected:!!sourceId,sourceId};
    },
    change(owner:string,body:Record<string,unknown>){
      const planet=home(owner);
      if(!planet)throw new RequestError(403,'Land on your own planet to change its residents.');
      return transact(()=>{
        const row=link(owner,planet);
        if(body.action==='connect'&&Object.keys(body).length===3){
          const scope=friendScope(body);
          if(row){
            if(row.scope!==scope)throw new RequestError(409,'This planet is connected to another Friends account.');
            const token=rotate(String(row.source));
            db.prepare('UPDATE app_resident_links SET lease=? WHERE source=?').run(digest(token),row.source);
            return {sourceId:row.source,token};
          }
          const slot=residents.connect(owner,planet);
          db.prepare('INSERT INTO app_resident_links(source,planet,scope,lease) VALUES(?,?,?,?)').run(slot.sourceId,planet,scope,digest(slot.token));
          return slot;
        }
        if(body.action==='disconnect'&&Object.keys(body).every(k=>['action','ifToken','sourceId'].includes(k))){
          if(row&&('ifToken' in body&&(typeof body.ifToken!=='string'||digest(body.ifToken)!==row.lease)||
                   'sourceId' in body&&body.sourceId!==row.source))
            throw new RequestError(409,'The resident connection has changed.');
          if(row)residents.disconnect(owner,planet,row.source);
          return {ok:true};
        }
        throw new RequestError(400,'Choose an App resident connection action.');
      });
    },
    check(token:string,body:Record<string,unknown>){
      const row=publisher(token);
      if(Object.keys(body).length!==3||row.source!==body.sourceId||row.scope!==friendScope(body))
        throw new RequestError(403,'The App connection belongs to a different account or source.');
      return {ok:true};
    },
    pause(token:string){
      return transact(()=>{rotate(String(publisher(token).source));return {ok:true};});
    }
  };
}
