'use strict';

const {randomUUID} = require('node:crypto');
const {windowsId}=require('../voice/qq-installed-voices.cjs');
const {publicCatalog}=require('../core/personas.cjs');
const {searchEndpoint}=require('./qq-public-lookup.cjs');
const {getGroupMediaRecording} = require('./qq-group-selected-recording.cjs');
const {isGroupCardRole,isCardImage,getGroupCardImage,getGroupNamedSticker,sameNamedSticker,
  groupStickerRows,namedStickerId,NAMED_STICKER_LIMIT} = require('./qq-group-card-images.cjs');
const catalog = new Map([
  ['claude-ju', ['ju-serena', 'ju-sticker', 'ju-portrait']],
  ['deepseek-whale', ['whale-recording', 'whale-speech', 'whale-sticker', 'whale-portrait']],
  ['codex-dragon', ['dragon-speech']]
]);
const qqId = value => typeof value === 'string' && /^[1-9]\d{4,14}$/u.test(value);
const isSticker = id => id.endsWith('-sticker');
const isRecording = id => id === 'whale-recording' || id === 'card-recording';
const cardAssets = ['card-speech','card-recording','card-sticker','card-portrait'];
const knownRoles=new Set(publicCatalog().map(role=>role.id));
const mediaForRole = roleId => isGroupCardRole(roleId) ? cardAssets : catalog.get(roleId)??(knownRoles.has(roleId)?[]:null);

function publicLookupSettings(config,accountId,groupId,roleId){
  if(config.channel!=='qq'||config.qqAccountId!==accountId||config.qqGroups?.enabled!==true||
     !config.qqGroups.groupIds?.includes(groupId))return null;
  const rows=config.qqGroupPublicLookup;
  if(!Array.isArray(rows)||rows.length>5)return null;
  const matches=rows.filter(row=>row?.accountId===accountId&&row.groupId===groupId&&row.roleId===roleId);
  if(matches.length!==1)return null;
  const {revision,web,disabledWeb}=matches[0];
  const source=web??disabledWeb;
  if(typeof revision!=='string'||!revision||!source||searchEndpoint(source)!==source||
    (web!==undefined&&disabledWeb!==undefined))return null;
  return {revision,web:source,...(disabledWeb!==undefined&&{enabled:false})};
}

function groupPublicLookup(config,accountId,groupId,roleId){
  const current=publicLookupSettings(config,accountId,groupId,roleId);
  return current?.enabled===false?null:current;
}

function setGroupPublicLookup(next,previous,change){
  if(!Object.hasOwn(change,'publicLookup')&&!Object.hasOwn(change,'expectedPublicLookup'))return;
  const {expectedAccountId:accountId,groupId,roleId,publicLookup,expectedPublicLookup}=change;
  const current=publicLookupSettings(previous,accountId,groupId,roleId);
  if(expectedPublicLookup!==(current?.revision??null)||typeof publicLookup!=='string')throw Error('Check the current public lookup settings.');
  const web=publicLookup===''?'':searchEndpoint(publicLookup);
  if(web===null)throw Error('Enter the full SearXNG /search endpoint.');
  const enabled=change.publicLookupEnabled!==false;
  if((current?.web??'')===web&&(!web||(current?.enabled!==false)===enabled))return;
  const rows=(Array.isArray(previous.qqGroupPublicLookup)?previous.qqGroupPublicLookup:[]).filter(row=>row?.groupId!==groupId);
  // A disabled source also reads as off in releases that only know the web key.
  if(web)rows.push({accountId,groupId,roleId,revision:randomUUID(),...(enabled?{web}:{disabledWeb:web})});
  if(rows.length)next.qqGroupPublicLookup=rows;
  else delete next.qqGroupPublicLookup;
}

function withGroupPublicLookup(config,change){
  const {expectedAccountId,groupId,roleId}=change;
  if(Object.keys(change).some(key=>!['expectedAccountId','groupId','roleId','publicLookup','expectedPublicLookup','publicLookupEnabled'].includes(key))||
    config.channel!=='qq'||!qqId(expectedAccountId)||expectedAccountId!==config.qqAccountId||
    config.qqGroups?.enabled!==true||!qqId(groupId)||!config.qqGroups.groupIds?.includes(groupId)||
    !mediaForRole(roleId)?.length||typeof change.publicLookupEnabled!=='boolean'||
    typeof change.publicLookup!=='string'||!change.publicLookup)throw Error('Review the saved group and public search source.');
  const next={...config};
  setGroupPublicLookup(next,config,change);
  return next;
}

function groupStickerRevision(config, groupId) {
  return config.qqGroupStickerRevisions?.[groupId] ?? null;
}

function renewGroupStickerRevision(next, groupId) {
  next.qqGroupStickerRevisions = {...next.qqGroupStickerRevisions, [groupId]:randomUUID()};
}

// Keep at most the current five groups. Once this profile has used a named
// sticker, re-admitting a removed group must never resurrect its old tickets.
function syncGroupStickerRevisions(next, previous, identityChanged) {
  if (!Object.hasOwn(previous,'qqGroupStickerRevisions')) return;
  const groups = cfg => cfg.channel==='qq' && cfg.qqGroups?.enabled===true && Array.isArray(cfg.qqGroups.groupIds)
    ? cfg.qqGroups.groupIds.filter(qqId).slice(0,5) : [];
  const before = groups(previous);
  const revisions = {};
  for (const groupId of groups(next)) {
    const saved = groupStickerRevision(previous,groupId);
    if (identityChanged || !before.includes(groupId)) revisions[groupId] = randomUUID();
    else if (saved!==null) revisions[groupId] = saved;
  }
  next.qqGroupStickerRevisions = revisions;
}

function normalizeAssets(value, roleId) {
  const media = mediaForRole(roleId);
  if (!media || !Array.isArray(value) || value.length > media.length ||
      new Set(value).size !== value.length || [...value].some(id => !media.includes(id))) return null;
  return media.filter(id => value.includes(id));
}

function selectedGroupMedia(config, accountId, groupId, roleId, purpose = 'request') {
  const groups = config?.qqGroups;
  if (config?.channel !== 'qq' || !mediaForRole(roleId) || !qqId(accountId) || !qqId(groupId) ||
      config.qqAccountId !== accountId || groups?.enabled !== true ||
      !Array.isArray(groups.groupIds) || !groups.groupIds.includes(groupId)) return [];
  const rows = config.qqGroupOutgoingMedia;
  if (!Array.isArray(rows) || rows.length > 5) return [];
  const matching = rows.filter(row => row?.accountId === accountId && row.groupId === groupId && row.roleId === roleId);
  if (matching.length !== 1) return [];
  const row = matching[0], requested = normalizeAssets(row.assets, roleId) || [];
  const named = getGroupNamedSticker(config,accountId,groupId,roleId);
  const duplicateVoice = (requested.includes('card-speech') && requested.includes('card-recording')) || (requested.includes('whale-speech')&&requested.includes('whale-recording'));
  const assets = requested.filter(id => {
    if (duplicateVoice && (id.endsWith('-speech')||id.endsWith('-recording'))) return false;
    if (isRecording(id)) return typeof row.recordingId === 'string' && row.recordingId === getGroupMediaRecording(config,accountId,groupId,roleId)?.sha256;
    if (isSticker(id) && (named || row.namedSticker!==undefined)) return !!named && sameNamedSticker(row.namedSticker,named);
    if (isCardImage(id)) return typeof row.imageIds?.[id] === 'string' && row.imageIds[id] === getGroupCardImage(config,accountId,groupId,roleId,id)?.sha256;
    return true;
  });
  if (purpose === 'request') return assets;
  if (purpose !== 'reaction') return [];
  const otherReactions = normalizeAssets(row.reactionAssets, roleId) || [];
  return assets.filter(id => isSticker(id) ? row.stickerReaction === true : otherReactions.includes(id));
}

function groupNamedStickers(config, accountId, groupId, roleId, purpose) {
  if (!['configured','request','reaction'].includes(purpose)) return [];
  return groupStickerRows(config,accountId,groupId,roleId).map(row=>{
    const {name,sourceSha256,sha256,width,height}=row;
    const request=row.id ? row.request : selectedGroupMedia(config,accountId,groupId,roleId).includes(row.assetId);
    const reaction=row.id ? row.reaction : row.reactionOnly===true || selectedGroupMedia(config,accountId,groupId,roleId,'reaction').includes(row.assetId);
    return {id:row.id||namedStickerId(row),name,sourceSha256,sha256,width,height,request,reaction,stickerRevision:groupStickerRevision(config,groupId)};
  }).filter(item=>purpose==='configured' || item[purpose]);
}
function groupCardVoice(config,accountId,groupId,roleId){
  const groups=config.qqGroups;
  if(config.channel!=='qq'||!qqId(accountId)||config.qqAccountId!==accountId||!isGroupCardRole(roleId)||
     groups?.enabled!==true||!Array.isArray(groups.groupIds)||!groups.groupIds.includes(groupId))return null;
  const row=Array.isArray(config.qqGroupCardVoices)&&config.qqGroupCardVoices.find(r=>
    r?.accountId===accountId&&r.groupId===groupId&&r.roleId===roleId);
  if(!row||row.id!=='serena'&&!windowsId(row.id)||typeof row.name!=='string'||typeof row.locale!=='string'||
     typeof row.revision!=='string')return null;
  return {id:row.id,name:row.name,locale:row.locale,revision:row.revision};
}

function withGroupCardVoice(config,{accountId,groupId,roleId},voice){
  const next={...config};
  pruneGroupMedia(next);
  next.qqGroupCardVoices=[...(next.qqGroupCardVoices||[]).filter(row=>row.groupId!==groupId),
    {accountId,groupId,roleId,id:voice.id,name:voice.name,locale:voice.locale,revision:randomUUID()}];
  return next;
}

function groupMediaOptions(config, rolesByGroup, hasCardPortrait, hasRoleVoice) {
  const accountId = config.qqAccountId, groups = config.qqGroups;
  if (config.channel !== 'qq' || !qqId(accountId) || groups?.enabled !== true || !Array.isArray(groups.groupIds)) return [];
  const options = [];
  for (const groupId of groups.groupIds) {
    const current = rolesByGroup.get(groupId);
    if (!qqId(groupId) || !mediaForRole(current?.roleId)) continue;
    const {roleId, roleName} = current;
    const reactionAssets = selectedGroupMedia(config, accountId, groupId, roleId, 'reaction');
    const availableAssets=mediaForRole(roleId).filter(id=>!['whale-speech','dragon-speech'].includes(id)||hasRoleVoice?.(accountId,roleId));
    const row = {groupId, roleId, roleName, availableAssets, assets:selectedGroupMedia(config, accountId, groupId, roleId),
      reactionAssets, stickerReaction:reactionAssets.some(isSticker),namedSticker:getGroupNamedSticker(config,accountId,groupId,roleId),
      stickerRevision:groupStickerRevision(config,groupId),namedStickerLimit:NAMED_STICKER_LIMIT,
      namedStickers:groupNamedStickers(config,accountId,groupId,roleId,'configured')};
    const lookup=publicLookupSettings(config,accountId,groupId,roleId);
    if(lookup)row.publicLookup=lookup;
    if (isGroupCardRole(roleId)) {
      row.hasCardPortrait = hasCardPortrait?.(roleId.slice(5)) === true;
      row.images = {};
      for (const id of cardAssets.filter(isCardImage)) {
        const image = getGroupCardImage(config,accountId,groupId,roleId,id);
        if (image) row.images[id] = image;
      }
    }
    if (mediaForRole(roleId).some(isRecording)) row.recording = getGroupMediaRecording(config, accountId, groupId, roleId);
    options.push(row);
  }
  return options;
}

// Mutates only the next configuration, immediately before its existing atomic save.
function pruneGroupMedia(next, excludeGroup) {
  if (excludeGroup && groupStickerRevision(next,excludeGroup)!==null) renewGroupStickerRevision(next,excludeGroup);
  const retain = row => qqId(row?.accountId) && row.accountId === next.qqAccountId && qqId(row.groupId) &&
    next.qqGroups?.enabled === true && Array.isArray(next.qqGroups.groupIds) && next.qqGroups.groupIds.includes(row.groupId) &&
    mediaForRole(row.roleId) && row.groupId !== excludeGroup;
  for (const key of ['qqGroupVoiceClips','qqGroupOutgoingMedia','qqGroupCardImages','qqGroupNamedStickers','qqGroupPublicLookup','qqGroupCardVoices']) {
    if (!Object.hasOwn(next, key)) continue;
    const rows = Array.isArray(next[key]) ? next[key].filter(retain) : [];
    if (rows.length) next[key] = rows;
    else delete next[key];
  }
}

function withGroupMediaSelection(config, change, currentRoleId) {
  const {expectedAccountId, groupId, roleId, expectedAssets, assets, recordingId, expectedStickerReaction, stickerReaction} = change || {};
  const nextAssets = normalizeAssets(assets, roleId), previous = normalizeAssets(expectedAssets, roleId);
  if (!change || Object.keys(change).some(key => !['expectedAccountId','groupId','roleId','expectedAssets','assets','recordingId','imageIds','namedSticker','expectedStickerRevision','expectedStickerReaction','stickerReaction','expectedReactionAssets','reactionAssets','publicLookup','expectedPublicLookup'].includes(key)) ||
      config.channel !== 'qq' || !qqId(expectedAccountId) || expectedAccountId !== config.qqAccountId ||
      !qqId(groupId) || config.qqGroups?.enabled !== true || !Array.isArray(config.qqGroups.groupIds) ||
      !config.qqGroups.groupIds.includes(groupId) || roleId !== currentRoleId ||
      !nextAssets || !previous) throw Error('Check the saved QQ group, companion role and selected media.');
  const saved = selectedGroupMedia(config, expectedAccountId, groupId, roleId);
  if (saved.join() !== previous.join()) throw Error('The group media selection changed. Reopen its settings.');
  if ((nextAssets.some(isSticker) || previous.some(isSticker)) &&
      (change.expectedStickerRevision ?? null)!==groupStickerRevision(config,groupId)) {
    throw Error('The group sticker source changed. Reopen its settings.');
  }
  const savedReactions = selectedGroupMedia(config, expectedAccountId, groupId, roleId, 'reaction');
  let reactions = nextAssets.filter(id => savedReactions.includes(id));
  const hasReactionList = Object.hasOwn(change,'reactionAssets') || Object.hasOwn(change,'expectedReactionAssets');
  if (hasReactionList) {
    const expected = normalizeAssets(change.expectedReactionAssets,roleId);
    reactions = normalizeAssets(change.reactionAssets,roleId);
    if (!expected || !reactions || expected.join() !== savedReactions.join() || reactions.some(id => !nextAssets.includes(id))) {
      throw Error('Review the current group media and their reply permissions before saving.');
    }
  }
  if (Object.hasOwn(change,'stickerReaction') || Object.hasOwn(change,'expectedStickerReaction')) {
    if (typeof stickerReaction !== 'boolean' || expectedStickerReaction !== savedReactions.some(isSticker) ||
        (stickerReaction && !nextAssets.some(isSticker)) || (hasReactionList && stickerReaction !== reactions.some(isSticker))) {
      throw Error('Check the current sticker and its reply permission before saving.');
    }
    if (!hasReactionList) reactions = nextAssets.filter(id => isSticker(id) ? stickerReaction : reactions.includes(id));
  }
  if ((nextAssets.includes('card-speech') && nextAssets.includes('card-recording')) || (nextAssets.includes('whale-speech') && nextAssets.includes('whale-recording'))) throw Error('Select one voice for this group and card.');
  if (nextAssets.some(isRecording)) {
    const current = getGroupMediaRecording(config, expectedAccountId, groupId, roleId);
    if (!current || recordingId !== current.sha256) throw Error('Select the current recording for this group.');
  } else if (recordingId !== undefined) throw Error('Select the recording before enabling it.');
  const named = nextAssets.some(isSticker) ? getGroupNamedSticker(config,expectedAccountId,groupId,roleId) : null;
  if (!sameNamedSticker(change.namedSticker??null,named)) throw Error('Review the selected group sticker before granting permission.');
  const pictures = nextAssets.filter(id=>isCardImage(id)&&!(named&&isSticker(id))), imageIds = {};
  if (pictures.length || Object.hasOwn(change,'imageIds')) {
    if (!change.imageIds || Object.getPrototypeOf(change.imageIds)!==Object.prototype ||
        Object.keys(change.imageIds).length!==pictures.length) throw Error('Review the selected images for this group and card.');
    for (const id of pictures) {
      const image = getGroupCardImage(config,expectedAccountId,groupId,roleId,id);
      if (!image || !Object.hasOwn(change.imageIds,id) || change.imageIds[id]!==image.sha256) throw Error('The selected group image changed.');
      imageIds[id] = image.sha256;
    }
  }
  const next = {...config};
  pruneGroupMedia(next);
  const rows = (next.qqGroupOutgoingMedia || []).filter(row => row.groupId !== groupId);
  if (nextAssets.length) {
    const row = {accountId:expectedAccountId, groupId, roleId, assets:nextAssets};
    // Keep the legacy flag as the single stored grant for the sticker.
    if (reactions.some(isSticker)) row.stickerReaction = true;
    const otherReactions = reactions.filter(id => !isSticker(id));
    if (otherReactions.length) row.reactionAssets = otherReactions;
    if (recordingId) row.recordingId = recordingId;
    if (named) row.namedSticker={name:named.name,sha256:named.sha256,sourceSha256:named.sourceSha256};
    if (pictures.length) row.imageIds = imageIds;
    rows.push(row);
  }
  if (rows.length) next.qqGroupOutgoingMedia = rows;
  else delete next.qqGroupOutgoingMedia;
  setGroupPublicLookup(next,config,change);
  return next;
}

// Replacing an attachment withdraws both uses of that file before its replacement is installed.
function withoutGroupMediaAsset(config,{accountId,groupId,roleId},removed) {
  const expectedAssets = selectedGroupMedia(config,accountId,groupId,roleId);
  const assets = expectedAssets.filter(id => id !== removed);
  const change = {expectedAccountId:accountId, groupId, roleId, expectedAssets, assets,
    expectedStickerRevision:groupStickerRevision(config,groupId)};
  if (assets.some(isRecording)) change.recordingId = getGroupMediaRecording(config,accountId,groupId,roleId).sha256;
  const named = assets.some(isSticker) && getGroupNamedSticker(config,accountId,groupId,roleId);
  if (named) change.namedSticker=named;
  const pictures = assets.filter(id=>isCardImage(id)&&!(named&&isSticker(id)));
  if (pictures.length) change.imageIds = Object.fromEntries(pictures.map(id => [id,getGroupCardImage(config,accountId,groupId,roleId,id).sha256]));
  return withGroupMediaSelection(config,change,roleId);
}

module.exports = {selectedGroupMedia, groupMediaOptions, pruneGroupMedia, withGroupMediaSelection, withoutGroupMediaAsset,
  groupNamedStickers,groupStickerRevision,renewGroupStickerRevision,syncGroupStickerRevisions,groupPublicLookup,withGroupPublicLookup,groupCardVoice,withGroupCardVoice};
