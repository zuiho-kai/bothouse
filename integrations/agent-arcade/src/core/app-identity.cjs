'use strict';
// Keep the historic Keychain service/account name across source and packaged
// builds. This does not replace macOS code-signing or weaken its access rules.
const NAME='agent-arcade',BUNDLE_ID='io.github.agentarcade.desktop';
function configureAppIdentity(app,{platform=process.platform}={}){
  if(platform==='darwin'&&typeof app?.setName==='function')app.setName(NAME);
  return {name:NAME,bundleId:BUNDLE_ID};
}
module.exports={NAME,BUNDLE_ID,configureAppIdentity};
