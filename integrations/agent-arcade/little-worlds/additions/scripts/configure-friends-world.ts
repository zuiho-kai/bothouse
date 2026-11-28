// Run once at installation or when the operator intentionally changes services.
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,rmSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {originPair} from '../src/server/friends-origins.ts';

const {values}=parseArgs({options:{
  database:{type:'string'},'friends-origin':{type:'string'},'world-origin':{type:'string'},'desktop-service':{type:'string'},
}});
if(!values.database || Boolean(values['friends-origin'])===Boolean(values['desktop-service']))
  throw new Error('Use --database PATH --world-origin ORIGIN with --friends-origin ORIGIN or --desktop-service service.json.');
const desktop=values['desktop-service'] && JSON.parse(readFileSync(values['desktop-service'],'utf8').replace(/^\uFEFF/,''));
const requestedWorld=values['world-origin'];
if(desktop?.littleWorldsOrigin && requestedWorld && desktop.littleWorldsOrigin!==requestedWorld)throw new Error('The desktop selects a different world.');
const origins=originPair(desktop ? desktop.origin : values['friends-origin'],requestedWorld ?? desktop?.littleWorldsOrigin);
const filename=resolve(values.database)+'.friends.json';
mkdirSync(dirname(filename),{recursive:true});
const pending=filename+'.'+randomUUID()+'.tmp';
try{
  writeFileSync(pending,JSON.stringify(origins,null,2)+'\n',{flag:'wx',mode:0o600});
  renameSync(pending,filename);
}finally{rmSync(pending,{force:true});}
console.log(JSON.stringify({friendsOrigin:origins.issuer,worldOrigin:origins.audience,file:filename}));
