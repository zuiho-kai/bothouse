'use strict';
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicJSON}=require('../core/files.cjs');
const {validateDirectoryRequest}=require('./qq-console.cjs');

const FIELD='qqFriendContactPreparation';
const validId=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/.test(id);
const error=code=>Object.assign(Error('QQ friend preparation: '+code),{code});
const limit=10000;
const validList=list=>Array.isArray(list)&&list.length<=limit&&list.every(validId)&&new Set(list).size===list.length;

function createQQFriendContactPreparation({accounts,directory}){
  return async value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||!['view','save'].includes(value.action)||
      Object.keys(value).some(k=>!['action','profileId','accountId','roleId','revision','ids','serverName'].includes(k))||
      typeof value.profileId!=='string'||typeof value.roleId!=='string'||
      (value.action==='save'?!validList(value.ids):['ids','revision','serverName'].some(k=>Object.hasOwn(value,k))))throw error('invalid_config');
    const request=validateDirectoryRequest({accountId:value.accountId,kind:'friends',serverName:value.serverName,fresh:true});
    const manager=accounts();
    function capture(){
      const row=manager?.snapshot().accounts.find(entry=>entry.id===value.profileId);
      if(accounts()!==manager||!row||row.channel!=='qq'||row.expectedQQAccountId!==request.accountId||
        row.accountId&&row.accountId!==request.accountId||row.characterId!==value.roleId||
        !['connected','disconnected'].includes(row.status)||row.credentialMigration)throw error('changed');
      const service=manager.get(row.id);
      if(service.forgetting)throw error('changed');
      const config=service.config,stored=config[FIELD];
      const scoped=stored?.profileId===row.id&&stored.accountId===request.accountId&&stored.ownerId===row.qqOwnerId;
      const current=scoped&&Array.isArray(stored.roles)?stored.roles.find(role=>role?.id===row.characterId):null;
      return {row,service,config,roles:scoped&&Array.isArray(stored.roles)?stored.roles:[],
        selection:{ids:validList(current?.ids)?current.ids:[],revision:typeof current?.revision==='string'?current.revision:null}};
    }
    const before=capture();
    if(value.action==='view')return before.selection;
    if(value.revision!==before.selection.revision||value.ids.includes(request.accountId))throw error('changed');
    const existing=new Set(before.selection.ids),added=value.ids.filter(id=>!existing.has(id));
    if(added.length){
      const {accountId,...options}=request;
      const result=await directory(accountId,options);
      if(result?.accountId!==accountId||result.kind!=='friends')throw error('account_mismatch');
      const friends=new Set(result.items.map(row=>row.id));
      if(added.some(id=>!friends.has(id)))throw error('friend_not_found');
    }
    const current=capture();
    if(current.service!==before.service||current.config!==before.config||
      current.row.qqOwnerId!==before.row.qqOwnerId||current.selection.revision!==value.revision)throw error('changed');
    const selection={ids:value.ids,revision:randomUUID()};
    const next={profileId:current.row.id,accountId:request.accountId,ownerId:current.row.qqOwnerId,
      roles:[...current.roles.filter(role=>role?.id!==value.roleId),{id:value.roleId,...selection}]};
    atomicJSON(path.join(current.service.root,'bot-config.json'),{...current.config,[FIELD]:next});
    current.config[FIELD]=next;
    return selection;
  };
}
module.exports={createQQFriendContactPreparation};
