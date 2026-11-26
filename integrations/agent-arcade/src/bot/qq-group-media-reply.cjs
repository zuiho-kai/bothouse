'use strict';

const {createHash, randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {validateImagePayload} = require('./qq-media.cjs');
const {isGroupCardRole} = require('./qq-group-card-images.cjs');
const {canonicalAudibleWav} = require('./qq-voice-payload.cjs');

// These files ship in the application. Input from the group or the model
// cannot select any other path, artwork, speaker, account, or destination.
const assets = new Map([
  ['ju-serena', {role:'claude-ju',kind:'voice'}],
  ['ju-sticker', {role:'claude-ju',kind:'sticker', file:'ju-sticker.png', sha:'8367eb39c317c19456c18b2ab518dc39c1880b25b73801a8d4da493c1c938d15'}],
  ['ju-portrait', {role:'claude-ju',kind:'image', file:'ju-portrait.png', sha:'671c783a895bb0aeeafc5309fbc0007be74fab8976fad0c26b4c302ea719fd5f'}],
  ['whale-speech', {role:'deepseek-whale',kind:'voice'}],
  ['dragon-speech', {role:'codex-dragon',kind:'voice'}],
  ['whale-recording', {role:'deepseek-whale',kind:'voice'}],
  ['whale-sticker', {role:'deepseek-whale',kind:'sticker', file:'whale-sticker.png', sha:'10982de5930844768c177735a67a3cb5a1a5062bf9abc3b72f02c267fd618804'}],
  ['whale-portrait', {role:'deepseek-whale',kind:'image', file:'whale-portrait.png', sha:'4c16def8e93d6cf6080c1b17182c36c02805ebe258bc7f752c0273b4fcf9c5e4'}],
  ['card-portrait', {kind:'image'}], ['card-sticker', {kind:'sticker'}],
  ['card-speech', {kind:'voice'}], ['card-recording', {kind:'voice'}]
]);
const failure = code => Object.assign(Error(code), {code});
const knownErrors = new Set(['changed','stale_context','group_unavailable','account_mismatch','disconnected',
  'status_unverified','bridge_unhealthy','account_offline','cancelled','media_unavailable','send_rejected',
  'voice_render_unavailable','voice_render_busy','voice_render_limit','voice_render_failed','voice_render_timeout',
  'voice_render_exit_unconfirmed','voice_clip_unavailable','voice_invalid','voice_format','voice_duration',
  'voice_clip_missing','voice_clip_changed','voice_clip_invalid','voice_clip_unreadable',
  'voice_too_large','operation_in_progress']);
const safeCode = error => knownErrors.has(error?.code) ? error.code : 'media_unavailable';

async function characterImage(assetId, roleId, signal) {
  const asset = assets.get(assetId);
  if (!asset?.file || asset.role !== roleId) throw failure('media_unavailable');
  const bytes = await fs.readFile(path.join(__dirname,'../assets/qq-group-replies',asset.file),{signal});
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha) throw failure('media_unavailable');
  validateImagePayload(bytes);
  return bytes;
}

const recordingAsset = id => id === 'whale-recording' || id === 'card-recording';
const roleMatches = (asset,binding) => !!asset && (asset.role ? binding?.roleId === asset.role : isGroupCardRole(binding?.roleId));

function groupTargetCheck(binding,assertCurrent,signal) {
  const {accountId,groupId,groupRevision,scopeId,client} = binding;
  return () => {
    if (signal?.aborted) throw failure('cancelled');
    if (!client || !accountId || accountId !== client.accountId || !groupRevision || !scopeId ||
        client.groupVoiceRevision?.(groupId) !== groupRevision) throw failure('changed');
    const current = assertCurrent();
    if (typeof current?.then === 'function') {
      Promise.resolve(current).catch(()=>{});
      throw failure('changed');
    }
    if (current === false) throw failure('changed');
  };
}

function audibleSource(source,recording) {
  if (!Buffer.isBuffer(source)) throw failure(recording ? 'voice_clip_unavailable' : 'voice_render_failed');
  try { return canonicalAudibleWav(source).bytes; }
  catch (error) { throw recording ? failure('voice_clip_invalid') : error; }
  finally { source.fill(0); }
}

async function readImage(assetId,binding,readSelectedImage,options) {
  const asset = assets.get(assetId);
  if (asset.file && !(asset.kind === 'sticker' && typeof readSelectedImage === 'function')) {
    return characterImage(assetId,binding.roleId,options.signal);
  }
  if (typeof readSelectedImage !== 'function') throw failure('media_unavailable');
  const bytes = await readSelectedImage(options);
  try { validateImagePayload(bytes);return bytes; }
  catch (error) { if (Buffer.isBuffer(bytes)) bytes.fill(0);throw error; }
}

// Local readiness for a text answer. The bridge and the speech renderer are
// only invoked by the explicit send path below.
async function groupMediaAvailable({assetId,binding,assertCurrent,signal,groupVoiceReady,renderVoice,readVoiceClip,readSelectedImage}) {
  const asset=assets.get(assetId);
  if(!roleMatches(asset,binding)||typeof assertCurrent!=='function')return false;
  const check=groupTargetCheck(binding,assertCurrent,signal),options={signal,assertCurrent:check};
  let bytes;
  try {
    check();
    const client=binding.client;
    if(asset.kind==='voice'){
      if(typeof client.sendGroupRecord!=='function'||typeof client.verifyGroupVoiceTarget!=='function')return false;
      if(recordingAsset(assetId))bytes=audibleSource(await readVoiceClip(options),true);
      else if(typeof renderVoice!=='function'||await groupVoiceReady?.()!==true)return false;
    }else{
      if(typeof client.sendGroupImage!=='function')return false;
      bytes=await readImage(assetId,binding,readSelectedImage,options);
    }
    check();
    return true;
  }catch{return false;}
  finally{if(Buffer.isBuffer(bytes))bytes.fill(0);}
}

async function sendGroupMediaReply({assetId, text, binding, assertCurrent, renderVoice, readVoiceClip, readSelectedImage, signal} = {}) {
  const asset = assets.get(assetId), kind = asset?.kind;
  if (!roleMatches(asset,binding) || typeof assertCurrent !== 'function') {
    return {kind,outcome:'not_sent',code:'group_unavailable'};
  }
  const {accountId,groupId,groupRevision,scopeId,client}=binding;
  const check=groupTargetCheck(binding,assertCurrent,signal);
  let bytes, enteredSend = false;
  try {
    check();
    if (kind === 'voice') {
      const recording = recordingAsset(assetId);
      if (recording && typeof readVoiceClip !== 'function') throw failure('voice_clip_unavailable');
      if (!recording && typeof renderVoice !== 'function') throw failure('voice_render_unavailable');
      if (!recording && (typeof text !== 'string' || !text.trim() || [...text].length > 300)) throw failure('voice_render_limit');
      const target = await client.verifyGroupVoiceTarget(groupId,signal,{assertCurrent:check});
      check();
      if (target?.groupId !== groupId || target.accountId !== accountId || target.revision !== groupRevision) throw failure('changed');
      const source = recording ? await readVoiceClip({signal,assertCurrent:check}) :
        await renderVoice(text,{signal,assertCurrent:check});
      bytes=audibleSource(source,recording);
    } else {
      bytes = await readImage(assetId,binding,readSelectedImage,{signal,assertCurrent:check});
    }
    check();
    const send = kind === 'voice' ? client.sendGroupRecord : client.sendGroupImage;
    if (typeof send !== 'function') throw failure('media_unavailable');
    enteredSend = true;
    const receipt = await send.call(client,groupId,bytes,randomUUID(),signal,{scopeId,assertCurrent:check});
    if (receipt?.outcome === 'accepted' && typeof receipt.messageId === 'string' && /^-?\d{1,20}$/.test(receipt.messageId)) {
      return {kind,outcome:'accepted',messageId:receipt.messageId};
    }
    if (receipt?.outcome === 'not_sent') return {kind,outcome:'not_sent',code:safeCode(receipt)};
    return {kind,outcome:'unknown',code:'send_unknown'};
  } catch (error) {
    return enteredSend ? {kind,outcome:'unknown',code:'send_unknown'} :
      {kind,outcome:'not_sent',code:signal?.aborted ? 'cancelled' : safeCode(error)};
  } finally {
    if (Buffer.isBuffer(bytes)) bytes.fill(0);
  }
}
module.exports = {sendGroupMediaReply, groupMediaAvailable, characterImage};
