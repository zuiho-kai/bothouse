'use strict';
const {createHash}=require('node:crypto');
const {publicCatalog}=require('../core/personas.cjs');

const CARD_ID=/^[0-9a-f]{16}$/;
const APPROVAL=/^[0-9a-f]{64}$/;
const BUILT_INS=new Map(publicCatalog().map(role=>[role.id,role]));
const roleError=(code,message)=>Object.assign(Error(message),{code});
const clip=(value,length)=>String(value??'').replace(/\r\n?/g,'\n')
 .replace(/[^\P{Cc}\n\t]|[\u202a-\u202e\u2066-\u2069]/gu,'').trim().slice(0,length).toWellFormed().trimEnd();

function builtInGroupPersona(persona){
 const role=BUILT_INS.get(persona.characterId)||BUILT_INS.get('claude-ju');
 return {...persona,name:role.name.zh,description:role.description.zh,speechExamples:[],notes:''};
}

function projectGroupRole(library,accountId,groupId,cardId){
 if(typeof cardId!=='string'||!CARD_ID.test(cardId))throw roleError('group_role_invalid','Choose an existing library character.');
 const card=library?.get(cardId);
 if(!card)throw roleError('group_role_missing','The public role card is no longer available.');
 const name=clip(card.name,40),description=clip(card.description,520),examples=clip(card.exampleDialogue,420);
 const approval=createHash('sha256').update(JSON.stringify([accountId,groupId,cardId,name,description,examples])).digest('hex');
 return {cardId,name,description,examples,approval};
}

function groupRoleBindings(rows,accountId,groupIds){
 if(!Array.isArray(rows)||!accountId)return [];
 return rows.slice(0,5).filter(row=>row&&row.accountId===accountId&&groupIds.includes(row.groupId));
}

function resolveGroupRoles(rows,library,accountId){
 const roles=new Map();
 for(const row of rows){
  let role=null;
  if(roles.has(row.groupId)){roles.set(row.groupId,null);continue;}
  try{
   if(typeof row.approval==='string'&&APPROVAL.test(row.approval)){
    const projection=projectGroupRole(library,accountId,row.groupId,row.cardId);
    if(projection.approval===row.approval)role=Object.freeze(projection);
   }
  }catch{/* Changed, removed and unreadable roles must be reviewed again. */}
  roles.set(row.groupId,role);
 }
 return roles;
}

module.exports={builtInGroupPersona,groupRoleBindings,projectGroupRole,resolveGroupRoles,roleError};
