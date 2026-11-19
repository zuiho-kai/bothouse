import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {Hub} from './hub.mjs';
import {Roster} from './roster.mjs';
import {managementMembers,managementCreate,managementUpdate,managementDelete} from './member-management.mjs';

test('management persists codex config, partial edit, clearing and source permissions', async () => {
 const store=new Store(':memory:');const hub=new Hub(store,{warn(){},info(){}});hub.setMember({id:'owner',name:'owner',kind:'human'});
 const dsh={putMember(m){hub.setMember({...m,kind:'dsh'});},dropMember(id){hub.removeMember(id);}};
 const roster=new Roster(hub,dsh,{resolveModelInfo:async()=>{}});roster.load([{id:'seed',name:'Seed'}]);
 hub.setMember({id:'bot',name:'External',kind:'bot'});
 const m=await managementCreate(roster,{name:'Coder',cli:'codex',cliConfig:{model:'m',reasoningEffort:'high'}});
 assert.equal(m.id,'coder');assert.equal(m.apply.status,'pending');assert.deepEqual(m.cliConfig,{model:'m',reasoningEffort:'high'});
 assert.equal(managementMembers(roster,hub).find(x=>x.id==='seed').can_edit,false);
 assert.equal(managementMembers(roster,hub).find(x=>x.id==='bot').can_delete,false);
 const renamed=await managementUpdate(roster,m.id,{persona:'hello'});assert.deepEqual(renamed.cliConfig,m.cliConfig);
 const cleared=await managementUpdate(roster,m.id,{cliConfig:{model:null}});assert.deepEqual(cleared.cliConfig,{reasoningEffort:'high'});
 const reset=await managementUpdate(roster,m.id,{cliConfig:null});assert.equal(reset.cliConfig,null);assert.equal(reset.apply.status,'pending');
 assert.equal(store.member(m.id).cli_config_managed,1);
 await assert.rejects(managementUpdate(roster,'seed',{name:'No'}),/read-only/);
 await assert.rejects(managementCreate(roster,{name:'Coder'}),/名字 Coder 已被/);
 roster.remove(m.id);assert.equal(managementMembers(roster,hub).some(x=>x.id===m.id),false);
});

test('native rejects CLI config and switching to Codex clears native route', async () => {
 const store=new Store(':memory:'); const hub=new Hub(store,{warn(){},info(){}}); hub.setMember({id:'owner',name:'owner',kind:'human'});
 const roster=new Roster(hub,{putMember(m){hub.setMember({...m,kind:'dsh'});},dropMember(id){hub.removeMember(id);}}, {resolveModelInfo:async()=>{}});
 const native=await managementCreate(roster,{name:'Native',model:{provider:'p',model:'m'}});
 await assert.rejects(managementUpdate(roster,native.id,{cliConfig:{model:'x'}}),/requires a Codex/);
 assert.deepEqual((await managementUpdate(roster,native.id,{persona:'same'})).model,{provider:'p',model:'m'});
 const codex=await managementUpdate(roster,native.id,{cli:'codex'});
 assert.equal(codex.model,null); assert.equal(codex.cli,'codex');
 await assert.rejects(managementUpdate(roster,native.id,{cli:'claude',cliConfig:{model:'x'}}),/requires a Codex/);
});

test('invalid advertised choices cannot be saved', async () => {
 const store=new Store(':memory:'); const hub=new Hub(store,{warn(){},info(){}}); hub.setMember({id:'owner',name:'owner',kind:'human'});
 const roster=new Roster(hub,{putMember(m){hub.setMember({...m,kind:'dsh'});},dropMember(id){hub.removeMember(id);}}, undefined);
 const probe=async()=>({supported:true,model:{options:[{value:'good'}]},reasoningEffort:{options:[{value:'low'}]}});
 await assert.rejects(managementCreate(roster,{name:'Coder',cli:'codex',cliConfig:{model:'bad'}},probe),/unavailable/);
 assert.equal(store.members().length,0);
 const m=await managementCreate(roster,{name:'Coder',cli:'codex',cliConfig:{model:'good'}},probe);
 await assert.rejects(managementUpdate(roster,m.id,{cliConfig:{reasoningEffort:'high'}},probe),/unavailable/);
 assert.deepEqual(JSON.parse(store.member(m.id).cli_config),{model:'good'});
});

test('older SQLite members migrate without opting in to new config', async () => {
 const {mkdtempSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const path=join(mkdtempSync(join(tmpdir(),'member-migration-')),'collab.sqlite3');
 const before=new Store(path); before.addMember({id:'legacy',name:'Legacy',cli:'codex'});
 before.db.exec('ALTER TABLE members DROP COLUMN cli_config; ALTER TABLE members DROP COLUMN cli_config_managed'); before.close();
 const after=new Store(path); const row=after.member('legacy');
 assert.equal(row.cli,'codex'); assert.equal(row.cli_config,null); assert.equal(row.cli_config_managed,0); after.close();
});

test('first start seeds a DSH member plus one per local CLI, DSH leads, runs once', async () => {
 const {mkdtempSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const store=new Store(':memory:');store.ensureRoom(1,'general');const hub=new Hub(store,{warn(){},info(){}});hub.setMember({id:'owner',name:'owner',kind:'human'});
 const roster=new Roster(hub,{putMember(m){hub.setMember({...m,kind:'dsh'});},dropMember(id){hub.removeMember(id);}},undefined);roster.load([]);
 const marker=join(mkdtempSync(join(tmpdir(),'seed-')),'default-members.json');
 const added=await roster.seedDefaults(marker,async()=>[{cli:'codex',path:'/x/codex'},{cli:'claude',path:'/x/claude'}]);
 assert.deepEqual(added,['DSH','Claude Code','Codex']);assert.ok(existsSync(marker));
 const rows=store.members();const dsh=rows.find(r=>r.name==='DSH');
 assert.equal(dsh.cli??null,null);assert.equal(dsh.persona??'','');assert.equal(dsh.avatar??'','');assert.equal(dsh.name_customized,0);
 assert.equal(rows.find(r=>r.name==='Codex').cli,'codex');assert.equal(rows.find(r=>r.name==='Claude Code').cli,'claude');
 assert.equal(store.leadId(1),dsh.id);
 assert.deepEqual(await roster.seedDefaults(marker,async()=>[{cli:'gemini'}]),[],'the marker keeps a second start from adding again');
 // An existing install (members stored, no marker yet) is left alone; detection failing still seeds DSH.
 const m2=join(mkdtempSync(join(tmpdir(),'seed-')),'d.json');assert.deepEqual(await roster.seedDefaults(m2,async()=>[{cli:'gemini'}]),[]);
 const s3=new Store(':memory:');const h3=new Hub(s3,{warn(){},info(){}});const r3=new Roster(h3,{putMember(m){h3.setMember({...m,kind:'dsh'});},dropMember(){}},undefined);r3.load([]);
 assert.deepEqual(await r3.seedDefaults(join(mkdtempSync(join(tmpdir(),'seed-')),'d.json'),async()=>{throw new Error('no which');}),['DSH']);
});

test('#1798 first start makes the seeded DSH member the global primary role before the first apply', async () => {
 const {mkdtempSync,readFileSync,writeFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {LeadState}=await import('./lead-state.mjs');const {applyRequest}=await import('./bridge.mjs');
 const dir=mkdtempSync(join(tmpdir(),'seed-lead-'));const leadState=new LeadState(join(dir,'lead.json'));
 const store=new Store(':memory:');store.ensureRoom(1,'general');const hub=new Hub(store,{warn(){},info(){}},leadState);
 // Like plugin.mjs: every putMember schedules an apply (bridge.sync); record the lead each one would send.
 const sent=[];const pending=[];
 const roster=new Roster(hub,{putMember(m){hub.setMember({...m,kind:'dsh'});pending.push(new Promise(r=>setTimeout(()=>{sent.push(applyRequest(store.members().map(x=>({id:x.id,name:x.name,cli:x.cli})),{url:'u',token:'t',lead:leadState.selected()}).fallback_role);r();},0)));},dropMember(){}},undefined);roster.load([]);
 await roster.seedDefaults(join(dir,'d.json'),async()=>[{cli:'claude'},{cli:'codex'}],undefined,leadState);
 await Promise.all(pending);
 const dsh=store.members().find(r=>r.name==='DSH');
 assert.equal(leadState.selected(),dsh.id);assert.equal(hub.selectedPrimaryMember()?.id,dsh.id);
 assert.equal(JSON.parse(readFileSync(join(dir,'lead.json'),'utf8')).auto,true,'an install pick, not a user switch');
 assert.ok(sent.length>0);assert.deepEqual([...new Set(sent)],[dsh.id],'every apply, the first included, names DSH');
 // A primary role already chosen is kept.
 const d2=mkdtempSync(join(tmpdir(),'seed-lead-'));writeFileSync(join(d2,'lead.json'),JSON.stringify({lead:'mine'}));const ls2=new LeadState(join(d2,'lead.json'));
 const s2=new Store(':memory:');const h2=new Hub(s2,{warn(){},info(){}},ls2);const r2=new Roster(h2,{putMember(m){h2.setMember({...m,kind:'dsh'});},dropMember(){}},undefined);r2.load([]);
 await r2.seedDefaults(join(d2,'d.json'),async()=>[],undefined,ls2);
 assert.equal(ls2.selected(),'mine');
});
