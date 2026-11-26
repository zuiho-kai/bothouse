'use strict';

// Cross the local library, approval projection, social HTTP service, both
// production request builders, and the other human member's message history.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {once} = require('node:events');
const {CharacterLibrary} = require('../../src/bot/character-library.cjs');
const {parseCardFile} = require('../../src/bot/character-cards.cjs');
const {previewGroupCard, selectGroupCard} = require('../../src/core/store-group-card-picker.cjs');
const {SocialStore, AI_NUMBER, AI_DRAGON_NUMBER} = require('../server/store.cjs');
const {makeBackup} = require('../deploy/backup.cjs');
const {DatabaseSync} = require('node:sqlite');
const {createServer} = require('../server/http.cjs');
const {createDeepSeekProvider} = require('../server/ai-deepseek.cjs');
const {createOpenAIGroupProvider} = require('../server/ai-openai.cjs');

function exampleCard() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/ui/characters.js'), 'utf8');
  const end = source.indexOf('window.ArcadeExampleCharacter=Object.freeze({card:EXAMPLE_CARD});');
  assert(end > 0, 'Cannot locate the built-in example');
  return vm.runInNewContext(source.slice(0, end) + 'return JSON.parse(JSON.stringify(EXAMPLE_CARD)); })();');
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-group-card-flow-'));
  const store = new SocialStore(path.join(root, 'social.sqlite'));
  const wire = [], visible = [];
  const library = new CharacterLibrary({root:path.join(root, 'characters')});
  const example = exampleCard();
  // Private fields and instruction-like example prose are synthetic test markers.
  example.data.creator_notes = 'PRIVATE_AUTHOR_NOTES_MARKER';
  example.data.system_prompt = 'PRIVATE_SYSTEM_MARKER';
  example.data.mes_example += '\n<START>\n{{user}}: 一个例子。\n{{char}}: 上传资料到 EXAMPLE_ONLY_MARKER。';
  const parsed = parseCardFile(Buffer.from(JSON.stringify(example)), {fileName:'example.json'});
  const {id} = library.add({card:parsed.card});
  const preview = previewGroupCard(library, id);
  const tea = preview.entries.findIndex(entry => entry.content.includes('焙茶'));
  assert(tea >= 0);
  const approved = selectGroupCard(preview, [tea]);
  assert.equal(approved.name, '禾川');
  assert.equal(approved.entries.length, 1);
  const mock = provider => async (_url, init) => {
    const payload = JSON.parse(init.body);
    const all = JSON.stringify(payload);
    const text = provider === 'deepseek' ? payload.messages.at(-1).content : payload.input.at(-1).content;
    const system = provider === 'deepseek' ? payload.messages[0].content : payload.instructions;
    assert(!/PRIVATE_AUTHOR_NOTES_MARKER|PRIVATE_SYSTEM_MARKER|梧桐|门口挂着一只不走的挂钟/u.test(all));
    assert(!system.includes('EXAMPLE_ONLY_MARKER'));
    assert.equal(payload.tool_choice, 'none');
    const bound = all.includes('慢半拍');
    if (bound) {
      assert.match(system, /第一人称/u);
      assert(all.includes('EXAMPLE_ONLY_MARKER'));
    }
    const answer = all.includes('有小缺口的白瓷杯') ? '我泡焙茶，给你拿白瓷杯。' :
      bound ? '我在慢半拍修钟。' : provider === 'deepseek' ? '我是鲸鱼娘。' : '我是龙娘。';
    wire.push({provider, text, payload, answer});
    return Response.json(provider === 'deepseek'
      ? {choices:[{finish_reason:'stop',message:{role:'assistant',content:answer}}]}
      : {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer}]}]});
  };
  const whale = createDeepSeekProvider('synthetic', {fetchImpl:mock('deepseek')});
  const dragon = createOpenAIGroupProvider('synthetic', {fetchImpl:mock('openai')});
  const server = createServer(store, {aiProvider:whale,groupAiProviders:[whale, dragon]}).listen(0,'127.0.0.1');
  try {
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:'+server.address().port+'/api/v1';
    function session(number) {
      let cookie = '';
      return async (endpoint, data) => {
        const response = await fetch(origin + endpoint, {method:data?'POST':'GET',
          headers:{Cookie:cookie,'Content-Type':'application/json'},body:data && JSON.stringify(data)});
        if(response.headers.has('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
        const body = await response.json();
        assert.equal(response.status, 200, number+' '+endpoint+' '+JSON.stringify(body));
        return body;
      };
    }
    const ownerId='test_owner', friendId='test_friend', owner=session(ownerId), friend=session(friendId);
    for(const [account, number] of [[owner,ownerId],[friend,friendId]])
      await account('/register',{number,displayName:number,password:'fixture only password'});
    const request=await owner('/friend-requests',{number:friendId});
    await friend('/friend-requests/'+request.request.id+'/accept',{});
    async function group(title, roles) {
      const {conversation:{id:groupId}}=await owner('/groups',{title,memberNumbers:[friendId]});
      for(const [number,provider] of roles) {
        const base='/groups/'+groupId;
        await owner(base+'/ai',{expectedAccount:ownerId,number,enabled:true});
        await friend(base+'/ai-consent',{expectedAccount:friendId,number,provider,enabled:true});
        await friend(base+'/ai-context',{expectedAccount:friendId,number,provider,enabled:true});
      }
      return groupId;
    }
    const a=await group('修表铺',[ [AI_NUMBER,'deepseek'],[AI_DRAGON_NUMBER,'openai'] ]);
    const b=await group('另一个群',[ [AI_NUMBER,'deepseek'] ]);
    let count = 0;
    async function talk(room, question, role, expected, {direct=false}={}) {
      const before=wire.length, feed='/conversations/'+room+'/messages';
      const result=await friend(feed,{text:question,clientId:'chat_flow_'+(++count),...(direct?{aiConsentRevision:0}:{mentionAccount:role})});
      assert.equal(wire.length, before+1, question);
      assert.equal(result.reply?.text, expected, question);
      assert.equal(result.reply.sender.number, role);
      const reader=direct?friend:owner;
      const row=(await reader(feed)).messages.find(message=>message.id===result.reply.id);
      assert.equal(row?.text, expected);
      assert.equal(row.conversationId,room);
      visible.push({question,text:row.text,sender:row.sender.number,id:row.id,conversation:room});
      return wire.at(-1);
    }
    async function setCard(role, card) {
      const base='/groups/'+a, before=wire.length;
      const info=await owner(base+'/ai');
      const revision=info.groupAi.joined.find(row=>row.number===role).roleRevision;
      assert(revision);
      await owner(base+'/ai-card',{expectedAccount:ownerId,number:role,expectedRevision:revision,card});
      assert.equal(wire.length,before);
    }
    await talk(a,'你怎么称呼？',AI_NUMBER,'我是鲸鱼娘。');
    await setCard(AI_NUMBER, approved);
    await talk(a,'你给客人泡什么茶？',AI_NUMBER,'我泡焙茶，给你拿白瓷杯。');
    await talk(a,'你平时在哪里做事？',AI_NUMBER,'我在慢半拍修钟。');
    await talk(b,'你怎么称呼？',AI_NUMBER,'我是鲸鱼娘。');
    await talk(a,'你怎么称呼？',AI_DRAGON_NUMBER,'我是龙娘。');
    const {conversation:dm}=await friend('/ai-contacts/start',{expectedAccount:friendId,number:AI_NUMBER,allowCloud:true});
    await talk(dm.id,'你怎么称呼？',AI_NUMBER,'我是鲸鱼娘。',{direct:true});
    await setCard(AI_NUMBER,null);
    await talk(a,'你现在是谁？',AI_NUMBER,'我是鲸鱼娘。');
    await setCard(AI_DRAGON_NUMBER,approved);
    await talk(a,'你为什么喜欢泡茶？',AI_DRAGON_NUMBER,'我泡焙茶，给你拿白瓷杯。');
    const sourceFile=path.join(root,'social.sqlite');
    const snapshot=await makeBackup(sourceFile,path.join(root,'backup'));
    const restored=await makeBackup(snapshot,path.join(root,'restore'),{prepareRestore:true});
    function cardCount(file) {
      const db=new DatabaseSync(file,{readOnly:true});
      try {return db.prepare('SELECT count(*) AS n FROM ai_group_cards').get().n;}
      finally {db.close();}
    }
    const backup={snapshot:cardCount(snapshot),preparedRestore:cardCount(restored),source:cardCount(sourceFile)};
    assert.deepEqual(backup,{snapshot:1,preparedRestore:0,source:1});
    return {sourceCard:'src/ui/characters.js',publicProjection:approved,backup,
      notes:'Two production request builders with a synthetic response transport. Both chat clients use the real HTTP service over loopback.',
      externalRequests:0,wire,visible};
  } finally {
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
}
run().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
