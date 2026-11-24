'use strict';
// Only the repeated connection-opening sequence is shared. Domain scopes,
// tickets, requests and output projections remain in their owning modules.
function failure(code){return Object.assign(Error('QQ management connection is unavailable.'),{code});}
function sync(callback){const result=callback();if(result?.then){result.catch?.(()=>{});throw failure('invalid_request');}return result;}
async function openManagementClient({retiring,verify,assertCurrent,clientFactory,onCreated,options,signal,requiredMethods=[]}){
 let client;
 const check=()=>{if(signal?.aborted)throw failure('cancelled');sync(assertCurrent);};
 try{
  check();await retiring;check();await verify();check();
  client=clientFactory({...options,receiveOwnerMessages:false,allowOwnerVoice:false});
  // Attach synchronously before connect can yield: close must always be able
  // to find exactly this object, including the resolve-to-caller microtask gap.
  sync(()=>onCreated(client));
  if(!client||client.receiveOwnerMessages!==false||['connect','close',...requiredMethods].some(key=>typeof client[key]!=='function'))throw failure('invalid_response');
  check();await client.connect(signal);check();return client;
 }catch(error){try{client?.close();}catch{}throw error;}
}
module.exports={openManagementClient};
