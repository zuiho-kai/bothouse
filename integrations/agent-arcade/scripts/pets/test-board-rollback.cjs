'use strict';
// node scripts/pets/test-board-rollback.cjs [--baseline-only] [output-directory]
// No second checkout, Electron, Claude CLI or account is needed. Each board
// runs in its own Node process against the same live git worktrees and home.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'), worker=path.join(root,'test/fixtures/task-board-rollback.cjs');
const h22='7a482a30a1898f61c99bd0a4e8cc49bd966b091e',rc14='f65952146bb832efceb05d07563e385e71c02141';
const args=process.argv.slice(2),baselineOnly=args[0]==='--baseline-only';if(baselineOnly)args.shift();
if(args.length>1||args[0]?.startsWith('--'))throw Error('Usage: test-board-rollback.cjs [--baseline-only] [output-directory]');
const dest=path.resolve(args[0]||'outputs/board-receipt-rollback');fs.mkdirSync(dest,{recursive:true});
const out=fs.mkdtempSync(path.join(dest,'run-')),tempRoot=fs.realpathSync(os.tmpdir());
const temp=fs.mkdtempSync(path.join(tempRoot,'arcade-board-rollback-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(cwd,...params)=>execFileSync('git',params,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
const report={pass:false,head:String(git(root,'rev-parse','HEAD')).trim(),platform:process.platform,node:process.version,
  git:String(git(root,'--version')).trim(),sources:{},cases:[]};
const moduleFiles=['src/core/bus.cjs','src/core/files.cjs','src/bot/background-sessions.cjs','src/bot/claude-sessions.cjs',
  'src/bot/task-board.cjs','src/bot/task-receipt.cjs','src/bot/task-worktree.cjs'];
// Materialize the exact committed modules, including omitted optional modules
// in old releases. No code is patched for compatibility.
function pinned(commit) {
  assert.equal(String(git(root,'rev-parse',commit)).trim(),commit);
  const dir=path.join(temp,commit);fs.mkdirSync(dir);
  const entries=String(git(root,'ls-tree','-r','--name-only',commit,'--',...moduleFiles)).trim().split('\n');
  const sums={};
  for(const f of entries) {
    const bytes=git(root,'show',commit+':'+f), target=path.join(dir,f);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);sums[f]=sha(fs.readFileSync(target));
  }
  report.sources[commit]=sums;return dir;
}
function primaryIdentity(file) {
  const s=fs.statSync(file,{bigint:true});
  return {sha256:sha(fs.readFileSync(file)),ino:String(s.ino),mtimeNs:String(s.mtimeNs)};
}
function caseRun(name,versions,expectLoss) {
  const sandbox=path.join(temp,name),home=path.join(sandbox,'App profile'),project=path.join(sandbox,'owner project'),evidence=path.join(out,name);
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(project);fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(project,'seed.txt'),'Owner project\n');
  git(project,'init','--quiet');git(project,'add','seed.txt');
  git(project,'-c','user.name=Task fixture','-c','user.email=task@example.invalid','-c','commit.gpgsign=false','commit','-qm','Fixture seed');
  const seedHead=String(git(project,'rev-parse','HEAD')).trim();
  const c={name,expectedLoss:expectLoss,stages:[],promptProofs:[]};report.cases.push(c);
  let proofs=[],sessionRows=[],priorPrimary,priorWorktrees;
  for(const [phase,source] of versions) {
    const environment={...process.env,HOME:sandbox,USERPROFILE:sandbox,AGENT_ARCADE_HOME:home,
      GIT_CONFIG_GLOBAL:path.join(sandbox,'empty.gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
    delete environment.CLAUDE_CONFIG_DIR;
    const input=JSON.stringify({phase,source,home,project,sessionRows,proofs,priorMain:priorPrimary?.sha256,expectLoss});
    const result=spawnSync(process.execPath,[worker],{cwd:sandbox,env:environment,input,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
    if(result.status!==0)throw Error(name+'/'+phase+': '+(result.error?.message||result.stderr));
    const output=JSON.parse(result.stdout);proofs=output.proofs;sessionRows=output.sessionRows;
    const stage=output.evidence;c.stages.push(stage);
    if(priorWorktrees)for(const [i,wt] of stage.worktrees.entries()) {
      const prior=priorWorktrees[i];
      for(const key of ['id','folder','dev','ino','branch','head','linkSHA'])assert.equal(wt[key],prior[key],key+' changed across versions');
      assert.equal(wt.status,'?? owner-note.txt');
      if(phase==='rollback')assert.notEqual(wt.noteSHA,prior.noteSHA);
      else assert.equal(wt.noteSHA,prior.noteSHA);
    }
    const file=path.join(home,'task-board.json'),primary=fs.readFileSync(file);
    stage.primary=primaryIdentity(file);
    if(phase==='upgrade-read'){
      assert.deepEqual(stage.primary,priorPrimary,'opening the upgraded board may not rewrite the primary');
      assert.equal(stage.primary.sha256,stage.mainSHA);
    }
    if(phase==='rollback')assert.notEqual(stage.primary.sha256,priorPrimary.sha256,'an actual RC14 save is required');
    assert.ok(proofs.every(p=>!primary.includes(Buffer.from(p.code))));
    fs.writeFileSync(path.join(evidence,phase+'-primary.json'),primary);
    const ledger=path.join(home,'task-handback-proofs.json');
    stage.proofFileSHA=fs.existsSync(ledger)?sha(fs.readFileSync(ledger)):null;
    if(stage.proofFileSHA){
      const bytes=fs.readFileSync(ledger);assert.ok(proofs.every(p=>!bytes.includes(Buffer.from(p.code))));
      fs.writeFileSync(path.join(evidence,phase+'-proofs.json'),bytes);
    }
    priorPrimary=stage.primary;priorWorktrees=stage.worktrees;
    console.log(name+'/'+phase+' cues='+stage.cues);
  }
  c.promptProofs=proofs.map(p=>({launchId:p.launchId,sessionId:p.sessionId,target:p.file,codeSHA:sha(p.code)}));
  assert.equal(String(git(project,'status','--porcelain=v1')).trim(),'');
  assert.equal(String(git(project,'rev-parse','HEAD')).trim(),seedHead);
  assert.ok(!proofs.some(p=>JSON.stringify(c).includes(p.code)));
}
try {
  const old=pinned(rc14), predecessor=pinned(h22);
  const currentFiles=[...moduleFiles,'src/bot/task-receipt-ledger.cjs',
    'scripts/pets/test-board-rollback.cjs','test/fixtures/task-board-rollback.cjs'];
  report.sources.working=Object.fromEntries(currentFiles.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
  caseRun('frozen-h22-loss',[['dispatch',predecessor],['rollback',old],['return',predecessor]],true);
  if(!baselineOnly){
    caseRun('current',[['dispatch',root],['rollback',old],['return',root]],false);
    caseRun('h22-upgrade',[['dispatch',predecessor],['upgrade-read',root],['rollback',old],['return',root]],false);
  }
  report.pass=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  const resolved=fs.realpathSync(temp);assert.equal(path.dirname(resolved),tempRoot);assert.match(path.basename(resolved),/^arcade-board-rollback-[a-zA-Z0-9]+$/);
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4});
  const file=path.join(out,'report.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass:report.pass,path:file,sha256:sha(fs.readFileSync(file)),error:report.error?.split('\n').slice(0,3)}));
}
