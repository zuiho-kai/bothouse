'use strict';

const {createHash} = require('node:crypto');
const {QQMediaError,canonicalImage,readSelected} = require('./qq-media.cjs');
const {ownedPath,retireOwnedFiles} = require('./qq-group-selected-file.cjs');
const {saveSelectedImage,readSelectedImage} = require('./qq-selected-image-file.cjs');
const isGroupCardRole = role => typeof role === 'string' && /^card-[0-9a-f]{16}$/u.test(role);
const isCardImage = asset => asset === 'card-portrait' || asset === 'card-sticker';
const qqId = id => typeof id === 'string' && /^[1-9]\d{4,14}$/u.test(id);
const checksum = hash => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash);
const dimension = n => Number.isInteger(n) && n > 0 && n <= 2048;
const invalid = () => Object.assign(Error('The selected group image is unavailable or changed.'), {code:'changed'});
const builtinStickers = new Map([['claude-ju','ju-sticker'],['deepseek-whale','whale-sticker']]);
const stickerAsset = role => isGroupCardRole(role) ? 'card-sticker' : builtinStickers.get(role) || null;
const NAMED_STICKER_LIMIT = 12;
const validStickerName = name => typeof name==='string' && !!name && name===name.trim().normalize('NFC') &&
  Array.from(name).length<=40 && !/\p{Cc}/u.test(name);
const sameNamedSticker = (a,b) => a===null || b===null ? a===b : !!a && !!b && validStickerName(a.name) &&
  checksum(a.sha256) && checksum(a.sourceSha256) && a.name===b.name && a.sha256===b.sha256 && a.sourceSha256===b.sourceSha256;

function allowedGroup(config,accountId,groupId) {
  return qqId(accountId) && qqId(groupId) && config.channel==='qq' && config.qqAccountId===accountId &&
    config.qqGroups?.enabled===true && Array.isArray(config.qqGroups.groupIds) && config.qqGroups.groupIds.includes(groupId);
}
function getGroupCardImage(config, accountId, groupId, roleId, assetId) {
  if (!allowedGroup(config,accountId,groupId) || !isGroupCardRole(roleId) || !isCardImage(assetId)) return null;
  const rows=config.qqGroupCardImages;
  if (!Array.isArray(rows) || rows.length > 10) return null;
  const matches = rows.filter(row => row?.accountId === accountId && row.groupId === groupId &&
    row.roleId === roleId && row.assetId === assetId);
  if (matches.length !== 1) return null;
  const {sha256,width,height}=matches[0];
  if (!checksum(sha256) || !dimension(width) || !dimension(height)) return null;
  return {sha256,width,height};
}
function namedStickerId(row) {
  return createHash('sha256').update(JSON.stringify([row.accountId,row.groupId,row.roleId,row.name,row.sourceSha256,row.sha256])).digest('hex');
}
function groupStickerRows(config,accountId,groupId,roleId) {
  const all=config.qqGroupNamedStickers,assetId=stickerAsset(roleId);
  if (!assetId || !allowedGroup(config,accountId,groupId) || !Array.isArray(all) || all.length>5*NAMED_STICKER_LIMIT) return [];
  const rows=all.filter(r=>r?.accountId===accountId && r.groupId===groupId && r.roleId===roleId && r.assetId===assetId);
  if (rows.length>NAMED_STICKER_LIMIT || rows.filter(r=>!Object.hasOwn(r,'id')).length>1 ||
      rows.some(r=>!validStickerName(r.name) || !checksum(r.sha256) || !checksum(r.sourceSha256) || !dimension(r.width) || !dimension(r.height) ||
        (Object.hasOwn(r,'id') && (r.id!==namedStickerId(r) || typeof r.request!=='boolean' || typeof r.reaction!=='boolean')))) return [];
  return new Set(rows.map(r=>r.name.toLowerCase())).size===rows.length ? rows : [];
}
function getGroupNamedSticker(config,accountId,groupId,roleId) {
  const row=groupStickerRows(config,accountId,groupId,roleId).find(r=>!Object.hasOwn(r,'id'));
  if(!row)return null;
  const {name,sourceSha256,sha256,width,height}=row;
  return {name,sourceSha256,sha256,width,height};
}

function imageFile(root, row, named=false) {
  if (!row || !qqId(row.accountId) || !qqId(row.groupId) || !checksum(row.sha256) ||
      (named ? !stickerAsset(row.roleId) || row.assetId!==stickerAsset(row.roleId) : !isGroupCardRole(row.roleId)||!isCardImage(row.assetId))) throw invalid();
  return ownedPath(root,named?'group-named-stickers':'group-reply-images',[row.accountId,row.groupId,row.roleId,row.assetId,row.sha256].join('-')+'.png');
}

function saveCardImage(root, scope, bytes, named=false) {
  return saveSelectedImage(root,scope,bytes,(base,row)=>imageFile(base,row,named));
}

async function prepareCardPortrait(library, roleId, nativeImage, assertCurrent) {
  assertCurrent();
  const file = isGroupCardRole(roleId) && library?.portraitPath(roleId.slice(5));
  if (!file) throw new QQMediaError('file_unavailable');
  const raw = await readSelected(file);
  try {
    assertCurrent();
    return canonicalImage(raw,'.png',nativeImage);
  } finally { raw.fill(0); }
}

function readCardImage(root,row,options) {
  return readSelectedImage(root,row,options,(base,item)=>imageFile(base,item,options.named));
}

function retireCardImages(root, oldRows, nextRows, named=false) {
  retireOwnedFiles(root,oldRows,nextRows,(base,row)=>imageFile(base,row,named));
}

module.exports = {isGroupCardRole,isCardImage,getGroupCardImage,saveCardImage,prepareCardPortrait,readCardImage,retireCardImages,
  getGroupNamedSticker,groupStickerRows,namedStickerId,NAMED_STICKER_LIMIT,stickerAsset,sameNamedSticker,validStickerName};
