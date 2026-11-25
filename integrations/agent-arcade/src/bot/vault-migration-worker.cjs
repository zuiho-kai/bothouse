'use strict';
const fs=require('node:fs');
// Only the bootstrap's dedicated import mode loads this module. No normal
// BotService, model runner, NapCat config or general decryption IPC is started.
const {MAX_REQUEST,validateRequest,validatePlaintext,readSource,sealPayload,samePath,directory,CODES,VaultMigrationError}=require('./vault-migration.cjs');
function input(stream){return new Promise((resolve,reject)=>{
  let text='',size=0;const timer=setTimeout(()=>reject(new VaultMigrationError('MIGRATION_TIMEOUT')),10000);
  stream.on('data',chunk=>{size+=chunk.length;if(size>MAX_REQUEST){clearTimeout(timer);reject(new VaultMigrationError('INVALID_MIGRATION'));return;}text+=chunk.toString('utf8');});
  stream.on('end',()=>{clearTimeout(timer);try{resolve(validateRequest(JSON.parse(text)));}catch(error){reject(error);}});
  stream.on('error',()=>{clearTimeout(timer);reject(new VaultMigrationError('INVALID_MIGRATION'));});
});}
// Windows GUI Electron can expose an EOF-only process.stdin even with an
// inherited pipe. Read its actual fd 0; do not substitute a socket or a file.
async function run({electron=require('electron'),stdin=process.platform==='win32'?fs.createReadStream(null,{fd:0,autoClose:false}):process.stdin,stdout=process.stdout}={}){
  const {app}=electron,safeStorage=require('../core/application-credential-vault.cjs').applicationCredentialVault({app,nativeVault:electron.safeStorage});let code=0,response;
  try{
    const incoming=input(stdin);
    // Install listeners before acknowledging readiness. The parent must keep
    // stdin open until this frame arrives, especially on packaged Windows apps.
    stdout.write(JSON.stringify({version:1,status:'ready'})+'\n');
    const request=await incoming;
    // The fixed Mac broker reads legacy vaults in place. Do not expose a
    // caller-supplied ciphertext/public-key oracle through this older CLI.
    // Windows migration and source fixtures keep their existing protocol.
    if(process.platform==='darwin'&&app.isPackaged===true)throw new VaultMigrationError('INVALID_MIGRATION');
    if(!samePath(directory(app.getPath('userData')),request.sourceProfile)||!samePath(directory(app.getPath('sessionData')),request.sourceProfile))throw new VaultMigrationError('PROFILE_MISMATCH');
    if(!app.requestSingleInstanceLock())throw new VaultMigrationError('PROFILE_IN_USE');
    await app.whenReady();
    if(!safeStorage.isEncryptionAvailable())throw new VaultMigrationError('ENCRYPTION_UNAVAILABLE');
    const source=readSource(request.sourceRoot);if(source.hash!==request.sourceHash)throw new VaultMigrationError('SOURCE_CHANGED');
    let plaintext;try{plaintext=validatePlaintext(safeStorage.decryptString(Buffer.from(source.data,'base64')));}catch{throw new VaultMigrationError('VAULT_OPEN_FAILED');}
    response=sealPayload(plaintext,request.publicKey,request.nonce,source.hash);
  }catch(error){code=1;response={version:1,status:'error',code:CODES.has(error?.code)?error.code:'WORKER_FAILED'};}
  await new Promise(resolve=>stdout.write(JSON.stringify(response)+'\n',resolve));
  app.exit(code);
}
module.exports={run};
