'use strict';

const {digest}=require('./event.cjs');
const {groupFolderChange}=require('./group-folder.cjs');
const {isGroupPageName}=require('./group-page.cjs');

function publishSourceEvent(bus,event,source,identity,calendarOccurrence){
  bus.publish({...event,notify:source.notify,sourceName:source.name});
  if(!identity)return;
  // This internal projection cannot consume the existing Bus's dedup budget.
  // The destination journal deduplicates the item by exact subscription.
  if(event.kind==='feed.item'){
    bus.publish({feedItemId:digest(JSON.stringify(['group-feed',identity,event.id])),source:event.source,
      kind:'group-feed.item',groupFeedIdentity:identity,feedTitle:event.title,at:event.at});
  }else if(event.kind==='calendar.upcoming'&&calendarOccurrence?.id===event.id){
    publishGroupCalendarEvent(bus,source,identity,calendarOccurrence,event.at);
  }else if(source.kind==='feed'&&source.mode==='page'&&event.kind==='page.changed'&&isGroupPageName(source.name)){
    bus.publish({pageItemId:digest(JSON.stringify(['group-page',identity,event.id])),source:event.source,
      kind:'group-page.changed',groupPageIdentity:identity,pageName:source.name,at:event.at});
  }else if(source.kind==='folder'){
    const change=groupFolderChange(event);
    if(!change)return;
    bus.publish({folderItemId:digest(JSON.stringify(['group-folder',identity,event.id])),source:event.source,
      kind:'group-folder.change',groupFolderIdentity:identity,folderName:change.name,folderChange:change.change,at:event.at});
  }
}

function publishGroupCalendarEvent(bus,source,identity,occurrence,at){
  if(!identity||!occurrence)return;
  bus.publish({calendarItemId:occurrence.id,calendarDeliveryId:digest(JSON.stringify(['group-calendar',identity,occurrence.id])),
    source:source.id,kind:'group-calendar.upcoming',groupCalendarIdentity:identity,at});
}

function subscribeGroupFeedEvents(bus,{registry,services,active=()=>true}){
  return bus.subscribe({kind:'group-feed.item'},event=>{
    if(!active()||!event.groupFeedIdentity)return;
    const feed=registry.groupFeed(event.source);
    if(!feed?.enabled||feed.identity!==event.groupFeedIdentity)return;
    for(const service of services())service.groupFeedAccept(event,feed);
  });
}

function subscribeGroupCalendarEvents(bus,{registry,services,active=()=>true}){
  return bus.subscribe({kind:'group-calendar.upcoming'},event=>{
    if(!active()||!event.groupCalendarIdentity)return;
    const calendar=registry.groupCalendar(event.source);
    if(!calendar?.enabled||calendar.identity!==event.groupCalendarIdentity||!calendar.occurrence(event.calendarItemId))return;
    for(const service of services())service.groupCalendarAccept(event,calendar);
  });
}

function subscribeGroupFolderEvents(bus,{registry,services,active=()=>true}){
  return bus.subscribe({kind:'group-folder.change'},event=>{
    if(!active()||!event.groupFolderIdentity)return;
    const folder=registry.groupFolder(event.source);
    if(!folder?.enabled||folder.identity!==event.groupFolderIdentity)return;
    for(const service of services())service.groupFolderAccept(event,folder);
  });
}

function subscribeGroupPageEvents(bus,{registry,services,active=()=>true}){
  return bus.subscribe({kind:'group-page.changed'},event=>{
    if(!active()||!event.groupPageIdentity)return;
    const page=registry.groupPage(event.source);
    if(!page?.enabled||page.identity!==event.groupPageIdentity||page.name!==event.pageName)return;
    for(const service of services())service.groupPageAccept(event,page);
  });
}

module.exports={publishSourceEvent,publishGroupCalendarEvent,subscribeGroupFeedEvents,subscribeGroupCalendarEvents,
  subscribeGroupFolderEvents,subscribeGroupPageEvents};
