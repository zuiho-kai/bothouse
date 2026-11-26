'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {atomicJSON} = require('../core/files.cjs');
const {applyRegexScripts, normalizeRegexScript, parseFindRegex, LIMITS} = require('../vendor/sillytavern/regex-scripts.cjs');
const {isControlText} = require('./commands.cjs');
const {clean} = require('./dispatcher.cjs');

const MAX_SCOPES = 24, MAX_SCRIPTS = 10, MAX_BYTES = 1024 * 1024, SCHEMA = 2;
const QQ_ID = /^[1-9]\d{4,14}$/, ROLE_ID = /^[a-z0-9-]{1,50}$/;
const SCRIPT_ID = /^[a-f0-9]{16}$/, HASH = /^[a-f0-9]{64}$/;
const SCOPE = ['accountId','groupId','roleId'];
const STATE = [...SCOPE,'revision','enabled','scripts'];
const LEGACY_STATE = [...SCOPE,'revision','enabled','script'];
const STAGES = ['stored','display'];
const SNAPSHOT = ['id','scriptName','stage','findRegex','replaceString','trimStrings','substituteRegex','minDepth','maxDepth'];
const REQUEST = ['revision','enabled'];
const warning = '群回复格式规则未应用，已保留原文。';
const error = name => Object.assign(new Error('Group output formatting could not complete.'),{code:'group_output_format_'+name});
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value,keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
const matches = (value,regex) => typeof value === 'string' && regex.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeKey = ({accountId,groupId,roleId}) => JSON.stringify([accountId,groupId,roleId]);
const scopeShape = scope => matches(scope?.accountId,QQ_ID) && matches(scope.groupId,QQ_ID) && matches(scope.roleId,ROLE_ID);
const formatControls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const credentials = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][a-z0-9_-]{12,}\b|\b(?:password|secret|token|api[ _-]?key|authorization)\s*[:=]\s*\S/iu;
const privateLocation = /\b(?:file|smb|ssh):\/\/|(?:^|[\s"'(])(?:\/(?:Users|home|private|Volumes|var|tmp)\/|[a-z]:[\\/]|~[\\/])/imu;
const commandSyntax = /(?:\[|&#(?:91|x5b);)\s*CQ\s*(?::|&#(?:58|x3a);)|javascript:\s*|<\s*(?:script|iframe|object|embed)(?:[\s/>]|$)/iu;

function safeText(text,max) {
  return typeof text === 'string' && text.length <= max && text.isWellFormed() && !formatControls.test(text) &&
    !credentials.test(text) && !privateLocation.test(text) && clean(text, Math.max(max, text.length)) === text;
}

function safeMacros(value) {
  for (const [macro] of value.matchAll(/\{\{[\s\S]*?\}\}|<(?:user|bot|char)>/gi)) {
    if (!/^(?:\{\{(?:char|match)\}\}|<(?:bot|char)>)$/i.test(macro)) return false;
  }
  return true;
}

function validPattern(pattern, mode) {
  if (!pattern || !pattern.trim()) return false;
  const sample = mode === 'none' ? pattern : pattern.replace(/\{\{char\}\}|<(?:bot|char)>/gi,'Agent Arcade');
  if (sample.startsWith('/')) {
    const closing = sample.lastIndexOf('/');
    if (closing <= 1 || !/^[gimsu]*$/.test(sample.slice(closing+1)) ||
        new Set(sample.slice(closing+1)).size !== sample.length-closing-1) return false;
  }
  return !parseFindRegex(sample).rejected;
}

function validSnapshot(script) {
  const depth = value => value === null || Number.isInteger(value) && Math.abs(value) <= 1000000;
  return exact(script,SNAPSHOT) && matches(script.id,SCRIPT_ID) && STAGES.includes(script.stage) &&
    safeText(script.scriptName,LIMITS.name) && !!script.scriptName.trim() && script.scriptName.trim() === script.scriptName &&
    !/[\r\n\t]/.test(script.scriptName) && !commandSyntax.test(script.scriptName) &&
    safeText(script.findRegex,LIMITS.findRegex) && safeMacros(script.findRegex) &&
    safeText(script.replaceString,LIMITS.replaceString) && safeMacros(script.replaceString) && !commandSyntax.test(script.replaceString) &&
    Array.isArray(script.trimStrings) && script.trimStrings.length <= LIMITS.trimStrings &&
    script.trimStrings.every(value=>safeText(value,LIMITS.trimString) && !!value && safeMacros(value)) &&
    ['none','raw','escaped'].includes(script.substituteRegex) && depth(script.minDepth) && depth(script.maxDepth) &&
    (script.minDepth === null || script.minDepth <= 0) && validPattern(script.findRegex,script.substituteRegex);
}

function review(scope,raw) {
  if (!exact(scope,SCOPE) || !scopeShape(scope) || !plain(raw) || !matches(raw.id,SCRIPT_ID)) throw error('invalid');
  let script;
  try { script = normalizeRegexScript(raw); } catch { throw error('ineligible'); }
  if (!script.placement.includes('ai_output') || script.promptOnly && !script.markdownOnly) throw error('ineligible');
  const {id,scriptName,findRegex,replaceString,trimStrings,substituteRegex,minDepth,maxDepth,markdownOnly} = script;
  const snapshot = {id,scriptName,stage:markdownOnly ? 'display' : 'stored',findRegex,replaceString,trimStrings,substituteRegex,minDepth,maxDepth};
  if (!validSnapshot(snapshot)) throw error('ineligible');
  const approval = digest([scopeKey(scope),script,integer(raw.updatedAt) ? raw.updatedAt : null]);
  return {snapshot,approval};
}

function previewOutputScript(scope,raw) {
  const {snapshot,approval} = review(scope,raw);
  return {...snapshot,approval};
}

function ownerView({revision,enabled,scripts}) {
  const summaries = scripts.map(({id,scriptName,stage})=>({id,scriptName,stage}));
  return {revision,enabled,script:summaries[0] || null,scripts:summaries};
}

const phaseOrder = scripts => STAGES.flatMap(stage=>scripts.filter(script=>script.stage === stage));
function inPhaseOrder(scripts) {
  const ordered = phaseOrder(scripts);
  return ordered.length === scripts.length && ordered.every((script,index)=>script === scripts[index]);
}

function validScripts(scripts) {
  return Array.isArray(scripts) && scripts.length <= MAX_SCRIPTS && scripts.every(validSnapshot) &&
    new Set(scripts.map(script=>script.id)).size === scripts.length && inPhaseOrder(scripts);
}

function loadScope(row,schema) {
  if (!exact(row,schema === 1 ? LEGACY_STATE : STATE) || !scopeShape(row) ||
      !integer(row.revision) || row.revision < 1 || typeof row.enabled !== 'boolean') throw error('unavailable');
  if (schema === 1) {
    const {script,...rest} = row;
    row = {...rest,scripts:script === null ? [] : [script]};
  }
  if (!validScripts(row.scripts) || row.enabled && !row.scripts.length) throw error('unavailable');
  return row;
}

/** Ordered owner-reviewed script snapshots for each ordinary QQ group role. */
class GroupOutputFormat {
  constructor({file} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw error('invalid');
    this.file = file;
  }

  #load() {
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw error('unavailable');
      const bytes = fs.readFileSync(this.file);
      if (bytes.length > MAX_BYTES) throw error('unavailable');
      const state = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if (!exact(state,['schema','scopes']) || ![1,SCHEMA].includes(state.schema) || !Array.isArray(state.scopes) ||
          state.scopes.length > MAX_SCOPES) throw error('unavailable');
      const scopes = state.scopes.map(row=>loadScope(row,state.schema));
      if (new Set(scopes.map(scopeKey)).size !== scopes.length) throw error('unavailable');
      return {schema:SCHEMA,scopes};
    } catch (err) {
      if (err?.code === 'ENOENT') return {schema:SCHEMA,scopes:[]};
      throw error('unavailable');
    }
  }

  #read(scope) {
    if (!exact(scope,SCOPE) || !scopeShape(scope)) throw error('invalid');
    const state = this.#load(), key = scopeKey(scope);
    const index = state.scopes.findIndex(row=>scopeKey(row) === key);
    const row = state.scopes[index] || {...scope,revision:0,enabled:false,scripts:[]};
    return {state,index,row};
  }

  view(scope) {
    return ownerView(this.#read(scope).row);
  }

  current(scope) {
    const {row} = this.#read(scope);
    return row.enabled ? {revision:row.revision,script:row.scripts[0],scripts:row.scripts} :
      {revision:null,script:null,scripts:[]};
  }

  #mutate(scope,revision,transform) {
    const {state,index,row} = this.#read(scope);
    if (revision !== row.revision) throw error('changed');
    const {enabled,scripts} = transform(row);
    if (row.enabled === enabled && JSON.stringify(scripts) === JSON.stringify(row.scripts)) return ownerView(row);
    if (row.revision === Number.MAX_SAFE_INTEGER || (index < 0 && state.scopes.length >= MAX_SCOPES)) throw error('limit');
    const next = {...row,revision:row.revision+1,enabled,scripts};
    if (index < 0) state.scopes.push(next);
    else state.scopes[index] = next;
    if (Buffer.byteLength(JSON.stringify(state,null,2)) > MAX_BYTES) throw error('limit');
    try { atomicJSON(this.file,state); } catch { throw error('unavailable'); }
    return ownerView(next);
  }

  configure(scope,value) {
    const saving = exact(value,[...REQUEST,'script','approval']);
    if ((!saving && !exact(value,REQUEST)) || !integer(value.revision) || typeof value.enabled !== 'boolean' ||
        (saving && !matches(value.approval,HASH))) throw error('invalid');
    return this.#mutate(scope,value.revision,row=>{
      let scripts = row.scripts;
      if (saving) {
        const {snapshot,approval} = review(scope,value.script);
        if (value.approval !== approval) throw error('review_required');
        const index = scripts.findIndex(script=>script.id === snapshot.id);
        if (index < 0 && scripts.length >= MAX_SCRIPTS) throw error('limit');
        scripts = [...scripts];
        if (index < 0) scripts.push(snapshot);
        else scripts[index] = snapshot;
        scripts = phaseOrder(scripts);
      }
      if (value.enabled && !scripts.length) throw error('not_selected');
      return {enabled:value.enabled,scripts};
    });
  }

  remove(scope,value) {
    if (!exact(value,['revision','scriptId']) || !integer(value.revision) ||
        !matches(value.scriptId,SCRIPT_ID)) throw error('invalid');
    return this.#mutate(scope,value.revision,row=>{
      const scripts = row.scripts.filter(script=>script.id !== value.scriptId);
      if (scripts.length === row.scripts.length) throw error('not_found');
      return {enabled:row.enabled && scripts.length > 0,scripts};
    });
  }

  reorder(scope,value) {
    if (!exact(value,['revision','scriptIds']) || !integer(value.revision) || !Array.isArray(value.scriptIds) ||
        value.scriptIds.length > MAX_SCRIPTS || !value.scriptIds.every(id=>matches(id,SCRIPT_ID))) throw error('invalid');
    return this.#mutate(scope,value.revision,row=>{
      const byId = new Map(row.scripts.map(script=>[script.id,script]));
      const scripts = value.scriptIds.map(id=>byId.get(id));
      if (scripts.length !== row.scripts.length || new Set(scripts).size !== scripts.length ||
          scripts.includes(undefined) || !inPhaseOrder(scripts)) throw error('invalid_order');
      return {enabled:row.enabled,scripts};
    });
  }
}

/** Apply stored output rules before display rules, to the outgoing text only. */
function formatGroupReply(text,scriptOrScripts,{roleName='',maxChars=6000} = {}) {
  const fallback = warning => ({text,applied:false,warning});
  const scripts = Array.isArray(scriptOrScripts) ? scriptOrScripts : scriptOrScripts ? [scriptOrScripts] : [];
  if (!scripts.length || typeof text !== 'string' || !text.trim()) return fallback(null);
  if (!validScripts(scripts) || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > LIMITS.outputChars ||
      !text.isWellFormed() || text.length > LIMITS.inputChars || !safeMacros(text)) return fallback(warning);
  const char = safeText(roleName,100) && !/[\r\n\t{}<>]/u.test(roleName) ? roleName : '';
  try {
    const now = () => performance.now(), deadline = now() + LIMITS.timeBudgetMs;
    let next = text;
    for (const stage of STAGES) {
      const display = stage === 'display';
      const prepared = scripts.filter(script=>script.stage === stage)
        .map(script=>normalizeRegexScript({...script,placement:['ai_output'],markdownOnly:display}));
      if (!prepared.length) continue;
      const timeBudgetMs = deadline - now();
      if (timeBudgetMs < 1) return fallback(warning);
      const result = applyRegexScripts(next,{scripts:prepared,placement:'ai_output',isMarkdown:display,depth:0,
        macroEnv:{char},timeBudgetMs,now});
      if (result.warnings.length || now() > deadline) return fallback(warning);
      if (!result.applied.length) continue;
      next = result.text;
      if (!next.trim() || !safeText(next,maxChars) || !safeMacros(next) || commandSyntax.test(next) || isControlText(next)) {
        return fallback(warning);
      }
    }
    return {text:next,applied:next !== text,warning:null};
  } catch { return fallback(warning); }
}

module.exports = {GroupOutputFormat, previewOutputScript, formatGroupReply};
