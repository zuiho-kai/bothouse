'use strict';
// The ordinary window, git checkout and hook writer are shared with the H21
// smoke. Only the synthetic background CLI can see the dispatched prompt.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

module.exports = async function checkTaskReceipt(h) {
  const {app,page,read,report,out,arcadeHome,git,sha,mark,dispatch,focus,quiet,sample,submit,stop,fk,until,tasks,snapshot}=h;
  const secret = 'H22_PRIVATE_FINAL_REPLY_ONLY_76ef9441';
  const visibleFile = 'owner-review.txt', reason = '第二轮保留第一行，再加本轮结论。';
  const receiptEvidence = report.receipt = {rounds:[],details:[],archives:{}};
  const getRow = async id => (await tasks()).find(t=>t.id===id);
  const rowState = async (id, state) => until(async()=>{const r=await getRow(id);return r?.state===state&&r;},state+' '+id);
  async function checkIPC(row,expected,label) {
    const list=await getRow(row.id),detail=await page.evaluate(id=>arcade.taskDiff(id),row.id);
    assert.equal(list.explicitHandback,expected,label+' list');assert.equal(detail.ok,true);
    assert.equal(detail.task.explicitHandback,expected,label+' diff');await privateFieldsAbsent(JSON.stringify([list,detail]));
    (receiptEvidence.ipc??=[]).push({label,state:list.state,reason:list.reason,reportStatus:list.reportStatus,list:list.explicitHandback,diff:detail.task.explicitHandback});
  }
  async function promptOf(row,requirement='') {
    const launch = await app.evaluate((_e,[id,why])=>handback.dispatch(id,why),[row.sessionId,requirement]);
    assert.equal(launch.cwd,fs.realpathSync(row.worktree));assert.equal(launch.launchId,row.launchId);assert.equal(launch.jobId,row.jobId);
    if(requirement) assert.ok(launch.includesReason);
    receiptEvidence.rounds.push({id:row.id,...launch});
    return launch;
  }
  async function submitted(row) {
    const events=await submit(row,[stop(secret)]);assert.equal(events.length,1);
    assert.equal(events[0].result,'','the normal hook must discard the synthetic final reply');
  }
  async function writeFromPrompt(row,source=row,otherName=false) {
    const target=await app.evaluate((_e,options)=>handback.writeReceipt(options),
      {destination:row.sessionId,source:source.sessionId,otherName});
    const offered=receiptEvidence.rounds.find(r=>r.sessionId===source.sessionId);
    assert.equal(target.bytes,32);assert.equal(target.sha256,offered.tokenSHA);
    (receiptEvidence.writes??=[]).push({destination:row.sessionId,source:source.sessionId,...target});
    return target;
  }
  const privateFieldsAbsent = async value => assert.equal(await app.evaluate((_e,body)=>handback.containsReceiptCode(body),value),false,'receipt code exposed');
  async function confirmed(row) {
    const state=await until(async()=>{const current=await getRow(row.id);return current?.reason==='explicit_handback'&&current;},'explicit handback in the board');
    assert.equal(state.state,'reported');assert.equal(state.outcome,'unverified');assert.equal(state.reportStatus,'receipt');
    assert.equal(state.report,null);assert.equal(state.reportRaw,null);return state;
  }
  async function detail(row,name) {
    await focus('main'); await fk('t:'+row.id+':diff').click();
    const dlg=page.locator('dialog.tb-detail');
    await dlg.getByText(visibleFile,{exact:true}).waitFor();
    const body=await dlg.innerText();
    const diffFiles=await dlg.locator('.tb-files .tb-file').allInnerTexts();
    assert.deepEqual(diffFiles,[visibleFile]);assert.ok(!body.includes(secret));
    await privateFieldsAbsent(body);const screenshot=await dlg.screenshot({path:path.join(out,name+'.png')});
    receiptEvidence.details.push({name,text:body,diffFiles,sha256:sha(screenshot),task:await getRow(row.id)});
    await dlg.getByRole('button',{name:'关闭',exact:true}).click();
    return body;
  }
  async function rework(first) {
    await focus('main'); await fk('t:'+first.id+':rework').click();
    await fk('t:'+first.id+':rework-field').fill(reason);await fk('t:'+first.id+':rework-go').click();
    const current=await until(async()=>{const t=await getRow(first.id);return t?.rework===1&&t.sessionId&&t.sessionId!==first.sessionId&&t;},'new rework session');
    assert.equal(current.worktree,first.worktree);assert.notEqual(current.launchId,first.launchId);assert.notEqual(current.jobId,first.jobId);
    const {rows,cli}=await read();assert.equal(rows.find(j=>j.id===first.jobId).state,'stopped');
    assert.ok(cli.some(e=>e.op==='stop'&&e.job===first.jobId));return current;
  }
  const saveArchive = async filename => {
    const bytes = fs.readFileSync(path.join(arcadeHome,filename));
    assert.equal(bytes.includes(Buffer.from(secret)),false,filename+' may not contain the final reply');
    await privateFieldsAbsent(bytes.toString('utf8'));
    const name=path.basename(filename);fs.writeFileSync(path.join(out,name),bytes);receiptEvidence.archives[name]=sha(bytes);
    return JSON.parse(bytes);
  };

  // The receipt scenarios below leave capture disabled throughout.
  assert.equal((await snapshot()).config.captureResults,false);
  await focus('robot');await sample('','01-baseline');
  receiptEvidence.hookSettingsExist=await app.evaluate(()=>process.getBuiltinModule('node:fs').existsSync(process.env.AGENT_ARCADE_CLAUDE_SETTINGS));
  assert.equal(receiptEvidence.hookSettingsExist,false);
  mark('first dispatch and real worktree edit');
  const first=await dispatch('默认隐私下的工作树交回');const original=await promptOf(first);
  await checkIPC(first,false,'first dispatch');
  const change=path.join(first.worktree,visibleFile);fs.writeFileSync(change,'第一轮的改动\n');
  await focus('robot');
  mark('correct new code written to a different path');
  const misplaced=await writeFromPrompt(first,first,true);await quiet(0,'wrong receipt filename');
  assert.equal(path.dirname(misplaced.file),path.dirname(original.file));assert.equal(path.basename(misplaced.file),'different-name');
  assert.ok(git(first.worktree,'status','--porcelain=v1','--untracked-files=all').includes('different-name'));
  fs.unlinkSync(misplaced.file); // Remove this fixture's intentionally misplaced token before inspecting the owner change.
  await privateFieldsAbsent(JSON.stringify(await snapshot()));
  mark('first receipt with no observer hook in background');
  const initial=await writeFromPrompt(first);await confirmed(first);await sample('!','02-first-return');
  await checkIPC(first,true,'first return');
  assert.equal((await read()).raises.length,1);
  await focus('main');await sample('','03-first-clear');
  assert.equal(git(first.worktree,'status','--porcelain=v1','--untracked-files=all'),'?? '+visibleFile);
  await detail(first,'04-first-detail');
  mark('owner starts rework and the previous CLI job is stopped');
  const next=await rework(first), revised=await promptOf(next,reason);
  await checkIPC(next,false,'rework reset');
  assert.notEqual(original.launchId,revised.launchId);assert.notEqual(original.tokenSHA,revised.tokenSHA);
  assert.equal(fs.readFileSync(change,'utf8'),'第一轮的改动\n');
  await focus('robot');
  mark('old round cannot hand back the new round');
  await writeFromPrompt(next,first);await quiet(1,'old code at the correct new path');
  assert.notEqual((await getRow(next.id)).reason,'explicit_handback');
  fs.appendFileSync(change,'第二轮的结论\n');
  mark('new round receipt with no observer hook in background');
  const current=await writeFromPrompt(next);assert.notEqual(current.file,initial.file);
  await confirmed(next);await sample('!','05-rework-return');assert.equal((await read()).raises.length,2);
  await checkIPC(next,true,'rework returned');
  await focus('main');await sample('','06-rework-clear');
  await detail(next,'07-rework-detail');
  assert.equal(git(next.worktree,'status','--porcelain=v1','--untracked-files=all'),'?? '+visibleFile);
  fs.copyFileSync(change,path.join(out,visibleFile));
  mark('repeat, no hooks and stored privacy evidence');
  // The same file may stay in place after handback. Observing it again during
  // later ticks cannot announce a second transition.
  await focus('robot');await quiet(2,'same receipt across later polls');
  assert.deepEqual(report.hooks,[]);assert.deepEqual((await read()).boardEvents.filter(e=>e.source==='claude-code'),[]);
  mark('separate control: ordinary reply ending without a receipt');
  const missing=await dispatch('没有回执的普通结束');await promptOf(missing);
  await focus('robot');await submitted(missing);await rowState(missing.id,'reported');await quiet(2,'ordinary reply without receipt');
  await checkIPC(missing,false,'ordinary stop');
  const active=await snapshot();assert.equal(active.config.captureResults,false);assert.ok(!JSON.stringify(active).includes(secret));
  await privateFieldsAbsent(JSON.stringify(active));
  const board=await saveArchive('task-board.json'), observer=await saveArchive('state.json');
  await saveArchive(path.join('task-board-sessions','background-sessions.json'));
  const persisted=board.tasks.find(t=>t.id===next.id);
  assert.equal(persisted.reason,'explicit_handback');assert.equal(persisted.reportStatus,'receipt');
  assert.equal(persisted.report,null);assert.equal(persisted.reportRaw,null);
  assert.ok(observer.tasks.some(t=>t.session===missing.sessionId));assert.ok(observer.tasks.every(t=>t.result===''));
  const logs=await read();assert.deepEqual(logs.network,[]);assert.deepEqual(report.errors,[]);
  assert.ok(logs.desktop.every(e=>e.fields.join(',')==='activity,attention'));
  assert.ok(logs.robotIPC.every(e=>e.fields.join(',')==='activity,attention,token'));
  report.observed=logs;
  await privateFieldsAbsent(JSON.stringify(report));
  receiptEvidence.rawReceiptCodesInEvidence=false;
};
