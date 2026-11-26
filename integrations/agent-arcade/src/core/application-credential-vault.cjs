'use strict';
// Packaged macOS builds never fall back to Chromium's per-build Keychain
// client. Other hosts and source fixtures retain their native vault interface.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createMacCredentialVault,MacCredentialError,validateProfile}=require('./mac-credential-vault.cjs');
const PROFILE_NAME='profile-v1.json';
function loadBrokerProfile({metadata,home=os.homedir(),io=fs}={}){
 const pin=metadata?.macCredentialBroker;
 if(!pin||pin.protocol!==1||typeof pin.identitySha1!=='string')throw new MacCredentialError('INVALID_PROFILE');
 const directory=path.join(home,'Library','Application Support','Agent Arcade Credentials'),file=path.join(directory,PROFILE_NAME);
 try{
  const parent=io.lstatSync(directory),st=io.lstatSync(file);
  if(parent.isSymbolicLink()||!parent.isDirectory()||st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size>16384||parent.uid!==process.getuid()||st.uid!==process.getuid()||(parent.mode&0o7777)!==0o700||(st.mode&0o7777)!==0o600)throw Error();
  const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let profile;
  try{const opened=io.fstatSync(fd);if(opened.ino!==st.ino||opened.dev!==st.dev||opened.size!==st.size)throw Error();profile=JSON.parse(io.readFileSync(fd,'utf8'));}finally{io.closeSync(fd);}
  for(const field of ['helperSha256','helperCdHash','sourceSha256','identitySha1'])if(typeof pin[field]!=='string'||String(profile[field]).toLowerCase()!==pin[field].toLowerCase())throw Error();
  return validateProfile(profile,{trustedIdentity:pin.identitySha1,pathRoot:directory});
 }catch(error){if(error instanceof MacCredentialError)throw error;throw new MacCredentialError('INVALID_PROFILE');}
}
function unavailableVault(){
 const denied=()=>{throw new MacCredentialError('UNAVAILABLE');};
 return Object.freeze({isEncryptionAvailable:()=>false,encryptString:denied,decryptString:denied});
}
function applicationCredentialVault({app,nativeVault,platform=process.platform,metadata=require('../../package.json'),home,create=createMacCredentialVault}={}){
 if(platform!=='darwin'||app?.isPackaged!==true)return nativeVault;
 try{const profile=loadBrokerProfile({metadata,home});return create({profile,trustedIdentity:metadata.macCredentialBroker.identitySha1});}
 catch{return unavailableVault();}
}
module.exports={PROFILE_NAME,loadBrokerProfile,applicationCredentialVault,unavailableVault};
