'use strict';
// Original, fixed-field policy. Schema/config bodies stay in the main process.
const {createHash}=require('node:crypto');
const PLUGIN='napcat-plugin-builtin',KEYS=Object.freeze(['prefix','enableReply','description','theme','features']);
const CLEANER='napcat-plugin-cleaner',PLUGINS=Object.freeze([PLUGIN,CLEANER]);
const CLEANER_KEYS=Object.freeze(['enableVideo','enableVideoThumb','enablePtt','enablePic','enableFile','enableLog','enableLogCache','enableNtTemp','enableNapCatData','enableNapCatTemp','retainDays']);
const CLEANER_LIMITS=Object.freeze({maxChanges:11,retainDaysMin:0,retainDaysMax:365});
const keys=(pluginId=PLUGIN)=>{if(!PLUGINS.includes(pluginId))fail('plugin_unsupported');return pluginId===CLEANER?CLEANER_KEYS:KEYS;};
const limits=(pluginId=PLUGIN)=>{keys(pluginId);return pluginId===CLEANER?CLEANER_LIMITS:LIMITS;};
const THEMES=Object.freeze(['light','dark','auto']),FEATURES=Object.freeze(['version','status','debug']);
const LIMITS=Object.freeze({prefixMaxChars:64,descriptionMaxChars:1024,maxChanges:5,themeOptions:THEMES,featureOptions:FEATURES});
const CODES=new Set(['invalid_request','invalid_response','response_too_large','unconfigured','unsupported_version','plugin_version_unsupported','component_unavailable','plugin_unsupported','plugin_not_found','plugin_not_active','manager_unavailable','account_changed','account_offline','endpoint_unverified','changed','cancelled','closed','timeout','unauthorized','two_factor_required','rate_limited','connection_failed','http_error','request_rejected','operation_in_progress','stale_observation','stale_ticket','expired_ticket','baseline_changed','change_unknown','unavailable','config_unavailable','schema_unsupported','invalid_field','no_changes']);
class QQPluginConfigError extends Error{constructor(code){code=CODES.has(code)?code:'unavailable';super(`QQ plugin configuration failed (${code}).`);this.code=code;}}
const safeCode=error=>new QQPluginConfigError(error?.code==='invalid_config'?'invalid_request':error?.code).code;
const fail=code=>{throw new QQPluginConfigError(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function exact(value,keys,code='invalid_request'){if(!plain(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail(code);}
function jsonCopy(value,{maxBytes=65536,maxDepth=8,maxEntries=2048}={}){
 let entries=0;const seen=new Set();
 function walk(item,depth){if(depth>maxDepth||++entries>maxEntries)fail('response_too_large');if(item===null||typeof item==='boolean')return item;if(typeof item==='string'){if(Buffer.byteLength(item)>maxBytes)fail('response_too_large');return item;}if(typeof item==='number'){if(!Number.isFinite(item))fail('invalid_response');return item;}if(!plain(item)&&!Array.isArray(item)||seen.has(item))fail('invalid_response');seen.add(item);let out;
  if(Array.isArray(item)){if(Object.keys(item).length!==item.length)fail('invalid_response');out=item.map(v=>walk(v,depth+1));}
  else{out={};for(const key of Object.keys(item)){if(['__proto__','constructor','prototype'].includes(key)||key.length>256)fail('invalid_response');const descriptor=Object.getOwnPropertyDescriptor(item,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))fail('invalid_response');out[key]=walk(descriptor.value,depth+1);}}
  seen.delete(item);return out;
 }
 const copy=walk(value,0);if(Buffer.byteLength(JSON.stringify(copy))>maxBytes)fail('response_too_large');return copy;
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function fieldValue(key,value,pluginId=PLUGIN){
 if(pluginId===CLEANER){if(!CLEANER_KEYS.includes(key))fail('invalid_field');if(key==='retainDays'){if(!Number.isSafeInteger(value)||value<0||value>365)fail('invalid_field');}else if(typeof value!=='boolean')fail('invalid_field');return value;}
 keys(pluginId);
 if(key==='prefix'||key==='description'){const max=key==='prefix'?64:1024;if(typeof value!=='string'||value.length>max*2||[...value].length>max)fail('invalid_field');const checked=key==='description'?value.replace(/[\r\n\t]/g,''):value;if(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(checked))fail('invalid_field');return value;}
 if(key==='enableReply'){if(typeof value!=='boolean')fail('invalid_field');return value;}
 if(key==='theme'){if(!THEMES.includes(value))fail('invalid_field');return value;}
 if(key==='features'){if(!Array.isArray(value)||value.length>3||new Set(value).size!==value.length||value.some(item=>!FEATURES.includes(item)))fail('invalid_field');return [...value];}
 fail('invalid_field');
}
function fieldState(key,state,pluginId=PLUGIN){if(!keys(pluginId).includes(key)||!plain(state)||typeof state.present!=='boolean')fail('invalid_field');exact(state,state.present?['present','value']:['present'],'invalid_field');if(!state.present){if(pluginId===CLEANER||!['theme','features'].includes(key))fail('invalid_field');return {present:false};}return {present:true,value:fieldValue(key,state.value,pluginId)};}
function editMap(value,{all=false,pluginId=PLUGIN}={}){const order=keys(pluginId);if(!plain(value)||Object.keys(value).length<1||Object.keys(value).length>order.length||Object.keys(value).some(key=>!order.includes(key))||all&&Object.keys(value).length!==order.length)fail('invalid_field');return Object.fromEntries(order.filter(key=>Object.hasOwn(value,key)).map(key=>[key,fieldState(key,value[key],pluginId)]));}
function fields(config,pluginId=PLUGIN){if(!plain(config))fail('config_unavailable');if(pluginId===CLEANER){if(!plain(config.defaultOptions)||!Array.isArray(config.scheduleTasks))fail('config_unavailable');config=config.defaultOptions;}const out={};for(const key of keys(pluginId)){if(!Object.hasOwn(config,key)){if(pluginId===CLEANER||!['theme','features'].includes(key))fail('config_unavailable');out[key]={present:false};}else try{out[key]={present:true,value:fieldValue(key,config[key],pluginId)};}catch{fail('config_unavailable');}}return out;}
function schema(value){const rows=jsonCopy(value,{maxBytes:49152});if(!Array.isArray(rows)||!rows.length||rows.length>128)fail('schema_unsupported');const seen=new Map(),types={prefix:'string',enableReply:'boolean',description:'string',theme:'select',features:'multi-select'};
 for(const row of rows){if(!plain(row)||typeof row.key!=='string'||!row.key||row.key.length>128||seen.has(row.key)||!['string','number','boolean','select','multi-select','html','text'].includes(row.type)||typeof row.label!=='string'||row.label.length>256)fail('schema_unsupported');seen.set(row.key,row);
  if(KEYS.includes(row.key)){if(Object.keys(row).some(key=>!['key','type','label','description','default','options','placeholder','reactive','hidden'].includes(key))||row.type!==types[row.key]||Object.hasOwn(row,'reactive')&&row.reactive!==false||Object.hasOwn(row,'hidden')&&row.hidden!==false)fail('schema_unsupported');
   if(['description','placeholder'].some(key=>Object.hasOwn(row,key)&&typeof row[key]!=='string'))fail('schema_unsupported');
   if(row.key==='theme'||row.key==='features'){const values=row.key==='theme'?THEMES:FEATURES;if(!Array.isArray(row.options)||row.options.length!==values.length||row.options.some((item,index)=>!plain(item)||Object.keys(item).sort().join('|')!=='label|value'||typeof item.label!=='string'||item.label.length>256||item.value!==values[index]))fail('schema_unsupported');}
   else if(Object.hasOwn(row,'options'))fail('schema_unsupported');
   if(Object.hasOwn(row,'default'))try{fieldValue(row.key,row.default);}catch{fail('schema_unsupported');}
  }
 }
 if(KEYS.some(key=>!seen.has(key)))fail('schema_unsupported');return rows;
}
function baseline(raw,pluginId=PLUGIN){keys(pluginId);let config,reviewed,supportReactive;if(pluginId===CLEANER){config=jsonCopy(raw);reviewed=null;supportReactive=false;}else{exact(raw,['schema','config','supportReactive'],'invalid_response');if(typeof raw.supportReactive!=='boolean')fail('invalid_response');config=jsonCopy(raw.config);reviewed=schema(raw.schema);supportReactive=raw.supportReactive;}const projected=fields(config,pluginId);return {config,schema:reviewed,supportReactive,fields:projected,digest:digest({config,schema:reviewed,supportReactive}),schemaDigest:digest({pluginId,schema:reviewed,supportReactive})};}
function applyChanges(saved,changes,pluginId=PLUGIN){const edits=editMap(changes,{pluginId}),config=jsonCopy(saved.config),target=pluginId===CLEANER?config.defaultOptions:config,before={},after={};for(const key of keys(pluginId)){if(!Object.hasOwn(edits,key)||digest(saved.fields[key])===digest(edits[key]))continue;before[key]=saved.fields[key];after[key]=edits[key];if(edits[key].present)target[key]=edits[key].value;else delete target[key];}const changedFields=Object.keys(after);if(!changedFields.length)fail('no_changes');return {config:jsonCopy(config),before:jsonCopy(before),after:jsonCopy(after),changedFields};}
function cleanerPatch(value){if(!plain(value)||!Object.keys(value).length||Object.keys(value).some(key=>!CLEANER_KEYS.includes(key)))fail('invalid_field');return Object.fromEntries(CLEANER_KEYS.filter(key=>Object.hasOwn(value,key)).map(key=>[key,fieldValue(key,value[key],CLEANER)]));}
function writePayload(config,changedFields,pluginId=PLUGIN){if(pluginId===CLEANER)return cleanerPatch(Object.fromEntries(changedFields.map(key=>[key,config.defaultOptions[key]])));keys(pluginId);return jsonCopy(config);}
function effects(pluginId=PLUGIN){keys(pluginId);return {unexposedFieldsPreserved:true,readsMayExecuteCode:true,writesMayExecuteCode:true,mayReload:pluginId!==CLEANER,persistenceVerified:false,reloadVerified:false,pluginCodeAuthenticated:false,mayActOutsideOwnerScope:true,...(pluginId===CLEANER?{updatesFutureCleanupDefaults:true,changesExistingSchedules:false,startsCleanup:false}:{})};}
module.exports={PLUGIN,PLUGINS,CLEANER,CLEANER_KEYS,CLEANER_LIMITS,KEYS,THEMES,FEATURES,LIMITS,keys,limits,QQPluginConfigError,safeCode,fail,plain,exact,jsonCopy,digest,fieldValue,fieldState,editMap,fields,schema,baseline,applyChanges,cleanerPatch,writePayload,effects};
