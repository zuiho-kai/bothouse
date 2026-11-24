import {existsSync,readFileSync} from 'node:fs';

function origin(value:unknown) {
  if(typeof value==='string'){
    try {
      const url=new URL(value);
      if(url.origin===value && (url.protocol==='https:' || (url.protocol==='http:' &&
          ['localhost','127.0.0.1','[::1]'].includes(url.hostname))))return value;
    } catch { /* Use the same actionable error for each invalid origin. */ }
  }
  throw new Error('Choose an exact HTTPS origin, or HTTP on loopback, for Friends and the world.');
}

export function originPair(friends:unknown,world:unknown){
  const issuer=origin(friends),audience=origin(world);
  if(issuer===audience)throw new Error('Friends and Little Worlds need their own service origins.');
  return {issuer,audience};
}

export function readFriendsOrigins(database:string,env:NodeJS.ProcessEnv){
  const filename=database+'.friends.json';
  if(database!==':memory:' && existsSync(filename)){
    const config=JSON.parse(readFileSync(filename,'utf8'));
    return originPair(config.issuer,config.audience);
  }
  if(env.LITTLE_WORLDS_FRIENDS_ORIGIN || env.LITTLE_WORLDS_PUBLIC_ORIGIN)
    return originPair(env.LITTLE_WORLDS_FRIENDS_ORIGIN,env.LITTLE_WORLDS_PUBLIC_ORIGIN);
  return {issuer:null,audience:null};
}
