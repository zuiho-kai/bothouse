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

test('busy member config edits stay pending; type changes and delete wait', async () => {
 const store=new Store(':memory:');const hub=new Hub(store,{warn(){},info(){}});hub.setMember({id:'owner',name:'owner',kind:'human'});
 const roster=new Roster(hub,{putMember(m){hub.setMember({...m,kind:'dsh'});},dropMember(id){hub.removeMember(id);}}, undefined);
 const m=await managementCreate(roster,{name:'Busy',cli:'codex'});
 store.openJobs=()=>[{member_id:m.id,state:'sent'}];
 const changed=await managementUpdate(roster,m.id,{cliConfig:{model:'next'}});
 assert.equal(changed.apply.status,'pending');
 await assert.rejects(managementUpdate(roster,m.id,{cli:'claude'}),/busy/);
 assert.throws(()=>managementDelete(roster,m.id),/busy/);
});

test('older SQLite members migrate without opting in to new config', async () => {
 const {mkdtempSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const path=join(mkdtempSync(join(tmpdir(),'member-migration-')),'collab.sqlite3');
 const before=new Store(path); before.addMember({id:'legacy',name:'Legacy',cli:'codex'});
 before.db.exec('ALTER TABLE members DROP COLUMN cli_config; ALTER TABLE members DROP COLUMN cli_config_managed'); before.close();
 const after=new Store(path); const row=after.member('legacy');
 assert.equal(row.cli,'codex'); assert.equal(row.cli_config,null); assert.equal(row.cli_config_managed,0); after.close();
});
