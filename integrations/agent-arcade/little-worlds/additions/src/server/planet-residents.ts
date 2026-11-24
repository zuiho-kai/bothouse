import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {residentActivities,type PlanetResident} from '../shared/planet-residents.ts';
import {RequestError} from './errors.ts';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const unavailable=()=>new RequestError(403,'This resident connection is no longer available.');
// Bothouse project settings accept 1–128 Unicode code points. Render public labels
// as text and discard control/bidi overrides, retaining emoji joiners.
function publicLabel(label:string){
  const name=[...label.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu,'').trim()].slice(0,128).join('');
  if(!name||/(?:[A-Za-z]:[\\/]|\\\\|https?:\/\/|^\/|^(?:sk-|ghp_|github_pat_|Bearer\s)\S{12,})/iu.test(name))return 'Bothouse AI';
  return name;
}
export const residentFreshMs=30_000;

export function planetResidents(db:DatabaseSync, now=Date.now){
  db.exec(`CREATE TABLE IF NOT EXISTS planet_resident_sources(
    id TEXT PRIMARY KEY, planet TEXT NOT NULL REFERENCES planets(id), owner TEXT NOT NULL REFERENCES players(id),
    credential TEXT NOT NULL UNIQUE, instance TEXT, roster TEXT NOT NULL DEFAULT '[]', sampled INTEGER NOT NULL DEFAULT 0
  ); CREATE INDEX IF NOT EXISTS resident_sources_by_planet ON planet_resident_sources(planet);`);
  function requireOwner(owner:string,planet:string){
    if(!db.prepare("SELECT 1 FROM planets WHERE id=? AND owner_id=? AND kind='garden'").get(planet,owner))
      throw new RequestError(403,'Only the owner can connect residents to this planet.');
  }
  function source(token:string){
    if(!/^[0-9a-f]{64}$/.test(token))throw unavailable();
    const row=db.prepare(`SELECT s.* FROM planet_resident_sources s JOIN planets p ON p.id=s.planet
      WHERE s.credential=? AND p.owner_id=s.owner`).get(digest(token));
    if(!row)throw unavailable();
    return row;
  }
  function requireLanded(viewer:string,planet:string) {
    const player=db.prepare('SELECT planet_id,flight FROM players WHERE id=?').get(viewer);
    if(!player||player.planet_id!==planet||(player.flight&&JSON.parse(String(player.flight)).mode==='space'))
      throw new RequestError(403,'Land on this planet to see its residents.');
  }
  return {
    requireLanded,
    owned(owner:string){return db.prepare('SELECT id FROM planets WHERE owner_id=?').get(owner)?.id as string|undefined;},
    connections(owner:string,planet:string){
      requireOwner(owner,planet);
      return db.prepare('SELECT id FROM planet_resident_sources WHERE planet=? AND owner=? ORDER BY rowid').all(planet,owner);
    },
    connect(owner:string,planet:string){
      requireOwner(owner,planet);
      if(Number(db.prepare('SELECT count(*) AS n FROM planet_resident_sources WHERE planet=?').get(planet)!.n)>=8)
        throw new RequestError(409,'Remove an unused connection first (up to eight per planet).');
      const sourceId=randomUUID(),token=randomBytes(32).toString('hex');
      db.prepare('INSERT INTO planet_resident_sources(id,planet,owner,credential) VALUES(?,?,?,?)').run(sourceId,planet,owner,digest(token));
      return {sourceId,token};
    },
    disconnect(owner:string,planet:string,sourceId:unknown){
      requireOwner(owner,planet);
      if(typeof sourceId!=='string')throw new RequestError(400,'Choose a resident connection.');
      db.prepare('DELETE FROM planet_resident_sources WHERE id=? AND planet=? AND owner=?').run(sourceId,planet,owner);
      return {ok:true};
    },
    authorize(token:string){source(token);},
    publish(token:string,body:Record<string,unknown>){
      const slot=source(token);
      const instance=body.instance;
      if(Object.keys(body).some(k=>!['instance','residents'].includes(k))||typeof instance!=='string'||!/^[a-f0-9]{64}$/.test(instance)||
        !Array.isArray(body.residents))throw new RequestError(400,'Invalid resident snapshot.');
      if(slot.instance!==null&&slot.instance!==instance)throw unavailable();
      if(db.prepare('SELECT 1 FROM planet_resident_sources WHERE planet=? AND instance=? AND id<>?').get(slot.planet,instance,slot.id))
        throw new RequestError(409,'This Bothouse instance already has a connection on this planet.');
      const roster:PlanetResident[]=[],ids=new Set<string>();
      for(const r of body.residents){
        if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['source','project','displayName','appearanceKey','activity'].includes(k))||
          !['bridge','dsh'].includes(r.source)||typeof r.project!=='string'||!r.project.length||r.project.length>256||/[\u0000-\u001f/\\]/u.test(r.project)||
          typeof r.displayName!=='string'||typeof r.appearanceKey!=='string'||!/^[-a-z0-9_]{1,64}$/.test(r.appearanceKey)||!residentActivities.includes(r.activity))throw new RequestError(400,'Invalid public resident fields.');
        const id='bh_'+digest(instance+'\0'+(r.source==='dsh'?'dsh\0':'')+r.project).slice(0,21);
        if(ids.has(id))throw new RequestError(400,'Duplicate project.');
        ids.add(id);
        roster.push({id,displayName:publicLabel(r.displayName),appearanceKey:r.appearanceKey,activity:r.activity});
      }
      db.prepare('UPDATE planet_resident_sources SET instance=?,roster=?,sampled=? WHERE id=?').run(instance,JSON.stringify(roster),now(),slot.id);
      return {ok:true};
    },
    read(viewer:string,planet:string){
      requireLanded(viewer,planet);
      const residents:PlanetResident[]=[];
      for(const row of db.prepare(`SELECT s.roster,s.sampled FROM planet_resident_sources s JOIN planets p ON p.id=s.planet
        WHERE s.planet=? AND s.owner=p.owner_id ORDER BY s.rowid`).all(planet)){
        const age=now()-Number(row.sampled);
        for(const r of JSON.parse(String(row.roster)) as PlanetResident[])
          residents.push(age<0||age>=residentFreshMs?{...r,activity:'unknown'}:r);
      }
      return {residents};
    },
  };
}
