'use strict';

// A GUI may outlive the terminal or launcher that supplied its output pipe.
// Only a broken output pipe is nonfatal. Do not hide other stream failures or
// install this handler in credential workers, whose stdout is their protocol.
const guarded=new WeakSet();
function guardDesktopOutput(streams=[process.stdout,process.stderr]){
  for(const stream of streams){
    if(!stream||typeof stream.on!=='function'||guarded.has(stream))continue;
    guarded.add(stream);
    stream.on('error',error=>{if(error?.code!=='EPIPE')throw error;});
  }
}
module.exports={guardDesktopOutput};
