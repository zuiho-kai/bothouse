'use strict';

const {randomUUID}=require('node:crypto');
const {builtInGroupPersona,groupRoleBindings}=require('./group-public-role.cjs');

const targetKeys=['profileId','expectedAccountId','groupId','cardId'];
const validCard=id=>typeof id==='string'&&/^[a-f0-9]{16}$/.test(id);
const validQQ=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/.test(id);
const changed=()=>Object.assign(Error('Review the current QQ account, group and card again.'),{code:'group_role_changed'});
function fields(value,keys){
  return value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}

// A preview belongs to the registered profile and its exact public binding.
// A verified reconnect or changes in a different group do not change either.
class GroupCardAssignments {
  constructor({accounts,library,available=()=>true,now=Date.now}){
    Object.assign(this,{accounts,library,available,now});this.reviews=new Map();
  }
  invalidate(){this.reviews.clear();}
  description(entry,service,groupId){
    const {qqAccountId:expectedAccountId}=service.config;
    const saved=groupRoleBindings(service.config.qqGroupRoles,expectedAccountId,[groupId]).find(row=>row.groupId===groupId);
    let currentCardId=saved?.cardId??null,currentRoleStatus,currentRoleName='';
    if(service.status==='connected'){
      const live=service.groupRoute.publicRoles.get(groupId);
      currentRoleStatus=live===null?'review_required':live?'card':'builtin';
      if(live){currentCardId=live.cardId;currentRoleName=live.name;}
      if(live===undefined)currentRoleName=builtInGroupPersona(service.socialStore.config()).name;
    }else{
      try{currentRoleName=service.groupPublicRole(expectedAccountId,groupId).roleName;currentRoleStatus=saved?'card':'builtin';}
      catch{currentRoleStatus='review_required';}
    }
    return {profileId:entry.id,profileName:entry.name,expectedAccountId,groupId,currentCardId,currentRoleName,currentRoleStatus,status:service.status};
  }
  eligible(manager,entry,service){
    if(!service || !['connected','disconnected'].includes(service.status) || service.forgetting ||
       manager.credentialMigrations.has(entry.id) || service.config.channel!=='qq' ||
       !validQQ(service.config.qqAccountId) || !this.available(entry.id,service.config.qqAccountId))return [];
    const groups=service.ordinaryGroupSettings();
    if(!groups.enabled || !service.socialStore.config().enabled)return [];
    return groups.groupIds.filter(id=>validQQ(id) && (service.status==='disconnected' ||
      service.client?.ready && service.client.accountId===service.config.qqAccountId &&
      service.groupRoute?.ownsOrdinaryGroup(service.config.qqAccountId,id)));
  }
  targets(value){
    if(!fields(value,['cardId'])||!validCard(value.cardId)||!this.library.get(value.cardId))throw changed();
    const manager=this.accounts(),targets=[];
    for(const entry of manager.accounts){
      const service=manager.services.get(entry.id);
      for(const groupId of this.eligible(manager,entry,service))targets.push(this.description(entry,service,groupId));
    }
    return {targets};
  }
  target(value){
    const manager=this.accounts(),entry=manager.accounts.find(row=>row.id===value.profileId),service=manager.services.get(value.profileId);
    if(!entry||service?.config.qqAccountId!==value.expectedAccountId||!this.eligible(manager,entry,service).includes(value.groupId))throw changed();
    return {manager,entry,service};
  }
  binding(service,target){
    const [saved]=groupRoleBindings(service.config.qqGroupRoles,target.expectedAccountId,[target.groupId]);
    return JSON.stringify([saved?.approval??null,target.currentRoleStatus,target.currentCardId,target.currentRoleName]);
  }
  preview(value){
    if(!fields(value,targetKeys)||!validCard(value.cardId))throw changed();
    const {manager,entry,service}=this.target(value),projection=service.groupRolePreview(value),reviewToken=randomUUID();
    const target=this.description(entry,service,value.groupId);
    if(this.reviews.size>=32)this.reviews.delete(this.reviews.keys().next().value);
    this.reviews.set(reviewToken,{manager,entry,service,input:{...value},approval:projection.approval,
      binding:this.binding(service,target),revision:service.groupRoleRevision(value.groupId),
      selectedId:manager.selectedId,expires:this.now()+300000});
    return {...target,...projection,reviewToken};
  }
  apply(value){
    const stale={saved:false,state:'changed',code:'group_role_changed'};
    if(!fields(value,[...targetKeys,'approval','reviewToken']))return stale;
    const review=this.reviews.get(value.reviewToken);
    this.reviews.delete(value.reviewToken);
    if(!review||review.expires<=this.now()||value.approval!==review.approval||targetKeys.some(k=>value[k]!==review.input[k]))return stale;
    try{
      const {manager,entry,service}=this.target(value);
      if(review.manager!==manager||review.entry!==entry||review.service!==service||manager.selectedId!==review.selectedId ||
         service.groupRoleRevision(value.groupId)!==review.revision ||
         this.binding(service,this.description(entry,service,value.groupId))!==review.binding)return stale;
      // This synchronous path recomputes the public projection, writes the
      // exact target first, then changes only that group's live admission.
      return service.groupRoleSet(value);
    }catch(error){
      if(/^group_role_/.test(error?.code||''))return stale;
      return {saved:false,state:'save_failed'};
    }
  }
}
module.exports={GroupCardAssignments};
