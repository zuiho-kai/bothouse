'use strict';
// No arbitrary decrypt oracle is exposed by these non-window worker modes.
// Authorization can only check availability. Self-test only uses fixed public
// synthetic text; no caller supplied ciphertext/path/key is accepted.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
async function runCredentialCommand({mode,electron=require('electron'),metadata=require('../../package.json')}={}){
 const {app}=electron;let directory,exit=1,reply={version:1,status:'error',code:'UNAVAILABLE'};
 try{
  if(process.platform!=='darwin'||!app.isPackaged||!['authorize','self-test'].includes(mode))throw Error();
  directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-credential-command-'));fs.chmodSync(directory,0o700);
  app.setPath('userData',directory);app.setPath('sessionData',directory);
  require('./app-identity.cjs').configureAppIdentity(app);
  await app.whenReady();
  const {loadBrokerProfile}=require('./application-credential-vault.cjs'),profile=loadBrokerProfile({metadata});
  if(mode==='authorize'){
   const {runHelperRequest}=require('./mac-credential-worker.cjs');
   const result=await runHelperRequest(profile,{version:1,operation:'status'},{trustedIdentity:metadata.macCredentialBroker.identitySha1,authorize:true});
   if(result.status!=='ok'||result.available!==true)throw Error();
   reply={version:1,status:'ok',authorized:true,helperSha256:profile.helperSha256};
  }else{
   const {runHelperRequest}=require('./mac-credential-worker.cjs');
   const state=await runHelperRequest(profile,{version:1,operation:'status'},{trustedIdentity:metadata.macCredentialBroker.identitySha1});
   if(state.status!=='ok'||state.available!==true)throw Object.assign(Error(),{code:state.code||'UNAVAILABLE'});
   const {createMacCredentialVault}=require('./mac-credential-vault.cjs'),vault=createMacCredentialVault({profile,trustedIdentity:metadata.macCredentialBroker.identitySha1});
   const text='Agent Arcade credential self-test v1 / 合成输入 / no API key';
   const encoded=vault.encryptString(text);if(vault.decryptString(encoded)!==text)throw Error();
   reply={version:1,status:'ok',syntheticRoundTrip:true,format:encoded.subarray(0,3).toString('ascii'),cipherSha256:crypto.createHash('sha256').update(encoded).digest('hex'),helperSha256:profile.helperSha256};
  }
  exit=0;
 }catch(error){reply={version:1,status:'error',code:/^[A-Z_]{1,48}$/.test(error?.code||'')?error.code:'UNAVAILABLE'};}
 await new Promise(resolve=>process.stdout.write(JSON.stringify(reply)+'\n',resolve));
 if(directory)try{fs.rmSync(directory,{recursive:true,force:true});}catch{/* Only this invocation's empty browser staging. */}
 app.exit(exit);
}
module.exports={runCredentialCommand};
