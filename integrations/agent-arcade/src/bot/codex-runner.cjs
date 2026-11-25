'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {styleInstructions} = require('../core/personas.cjs');
const {findExecutable} = require('../core/platform.cjs');

const ID = /^[A-Za-z0-9_-]{1,180}$/;
const MAX_FRAME = 2 * 1024 * 1024;
const MAX_TEXT = 12000;
function findCodexExecutable({platform=process.platform,env=process.env,find=findExecutable}={}) {
  // macOS and Linux: PATH first, then the usual install locations (a desktop app
  // can start with a short PATH). The bare name remains the last resort.
  if(platform!=='win32')return find('codex',{platform,env})||'codex';
  const directories=String(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean);
  for(const directory of directories){const candidate=path.join(directory,'codex.exe');try{if(fs.statSync(candidate).isFile())return candidate;}catch{}}
  // The desktop distribution may not add its versioned CLI to Explorer's PATH.
  // Discover only the executable under its installation directory; no user auth/config files.
  if(env.LOCALAPPDATA){
    const base=path.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');
    try{
      const candidates=fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()).slice(0,100).map(entry=>{
        const file=path.join(base,entry.name,'codex.exe');try{const stat=fs.statSync(file);return stat.isFile()?{file,mtime:stat.mtimeMs}:null;}catch{return null;}
      }).filter(Boolean).sort((a,b)=>b.mtime-a.mtime);
      if(candidates.length)return candidates[0].file;
    }catch{}
  }
  return 'codex.exe';
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
async function waitFor(promise, ms) { let timer; try { await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(resolve,ms);})]); } finally { clearTimeout(timer); } }
function environment(source) {
  const env = {...source};
  // Let the original CLI use its own login; never read or copy auth files.
  delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
  return env;
}

class CodexTransport {
  constructor({executable, workspace, spawnImpl = spawn, requestTimeoutMs = 30000, onMessage, onFailure}) {
    this.pending = new Map(); this.next = 0; this.buffer = ''; this.closed = false;
    this.requestTimeoutMs = requestTimeoutMs; this.onMessage = onMessage; this.onFailure = onFailure;
    this.exited = deferred();
    this.child = spawnImpl(executable, ['app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'], {
      cwd:workspace, env:environment(process.env), shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'],
    });
    this.child.once('error', () => this.fail('Codex could not start. Open the original Codex CLI and check its installation/login.'));
    this.child.once('exit', () => { this.didExit = true; this.exited.resolve(); this.fail('Codex app-server exited before the turn finished.'); });
    this.child.stdin.on('error', () => this.fail('Codex input pipe closed.'));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', data => this.read(data));
    // Do not export CLI stderr: it may contain account/configuration details.
    this.child.stderr.on('data', () => {});
  }
  read(data) {
    if (this.closed) return;
    this.buffer += data;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_FRAME) return this.fail('Codex protocol frame exceeded the limit.');
    let split;
    while ((split = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, split); this.buffer = this.buffer.slice(split + 1);
      if (!line.trim()) continue;
      let message; try { message = JSON.parse(line); } catch { return this.fail('Codex returned malformed protocol data.'); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return this.fail('Codex returned malformed protocol data.');
      if (Object.hasOwn(message, 'id') && !message.method) {
        const pending = this.pending.get(message.id); if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Error('Codex rejected the request. Check the original CLI login, model and sandbox configuration.'));
        else pending.resolve(message.result);
      } else {
        Promise.resolve(this.onMessage(message)).catch(() => this.fail('Codex protocol request could not be handled.'));
      }
    }
  }
  send(message) {
    if (this.closed || this.didExit) throw Error('Codex connection is closed.');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > MAX_FRAME) throw Error('Codex request exceeded the limit.');
    this.child.stdin.write(line);
  }
  call(method, params) {
    if (this.closed) return Promise.reject(Error('Codex connection is closed.'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Codex request timed out.')); }, this.requestTimeoutMs);
      this.pending.set(id, {resolve, reject, timer});
      try { this.send({id, method, params}); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  fail(message) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error(message)); }
    this.pending.clear(); this.onFailure(Error(message));
  }
  async dispose() {
    if (!this.closed) this.fail('Codex connection closed.');
    if (this.didExit) return;
    this.child.stdin.end();
    await waitFor(this.exited.promise,500);
    if (!this.didExit) this.child.kill();
    await waitFor(this.exited.promise,1500);
  }
}

function createCodexRunner({workspace, persona = {enabled:true, selection:'default'}, conversationOnly=false, executable = findCodexExecutable(), spawnImpl, requestTimeoutMs = 30000, taskTimeoutMs = 10 * 60 * 1000, interruptTimeoutMs = 8000} = {}) {
  // Native App Server tools can execute within their sandbox without asking this
  // client. Until its no-tool contract is verified, do not call that social mode.
  if(conversationOnly!==false)throw Error('Local Codex conversation-only mode is not yet supported. Choose Claude program, Claude API, GPT API or DeepSeek for autonomous social mode.');
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || !fs.statSync(workspace).isDirectory()) throw Error('Choose an existing project folder.');
  if (typeof executable !== 'string' || !executable || /[\r\n\0]/.test(executable)) throw Error('Invalid Codex executable.');
  let active = null, permanentlyClosed = false;
  const execute = async ({prompt, resume, signal, request = async () => ({allow:false}), onUpdate = () => {}} = {}) => {
    if (active || permanentlyClosed) throw Error('Codex runner is busy or closed.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000 || (resume && !ID.test(resume))) throw Error('Invalid Codex input or thread ID.');
    let sessionId = resume || '', turnId = '', finalText = '', lastText = '', timedOut = false, finished = false, interruptSent = false, startingTurn = false;
    const earlyMessages = [];
    const turnDone = deferred(), failure = deferred(), localAbort = new AbortController(), items = new Map(), approvals = new Map();
    // Attach handlers immediately: startup failures can precede the first RPC.
    failure.promise.catch(() => {}); turnDone.promise.catch(() => {});
    let transport;
    const bound = params => params && params.threadId === sessionId && typeof params.turnId === 'string' && params.turnId === turnId;
    const abortApprovals = () => { for (const pending of approvals.values()) pending.abort(); approvals.clear(); };
    const interrupt = async () => {
      abortApprovals();
      if (finished || !transport || transport.closed || !sessionId || !turnId || interruptSent) return;
      interruptSent = true;
      try { await transport.call('turn/interrupt', {threadId:sessionId, turnId}); } catch { /* bounded cleanup below */ }
    };
    const abort = () => { localAbort.abort(); void interrupt(); };
    active = {abort, done:deferred()}; const run = active;
    const timer = setTimeout(() => { timedOut = true; abort(); }, taskTimeoutMs);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
    const respond = (id, result) => { if (!transport.closed) transport.send({id, result}); };
    const onMessage = async message => {
      const p = message.params || {};
      if (startingTurn && !turnId && p.threadId === sessionId && message.method !== 'turn/started') {
        if(earlyMessages.length>=100) return transport.fail('Too many Codex events before turn start.');
        earlyMessages.push(message); return;
      }
      if (Object.hasOwn(message, 'id')) {
        const id = message.id;
        if (!['string','number'].includes(typeof id)) return;
        if (approvals.has(id)) return transport.fail('Codex reused an active request ID.');
        const method = message.method;
        const controller = new AbortController();
        const eligible = bound(p) && !localAbort.signal.aborted && !finished && typeof p.itemId === 'string';
        if (!eligible) {
          if (/requestApproval$/.test(method) && method !== 'item/permissions/requestApproval') return respond(id,{decision:'decline'});
          if (method === 'item/permissions/requestApproval') return respond(id,{permissions:{},scope:'turn'});
          if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') return respond(id,{answers:{}});
          if (method === 'mcpServer/elicitation/request') return respond(id,{action:'decline',content:null});
          return transport.send({id,error:{code:-32601,message:'Unsupported or stale request.'}});
        }
        approvals.set(id,controller);
        const ask = options => request({...options,signal:controller.signal});
        let result;
        try {
          if (method === 'item/commandExecution/requestApproval') {
            const item = items.get(p.itemId);
            const input = {...p,command:p.command || (item?.type === 'commandExecution' ? item.command : undefined),cwd:p.cwd || item?.cwd};
            const previewable = (typeof input.command === 'string' && input.command.trim()) || (p.networkApprovalContext && typeof p.networkApprovalContext.host === 'string');
            const reply = previewable ? await ask({kind:'permission',tool:p.networkApprovalContext?'CodexNetwork':'CodexCommand',input}) : null;
            result = {decision:reply?.allow === true ? 'accept' : 'decline'};
          } else if (method === 'item/fileChange/requestApproval') {
            const item = items.get(p.itemId);
            // grantRoot can request a session-wide grant, which a one-shot code cannot authorize.
            const reply = !p.grantRoot && item?.type === 'fileChange' && Array.isArray(item.changes) && item.changes.length
              ? await ask({kind:'permission',tool:'CodexFileChange',input:{...p,changes:item.changes}}) : null;
            result = {decision:reply?.allow === true ? 'accept' : 'decline'};
          } else if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
            const answers = {};
            if (Array.isArray(p.questions) && p.questions.length > 0 && p.questions.length <= 3 && p.questions.every(q => typeof q.id === 'string' && typeof q.question === 'string' && !q.isSecret)) {
              for (const question of p.questions) {
                if (controller.signal.aborted) break;
                const reply = await ask({kind:'question',tool:'CodexQuestion',input:{questions:[question]},questions:[question]});
                if (reply?.allow !== true || typeof reply.answer !== 'string') break;
                answers[question.id] = {answers:[reply.answer]};
              }
            }
            result = {answers};
          } else if (method === 'item/permissions/requestApproval') result = {permissions:{},scope:'turn'};
          else if (method === 'mcpServer/elicitation/request') result = {action:'decline',content:null};
          else { transport.send({id,error:{code:-32601,message:'This remote client does not support this tool or authorization request.'}}); return; }
        } catch { result = method.includes('requestUserInput') ? {answers:{}} : {decision:'decline'}; }
        finally { if (approvals.get(id) === controller) approvals.delete(id); }
        if (!controller.signal.aborted && !finished && !transport.closed) respond(id,result);
        return;
      }
      if (message.method === 'serverRequest/resolved' && p.threadId === sessionId) { approvals.get(p.requestId)?.abort(); approvals.delete(p.requestId); return; }
      if (p.threadId !== sessionId) return;
      if (message.method === 'turn/started' && !turnId && ID.test(p.turn?.id || '')) { turnId = p.turn.id; if(localAbort.signal.aborted) void interrupt(); }
      if (message.method === 'turn/completed' && p.turn?.id === turnId) {
        for (const item of p.turn.items || []) if(item.type === 'agentMessage' && typeof item.text === 'string') {lastText=item.text.slice(0,MAX_TEXT);if(item.phase==='final_answer') finalText=lastText;}
        finished = true; abortApprovals(); turnDone.resolve(p.turn); return;
      }
      if (!bound(p)) return;
      if(message.method==='error' && p.willRetry===false) return transport.fail('Codex reported a terminal turn error.');
      if (['item/started','item/completed'].includes(message.method) && p.item && typeof p.item.id === 'string') {
        const item = p.item;
        if(item.type==='commandExecution' || item.type==='fileChange') {
          const preview=item.type==='commandExecution'?{type:item.type,command:item.command,cwd:item.cwd}:{type:item.type,changes:item.changes};
          if (items.size >= 100) items.delete(items.keys().next().value);
          if(Buffer.byteLength(JSON.stringify(preview))<=8000) items.set(item.id,preview);
          else items.delete(item.id); // No shortened operation can be approved.
        }
        if (item.type === 'agentMessage' && message.method === 'item/completed' && typeof item.text === 'string') { lastText=item.text.slice(0,MAX_TEXT); if(item.phase==='final_answer') finalText=lastText; }
        if (message.method === 'item/started') onUpdate({state:'running',tool:item.type});
      }
    };
    try {
      if (localAbort.signal.aborted) return {sessionId,outcome:'cancelled',text:'',notice:'本轮尚未启动，已取消。'};
      transport = new CodexTransport({executable,workspace,spawnImpl,requestTimeoutMs,onMessage,onFailure:error => failure.reject(error)});
      const call = (method,params) => Promise.race([transport.call(method,params),failure.promise]);
      await call('initialize',{clientInfo:{name:'agent_arcade',title:'Agent Arcade',version:'0.3.0'},capabilities:{experimentalApi:false}});
      transport.send({method:'initialized',params:{}});
      const account = await call('account/read',{refreshToken:false});
      if (!account?.account) throw Error('Sign in through the original Codex CLI before connecting.');
      if (localAbort.signal.aborted) return {sessionId,outcome:timedOut?'limit':'cancelled',text:'',notice:'未创建执行轮次；本次请求已停止。'};
      const policy = {cwd:workspace,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'};
      const instructions = 'You are assisting one user through Agent Arcade chat. Reply naturally to ordinary conversation. Work in the selected project and report actual changes/checks honestly. Do not treat a completed response as verified task success. Do not contact third parties. Ask concise questions when needed. ' + styleInstructions('codex',persona);
      const thread = await call(resume?'thread/resume':'thread/start',{...policy,...(resume?{threadId:resume,excludeTurns:true}:{serviceName:'agent-arcade'}),developerInstructions:instructions});
      const receivedId = thread?.thread?.id;
      if (!ID.test(receivedId || '') || (resume && receivedId !== resume)) throw Error('Codex returned a different conversation.');
      sessionId = receivedId;
      if (localAbort.signal.aborted) return {sessionId,outcome:timedOut?'limit':'cancelled',text:'',notice:'未创建执行轮次；本次请求已停止。'};
      startingTurn = true;
      const started = await call('turn/start',{threadId:sessionId,input:[{type:'text',text:prompt}],cwd:workspace,approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite',writableRoots:[workspace],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}});
      if (!ID.test(started?.turn?.id || '') || (turnId && started.turn.id !== turnId)) throw Error('Codex returned an unexpected turn.');
      turnId = started.turn.id;
      startingTurn = false;
      for(const message of earlyMessages.splice(0)) void onMessage(message);
      if (localAbort.signal.aborted) void interrupt();
      const stopped = deferred();
      let stopTimer;
      const stopWait = () => { stopTimer=setTimeout(()=>stopped.reject(Error('Codex interruption was not confirmed.')),interruptTimeoutMs); };
      if (localAbort.signal.aborted) stopWait(); else localAbort.signal.addEventListener('abort',stopWait,{once:true});
      let turn;
      try { turn = await Promise.race([turnDone.promise,failure.promise,stopped.promise]); }
      finally { clearTimeout(stopTimer); localAbort.signal.removeEventListener('abort',stopWait); }
      const outcome = timedOut?'limit':localAbort.signal.aborted || turn.status==='interrupted'?'cancelled':turn.status==='completed'?'reply_ended':'error';
      const notice = outcome==='reply_ended' ? undefined : turn.status==='interrupted'
        ? (timedOut?'达到执行时限。':'')+'Codex 已确认本轮中断；独立后台作业未核验。'
        : turn.status==='completed' ? '停止请求时本轮已结束；任务结果未核验，不能据此确认执行被中断。'
        : 'Codex 报告本轮执行失败；请检查本机 Codex 的登录、模型、网络和沙箱配置。';
      return {sessionId,outcome,text:outcome==='reply_ended'?(finalText || lastText || '本轮没有可显示的回复文本。'):'',...(notice?{notice}:{})};
    } catch {
      return {sessionId,outcome:timedOut?'limit':localAbort.signal.aborted?'cancelled':'error',text:'',notice:localAbort.signal.aborted
        ? (timedOut?'达到执行时限。':'')+'已请求中断，未收到确认；请检查本机 Codex。'
        : 'Codex 未能完成本轮；请检查本机 Codex 的安装、登录、模型、网络和沙箱配置。'};
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',abort); finished=true; abortApprovals();
      await transport?.dispose();
      if(active===run) active=null; run.done.resolve();
    }
  };
  execute.close = async () => { permanentlyClosed=true; const run=active; if(run){run.abort();await run.done.promise;} };
  return execute;
}
module.exports = {createCodexRunner, CodexTransport, environment, findCodexExecutable};
