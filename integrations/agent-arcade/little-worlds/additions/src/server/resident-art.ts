import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import {crc32,inflateSync} from 'node:zlib';
import {RequestError} from './errors.ts';
import type {planetResidents} from './planet-residents.ts';
import type {ResidentPortrait} from '../shared/resident-portrait.ts';

const limit=2*1024*1024;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const bad=()=>new RequestError(400,'Invalid resident portrait.');
const missing=()=>new RequestError(404,'This resident portrait is unavailable.');
function descriptor(value:unknown):ResidentPortrait|null {
  if(value===null)return null;
  if(!value||typeof value!=='object')throw bad();
  const r=value as Record<string,unknown>;
  if(Object.keys(r).sort().join(',')!=='author,license,pack,sha256'||
    typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||
    typeof r.pack!=='string'||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(r.pack))throw bad();
  for(const k of ['author','license'])if(typeof r[k]!=='string'||!r[k].trim()||r[k].length>160||/[\p{Cc}\p{Cf}]/u.test(r[k]))throw bad();
  return {sha256:r.sha256,pack:r.pack,author:r.author as string,license:r.license as string};
}

// Same essential pixel chunks as prepare-resident-art and the Friends static-image
// canonicalizer. The publisher strips other chunks before transport; reject them here.
function checkPng(bytes:Buffer) {
  if(bytes.length>limit||bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw bad();
  const compressed:Buffer[]=[];
  let rowBytes=0,height=0;
  for(let i=8;i+12<=bytes.length;){
    const size=bytes.readUInt32BE(i),end=i+size+12,kind=bytes.toString('latin1',i+4,i+8);
    if(end>bytes.length||crc32(bytes.subarray(i+4,end-4))!==bytes.readUInt32BE(end-4))throw bad();
    if(i===8){
      if(kind!=='IHDR'||size!==13)throw bad();
      for(const n of [bytes.readUInt32BE(16),bytes.readUInt32BE(20)])if(!n||n>1024)throw bad();
      const depth=bytes[24],color=bytes[25];
      const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
      const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      // A bounded, non-interlaced still. Reject unsupported encodings without decoding them.
      if(!depths[color]?.includes(depth)||bytes[26]||bytes[27]||bytes[28])throw bad();
      rowBytes=Math.ceil(bytes.readUInt32BE(16)*channels[color]*depth/8)+1;
      height=bytes.readUInt32BE(20);
    }else if(kind==='IEND'){
      if(!compressed.length||size!==0||end!==bytes.length)throw bad();
      const expected=rowBytes*height;
      let raw:Buffer;
      try{raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch{throw bad();}
      if(raw.length!==expected)throw bad();
      for(let pos=0;pos<expected;pos+=rowBytes)if(raw[pos]>4)throw bad();
      return;
    }else if(!['IDAT','PLTE','tRNS'].includes(kind))throw bad();
    if(kind==='IDAT'&&size)compressed.push(bytes.subarray(i+8,end-4));
    i=end;
  }
  throw bad();
}

export function withResidentArt(db:DatabaseSync, base:ReturnType<typeof planetResidents>){
  db.exec(`CREATE TABLE IF NOT EXISTS resident_portraits(
    slot TEXT NOT NULL REFERENCES planet_resident_sources(id) ON DELETE CASCADE,
    resident TEXT NOT NULL, descriptor TEXT NOT NULL, digest TEXT, png BLOB,
    PRIMARY KEY(slot,resident))`);
  function bound(token:string){
    base.authorize(token);
    const row=db.prepare(`SELECT s.id,s.roster FROM planet_resident_sources s JOIN planets p
      ON p.id=s.planet AND p.owner_id=s.owner WHERE s.credential=?`).get(hash(token));
    if(!row)throw missing();
    return row;
  }
  function onPlanet(planet:string){
    return db.prepare(`SELECT a.resident,a.descriptor,(a.png IS NOT NULL) AS ready FROM resident_portraits a
      JOIN planet_resident_sources s ON a.slot=s.id JOIN planets p ON p.id=s.planet AND p.owner_id=s.owner
      WHERE s.planet=?`).all(planet);
  }
  return {...base,
    publish(token:string, body:Record<string,unknown>){
      base.authorize(token);
      if(!Array.isArray(body.residents))throw bad();
      const extras=new Map<string,ResidentPortrait|null>();
      const residents=body.residents.map(row=>{
        if(!row||typeof row!=='object'||!Object.hasOwn(row,'portrait'))return row;
        const {portrait,...publicFields}=row;
        if(row.source!=='bridge'||typeof row.project!=='string'||typeof body.instance!=='string')throw bad();
        const id='bh_'+hash(body.instance+'\0'+row.project).slice(0,21);
        extras.set(id,descriptor(portrait));
        return publicFields;
      });
      db.exec('SAVEPOINT resident_art_publish');
      try{
        const result=base.publish(token,{...body,residents});
        const slot=bound(token),slotId=String(slot.id);
        const actual=new Set((JSON.parse(String(slot.roster)) as {id:string}[]).map(r=>r.id));
        const old=db.prepare('SELECT resident FROM resident_portraits WHERE slot=?').all(slotId);
        for(const row of old)if(!extras.has(String(row.resident)))db.prepare('DELETE FROM resident_portraits WHERE slot=? AND resident=?').run(slotId,row.resident);
        const save=db.prepare(`INSERT INTO resident_portraits(slot,resident,descriptor,digest) VALUES(?,?,?,?)
          ON CONFLICT(slot,resident) DO UPDATE SET descriptor=excluded.descriptor,digest=excluded.digest,
          png=CASE WHEN excluded.digest=resident_portraits.digest THEN resident_portraits.png END
          WHERE excluded.descriptor<>resident_portraits.descriptor`);
        for(const [id,d] of extras){
          if(!actual.has(id))throw bad();
          save.run(slotId,id,JSON.stringify(d),d?.sha256??null);
        }
        const missingArt=db.prepare('SELECT resident AS id,digest AS sha256 FROM resident_portraits WHERE slot=? AND digest IS NOT NULL AND png IS NULL').all(slotId);
        db.exec('RELEASE resident_art_publish');
        return missingArt.length?{...result,missingArt}:result;
      }catch(err){db.exec('ROLLBACK TO resident_art_publish; RELEASE resident_art_publish');throw err;}
    },
    read(viewer:string, planet:string){
      const {residents}=base.read(viewer,planet);
      const art=new Map(onPlanet(planet).map(a=>[String(a.resident),a]));
      return {residents:residents.map(r=>{
        const a=art.get(r.id);
        // An older client ignores portrait. Do not let it paint a different host's same-slug asset.
        const portrait=a?.ready?{...JSON.parse(String(a.descriptor)) as ResidentPortrait,slug:r.appearanceKey}:null;
        return a?{...r,appearanceKey:'default',portrait}:r;
      })};
    },
    checkUpload(token:string,id:string,digest:string){
      const slot=String(bound(token).id);
      if(!db.prepare('SELECT 1 FROM resident_portraits WHERE slot=? AND resident=? AND digest=?').get(slot,id,digest))throw missing();
      return slot;
    },
    upload(token:string,id:string,digest:string,bytes:Buffer){
      const slot=this.checkUpload(token,id,digest);
      checkPng(bytes);
      if(hash(bytes)!==digest)throw bad();
      const used=Number(db.prepare('SELECT COALESCE(SUM(length(png)),0) AS n FROM resident_portraits WHERE slot=? AND resident<>?').get(slot,id)!.n);
      if(used+bytes.length>32*1024*1024)throw new RequestError(413,'Too much public artwork on this connection.');
      db.prepare('UPDATE resident_portraits SET png=? WHERE slot=? AND resident=? AND digest=? AND png IS NULL').run(bytes,slot,id,digest);
    },
    image(viewer:string,planet:string,id:string,digest:string){
      if(!base.read(viewer,planet).residents.some(r=>r.id===id))throw missing();
      const row=db.prepare(`SELECT a.png FROM resident_portraits a JOIN planet_resident_sources s ON s.id=a.slot
        JOIN planets p ON p.id=s.planet AND p.owner_id=s.owner
        WHERE s.planet=? AND a.resident=? AND a.digest=? AND a.png IS NOT NULL`).get(planet,id,digest);
      if(!(row?.png instanceof Uint8Array))throw missing();
      return row.png;
    }
  };
}
export async function serveResidentArt(req:IncomingMessage,res:ServerResponse,path:string,viewer:string,service:ReturnType<typeof withResidentArt>,canReadVisit?: (planet:string)=>Promise<boolean>){
  const upload=/^\/api\/resident-feed\/art\/(bh_[a-f0-9]{21})\/([a-f0-9]{64})$/.exec(path);
  const read=/^\/api\/planets\/(p-[a-f0-9-]{36})\/residents\/(bh_[a-f0-9]{21})\/art\/([a-f0-9]{64})\.png$/.exec(path);
  if(!upload&&!read)return false;
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(upload){
    if(req.method!=='POST')throw new RequestError(405,'Use the bound publisher.');
    if(req.headers.origin||req.headers['content-type']!=='image/png')throw new RequestError(415,'Expected a publisher PNG.');
    const token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization??'')?.[1]??'';
    service.checkUpload(token,upload[1],upload[2]);
    const chunks:Buffer[]=[];let size=0;
    for await(const part of req){size+=part.length;if(size>limit)throw new RequestError(413,'Portrait too large.');chunks.push(Buffer.from(part));}
    service.upload(token,upload[1],upload[2],Buffer.concat(chunks));
    res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');
  }else if(read){
    if(req.method!=='GET')throw new RequestError(405,'Use GET.');
    if(!viewer)throw new RequestError(401,'Open your world first.');
    if(canReadVisit&&!await canReadVisit(read[1]))throw new RequestError(403,'This friend visit has closed.');
    const bytes=service.image(viewer,read[1],read[2],read[3]);
    res.writeHead(200,{'Content-Type':'image/png'});res.end(bytes);
  }
  return true;
}
