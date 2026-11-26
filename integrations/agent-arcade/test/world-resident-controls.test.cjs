'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {worldResidentControls}=require('../src/core/world-resident-controls.cjs');
const token='a'.repeat(64);
const account='owner_one',worldOrigin='http://127.0.0.1:1234',socialOrigin='https://friends.example';

function fixture(){
  const world={owned:true,connected:false,sourceId:null};
  const friends={account,worldOrigin,available:true,active:false,sourceId:null};
  const trace=[],events={};
  let live=true;
  function session(name,state,url){
    return {fetch:async(endpoint,opts)=>{
      assert.equal(endpoint,url);
      assert.equal(opts.credentials,'include');assert.equal(opts.redirect,'error');
      const args=opts.body?JSON.parse(opts.body):{};
      if(opts.body)assert.equal(opts.headers.Origin,new URL(endpoint).origin);
      trace.push([name,args.action||'read',args]);
      const response=value=>Response.json(value);
      if(!args.action)return response(state);
      if(name==='game'){
        if(args.action==='connect'){
          assert.equal(args.account,account);assert.equal(args.socialOrigin,socialOrigin);
          Object.assign(state,{sourceId:'slot-1',connected:true});
          await events.issued?.();
          return response({sourceId:'slot-1',token});
        }
        if(args.ifToken)assert.equal(args.ifToken,token);
        else assert.equal(args.sourceId,state.sourceId);
        Object.assign(state,{sourceId:null,connected:false});
      }else{
        assert.equal(args.expectedAccount,account);assert.equal(args.sourceId,'slot-1');
        if(args.action==='connect'){
          assert.equal(args.worldOrigin,worldOrigin);assert.equal(args.token,token);
          if(events.fail)return Response.json({error:{code:'planet_empty'}},{status:409});
          Object.assign(state,{active:true,sourceId:args.sourceId});
        }else Object.assign(state,{active:false,sourceId:null});
      }
      return response(state);
    }};
  }
  const act=worldResidentControls({account,worldOrigin,socialOrigin,current:()=>live,
    world:session('game',world,worldOrigin+'/api/app-residents'),
    friends:session('friends',friends,socialOrigin+'/api/v1/planet-residents')});
  return {act,world,friends,trace,events,close:()=>{live=false;},mutations:()=>trace.filter(i=>i[1]!=='read')};
}
test('one explicit opt-in publishes in this account and one explicit disconnect revokes the world first',async()=>{
  const f=fixture();assert.equal((await f.act('open')).state,'ready');assert.equal(f.mutations().length,0);
  assert.deepEqual(await f.act('connect'),{state:'connected',connected:true});
  assert.equal((await f.act('connect')).state,'connected');assert.equal(f.mutations().length,2);
  assert.equal((await f.act('disconnect')).state,'disconnected');
  assert.deepEqual(f.mutations().map(([service,action])=>[service,action]),[
    ['game','connect'],['friends','connect'],['game','disconnect'],['friends','disconnect']]);
});
test('returning owner resumes an existing slot after a publisher restart',async()=>{
  const f=fixture();Object.assign(f.world,{connected:true,sourceId:'slot-1'});
  assert.equal((await f.act('open')).state,'connected');
  const g=fixture();Object.assign(g.friends,{active:true,sourceId:'other-slot'});
  assert.equal((await g.act('connect')).state,'other');assert.equal(g.mutations().length,0);
});
test('visit, different Friends account, and mismatched service address never hand off a capability',async()=>{
  for(const [mutate,expected] of [
    [f=>{f.world.owned=false;},'home'],[f=>{f.friends.account='another';},'login'],
    [f=>{f.friends.worldOrigin='https://another.example';},'configuration']
  ]){
    const f=fixture();mutate(f);assert.equal((await f.act('connect')).state,expected);
    assert.equal(f.mutations().length,0);
  }
});
test('a failed first publication or a late token after closing is rolled back conditionally',async()=>{
  for(const closed of [false,true]){
    const f=fixture();
    if(closed)f.events.issued=()=>f.close();else f.events.fail=true;
    assert.equal((await f.act('connect')).state,closed?'closed':'roles');
    assert.equal(f.world.connected,false);
    assert.equal(f.mutations().at(-1)[2].ifToken,token);
    if(closed)assert.ok(!f.trace.some(([where,action])=>where==='friends'&&action==='connect'));
  }
});
