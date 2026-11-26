'use strict';

const {createHash} = require('node:crypto');
const {ownedPath,writeOwnedFile,retireOwnedFiles} = require('./qq-group-selected-file.cjs');
const {isGroupCardRole} = require('./qq-group-card-images.cjs');
const {canonicalWav,canonicalAudibleWav,MAX_BYTES} = require('./qq-voice-payload.cjs');
const {selectedMediaIdentity,matchesSelectedMedia} = require('./qq-media-file.cjs');

const whale = 'deepseek-whale';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const number = text => typeof text === 'string' && /^[1-9]\d{4,14}$/u.test(text);
const checksum = text => typeof text === 'string' && /^[0-9a-f]{64}$/u.test(text);
const invalid = () => Object.assign(Error('The selected group recording is unavailable or changed.'), {code:'changed'});

function getGroupMediaRecording(config, accountId, groupId, roleId) {
  if ((roleId !== whale && !isGroupCardRole(roleId)) || !number(accountId) || !number(groupId) || config.qqAccountId !== accountId ||
      config.channel !== 'qq' || !config.qqGroups?.enabled || !config.qqGroups.groupIds?.includes(groupId)) return null;
  const rows = config.qqGroupVoiceClips;
  if (!Array.isArray(rows) || rows.length > 5) return null;
  const match = rows.filter(r => r?.accountId === accountId && r.groupId === groupId && r.roleId === roleId);
  if (match.length !== 1 || Object.hasOwn(match[0],'ownerId')) return null;
  const {sha256, durationSeconds} = match[0];
  return checksum(sha256) && durationSeconds >= 0.2 && durationSeconds <= 30 && Number.isFinite(durationSeconds)
    ? {sha256, durationSeconds} : null;
}

function selectedFile(root, row) {
  if (!row || !number(row.accountId) || !checksum(row.sha256)) throw invalid();
  const owner = Object.hasOwn(row,'ownerId'), group = Object.hasOwn(row,'groupId');
  const target = owner ? row.ownerId : row.groupId;
  if (owner === group || !number(target)) throw invalid();
  if (row.roleId !== whale && !(group && isGroupCardRole(row.roleId))) throw invalid();
  const directory = owner ? 'owner-reply-recordings' : 'group-reply-recordings';
  return ownedPath(root, directory, [row.accountId,target,row.roleId,row.sha256].join('-') + '.wav');
}

function recordingError(error) {
  if(error?.recordingStatus)return error.recordingStatus;
  if(error?.code==='ENOENT'||error?.code==='ENOTDIR')return 'missing';
  if(error?.code==='media_too_large'||error?.code==='voice_too_large')return 'invalid';
  if(error?.code==='file_changed')return 'changed';
  return 'unreadable';
}

function checkRecordingFile(file) {
  return selectedMediaIdentity(file,['.wav'],MAX_BYTES);
}

function recordingAvailability(root,onChange) {
  const checked=new Map();
  return row=>{
    let file,identity;
    try {file=selectedFile(root,row);identity=checkRecordingFile(file);}
    catch(error){return recordingError(error);}
    const previous=checked.get(file);
    if(previous?.identity===identity)return previous.status;
    if(checked.size>=15&&!previous)checked.delete(checked.keys().next().value);
    const result={identity,status:'checking'};
    checked.set(file,result);
    void readGroupRecording(root,row,{assertCurrent:()=>{}}).then(bytes=>{
      try{canonicalAudibleWav(bytes).bytes.fill(0);return 'available';}
      catch{return 'invalid';}
      finally{bytes.fill(0);}
    },recordingError).then(status=>{
      if(checked.get(file)!==result)return;
      // A late result must never certify bytes after a replacement.
      try{if(checkRecordingFile(file)!==identity)checked.delete(file);else result.status=status;}
      catch{checked.delete(file);}
      onChange();
    }).catch(()=>{if(checked.get(file)===result)checked.delete(file);});
    return result.status;
  };
}

function saveRecordingBytes(root, scope, bytes) {
  const prepared = canonicalWav(bytes);
  try {
    const row = {...scope, sha256:digest(prepared.bytes), durationSeconds:prepared.durationSeconds};
    const file=selectedFile(root,row);
    if(!matchesSelectedMedia(file,prepared.bytes,['.wav'],MAX_BYTES))writeOwnedFile(file,prepared.bytes);
    return row;
  } finally {
    prepared.bytes.fill(0);
  }
}

async function readRecording(root, row, {signal,assertCurrent}) {
  assertCurrent();
  const target = selectedFile(root, row);
  const {readVoiceSelection} = require('./qq-voice.cjs');
  const bytes = await readVoiceSelection(target, signal);
  try {
    assertCurrent();
    if (digest(bytes) !== row.sha256) throw Object.assign(invalid(),{recordingStatus:'changed'});
    return bytes;
  } catch(error) { bytes.fill(0); throw error; }
}

async function readGroupRecording(root,row,options){
  let file;
  try{
    file=selectedFile(root,row);
    checkRecordingFile(file);
    return await readRecording(root,row,options);
  }catch(error){
    if(options.signal?.aborted||error?.code==='cancelled')throw error;
    let status=recordingError(error);
    // The file may disappear between stat and the reader opening it.
    if(status==='unreadable'&&file){
      try{checkRecordingFile(file);}catch(cause){status=recordingError(cause);}
    }
    throw Object.assign(Error('Selected group recording unavailable.'),{code:'voice_clip_'+status,recordingStatus:status});
  }
}

// Only unlink an app-owned copy after the configuration using it has retired.
function retireRecordings(root, oldRows, nextRows) {
  retireOwnedFiles(root, oldRows, nextRows, selectedFile);
}

module.exports = {getGroupMediaRecording, saveRecordingBytes, readRecording, readGroupRecording, retireRecordings, recordingAvailability};
