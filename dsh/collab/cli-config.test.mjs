import test from 'node:test';
import assert from 'node:assert/strict';
import { CliMember } from './cli-member.mjs';

const options = (model = 'base', effort = 'low') => [
  { id:'model', type:'select', currentValue:model, options:[{value:'base',name:'Base'},{value:'chosen',name:'Chosen'}] },
  { id:'reasoning_effort', type:'select', currentValue:effort, options:[{value:'low',name:'Low'},{value:'high',name:'High'}] },
];
function fake({loaded = false, reject = false, unsupported = false} = {}) {
  const m = new CliMember({cli:'codex',cwd:process.cwd()});
  const calls = []; let n = 0; const sessions = new Map();
  m._start = async () => {
    m.ready = Promise.resolve({}); m.exited = new Promise(() => {}); m.canLoad = true;
    m.conn = {
      newSession: async () => { const id = `new${++n}`; sessions.set(id, options()); calls.push(['new',id]); return { sessionId:id, configOptions:unsupported ? undefined : options() }; },
      loadSession: async ({sessionId}) => { sessions.set(sessionId, options('chosen','high')); calls.push(['load',sessionId]); return {configOptions:options('chosen','high')}; },
      setSessionConfigOption: async ({sessionId,configId,value}) => { calls.push(['set',sessionId,configId,value]); if (reject) throw Error('rejected'); const o=sessions.get(sessionId).map(x=>({...x})); const selected=o.find(x=>x.id===configId);selected.currentValue=value; if(configId==='model') o[1].currentValue='low'; sessions.set(sessionId,o); return {configOptions:o}; },
      prompt: async ({sessionId}) => { calls.push(['prompt',sessionId]);m.buffers.set(sessionId,'ok');return {}; },
    }; return m.ready;
  };
  m._defaultOptions = async model => {
    const probe = fake();
    try { return await probe.m._options(model); } finally { probe.m.close(); }
  };
  return {m,calls};
}
test('configured new session applies model then effort before prompt', async () => {
  const {m,calls}=fake(); await m.ask('x','r',undefined,undefined,{cliConfigManaged:true,cliConfig:{model:'chosen',reasoningEffort:'high'}});
  const target = calls.find(x=>x[0]==='prompt')[1];
  assert.deepEqual(calls.filter(x=>x[0]==='set' && x[1]===target).map(x=>x.slice(2)),[['model','chosen'],['reasoning_effort','high']]);
  assert.ok(calls.findIndex(x=>x[0]==='prompt') > calls.findIndex(x=>x[0]==='set' && x[1]===target));
});
test('loaded session clearing config restores adapter defaults before prompt', async () => {
  const {m,calls}=fake(); await m.ask('x','r',undefined,undefined,{resumeId:'old',cliConfigManaged:true});
  assert.deepEqual(calls.filter(x=>x[0]==='set' && x[1]==='old').map(x=>x.slice(2)),[['model','base']]);
  assert.ok(calls.some(x=>x[0]==='prompt' && x[1]==='old'));
});
test('configuration failure refuses prompt', async () => {
  const {m,calls}=fake({reject:true}); await assert.rejects(m.ask('x','r',undefined,undefined,{cliConfigManaged:true,cliConfig:{model:'chosen'}}));
  assert.equal(calls.some(x=>x[0]==='prompt'),false);
});
test('probe returns only advertised choices without prompting', async () => {
  const {m,calls}=fake();const result=await m.probeOptions('chosen');assert.equal(result.model.current,'chosen');assert.equal(result.reasoningEffort.current,'low');assert.equal(calls.some(x=>x[0]==='prompt'),false);
});

test('unconfigured legacy adapter runs without config or a probe', async () => {
  const {m,calls}=fake({unsupported:true});
  m._defaultOptions = async () => { throw Error('unexpected probe'); };
  await m.ask('x','r');
  assert.deepEqual(calls.map(x=>x[0]), ['new','prompt']);
});
test('unsupported adapter cannot silently retain a cleared override', async () => {
  const {m,calls}=fake();
  m._defaultOptions = async () => [];
  await assert.rejects(m.ask('x','r',undefined,undefined,{resumeId:'old',cliConfigManaged:true}), /unsupported/);
  assert.equal(calls.some(x=>x[0]==='prompt'),false);
});
test('configured turns do not add probe sessions to the conversation process', async () => {
  const {m,calls}=fake();
  await m.ask('x','r',undefined,undefined,{cliConfigManaged:true,cliConfig:{model:'chosen'}});
  await m.ask('x','r',undefined,undefined,{cliConfigManaged:true,cliConfig:{model:'chosen'}});
  assert.equal(calls.filter(x=>x[0]==='new').length,1);
});

test('unchanged session avoids another probe; changed config is probed and applied', async () => {
 const {m,calls}=fake(); let probes=0; const real=m._defaultOptions;
 m._defaultOptions=async model=>{probes++;return real(model);};
 const opts={cliConfigManaged:true,cliConfig:{model:'chosen',reasoningEffort:'high'}};
 await m.ask('one','r',undefined,undefined,opts);
 await m.ask('two','r',undefined,undefined,opts);
 assert.equal(probes,1);
 await m.ask('three','r',undefined,undefined,{cliConfigManaged:true,cliConfig:{model:'base',reasoningEffort:'low'}});
 assert.equal(probes,2);
 const target=calls.find(x=>x[0]==='prompt')[1];
 assert.ok(calls.some(x=>x[0]==='set' && x[1]===target && x[2]==='model' && x[3]==='base'));
});

test('a partial apply failure invalidates snapshot and cannot reuse stale model', async () => {
 const {m,calls}=fake();
 const first={cliConfigManaged:true,cliConfig:{model:'base',reasoningEffort:'high'}};
 await m.ask('one','r',undefined,undefined,first);
 const set=m.conn.setSessionConfigOption; let rejectOnce=true;
 m.conn.setSessionConfigOption=async args=>{
   if (args.configId==='reasoning_effort' && rejectOnce) { rejectOnce=false; throw Error('effort rejected'); }
   return set(args);
 };
 await assert.rejects(m.ask('two','r',undefined,undefined,{cliConfigManaged:true,cliConfig:{model:'chosen',reasoningEffort:'high'}}));
 await m.ask('three','r',undefined,undefined,first);
 const sets=calls.filter(c=>c[0]==='set' && c[1]==='new1' && c[2]==='model');
 assert.deepEqual(sets.map(c=>c[3]),['chosen','base']);
 assert.equal(calls.filter(c=>c[0]==='prompt').length,2);
});
