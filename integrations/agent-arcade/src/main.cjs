'use strict';
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog, session, safeStorage:nativeSafeStorage, clipboard, shell, nativeTheme, protocol, screen } = require('electron');
const safeStorage=require('./core/application-credential-vault.cjs').applicationCredentialVault({app,nativeVault:nativeSafeStorage});
require('./core/app-identity.cjs').configureAppIdentity(app);
const {PetWindows, enabledPets, validatePetToggle, registerScheme:registerPetScheme}=require('./pets/windows.cjs');
if(process.platform==='darwin')registerPetScheme(protocol);
const {PetWindow,normalize:normalizePet}=require('./pet/window.cjs');
const {PetPresence}=require('./pet/presence.cjs');
const {RobotPreview}=require('./pet/robot/preview.cjs');
const {RobotConnection}=require('./pet/robot/connection.cjs');
const {RobotDeviceBody}=require('./pet/robot/device-body.cjs');
const appVersion = require('../package.json').version;
const storeEdition = require('../package.json').storeEdition === true;
const hiddenStoreTest = storeEdition && require('../store-main.cjs').hiddenTest;
const {createWindowsUpdate,dailyUpdateBinding}=require('./core/windows-app-update.cjs');
const {createStoreUpdate}=require('./core/store-app-update.cjs');
const {qqGuide}=require('./bot/qq-setup.cjs');
const {createMacQQSetup}=require('./bot/mac-qq-setup.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Store } = require('./core/store.cjs');
const { NotificationGate, coalesceChanges } = require('./core/notify.cjs');
const { Bus } = require('./core/bus.cjs');
const { SourceRegistry } = require('./sources/registry.cjs');
const { publishSourceEvent, publishGroupCalendarEvent, subscribeGroupFeedEvents, subscribeGroupCalendarEvents,
  subscribeGroupFolderEvents, subscribeGroupPageEvents } = require('./sources/group-feed-events.cjs');
const { loadSources } = require('./sources/config.cjs');
const { atomicJSON, readJSON, drainInbox } = require('./core/files.cjs');
const integration = require('./core/integration.cjs');
const { validateTheme } = require('./core/theme.cjs');
const {normalizeAppearance,validAppearance,appearanceSnapshot,appearanceBackground,AppearanceController}=require('./core/appearance.cjs');
const {normalizeSendShortcut,validSendShortcut}=require('./core/send-shortcut.cjs');
const { createBrandIcon } = require('./core/icon.cjs');
const hostPlatform = require('./core/platform.cjs');
const { applicationMenuTemplate } = require('./core/app-menu.cjs');
const { BotService } = require('./bot/service.cjs');
const {DesktopChat,desktopChatResult}=require('./bot/desktop-chat.cjs');
const {CharacterStickerStudio,stickerRole,stickerResult,listNamedStickers,readNamedSticker}=require('./bot/character-stickers.cjs');
const {DesktopConversations}=require('./bot/desktop-conversations.cjs');
const {localMemoryResult}=require('./bot/local-companion.cjs');
const {cardGreetingText}=require('./bot/st/card-greeting.cjs');
const {AccountManager}=require('./bot/account-manager.cjs');
const {GroupCardAssignments}=require('./bot/group-card-assignments.cjs');
const {QQConsole,validateDirectoryRequest,validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt}=require('./bot/qq-console.cjs');
const {QQDirectoryReader}=require('./bot/qq-directory.cjs');
const {createQQFriendContactPreparation}=require('./bot/qq-friend-contact-preparation.cjs');
const {onlineGroupMembership}=require('./bot/qq-online-group-directory.cjs');
const {createQQCompanionLaunch}=require('./bot/qq-companion-launch-context.cjs');
const {qqCompanionLaunchResult}=require('./bot/qq-companion-launch.cjs');
const {QQRuntimeManager}=require('./bot/qq-runtime.cjs');
const {createQQStopTrace}=require('./bot/qq-stop-trace.cjs');
const {QQDiagnosticError,codeOf:qqDiagnosticCode,encodeQQDiagnosticReport,writeQQDiagnosticReport}=require('./bot/qq-diagnostic-report.cjs');
const {QQComponents}=require('./bot/qq-components.cjs');
const {QQFirstSetup,QQFirstSetupError}=require('./bot/qq-first-setup.cjs');
const {QQFirstSetupPanel}=require('./bot/qq-first-setup-panel.cjs');
const {QQOwnerImage,canonicalImage,canonicalGroupSticker,readSelected:readSelectedImage}=require('./bot/qq-media.cjs');
const {capability:companionImageCapability}=require('./bot/companion-image.cjs');
const {DEFAULT_MODEL:DEFAULT_CHAT_IMAGE_GPT_MODEL}=require('./bot/gpt-runner.cjs');
const {QQOwnerVoice}=require('./bot/qq-voice.cjs');
const {ownerRemarkResult}=require('./bot/qq-owner-remark-panel.cjs');
const {QQOwnerRemarkSession}=require('./bot/qq-owner-remark-session.cjs');
const {QQOwnerHistorySession,ownerHistoryResult,ownerComposerResult,historyImageResult}=require('./bot/qq-owner-history-session.cjs');
const {QQFriendRequestsPanel,friendRequestsResult}=require('./bot/qq-friend-requests-panel.cjs');
const {OwnerFriendSetup,safeCode:ownerFriendCode}=require('./bot/qq-owner-friend-setup.cjs');
const {QQSelfProfilePanel,selfProfileResult}=require('./bot/qq-self-profile-panel.cjs');
const {QQAvatarSession,avatarResult}=require('./bot/qq-avatar-session.cjs');
const {QQGroupProfileSession,groupProfileResult}=require('./bot/qq-group-profile-session.cjs');
const {QQGroupAdminSession,groupAdminResult}=require('./bot/qq-group-admin-session.cjs');
const {QQContactAdminSession,contactAdminResult}=require('./bot/qq-contact-admin-session.cjs');
const {QQPluginAdminSession,pluginAdminResult,pluginAdminRequest}=require('./bot/qq-plugin-admin-session.cjs');
const {QQPluginConfigSession,pluginConfigResult,pluginConfigRequest}=require('./bot/qq-plugin-config-session.cjs');
const {QQPluginPackageSession,pluginPackageResult,pluginPackageRequest}=require('./bot/qq-plugin-package-session.cjs');
const {QQSSQQSession,ssqqResult}=require('./bot/qq-ssqq-session.cjs');
const {QQSSQQView}=require('./bot/qq-ssqq-view.cjs');
const {QQQCESession,qceRequest,qceResult}=require('./bot/qq-qce-session.cjs');
const {QQQCESecuritySession,qceSecurityRequest,qceSecurityResult}=require('./bot/qq-qce-security-session.cjs');
const {QQQCENativePlansSession,qceNativePlansRequest,qceNativePlansResult}=require('./bot/qq-qce-native-plans-session.cjs');
const {QCECredentialStore,verifyQCEListener}=require('./bot/qq-qce-binding.cjs');
const {QQQCEExportSession,qceExportRequest,qceExportResult}=require('./bot/qq-qce-export-session.cjs');
const {QCEExportJobs,fileName:validateQCEExportFileName}=require('./bot/qq-qce-export-jobs.cjs');
const {QCEScheduleStore}=require('./bot/qq-qce-schedule-store.cjs');
const {QQQCEScheduleRunner}=require('./bot/qq-qce-schedule-runner.cjs');
const {QQQCEScheduleSession,qceScheduleRequest,qceScheduleResult}=require('./bot/qq-qce-schedule-session.cjs');
const {QQRemoteFileStage}=require('./bot/qq-remote-file-stage.cjs');
const {NapCatWebUI}=require('./bot/napcat-webui.cjs');
const {QQPluginArtifacts}=require('./bot/qq-plugin-artifacts.cjs');
const {QQPluginCatalog}=require('./bot/qq-plugin-catalog.cjs');
const {RemoteNapCatRegistry}=require('./bot/qq-remote-registry.cjs');
const {QQRemotePanel,METHODS:remoteSessionMethods}=require('./bot/qq-remote-panel.cjs');
const {QQRemoteSession,remoteResult,remoteRequest}=require('./bot/qq-remote-session.cjs');
const {QQTransferLinks}=require('./bot/qq-transfer-links.cjs');
const {QQTransferJobs}=require('./bot/qq-transfer-jobs.cjs');
const {QQTransferSession}=require('./bot/qq-transfer-session.cjs');
const {QQTransferPanel,SESSION_METHODS:transferSessionMethods}=require('./bot/qq-transfer-panel.cjs');
const {QQTransferLocal,transferLocalResult}=require('./bot/qq-transfer-local.cjs');
const {QQSupervisorLinks}=require('./bot/qq-supervisor-links.cjs');
const {QQSupervisorPanel,supervisorResult}=require('./bot/qq-supervisor-panel.cjs');
const {WindowsWebAuthn}=require('./auth/windows-webauthn.cjs');
const {validateRemoteOrigin,validateRemoteTrust}=require('./bot/qq-remote-transport.cjs');
const {capturePluginWorkScope}=require('./bot/qq-plugin-scope.cjs');
const {groupId:validManagedGroupId}=require('./bot/qq-group-profile.cjs');
const {validateQQOwner,validateQQUrl}=require('./bot/qq.cjs');
const {validateBackupRequest}=require('./bot/qq-profile-backups.cjs');
const {migrateApplicationVault}=require('./bot/vault-migration.cjs');
const characterCards=require('./bot/character-cards.cjs');
const {CharacterLibrary}=require('./bot/character-library.cjs');
const {LorebookLibrary,importWorldInfoFile,MAX_BOOK_BYTES}=require('./bot/st/lorebooks.cjs');
const {VoiceConversation}=require('./voice/conversation.cjs');
const {createVoiceRuntime,voiceCapabilities,voiceRenderAvailability,createVoiceRenderRuntime,voiceRenderRevision}=require('./voice/runtime.cjs');
const {QQVoiceRenderer}=require('./voice/qq-render.cjs');
const {AsrGate}=require('./voice/asr-gate.cjs');
const {createWarmFileAsrProvider}=require('./voice/warm-file-asr-runtime.cjs');
const {OwnerRecordReader,OwnerVoicePipeline}=require('./bot/qq-inbound-voice.cjs');
const {GroupRecordReader}=require('./bot/qq-group-voice.cjs');
const {GroupVoicePipeline}=require('./bot/group-voice-pipeline.cjs');
const QRCode = require('qrcode');
const {discoverNative,createNativeLaunch}=require('./bot/native-launch.cjs');
const {NativeProcess}=require('./bot/native-process.cjs');
const {Workbench}=require('./workbench.cjs');
const {createTaskBoard,taskBoardHandlers}=require('./bot/task-board.cjs');
const {publicCatalog,personaForBackend}=require('./core/personas.cjs');
const {createProviderLogin}=require('./bot/provider-login.cjs');
const root = path.resolve(process.env.AGENT_ARCADE_HOME || path.join(os.homedir(), '.agent-arcade'));
// Bootstrap already owns the desktop guard. Snapshot data before any store can
// migrate it; the build identity also detects same-version repackaging.
let updateSafety=null;
if(['darwin','win32','linux'].includes(process.platform)){
  try{
    const {buildIdentity,ensureUpdateBackup}=require('./core/update-backup.cjs');
    updateSafety=ensureUpdateBackup({root,buildId:buildIdentity({appPath:path.join(__dirname,'..')})});
  }catch{throw Object.assign(Error('Update backup failed; original data was kept.'),{code:'UPDATE_BACKUP_FAILED'});}
}
const qqComponentStoreRoot=storeEdition ? path.join(root,'qq-components')
  : path.resolve(path.join(process.env.LOCALAPPDATA||os.homedir(),'AgentArcade','qq-components'));
const settingsFile = process.env.AGENT_ARCADE_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
const savedConfig = readJSON(path.join(root, 'config.json'));
let config = { sendShortcut:'enter', appearance:'system', language: 'en', notifications: false, quiet: false, captureResults: false, alwaysOnTop: false, compact: false, theme: 'workshop', portrait: 'anime', character:'default', personaVoice:true, layout:'immersive', accent:'auto', workspace:'companion', ...savedConfig };
// Interface layout, accent colour and workspace are presentation choices only.
const LAYOUTS=['immersive','messenger','minimal'],WORKSPACES=['companion','work'],validAccent=value=>value==='auto'||typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
if(!LAYOUTS.includes(config.layout))config.layout='immersive';if(!validAccent(config.accent))config.accent='auto';if(!WORKSPACES.includes(config.workspace))config.workspace='companion';
config.appearance=normalizeAppearance(config.appearance);
config.sendShortcut=normalizeSendShortcut(config.sendShortcut);
config.desktopPets=enabledPets(config.desktopPets);
if(!['default','sprout'].includes(config.character))config.character='default';
if(typeof config.personaVoice!=='boolean')config.personaVoice=true;
const live = new Store(restoreObserverState(savedConfig?.captureResults === false));
function restoreObserverState(captureDisabled) {
  const file = path.join(root, 'state.json');
  if (!captureDisabled) return readJSON(file);
  // A stop between the preference write and the state write leaves old replies
  // on disk. Finish that erasure before any window can observe restored tasks.
  try {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
    let changed = false;
    for (const task of Array.isArray(saved?.tasks) ? saved.tasks : []) {
      if (typeof task?.result === 'string' && task.result.length) {
        task.result = '';
        changed = true;
      }
    }
    if (changed) atomicJSON(file, saved);
    return saved;
  } catch (cause) {
    throw Object.assign(new Error('Could not finish clearing saved observer replies.', {cause}), {code:'CAPTURE_CLEANUP_FAILED'});
  }
}
let win, tray, quitting = false, problem = '', quitProblem = '', timer, restartEventPoll = () => {};
let lastPublishedSnapshot = '';
let pets=null;
let appearanceController=null;
let applicationMenuLanguage=null;
// macOS only: without an Edit menu, Command+C/V/X/A do nothing in text fields.
// (hostGate is declared beside the IPC register wrapper below.)
function installApplicationMenu(){
  const template=applicationMenuTemplate({platform:hostGate?.platform,appName:app.getName?.()||'Agent Arcade',language:config.language,developer:app.isPackaged===false});
  if(!template)return false;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));applicationMenuLanguage=config.language;return true;
}
let bot, accounts, qqConsole, qqComponents, qqCompanionLaunch, qqStopTrace, voice, voiceAccount, voicePanel, voiceWatch, voiceOwnerSource, workbench, cleanedUp = false, voiceEpoch=0, shutdownTask=null;
let imagePanel=null,imagePickerBusy=false;
let avatarPickerBusy=false;
let pluginPackagePickerBusy=false;
let remotePanel=null,transferPanel=null,transferLocal=null,transferJobs=null,supervisorPanel=null,remotePickerBusy=false,remoteLifecycleEpoch=0;
const transferParentIds=new WeakMap();let transferParentSequence=0;
const remoteServiceIds=new WeakMap();let remoteServiceSequence=0;
let voiceMediaPanel=null,voiceMediaClosingPanel=null,voiceFilePickerBusy=false,qqVoiceRenderPending=false;
const {renderNeuralLine}=require('./voice/qq-spoken-line.cjs');
const {QQCharacterVoices}=require('./voice/qq-character-voices.cjs');
const {AppCharacterVoice}=require('./voice/app-character-voice.cjs');
const {windowsId,renderWindowsVoice}=require('./voice/qq-installed-voices.cjs');
const characterVoices=new QQCharacterVoices({
  serenaAvailable:()=>{try{return !!voiceRenderRevision({root});}catch{return false;}},
  renderSerena:async (text,options)=>{
    if(groupVoiceProblem())throw qqVoiceError('voice_render_unavailable');
    const preview=new QQVoiceRenderer({createSpeech:()=>createVoiceRenderRuntime({root})});
    return renderNeuralLine(text,line=>preview.render(line),options?.assertCurrent);
  }
});
const qqVoiceRenderer=new QQVoiceRenderer({createSpeech:()=>createVoiceRenderRuntime({root}),captureRuntime:()=>voiceRenderRevision({root})});
function renderLocalCharacterVoice(text,options){
  if(windowsId(options?.voice))return renderWindowsVoice(options.voice,text,options);
  const problem=groupVoiceProblem();
  if(problem)throw qqVoiceError(problem);
  return renderNeuralLine(text,line=>qqVoiceRenderer.render(line,options),options.assertCurrent);
}
const appCharacterVoice=new AppCharacterVoice({picker:characterVoices,render:renderLocalCharacterVoice});
const asrGate=new AsrGate();
const warmFileAsr=createWarmFileAsrProvider({root,gate:asrGate});
const voiceReceipts=new Map();
// Keep the exact retiring session reachable until its close call succeeds.
const voiceRetirements=new Map(),voiceDiscoveries=new Set();
const qqStopping=new Set();
const qqConnectIntents=new Map();
let qqDiagnosticCache=null,qqDiagnosticGeneration=0,qqDiagnosticSaving=false;
const ownerRemarkPanel=new QQOwnerRemarkSession({capture:captureOwnerRemarkManagement,verifyContext:verifyOwnerRemarkManagement});
const ownerHistorySession=new QQOwnerHistorySession({capture:captureSelfProfile,verifyContext:verifySelfProfile,
  imagePrepare:(bytes,extension)=>canonicalImage(bytes,extension,nativeImage),
  captureSubmission:captured=>captured.profile.manualQQRecorder({accountId:captured.qqAccountId,ownerId:captured.ownerId,characterId:captured.characterId})});
const friendRequestsPanel=new QQFriendRequestsPanel({capture:captureFriendRequests});
const ownerFriendSetup=new OwnerFriendSetup({capture:captureOwnerFriendSetup,verifyContext:verifyOwnerFriendSetup});
const selfProfilePanel=new QQSelfProfilePanel({capture:captureSelfProfile,verifyContext:verifySelfProfile});
const avatarPanel=new QQAvatarSession({capture:captureSelfProfile,verifyContext:verifySelfProfile,nativeImage,uploadRoot:path.join(root,'qq-avatar-uploads')});
const groupProfileSession=new QQGroupProfileSession({capture:captureGroupProfile,verifyContext:verifyGroupProfile});
const groupAdminSession=new QQGroupAdminSession({capture:captureGroupProfile,verifyContext:verifyGroupProfile});
const contactAdminSession=new QQContactAdminSession({capture:captureSelfProfile,verifyContext:verifySelfProfile});
const pluginAdminSession=new QQPluginAdminSession({capture:capturePluginAdmin,verifyContext:verifyPluginAdmin,verifyEnable:(captured,options)=>require('./bot/qq-qce-managed-process.cjs').verifyManagedQCEEnable({runtime:captured.runtime,qqAccountId:captured.qqAccountId,signal:options.signal,assertCurrent:()=>{assertPluginCapture(captured);options.assertCurrent();}})});
const pluginConfigSession=new QQPluginConfigSession({capture:capturePluginAdmin,verifyContext:verifyPluginAdmin});
const qceSession=new QQQCESession({capture:captureQCE,verifyContext:verifyQCE});
const qceSecuritySession=new QQQCESecuritySession({capture:captureQCE,verifyContext:verifyQCE});
const qceNativePlansSession=new QQQCENativePlansSession({capture:captureQCE,verifyContext:verifyQCE});
let qceCredentials=null,qceCredentialPanel=null;
let qceExportJobs=null;
const qceExportStages=new Set();
const qceExportSession=new QQQCEExportSession({capture:captureQCE,verifyContext:verifyQCE,saveDownload:saveQCEExportDownload,
  jobs:Object.fromEntries(['begin','change','get','list','forget'].map(method=>[method,(...args)=>qceJobs()[method](...args)]))});
let qceScheduleStore=null,qceScheduleTimer=null;
const qceScheduleRecords=Object.fromEntries(['list','get','allEnabled','create','update','setEnabled','remove','advance','claim','done','runs','settleInterrupted','forgetRun'].map(method=>[method,(...args)=>qceSchedules()[method](...args)]));
const qceScheduleRunner=new QQQCEScheduleRunner({store:qceScheduleRecords,
  jobs:Object.fromEntries(['begin','change','get','list','forget'].map(method=>[method,(...args)=>qceJobs()[method](...args)])),
  capture:value=>captureQCE(value,{background:true}),verifyContext:(value,options)=>verifyQCE(value,options,{background:true})});
const qceScheduleSession=new QQQCEScheduleSession({captureLocal:captureQCEScheduleLocal,captureNetwork:captureQCE,verifyContext:verifyQCE,store:qceScheduleRecords,runner:qceScheduleRunner});
const pluginCatalog=new QQPluginCatalog();
const pluginArtifacts=new QQPluginArtifacts({root:qqComponentStoreRoot,catalog:pluginCatalog});
const pluginPackageSession=new QQPluginPackageSession({capture:capturePluginPackage,withDeploymentLock:withPluginDeploymentLock,picker:pickPluginPackage,artifacts:pluginArtifacts,catalog:pluginCatalog});
const ssqqSession=new QQSSQQSession({capture:captureSSQQ,verifyContext:verifySelfProfile,artifacts:pluginArtifacts,selectArchive:pickSSQQArchive,viewFactory:options=>new QQSSQQView({...options,window:win,electron:require('electron')}),onState:state=>{if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('arcade:ssqqState',state);}});
let pendingPluginRead=null;
let qqProgramPickerBusy=false;
const firstSetupPanel=new QQFirstSetupPanel({capture:captureFirstSetup,create:({capture})=>new QQFirstSetup({componentStoreRoot:qqComponentStoreRoot,console:qqConsole,capture,programPicker:pickQQProgram,onChange:publish})});
const gate = new NotificationGate();
// Listen/notify: every source publishes here; notifications and the companion
// subscribe. Module onChange callbacks still call publish() for the snapshot.
const bus = new Bus();
// User-added data sources (calendar, folder, feed). None exist by default.
// Their content is data: it is shown, never run.
const sourcesFile = path.join(root,'sources.json');
const sources = new SourceRegistry({file:sourcesFile,
  publish:(event,source,identity,occurrence)=>publishSourceEvent(bus,event,source,identity,occurrence),
  publishCalendar:(occurrence,source,identity,at)=>publishGroupCalendarEvent(bus,source,identity,occurrence,at)});
let sourceNotice = null;
bus.subscribe(event=>typeof event.title==='string'&&['desktop','both'].includes(event.notify),event=>{
  if(quitting||!win||win.isDestroyed()||!Notification.isSupported())return;
  // One toast per source per cooldown; a burst of items shows the first.
  if(!gate.allow({changed:true,task:{id:'source:'+event.source,state:'done',updatedAt:Date.now()}},{enabled:config.notifications,quiet:config.quiet,focused:win.isFocused()&&win.isVisible()}))return;
  try{sourceNotice?.close();}catch{/* Optional OS surface. */}
  const notice=new Notification({title:'Agent Arcade · '+(event.sourceName||'').slice(0,60),body:event.title,silent:true});
  sourceNotice=notice;notice.on('click',show);notice.show();
});
bus.subscribe(event=>typeof event.title==='string',()=>publish());
// The selected profile's companion may mention a source event in its own words.
// It stores the notice and applies its own hours, daily cap and quiet rules.
bus.subscribe(event=>typeof event.title==='string'&&['companion','both'].includes(event.notify),event=>{bot?.companionNotice?.(event);});
const groupSourceBusOptions={registry:sources,services:()=>accounts?.services?.values()||[],active:()=>!quitting};
subscribeGroupFeedEvents(bus,groupSourceBusOptions);
subscribeGroupCalendarEvents(bus,groupSourceBusOptions);
subscribeGroupFolderEvents(bus,groupSourceBusOptions);
subscribeGroupPageEvents(bus,groupSourceBusOptions);
function sourceConfig(){const loaded=loadSources(sourcesFile);if(loaded.problem)throw Error('The saved source list could not be read.');return loaded.sources;}
// Imported character cards (PNG/JSON). Card text is data; nothing in a card is run.
const characterLibrary = new CharacterLibrary({root:path.join(root,'characters')});
const groupCardAssignments=new GroupCardAssignments({accounts:()=>accounts,library:characterLibrary,
  available:(id,qqId)=>!quitting&&!qqStopping.has(qqId)&&!qqConnectIntents.has(id)});
function characterThumb(id){
  try{const file=characterLibrary.portraitPath(id);if(!file||!fs.existsSync(file))return '';const image=nativeImage.createFromPath(file);return image.isEmpty()?'':image.resize({width:128,quality:'good'}).toDataURL();}catch{return '';}
}
const lorebookLibrary = new LorebookLibrary({root:path.join(root,'lorebooks')});
// Regex scripts (SillyTavern exports). Scripts are data, run only by the guarded engine.
const {RegexLibrary}=require('./bot/st/regex-library.cjs');
const regexLibrary = new RegexLibrary({root:path.join(root,'regex')});
// Group chats of the App conversation: member lists of library character ids, shared by every profile.
const {GroupLibrary}=require('./bot/st/group-library.cjs');
const groupLibrary = new GroupLibrary({root:path.join(root,'groups')});
// Task board: one git worktree per task. Neither the worktree nor the edit
// pre-authorization is a sandbox; a hand-back is verified only by the owner.
// A project directory is accepted only from the native picker of this run.
let taskBoard=null;
function registerTaskBoardHandlers(){
  const handlers=taskBoardHandlers(taskBoard,{pick:async()=>{const picked=await dialog.showOpenDialog(win,{properties:['openDirectory']});return picked.canceled?'':picked.filePaths[0];}});
  for(const [channel,handler] of Object.entries(handlers))register(channel,handler);
}
// SillyTavern-style pipeline of the selected profile's App conversation.
function registerSTHandlers(){
  const {localOperationResult,codedResult}=require('./bot/local-companion.cjs');
  const done=value=>{publish();return value;};
  if(storeEdition){
    const {createLegacyCompanionImport}=require('./bot/legacy-companion-import.cjs');
    const migration=createLegacyCompanionImport({
      current:()=>{
        const id=accounts?.selectedId, entry=accounts?.accounts.find(item=>item.id===id);
        return entry&&accounts.services.get(id)===bot?{id,home:root,root:entry.root,name:entry.name,
          revision:accounts.selectionRevision,service:bot}:null;
      },
      pick:async()=>{
        const selection=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择旧版陪伴资料目录':'Choose the previous companion data folder',properties:['openDirectory']});
        return selection.canceled?'':selection.filePaths[0];
      },
      characters:characterLibrary,books:lorebookLibrary,refresh:()=>done(bot?.stRefresh?.()),
    });
    register('legacyCompanionPreview',()=>migration.preview());
    register('legacyCompanionApply',request=>migration.apply(request));
  }
  register('stConfigure',partial=>{
    // A role choice is bound to the profile rendered in the selector, so an
    // unpublished account change cannot redirect it to another companion.
    if(partial&&typeof partial==='object'&&Object.hasOwn(partial,'profileId')){
      if(typeof partial.profileId!=='string'||partial.profileId!==accounts?.selectedId||accounts.get(partial.profileId)!==bot)throw Object.assign(Error('The selected companion changed. Open its role selector again.'),{code:'changed'});
      const {profileId,...patch}=partial;partial=patch;
    }
    return done(bot.stConfigure(partial));
  });
  function selectedSTService(profileId,service=bot){
    if(service&&service===bot&&typeof profileId==='string'&&profileId&&profileId===accounts?.selectedId&&accounts.services.get(profileId)===service)return service;
    throw Object.assign(Error('The selected companion changed. Reopen its conversation settings.'),{code:'changed'});
  }
  register('stConversations',profileId=>selectedSTService(profileId).stConversations());
  // Read-only: the built-in preset, so the renderer can offer "restore default".
  register('stDefaultPreset',()=>require('./bot/st/presets.cjs').validatePreset(require('./bot/st/prompt-builder.cjs').DEFAULT_PRESET));
  register('stClearConversation',value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'profileId')||Object.keys(value).length!==2||
      !(Object.hasOwn(value,'characterId')||Object.hasOwn(value,'groupId')))throw Object.assign(Error('Invalid conversation target.'),{code:'invalid_request'});
    const {profileId,...target}=value;
    return done(selectedSTService(profileId).stClearConversation(target));
  });
  register('stImportPreset',async profileId=>{
    const service=selectedSTService(profileId);
    const picked=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Preset JSON',extensions:['json']}]});if(picked.canceled||!picked.filePaths[0])return null;
    selectedSTService(profileId,service);
    const file=picked.filePaths[0];if(fs.statSync(file).size>1024*1024)throw Error('Preset file is too large.');
    const imported=require('./bot/st/presets.cjs').importSillyTavernPreset(fs.readFileSync(file),{name:path.basename(file,path.extname(file)).slice(0,60)});
    return {snapshot:done(service.stConfigure({preset:imported.preset})),warnings:imported.warnings.slice(0,20)};
  });
  register('localMessage',async value=>{const result=await localOperationResult(()=>bot.localMessage(value));publish();return result;});
  // Conversation branches of the selected library character. Results are {ok:true,...} or {ok:false,code}.
  register('branches',()=>bot.branches());
  register('branchFrom',async value=>{const result=await localOperationResult(()=>({branch:bot.branchFrom(value?.messageId,value?.name)}));publish();return result;});
  register('branchRename',async value=>{const result=await localOperationResult(()=>({branch:bot.branchRename(value?.id,value?.name)}));publish();return result;});
  register('branchRemove',async id=>{const result=await localOperationResult(()=>bot.branchRemove(id));publish();return result;});
  // Regex scripts, shared by every profile.
  register('regexList',()=>bot.regexScripts());
  // Results are {ok:true,...} or {ok:false,code}; a cancelled file dialog is null.
  register('regexImport',async()=>{
    const picked=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Regex script JSON',extensions:['json']}]});if(picked.canceled||!picked.filePaths[0])return null;
    return codedResult(()=>{
      const file=picked.filePaths[0];if(fs.statSync(file).size>1024*1024)throw Object.assign(Error('Regex script file is too large.'),{code:'regex_file_too_large'});
      const imported=bot.regexImport(fs.readFileSync(file));publish();return {...imported,list:bot.regexScripts()};
    });
  });
  register('regexUpdate',value=>codedResult(()=>{const script=bot.regexUpdate(value?.id,value?.patch);publish();return {id:script.id,list:bot.regexScripts()};}));
  register('regexRemove',id=>codedResult(()=>{const result=bot.regexRemove(id);publish();return {...result,list:bot.regexScripts()};}));
  register('regexReorder',ids=>codedResult(()=>{bot.regexReorder(ids);publish();return {list:bot.regexScripts()};}));
  // Group chats of the App conversation (several library characters). Results are {ok:true,...} or {ok:false,code}.
  register('groupsList',()=>bot.groups());
  register('groupSave',async value=>{const result=await localOperationResult(()=>({group:bot.groupSave(value)}));publish();return result;});
  register('groupRemove',async id=>{const result=await localOperationResult(()=>bot.groupRemove(id));publish();return result;});
  // Group dispatcher, memory wiki and reflection of the selected profile's App conversation. All off
  // until the owner switches them on. Results are {ok:true,...} or {ok:false,code}.
  const knowledge=(channel,method,changes=false)=>register(channel,async value=>{const result=await codedResult(()=>bot[method](value));if(changes)publish();return result;});
  for(const method of ['dispatcherStatus','wikiTree','wikiLint','wikiProposals','reflectionStatus','reflectionCandidates','reflectionRules'])knowledge(method,method);
  for(const method of ['dispatcherConfigure','wikiCreate','wikiPropose','wikiDecide','wikiAccess','reflectionConfigure','reflectionRun','reflectionDecide','reflectionRule'])knowledge(method,method,true);
  register('wikiPage',rel=>codedResult(()=>bot.wikiPage(rel)));
  // Opens the owner's notes folder in the file manager; the path is derived here, never taken from the renderer.
  register('wikiOpenFolder',async()=>{const folder=path.join(bot.root,'local-companion','wiki');if(!fs.existsSync(folder))return {ok:false,code:'wiki_not_found'};const problem=await shell.openPath(folder);return problem?{ok:false,code:'wiki_unavailable'}:{ok:true};});
}
function importFileError(message,code){
  return Object.assign(Error(message),{code});
}
function readImportFile(file,maxBytes,tooLarge){
  let handle;
  try{
    if(!fs.statSync(file).isFile())throw importFileError('Choose a regular file.','unreadable');
    handle=fs.openSync(file,'r');
    const stat=fs.fstatSync(handle);
    if(!stat.isFile())throw importFileError('Choose a regular file.','unreadable');
    if(stat.size>maxBytes)throw importFileError(tooLarge,'too_large');
    const bytes=Buffer.alloc(stat.size+1);
    let read=0;
    while(read<bytes.length){
      const count=fs.readSync(handle,bytes,read,bytes.length-read,null);
      if(!count)break;
      read+=count;
    }
    if(read!==stat.size)throw importFileError('The file changed while it was being read. Choose it again.','unreadable');
    return bytes.subarray(0,read);
  }catch(error){
    if(error.code==='too_large'||error.code==='unreadable')throw error;
    throw importFileError('The selected file could not be read.','unreadable');
  }finally{if(handle!==undefined)fs.closeSync(handle);}
}
function importPickedLibraryFiles(files,prepare,library,list,changed){
  if(files.length===1){
    const {entry,...details}=prepare(files[0]);
    const added=library.add(entry);
    changed?.();
    return {id:added.id,...details,list:list()};
  }
  // Keep the index and subsequent writes in the same main-process turn.
  // Another picker can finish later without reusing an obsolete index.
  const add=library.batchImporter();
  let imported=false;
  const results=files.map(pathname=>{
    const file=path.basename(pathname);
    let prepared;
    try{prepared=prepare(pathname);}
    catch(error){
      const code=['too_large','unreadable'].includes(error.code)?error.code:'invalid';
      return {file,status:'failed',code};
    }
    try{
      const {id,skipped}=add(prepared.entry);
      if(!skipped)imported=true;
      return {file,status:skipped?'skipped':'imported',id,name:prepared.name,warnings:prepared.warnings};
    }catch(error){
      const code=['character_library_full','lorebook_library_full'].includes(error.code)?'full':
        ['character_too_large','lorebook_too_large'].includes(error.code)?'too_large':'save_failed';
      return {file,status:'failed',code,warnings:prepared.warnings};
    }
  });
  if(imported)changed?.();
  return {batch:true,results,list:list()};
}
function registerLorebookHandlers(){
  const rows=()=>lorebookLibrary.list();
  register('lorebooksList',()=>rows());
  register('lorebooksReadEntries',id=>{
    const record=lorebookLibrary.get(id);
    return record?.book.entries.map(({comment,keys,secondaryKeys,content,enabled})=>({comment,keys,secondaryKeys,content,enabled}))||null;
  });
  register('lorebooksSaveFromCharacter',id=>{
    try{
      const card=characterLibrary.get(id);
      if(!card)return {ok:false,code:'character_missing'};
      const book=card.characterBook;
      if(!book?.entries.length)return {ok:false,code:'no_book'};
      const name=(book.name.trim()||card.name).slice(0,60);
      // Reuse the synchronous import index so repeated clicks match existing
      // content without editing the card or any already approved book.
      const result=lorebookLibrary.batchImporter()({name,book});
      return {ok:true,...result,list:rows()};
    }catch(error){
      const code={'character_id_invalid':'character_missing','lorebook_library_full':'full','lorebook_too_large':'too_large'}[error.code];
      return {ok:false,code:code||'save_failed'};
    }
  });
  register('lorebooksImport',async()=>{
    const picked=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'World info / lorebook JSON',extensions:['json']}]});if(picked.canceled||!picked.filePaths.length)return null;
    return importPickedLibraryFiles(picked.filePaths,file=>{
      const parsed=importWorldInfoFile(readImportFile(file,MAX_BOOK_BYTES,'Lorebook file is too large.'));
      const name=(parsed.book.name||path.basename(file,path.extname(file))).slice(0,60)||'Lorebook';
      return {entry:{name,book:parsed.book},name,entries:parsed.book.entries.length,warnings:parsed.warnings.slice(0,20)};
    },lorebookLibrary,rows);
  });
  register('lorebooksRemove',id=>{const result=lorebookLibrary.remove(id);bot?.stRefresh?.();publish();return {...result,list:rows()};});
}
function registerCharacterHandlers(){
  const summaries=()=>characterLibrary.list().map(row=>({...row,thumb:row.hasPortrait?characterThumb(row.id):''}));
  register('charactersList',()=>summaries());
  // Larger portrait for layouts that show the character as artwork; bounded and re-encoded.
  register('charactersPortrait',id=>{
    try{const file=characterLibrary.portraitPath(id);if(!file||!fs.existsSync(file))return '';const image=nativeImage.createFromPath(file);if(image.isEmpty())return '';const size=image.getSize();return (size.height>1200?image.resize({height:1200,quality:'best'}):image).toDataURL();}catch{return '';}
  });
  register('charactersImport',async()=>{
    const picked=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'Character card',extensions:['png','json']}]});if(picked.canceled||!picked.filePaths.length)return null;
    return importPickedLibraryFiles(picked.filePaths,file=>{
      const parsed=characterCards.parseCardFile(readImportFile(file,characterCards.FULL_PNG_MAX_BYTES,'Character card is too large.'),{fileName:path.basename(file)});
      return {entry:{card:parsed.card,portrait:parsed.portrait},name:parsed.card.name,warnings:parsed.warnings.slice(0,20)};
    },characterLibrary,summaries,()=>bot?.stRefresh?.());
  });
  // Built-in example card (original text, no portrait). It goes through the same parser and
  // bounds as an imported file; adding it twice returns the existing one.
  register('charactersAddExample',card=>{
    const text=JSON.stringify(card);if(typeof text!=='string'||text.length>64*1024)throw Error('Invalid example character.');
    const parsed=characterCards.parseCardFile(Buffer.from(text),{fileName:'example.json'});
    const existing=characterLibrary.list().find(row=>row.name===parsed.card.name&&row.creator===parsed.card.creator);
    if(existing)return {id:existing.id,name:existing.name,warnings:[],list:summaries()};
    const added=characterLibrary.add({card:parsed.card,portrait:null});
    bot?.stRefresh?.();
    return {id:added.id,name:parsed.card.name,warnings:parsed.warnings.slice(0,20),list:summaries()};
  });
  register('charactersGet',id=>{
    const card=characterLibrary.get(id);if(!card)return null;const clip=(value,max=4000)=>typeof value==='string'?value.slice(0,max):'';
    return {id:card.id,name:card.name,creator:clip(card.creator,200),characterVersion:clip(card.characterVersion,80),tags:card.tags,description:clip(card.description),personality:clip(card.personality),scenario:clip(card.scenario),firstMessage:clip(cardGreetingText(card.firstMessage)),alternateGreetings:card.alternateGreetings.length,creatorNotes:clip(card.creatorNotes),hasSystemPrompt:!!card.systemPrompt,hasPostHistory:!!card.postHistoryInstructions,bookEntries:card.characterBook?.entries?.length||0,thumb:characterThumb(card.id)};
  });
  register('charactersRemove',id=>{
    const result=characterLibrary.remove(id);
    if(result.removed)accounts?.pauseGroupsForRemovedCard(id);
    bot?.stRefresh?.();
    publish();
    return {...result,list:summaries()};
  });
  register('charactersExport',async value=>{
    const {id,format}=value&&typeof value==='object'?value:{};const card=characterLibrary.get(id);if(!card)throw Error('This character no longer exists.');
    const portraitFile=characterLibrary.portraitPath(id),portraitPng=portraitFile&&fs.existsSync(portraitFile)?fs.readFileSync(portraitFile):undefined;
    const out=characterCards.exportCard(card,{format:format==='v3'?'v3':'v2',portraitPng});
    const extension=out.png?'png':'json';
    const cleaned=card.name.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} _-]+/gu,' ').trim();
    const stem=cleaned.match(/^.{1,40}/u)?.[0].trimEnd()||'';
    const reserved=/^(?:CON|PRN|AUX|NUL|CONIN|CONOUT|(?:COM|LPT)[0-9¹²³])$/iu.test(stem);
    const suggested=/[\p{L}\p{N}]/u.test(stem)&&!reserved?stem:'character';
    const picked=await dialog.showSaveDialog(win,{defaultPath:suggested+'.'+extension,filters:[{name:'Character card',extensions:[extension]}]});if(picked.canceled)return {saved:false};
    fs.writeFileSync(picked.filePath,out.png||out.json);return {saved:true};
  });
}
function registerSourceHandlers(){
  register('sourcesRoleJournal',async value=>{
    if(!value||!['view','save'].includes(value.operation))throw Error('Invalid journal operation.');
    const current=()=>{
      if(!win||win.isDestroyed()||!win.isVisible()||quitting||accounts.selectedId!==value.accountId||accounts.get(value.accountId)!==bot)throw Error('The selected companion changed.');
      return bot.localManager().reminderJournal(value.historyId,value.day);
    };
    const journal=current();
    if(value.operation==='view')return journal.records.map(({time,name,text})=>({time,name,text}));
    if(!journal.records.length)return {saved:false,empty:true};
    const choice=await dialog.showSaveDialog(win,{defaultPath:journal.filename,filters:[{name:'JSON Lines',extensions:['jsonl']}],properties:['dontAddToRecent']});
    if(choice.canceled||!choice.filePath)return {saved:false};
    const confirmed=current();
    if(JSON.stringify(confirmed)!==JSON.stringify(journal))throw Error('The reminder journal changed.');
    if(path.extname(choice.filePath).toLowerCase()!=='.jsonl')throw Error('Choose a JSONL file.');
    const staged=choice.filePath+'.'+require('node:crypto').randomUUID()+'.tmp';
    try{
      fs.writeFileSync(staged,confirmed.records.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx',mode:0o600});
      fs.renameSync(staged,choice.filePath);
    }finally{fs.rmSync(staged,{force:true});}
    return {saved:true};
  });
  const reply=()=>{publish();return true;};
  register('sourcesAdd',spec=>{
    if(!spec||typeof spec!=='object'||Array.isArray(spec)||typeof spec.target!=='string'||!spec.target.trim()||spec.target.length>2000)throw Error('Choose what to watch.');
    const target=spec.target.trim(),name=typeof spec.name==='string'?spec.name.trim().slice(0,60):'';
    const entry={id:require('node:crypto').randomBytes(8).toString('hex'),kind:spec.kind,name:name||({ics:'Calendar',folder:path.basename(target)||'Folder',feed:spec.mode==='page'?'Web page':'Feed'})[spec.kind]||'Source',enabled:true,notify:spec.notify};
    if(spec.kind==='ics')Object.assign(entry,/^https:/i.test(target)?{url:target}:{file:target});
    else if(spec.kind==='folder')entry.dir=target;
    else if(spec.kind==='feed')Object.assign(entry,{url:target,mode:spec.mode==='page'?'page':'feed'});
    else throw Error('Unknown source type.');
    sources.configure([...sourceConfig(),entry]);return reply();
  });
  register('sourcesUpdate',value=>{
    const {id,patch}=value&&typeof value==='object'?value:{};
    if(typeof id!=='string'||!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['enabled','notify','name'].includes(key)))throw Error('Invalid source change.');
    const list=sourceConfig();if(!list.some(source=>source.id===id))throw Error('This source no longer exists.');
    sources.configure(list.map(source=>source.id===id?{...source,...patch}:source));return reply();
  });
  register('sourcesRemove',id=>{if(typeof id!=='string')throw Error('Invalid source.');sources.configure(sourceConfig().filter(source=>source.id!==id));return reply();});
  register('sourcesPick',async kind=>{
    if(!['file','folder'].includes(kind))throw Error('Invalid choice.');
    const result=await dialog.showOpenDialog(win,kind==='folder'?{properties:['openDirectory']}:{properties:['openFile'],filters:[{name:'iCalendar',extensions:['ics']}]});
    return result.canceled||!result.filePaths[0]?'':result.filePaths[0];
  });
}
const themes = new Map();
const indexURL = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
function saveConfig(value = config) { atomicJSON(path.join(root, 'config.json'), value); }
function initializeQQStopTrace(){
  // Local, explicit diagnostics only. No IPC or saved setting can enable this.
  if(process.env.AGENT_ARCADE_QQ_STOP_TRACE!=='1')return;
  try{qqStopTrace=createQQStopTrace({directory:path.resolve(root,'diagnostics'),filename:`qq-stop-trace-${process.pid}-${Date.now()}.jsonl`});}catch{/* Diagnostics must not prevent ordinary app operation. */}
}
function observedSessions() {
  const tasks = live.snapshot();
  return (workbench ? workbench.reconcile(tasks) : tasks).map(task => ({
    id: task.id, project: task.project, name: task.name, agent: task.agent, session: task.session,
    state: task.state, displayState: task.displayState, stale: task.stale, updatedAt: task.updatedAt,
    reason: task.reason, result: task.result, acknowledged: task.acknowledged, sessionEvidence: task.sessionEvidence,
    responseEnded: task.state === 'ended' && task.history.some(event => event.event === 'Stop' || event.event === 'SubagentStop'),
  }));
}
function snapshot() { const botState=bot?.snapshot();let persona=personaForBackend(({native:'claude-native',claude:'claude-native',api:'claude-api',codex:'codex',deepseek:'deepseek',gpt:'gpt',gemini:'gemini',doubao:'doubao'})[bot?.config.mode]||'claude-api',config.character);if(botState?.social?.config.enabled&&botState.social.supported){const settings=botState.social.config;persona=publicCatalog().find(p=>p.id===settings.characterId)||persona;persona.name={zh:settings.name,en:settings.name};}return { tasks:observedSessions(), config,desktopPets:pets?.snapshot(true), appearance:appearanceSnapshot(config.appearance,nativeTheme?.shouldUseDarkColors), appUpdate: windowsUpdate.state(), installed: integration.installed(settingsFile), lastEventAt: live.lastEventAt, problem, bot:botState,persona,personas:publicCatalog(),work:workbench?.snapshot(), theme: themes.get(config.theme) || themes.get('workshop'), themes: [...themes].map(([id,t])=>({id,name:t.name})) }; }
function voiceSnapshot(){
  if(voice&&voiceAccount===accounts?.selectedId)return {...voice.snapshot(),...voiceSourceFields(voice.source),accountId:voiceAccount,panelId:voicePanel};
  const last=voiceReceipts.get(accounts?.selectedId);
  return last&&voiceReceiptMatches(last)?{...voiceSourceFields(last.source),status:last.closeState==='closing'?'closing':last.closeState==='failed'?'error':'closed',error:last.closeState==='failed'?'Voice shutdown has not been confirmed. Retry ending the session.':'',mode:last.mode,reason:last.reason,scope:last.scope,accountId:last.accountId,panelId:last.panelId,endedAt:last.endedAt,needsClose:last.closeState!=='closed'}:null;
}
function fullSnapshot(){
  const state=snapshot();
  return {...state,characterSticker:stickerStudio.snapshot(state.bot),sources:{list:sources.snapshot(),recent:bus.recent(8),problem:sources.problem||''},desktopChat:{...desktopChat.snapshot(),kind:desktopConversations.kind()},pet:petWindow?.snapshot()||null,petRobot:robotPreview?{...robotPreview.snapshot(),device:robotConnection?.snapshot()||null}:null,appVersion,appPackaged:app.isPackaged,taskBoard:taskBoard?taskBoard.summary():null,accounts:accounts?.snapshot(),voice:voiceSnapshot(),qqRuntime:qqConsole?.snapshot(),qqComponents:qqComponents?.snapshot(),qqCompanionLaunch:qqCompanionLaunch?.snapshot()||null};
}
function clearQQDiagnosticCache(){qqDiagnosticGeneration++;qqDiagnosticCache?.body.fill(0);qqDiagnosticCache=null;}
async function dismissPendingUpdate(){return qqComponents?.execute({action:'pending-dismiss'});}
async function dismissNodeRepair(){return qqComponents?.nodeRepair?.dismissCurrent();}
function captureNodeRepairUI(){
  if(quitting||!win?.isVisible()||win.isMinimized()||!accounts?.selectedId||!qqConsole||qqConsole.closed)throw Object.assign(Error('QQ repair context changed'),{code:'changed'});
  accounts.get(accounts.selectedId);
  const profiles=accounts.snapshot().accounts.filter(item=>item.channel==='qq').map(item=>({profileId:item.id,label:String(item.name||'QQ companion').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,'').slice(0,120)||'QQ companion'}));
  return {key:accounts.selectedId,profiles};
}
function qqDiagnosticRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='accountId')||typeof value.accountId!=='string'||!/^[1-9]\d{4,14}$/.test(value.accountId)||!Number.isSafeInteger(Number(value.accountId)))throw new QQDiagnosticError('invalid_request');
  return value.accountId;
}
function captureQQDiagnostic(accountId){
  if(quitting||!win?.isVisible()||win.isMinimized()||win.isDestroyed()||!qqConsole||qqConsole.closed||!qqConsole.runtime)throw new QQDiagnosticError('changed');
  const state=qqConsole.state,rows=state?.instances?.filter(row=>row.accountId===accountId);if(rows?.length!==1)throw new QQDiagnosticError('diagnostics_unavailable');
  const row=rows[0];
  return {window:win,console:qqConsole,runtime:qqConsole.runtime,epoch:qqConsole.epoch,revision:qqConsole.refreshRevision,profile:accounts?.selectedId,service:bot,serviceGeneration:bot?.generation,accountId,
    binding:JSON.stringify([qqConsole.selectionDigest,state.installationKind,state.installation?.current?.kind,state.installation?.current?.setupId,row.runtimeRevision,row.processRunning,row.management,row.login?.state,row.login?.online,row.login?.issue,row.reason,row.endpointRecoveryIssue,row.configurationIssue,state.issue,state.components?.available,state.components?.selectionKind,state.components?.napcatVersion,state.components?.selectedNapcatVersion,state.components?.qqVersion,state.components?.nodeVersion])};
}
function assertQQDiagnostic(capture){
  const current=captureQQDiagnostic(capture.accountId);for(const key of Object.keys(current))if(current[key]!==capture[key])throw new QQDiagnosticError('changed');
}
function observeQQDiagnosticCache(){if(qqDiagnosticCache)try{assertQQDiagnostic(qqDiagnosticCache.capture);}catch{clearQQDiagnosticCache();}}
async function readQQDiagnostics(value){
  const accountId=qqDiagnosticRequest(value);clearQQDiagnosticCache();const generation=qqDiagnosticGeneration,capture=captureQQDiagnostic(accountId);
  // Viewing diagnostics already owns the bounded classifier. Export reuses
  // only its projected result; it never reopens raw logs or other private data.
  const result=await capture.console.perform('logs',{accountId});assertQQDiagnostic(capture);if(generation!==qqDiagnosticGeneration)throw new QQDiagnosticError('changed');
  if(result?.accountId!==accountId||result.rawMessagesIncluded!==false||result.source!=='diagnostic-events'||!Array.isArray(result.events))throw new QQDiagnosticError('report_invalid');
  const body=encodeQQDiagnosticReport({version:appVersion,platform:process.platform,runtimeState:capture.console.state,accountId,diagnosticEvents:result.events,capturedAt:new Date().toISOString()});
  qqDiagnosticCache={capture,body,generation};return result;
}
async function exportQQDiagnostics(value){
  const accountId=qqDiagnosticRequest(value);if(pluginPackagePickerBusy||avatarPickerBusy||qqDiagnosticSaving||qqProgramPickerBusy||imagePickerBusy||voiceFilePickerBusy)throw new QQDiagnosticError('operation_in_progress');
  const entry=qqDiagnosticCache;if(!entry||entry.capture.accountId!==accountId)throw new QQDiagnosticError('diagnostics_unavailable');
  const current=()=>{if(entry!==qqDiagnosticCache||entry.generation!==qqDiagnosticGeneration)throw new QQDiagnosticError('changed');assertQQDiagnostic(entry.capture);if(qqConsole.busy.size||qqStopping.has(accountId))throw new QQDiagnosticError('operation_in_progress');};
  current();qqDiagnosticSaving=true;
  try{
    const picked=await dialog.showSaveDialog(win,{title:config.language==='zh'?'导出 QQ 脱敏诊断':'Export redacted QQ diagnostics',defaultPath:'qq-diagnostics.json',filters:[{name:'QQ diagnostics JSON',extensions:['json']}]});
    if(picked.canceled)return {accountId,saved:false,cancelled:true};
    current();return {accountId,...writeQQDiagnosticReport(picked.filePath,entry.body,{assertCurrent:current})};
  }finally{qqDiagnosticSaving=false;}
}
async function qqDiagnosticResult(value,operation){
  let accountId;try{accountId=qqDiagnosticRequest(value);return {ok:true,...await operation(value)};}
  catch(error){const code=qqDiagnosticCode(error);return {ok:false,...(accountId?{accountId}:{}),saved:code==='save_unconfirmed'?null:false,code,...(code==='save_unconfirmed'?{saveAttempted:true}:{})};}
}
function registerQQDiagnosticHandlers(){
  register('qqRuntimeLogs',value=>qqDiagnosticResult(value,readQQDiagnostics));
  register('qqRuntimeExportDiagnostics',value=>qqDiagnosticResult(value,exportQQDiagnostics));
}
function captureFirstSetup(value){
  if(quitting||!win?.isVisible()||win.isMinimized()||!qqConsole||qqConsole.closed||accounts?.selectedId!==value.accountId)throw new QQFirstSetupError('changed');
  accounts.get(value.accountId);
  return JSON.stringify([value.accountId,value.panelId,qqConsole.epoch]);
}
async function pickQQProgram({signal}){
  if(pluginPackagePickerBusy||avatarPickerBusy||qqProgramPickerBusy||imagePickerBusy||voiceFilePickerBusy)throw new QQFirstSetupError('operation_in_progress');
  if(signal.aborted)throw new QQFirstSetupError('cancelled');
  qqProgramPickerBusy=true;
  try{
    const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择已安装的 QQ.exe':'Choose an installed QQ.exe',properties:['openFile'],filters:[{name:'QQ program',extensions:['exe']}]});
    if(signal.aborted)throw new QQFirstSetupError('cancelled');
    if(picked.canceled)return null;
    if(!Array.isArray(picked.filePaths)||picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string')throw new QQFirstSetupError('invalid_request');
    return picked.filePaths[0];
  }finally{qqProgramPickerBusy=false;}
}
async function firstSetupResult(value,{close=false}={}){
  const identity={};for(const key of ['accountId','panelId'])if(typeof value?.[key]==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value[key]))identity[key]=value[key];
  try{
    if(!close&&['use','return-previous'].includes(value?.action)&&accounts.snapshot().accounts.some(item=>item.channel==='qq'&&item.status!=='disconnected'))throw Object.assign(Error('Disconnect QQ companions before selecting another installation.'),{code:'account_connected'});
    return {ok:true,...await (close?firstSetupPanel.closeOwned(value):firstSetupPanel.execute(value)),...identity};
  }catch(error){return {ok:false,code:error?.code==='account_connected'?'account_connected':new QQFirstSetupError(error?.code).code,...(error?.recoveryAttempted===true?{recoveryAttempted:true}:{}),...identity};}
}
function captureOwnerRemark(value){
  const reject=code=>{throw Object.assign(Error('Owner remark context unavailable.'),{code});};
  if(quitting||accounts?.selectedId!==value.accountId||!win?.isVisible()||win.isMinimized())reject('changed');
  const service=accounts.get(value.accountId);if(service!==bot||typeof service.imageBinding!=='function')reject('disconnected');
  const binding=service.imageBinding();
  if(!qqConsole||qqConsole.closed||!qqConsole.runtime)reject('unavailable');
  if(qqStopping.has(binding.accountId)||[binding.accountId,'qq-components','qq-orphan-cleanup','qq-setup'].some(key=>qqConsole.busy?.has(key)))reject('operation_in_progress');
  if(!qqConsole.state?.instances?.some(item=>item.accountId===binding.accountId))reject('changed');
  const role=typeof binding.role==='string'?binding.role.replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,64):'';
  return {accountId:value.accountId,panelId:value.panelId,service,binding,generation:binding.generation,scopeId:binding.scopeId,
    client:binding.client,clientGeneration:binding.client?.generation,qqAccountId:binding.accountId,ownerId:binding.ownerId,role,
    console:qqConsole,runtime:qqConsole.runtime,epoch:qqConsole.epoch};
}
function captureFriendRequests(value){
  const capture=captureOwnerRemark(value),inbox=capture.service.friendRequests;
  if(!inbox)throw Object.assign(Error('Friend requests unavailable.'),{code:'disconnected'});
  return {...capture,inbox};
}
function ownerFriendError(code){return Object.assign(Error('Owner friend management is unavailable.'),{code});}
function qqConnectError(code){return Object.assign(Error('The QQ connection could not be verified.'),{code});}
async function connectSavedOneBot(value){
  const fields=['source','accountId','qqAccountId','ownerId','url','mode'];
  if(Object.keys(value).length!==fields.length||!fields.every(field=>typeof value[field]==='string')||
    !/^[a-zA-Z0-9-]{1,64}$/.test(value.accountId)||!/^[1-9]\d{4,14}$/.test(value.qqAccountId)||
    !/^[1-9]\d{4,14}$/.test(value.ownerId)||value.qqAccountId===value.ownerId)throw qqConnectError('invalid_request');
  const url=validateQQUrl(value.url),manager=accounts,service=manager.current();
  const config=service.config,secret=service.secret,token=secret?.qqToken;
  const assertCurrent=()=>{
    if(quitting||!win?.isVisible()||win.isMinimized()||accounts!==manager||manager.selectedId!==value.accountId||
      manager.current()!==service||service.config!==config||service.secret!==secret||
      config.channel!=='qq'||config.mode!==value.mode||config.qqAccountId!==value.qqAccountId||
      config.qqOwnerId!==value.ownerId||validateQQUrl(config.qqUrl)!==url||!token||secret.qqToken!==token||
      service.credentialState!=='ready'||manager.credentialMigrations.has(value.accountId))throw qqConnectError('changed');
    if(qqConsole?.busy.has('qq-setup')||qqStopping.has(value.qqAccountId))throw qqConnectError('operation_in_progress');
  };
  assertCurrent();
  if(service.status!=='disconnected'||qqConnectIntents.has(value.accountId))throw qqConnectError('operation_in_progress');
  qqConnectIntents.set(value.accountId,{service});
  try{
    await retireQQConnectionPanels();
    assertCurrent();
    return await manager.connect(value.accountId,{assertCurrent});
  }finally{qqConnectIntents.delete(value.accountId);}
}
function retireQQConnectionPanels(){
  return Promise.all([closeOwnerFriendSetup(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);
}
function captureQQConnectIntent(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accountId','qqAccountId','runtimeRevision'].includes(key))||typeof value.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.accountId)||typeof value.qqAccountId!=='string'||!/^[1-9]\d{4,14}$/.test(value.qqAccountId)||typeof value.runtimeRevision!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.runtimeRevision))throw qqConnectError('invalid_request');
  const manager=accounts,service=manager.get(value.accountId),console=qqConsole,runtime=console?.runtime,epoch=console?.epoch,installation=console?.installationSettings?.current,revision=console?.refreshRevision,selectedId=manager.selectedId;
  const config=service.config,secret=service.secret,generation=service.generation;
  let owned=null;
  const observe=()=>{
    if(quitting||!win?.isVisible()||win.isMinimized()||accounts!==manager||manager.selectedId!==selectedId||manager.get(value.accountId)!==service||service.config!==config||service.secret!==secret||qqConsole!==console||console?.runtime!==runtime||console?.epoch!==epoch||console?.installationSettings?.current!==installation||console?.refreshRevision!==revision)throw qqConnectError('changed');
    if(!runtime||!installation||console.closed)throw qqConnectError('changed');console.check(runtime,epoch);
    if(console.busy.size||qqStopping.has(value.qqAccountId))throw qqConnectError('operation_in_progress');
    const rows=manager.snapshot().accounts,candidates=rows.filter(row=>row.channel==='qq'&&[row.accountId,row.expectedQQAccountId,row.qqBinding?.source==='last_verified'?row.qqBinding.accountId:''].includes(value.qqAccountId)),entry=candidates.length===1?candidates[0]:null;
    if(!entry||entry.id!==value.accountId||entry.expectedQQAccountId!==value.qqAccountId||[entry.accountId,entry.qqBinding?.source==='last_verified'?entry.qqBinding.accountId:''].filter(Boolean).some(id=>id!==value.qqAccountId)||entry.credentialState!=='ready'||entry.credentialMigration)throw qqConnectError('changed');
    let ownerId,url;try{ownerId=validateQQOwner(config.qqOwnerId);url=validateQQUrl(config.qqUrl);}catch{throw qqConnectError('changed');}
    if(config.channel!=='qq'||config.qqAccountId!==value.qqAccountId||ownerId===value.qqAccountId||entry.qqOwnerId!==ownerId)throw qqConnectError('changed');
    const row=console.state?.instances?.find(item=>item.accountId===value.qqAccountId),endpoint=console.clients.get(value.qqAccountId);
    if(console.state?.desktopRunning===true||row?.management!=='owned'||row.reason||row.recoveryRequired||!row.processRunning||row.login?.state!=='online'||row.login.identityVerified!==true||row.login.accountId!==value.qqAccountId||row.login.online!==true||row.runtimeRevision!==value.runtimeRevision||endpoint?.publicId!==value.runtimeRevision||typeof endpoint.endpointId!=='string'||!endpoint.endpointId)throw qqConnectError('status_unverified');
    if(!Array.isArray(row.bridges)||row.bridges.length>64)throw qqConnectError('changed');
    const port=Number(new URL(url).port),choices=row.bridges.filter(item=>item.enabled===true&&item.loopbackOnly===true&&item.hasToken===true&&item.port===port);
    if(choices.length!==1||typeof choices[0].serverName!=='string')throw qqConnectError('changed');
    let connection;try{connection=console.profiles(runtime).connection(value.qqAccountId,choices[0].serverName);if(connection.accountId!==value.qqAccountId||validateQQUrl(connection.url)!==url||typeof secret?.qqToken!=='string'||connection.token!==secret.qqToken)throw Error();}catch{throw qqConnectError('changed');}
    // These are bounded character settings, never conversation history. The
    // connection may itself disable proactive activities after a scope change.
    const {proactiveMessages,qzonePosts,...character}=service.socialStore.config(),persona=service.personaOptions();
    const characterBytes=JSON.stringify([character,persona]);if(characterBytes.length>32768)throw qqConnectError('changed');
    const characterDigest=require('node:crypto').createHash('sha256').update(characterBytes).digest('hex');
    return {endpointId:endpoint.endpointId,ownerId,url,token:connection.token,serverName:choices[0].serverName,characterId:entry.characterId,companion:entry.companion,mode:entry.mode,characterDigest};
  };
  const original=observe();
  if(service.status!=='disconnected'||!Number.isSafeInteger(generation))throw qqConnectError('changed');
  const assertCurrent=(state={phase:'preflight',generation,controller:null})=>{
    const fresh=observe();if(Object.keys(original).some(key=>fresh[key]!==original[key]))throw qqConnectError('changed');
    if(state.phase==='preflight'){
      if(owned||state.generation!==generation||service.generation!==generation||state.controller!==null||service.status!=='disconnected')throw qqConnectError('changed');
    }else if(state.phase==='connecting'){
      if(state.generation!==generation+1||service.generation!==state.generation||!state.controller||service.controller!==state.controller||state.controller.signal?.aborted||!['connecting','connected'].includes(service.status))throw qqConnectError('changed');
      // This callback is called synchronously by the one guarded service
      // invocation immediately after its own generation increment.
      if(!owned)owned={generation:state.generation,controller:state.controller};
      if(owned.controller!==state.controller||owned.generation!==state.generation)throw qqConnectError('changed');
    }else throw qqConnectError('changed');
  };
  return {service,runtime,endpointId:original.endpointId,assertCurrent};
}
async function connectQQIntent(value,{assertCurrent:outerGuard}={}){
  if(value?.source==='existing-onebot'&&!outerGuard)return connectSavedOneBot(value);
  const checkOuter=state=>{if(!outerGuard)return;const result=outerGuard(state);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw qqConnectError('changed');}};
  checkOuter();
  // The verified-identity connection belongs to the managed QQ runtime.
  if(hostGate!==null&&hostGate.features.managedQQ.available!==true)throw qqConnectError('unsupported_platform');
  const intent=captureQQConnectIntent(value);
  const assertCurrent=state=>{checkOuter(state);intent.assertCurrent(state);};
  if(qqConnectIntents.has(value.accountId))throw qqConnectError('operation_in_progress');
  qqConnectIntents.set(value.accountId,intent);
  try{
    await retireQQConnectionPanels();assertCurrent();
    let endpoint;try{endpoint=await intent.runtime.getConnection(value.qqAccountId);}catch{throw qqConnectError('status_unverified');}assertCurrent();
    if(endpoint?.ownershipVerified!==true||endpoint.endpointId!==intent.endpointId)throw qqConnectError('changed');
    return await accounts.connect(value.accountId,{assertCurrent});
  }finally{if(qqConnectIntents.get(value.accountId)===intent)qqConnectIntents.delete(value.accountId);}
}
function initializeQQCompanionLaunch(){
  qqCompanionLaunch=createQQCompanionLaunch({current:()=>({accounts,console:qqConsole,window:win,stopping:qqStopping,quitting}),connectIntent:connectQQIntent,onChange:publish});
}
function registerQQCompanionLaunchHandlers(){
  for(const [channel,method]of [['qqCompanionLaunchInspect','inspect'],['qqCompanionLaunch','launch'],['qqCompanionLaunchCancel','cancel']])register(channel,value=>qqCompanionLaunchResult(value,()=>qqCompanionLaunch[method](value)));
}
function captureOwnerFriendSetup(value,{allowConnected=false,background=false}={}){
  if(quitting||!accounts||!background&&(!win?.isVisible()||win.isMinimized()||accounts.selectedId!==value.accountId))throw ownerFriendError('changed');
  const service=accounts.get(value.accountId);
  if(!background&&service!==bot||service.config?.channel!=='qq')throw ownerFriendError('unconfigured');
  if(service.status!=='disconnected'&&!(allowConnected&&service.status==='connected'))throw ownerFriendError('account_connected');
  if(service.credentialState==='locked'||!qqConsole||qqConsole.closed||!qqConsole.runtime)throw ownerFriendError('unconfigured');
  let qqAccountId,ownerId,url;try{qqAccountId=validateQQOwner(service.config.qqAccountId);ownerId=validateQQOwner(service.config.qqOwnerId);url=validateQQUrl(service.config.qqUrl);}catch{throw ownerFriendError('unconfigured');}
  if(qqAccountId===ownerId||qqStopping.has(qqAccountId)||qqConsole.busy.size)throw ownerFriendError('operation_in_progress');
  const runtime=qqConsole.runtime,runtimeEpoch=qqConsole.epoch;qqConsole.check(runtime,runtimeEpoch);
  const installation=qqConsole.installationSettings?.current,row=qqConsole.state?.instances?.find(item=>item.accountId===qqAccountId),entry=qqConsole.clients.get(qqAccountId);
  if(!installation||!row?.processRunning||row.login?.identityVerified!==true||row.login?.accountId!==qqAccountId||row.login?.online!==true||typeof row.runtimeRevision!=='string'||row.runtimeRevision!==entry?.publicId||typeof entry.endpointId!=='string'||!entry.endpointId)throw ownerFriendError('status_unverified');
  // Select only the already-saved authenticated loopback bridge. A renderer
  // cannot choose a server, URL or token, and an ambiguous port is not guessed.
  if(!Array.isArray(row.bridges)||row.bridges.length>64)throw ownerFriendError('unconfigured');
  const port=Number(new URL(url).port),choices=row.bridges.filter(item=>item.enabled===true&&item.loopbackOnly===true&&item.hasToken===true&&item.port===port);
  if(choices.length!==1||typeof choices[0].serverName!=='string')throw ownerFriendError('unconfigured');
  let connection;try{connection=qqConsole.profiles(runtime).connection(qqAccountId,choices[0].serverName);}catch{throw ownerFriendError('unconfigured');}
  const token=service.secret?.qqToken;
  if(connection.accountId!==qqAccountId||validateQQUrl(connection.url)!==url||typeof token!=='string'||connection.token!==token)throw ownerFriendError('changed');
  const characterId=service.socialStore.config().characterId;
  const bridgeRevision=require('node:crypto').createHash('sha256').update(JSON.stringify([row.runtimeRevision,entry.endpointId,connection.serverName,url,token])).digest('hex');
  return {profileId:value.accountId,panelId:value.panelId,profile:service,generation:service.generation,characterId,runtime,installation,runtimeEpoch,bridgeRevision,qqAccountId,ownerId,url,token,channel:'qq',status:service.status,endpointId:entry.endpointId};
}
async function verifyOwnerFriendSetup(captured,{signal}){
  const current=()=>{
    if(signal.aborted)throw ownerFriendError('cancelled');
    const fresh=captureOwnerFriendSetup({accountId:captured.profileId,panelId:captured.panelId});
    if(['profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','endpointId'].some(key=>fresh[key]!==captured[key]))throw ownerFriendError('changed');
  };
  current();const endpoint=await captured.runtime.getConnection(captured.qqAccountId);current();
  if(endpoint?.ownershipVerified!==true||endpoint.endpointId!==captured.endpointId)throw ownerFriendError('changed');
  // The dedicated QQClient subsequently verifies actual login/status itself.
  // This check proves only the exact current runtime and configured bridge.
  return {verified:true};
}
function closeOwnerFriendSetup({permanent=false}={}){
  if(permanent)return ownerFriendSetup.close();
  const owned=ownerFriendSetup.session||ownerFriendSetup.retiringSession;
  return owned?ownerFriendSetup.closeOwned({accountId:owned.accountId,panelId:owned.panelId}):Promise.resolve({closed:true});
}
async function ownerFriendResult(operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:ownerFriendCode(error)};}}
function registerOwnerFriendHandlers(){
  register('qqOwnerFriendAvailability',value=>ownerFriendResult(()=>ownerFriendSetup.availability(value)));
  register('qqOwnerFriendStart',value=>ownerFriendResult(()=>ownerFriendSetup.start(value)));
  register('qqOwnerFriendRead',value=>ownerFriendResult(()=>ownerFriendSetup.read(value)));
  register('qqOwnerFriendDecide',value=>ownerFriendResult(()=>ownerFriendSetup.decide(value)));
  register('qqOwnerFriendClose',value=>ownerFriendResult(()=>ownerFriendSetup.closeOwned(value)));
}
function captureSelfProfile(value){
  // Same selected registered QQ/runtime/bridge proof, with an independently
  // owned request-only socket. An active AI connection is never borrowed.
  return captureOwnerFriendSetup(value,{allowConnected:true});
}
async function verifySelfProfile(captured,{signal}){
  if(typeof captured?.profileId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(captured.profileId)||typeof captured?.panelId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(captured.panelId))throw ownerFriendError('changed');
  const current=()=>{
    if(signal.aborted)throw ownerFriendError('cancelled');
    const fresh=captureSelfProfile({accountId:captured.profileId,panelId:captured.panelId});
    if(['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','endpointId','status'].some(key=>fresh[key]!==captured[key]))throw ownerFriendError('changed');
  };
  current();const endpoint=await captured.runtime.getConnection(captured.qqAccountId);current();
  if(endpoint?.ownershipVerified!==true||endpoint.endpointId!==captured.endpointId)throw ownerFriendError('changed');
  return {verified:true};
}
function captureOwnerRemarkManagement(value){
  const captured=captureSelfProfile(value),service=captured.profile;
  if(service.status==='connected'&&service.client?.accountId!==captured.qqAccountId)throw ownerFriendError('changed');
  const settings=service.socialStore.config();
  const social=settings.enabled&&require('./bot/social-companion.cjs').SUPPORTED_MODES.has(service.config.mode);
  const backend=({native:'claude-native',claude:'claude-native',api:'claude-api',codex:'codex',deepseek:'deepseek',gpt:'gpt',gemini:'gemini',doubao:'doubao'})[service.config.mode]||'claude-api';
  const selected=service.personaOptions?.();
  const fallback=service.status==='connected'&&service.imagePersona||require('./core/personas.cjs').personaForBackend(backend,selected?.selection==='sprout'?'sprout':'default');
  const role=social?settings.name:fallback.name.zh;
  // Role/mode are part of the management scope, without borrowing an AI socket.
  const bridgeRevision=require('node:crypto').createHash('sha256').update(JSON.stringify([captured.bridgeRevision,service.config.mode,settings.enabled===true,role,fallback.id])).digest('hex');
  return {...captured,role,bridgeRevision};
}
async function verifyOwnerRemarkManagement(captured,{signal}){
  const current=()=>{
    if(signal.aborted)throw ownerFriendError('cancelled');
    const fresh=captureOwnerRemarkManagement({accountId:captured.profileId,panelId:captured.panelId});
    if(['profileId','panelId','profile','generation','characterId','role','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','endpointId','status'].some(key=>fresh[key]!==captured[key]))throw ownerFriendError('changed');
  };
  current();const endpoint=await captured.runtime.getConnection(captured.qqAccountId);current();
  if(endpoint?.ownershipVerified!==true||endpoint.endpointId!==captured.endpointId)throw ownerFriendError('changed');
  return {verified:true};
}
function registerSelfProfileHandlers(){
  register('qqSelfProfileRead',value=>selfProfileResult(value,()=>selfProfilePanel.read(value)));
  register('qqSelfProfilePreview',value=>selfProfileResult(value,()=>selfProfilePanel.preview(value)));
  register('qqSelfProfileConfirm',value=>selfProfileResult(value,()=>selfProfilePanel.confirm(value)));
  register('qqSelfProfileDismiss',value=>selfProfileResult(value,()=>selfProfilePanel.dismiss(value)));
  register('qqSelfProfileClose',value=>selfProfileResult(value,()=>selfProfilePanel.closeOwned(value)));
}
async function pickQQAvatarFile({signal}){
  if(pluginPackagePickerBusy||avatarPickerBusy||imagePickerBusy||voiceFilePickerBusy||qqProgramPickerBusy||qqDiagnosticSaving)throw ownerFriendError('operation_in_progress');
  if(signal.aborted)throw ownerFriendError('cancelled');
  avatarPickerBusy=true;
  try{
    const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择 QQ 头像':'Choose a QQ avatar',properties:['openFile'],filters:[{name:'PNG / JPEG',extensions:['png','jpg','jpeg']}]});
    if(signal.aborted)throw ownerFriendError('cancelled');
    if(picked.canceled)return null;
    if(!Array.isArray(picked.filePaths)||picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string')throw ownerFriendError('invalid_request');
    return picked.filePaths[0];
  }finally{avatarPickerBusy=false;}
}
function registerAvatarHandlers(){
  register('qqAvatarRead',value=>avatarResult(value,()=>avatarPanel.read(value)));
  register('qqAvatarPick',value=>avatarResult(value,()=>avatarPanel.select(value,{pickFile:pickQQAvatarFile})));
  register('qqAvatarConfirm',value=>avatarResult(value,()=>avatarPanel.confirm(value)));
  register('qqAvatarDismiss',value=>avatarResult(value,()=>avatarPanel.dismiss(value)));
  register('qqAvatarCleanup',value=>avatarResult(value,()=>avatarPanel.cleanup(value)));
  register('qqAvatarClose',value=>avatarResult(value,()=>avatarPanel.closeOwned(value)));
}
function captureGroupProfile(value){
  if(!validManagedGroupId(value?.groupId))throw ownerFriendError('invalid_request');
  // A renderer group ID is a candidate, never membership or role authority.
  // The owned request-only transport checks the actual group list and own role.
  return {...captureSelfProfile(value),groupId:value.groupId};
}
async function verifyGroupProfile(captured,{signal}){
  if(!validManagedGroupId(captured?.groupId))throw ownerFriendError('changed');
  return verifySelfProfile(captured,{signal});
}
function registerGroupProfileHandlers(){
  register('qqGroupProfileRead',value=>groupProfileResult(value,()=>groupProfileSession.read(value)));
  register('qqGroupProfilePreview',value=>groupProfileResult(value,()=>groupProfileSession.preview(value)));
  register('qqGroupProfileConfirm',value=>groupProfileResult(value,()=>groupProfileSession.confirm(value)));
  register('qqGroupProfileDismiss',value=>groupProfileResult(value,()=>groupProfileSession.dismiss(value)));
  register('qqGroupProfileClose',value=>groupProfileResult(value,()=>groupProfileSession.closeOwned(value)));
}
function registerGroupAdminHandlers(){
  register('qqGroupAdminRead',value=>groupAdminResult(value,()=>groupAdminSession.read(value)));
  register('qqGroupAdminPreview',value=>groupAdminResult(value,()=>groupAdminSession.preview(value)));
  register('qqGroupAdminConfirm',value=>groupAdminResult(value,()=>groupAdminSession.confirm(value)));
  register('qqGroupAdminDismiss',value=>groupAdminResult(value,()=>groupAdminSession.dismiss(value)));
  register('qqGroupAdminClose',value=>groupAdminResult(value,()=>groupAdminSession.closeOwned(value)));
}
function registerContactAdminHandlers(){
  register('qqContactAdminRead',value=>contactAdminResult(value,()=>contactAdminSession.read(value)));
  register('qqContactAdminPreview',value=>contactAdminResult(value,()=>contactAdminSession.preview(value)));
  register('qqContactAdminConfirm',value=>contactAdminResult(value,()=>contactAdminSession.confirm(value)));
  register('qqContactAdminDismiss',value=>contactAdminResult(value,()=>contactAdminSession.dismiss(value)));
  register('qqContactAdminClose',value=>contactAdminResult(value,()=>contactAdminSession.closeOwned(value)));
}
function capturePluginAdmin(value,{background=false}={}){
  const captured=background?captureOwnerFriendSetup(value,{allowConnected:true,background:true}):captureSelfProfile(value);
  const row=qqConsole.state?.instances?.find(item=>item.accountId===captured.qqAccountId);
  if(qqConsole.state?.desktopRunning||row?.management!=='owned'||row.recoveryRequired)throw ownerFriendError('changed');
  const profiles=accounts.accounts.map(entry=>({accountId:entry.id,label:entry.name,qqAccountId:accounts.get(entry.id).config?.qqAccountId}));
  return {...captured,...capturePluginWorkScope({runtime:captured.runtime,qqAccountId:captured.qqAccountId,profileId:captured.profileId,profiles})};
}
function captureSSQQ(value){
  return {...capturePluginAdmin(value),appScopeHash:require('node:crypto').createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex')};
}
async function pickSSQQArchive(captured,{signal,assertCurrent}){
  const current=()=>{if(signal?.aborted)throw ownerFriendError('cancelled');assertCurrent();};
  current();if(pluginPackagePickerBusy||avatarPickerBusy||qqDiagnosticSaving||qqProgramPickerBusy||imagePickerBusy||voiceFilePickerBusy||remotePickerBusy)throw ownerFriendError('operation_in_progress');
  pluginPackagePickerBusy=true;
  try{
    const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择官方 SSQQ 3.5.2 ZIP':'Choose the official SSQQ 3.5.2 ZIP',properties:['openFile'],filters:[{name:'SSQQ ZIP',extensions:['zip']}]});
    current();if(picked.canceled)return null;if(!Array.isArray(picked.filePaths)||picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string'||!path.isAbsolute(picked.filePaths[0]))throw ownerFriendError('invalid_request');
    return picked.filePaths[0];
  }finally{pluginPackagePickerBusy=false;}
}
function ssqqWindowBounds(value){
  const b=value?.bounds;if(!b||Object.getPrototypeOf(b)!==Object.prototype||Object.keys(b).length!==4||!['x','y','width','height'].every(k=>Number.isFinite(b[k])))throw ownerFriendError('invalid_request');
  if(!win||win.isDestroyed()||!win.isVisible()||win.isMinimized())throw ownerFriendError('changed');
  const zoom=win.webContents.getZoomFactor(),[width,height]=win.getContentSize();
  const bounds=Object.fromEntries(Object.entries(b).map(([key,n])=>[key,Math.round(n*zoom)]));
  if(!Number.isFinite(zoom)||zoom<=0||bounds.x<0||bounds.y<80||bounds.width<100||bounds.height<100||bounds.x+bounds.width>width+1||bounds.y+bounds.height>height+1)throw ownerFriendError('invalid_request');
  bounds.width=Math.min(bounds.width,width-bounds.x);bounds.height=Math.min(bounds.height,height-bounds.y);
  return {...value,bounds};
}
function registerSSQQHandlers(){
  for(const [channel,method]of [['qqSSQQRead','read'],['qqSSQQPrepare','prepare'],['qqSSQQClose','closeOwned']])register(channel,value=>ssqqResult(value,()=>ssqqSession[method](value)));
  register('qqSSQQOpen',value=>ssqqResult(value,()=>ssqqSession.open(ssqqWindowBounds(value))));
  register('qqSSQQBounds',value=>ssqqResult(value,()=>ssqqSession.setBounds(ssqqWindowBounds(value))));
}
function capturePluginPackage(value){
  if(quitting||!win?.isVisible()||win.isMinimized()||win.isDestroyed()||!accounts||!qqConsole?.runtime||qqConsole.closed||accounts.selectedId!==value.accountId)throw ownerFriendError('changed');
  const profile=accounts.get(value.accountId),qqAccountId=profile.config?.qqAccountId,runtime=qqConsole.runtime;
  if(profile!==bot||profile.config.channel!=='qq'||typeof qqAccountId!=='string'||!/^[1-9]\d{4,14}$/.test(qqAccountId)||!Number.isSafeInteger(Number(qqAccountId)))throw ownerFriendError('changed');
  const install=runtime.instance(qqAccountId),profiles=accounts.accounts.map(entry=>({accountId:entry.id,label:entry.name,qqAccountId:accounts.get(entry.id).config?.qqAccountId}));
  if(!install.available||qqConsole.selectionIssue)throw ownerFriendError('component_unavailable');
  const scope=capturePluginWorkScope({runtime,qqAccountId,profileId:value.accountId,profiles});
  return {profileId:value.accountId,panelId:value.panelId,profile,generation:profile.generation,characterId:profile.socialStore?.config()?.characterId||null,runtime,installation:qqConsole.installationSettings,runtimeEpoch:qqConsole.epoch,qqAccountId,channel:profile.config.channel,status:profile.status,...scope,workDir:install.workDir,configDir:install.configDir};
}
function assertPluginPackageCapture(captured){
  const fresh=capturePluginPackage({accountId:captured.profileId,panelId:captured.panelId});
  for(const key of Object.keys(fresh))if(key==='affectedProfiles'?JSON.stringify(fresh[key])!==JSON.stringify(captured[key]):fresh[key]!==captured[key])throw ownerFriendError('changed');
}
async function withPluginDeploymentLock(captured,{signal,assertCurrent},operation){
  const manager=qqConsole,marker='qq-plugin-deployment';
  const current=()=>{if(signal?.aborted)throw ownerFriendError('cancelled');assertCurrent();assertPluginPackageCapture(captured);if(qqConsole!==manager||manager.closed||[...manager.busy].some(key=>key!==marker))throw ownerFriendError('changed');};
  current();if(manager.busy.size||typeof captured.runtime.withPluginDeploymentLock!=='function')throw ownerFriendError('operation_in_progress');
  manager.busy.add(marker);
  try{return await captured.runtime.withPluginDeploymentLock(captured.qqAccountId,async install=>{
    current();if(install.workDir!==captured.workDir||install.configDir!==captured.configDir)throw ownerFriendError('changed');
    const assertStopped=async()=>{current();await install.assertStopped();current();};
    await assertStopped();return operation({assertStopped});
  });}finally{manager.busy.delete(marker);}
}
async function pickPluginPackage({capture,signal,assertCurrent}){
  const current=()=>{if(signal?.aborted)throw ownerFriendError('cancelled');assertCurrent();assertPluginPackageCapture(capture);};
  current();if(pluginPackagePickerBusy||avatarPickerBusy||qqDiagnosticSaving||qqProgramPickerBusy||imagePickerBusy||voiceFilePickerBusy)throw ownerFriendError('operation_in_progress');
  pluginPackagePickerBusy=true;
  try{
    const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择本地 QQ 插件 ZIP':'Choose a local QQ plugin ZIP',properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});
    current();if(picked.canceled)return null;if(!Array.isArray(picked.filePaths)||picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string'||!path.isAbsolute(picked.filePaths[0]))throw ownerFriendError('invalid_request');
    return picked.filePaths[0];
  }finally{pluginPackagePickerBusy=false;}
}
async function verifyPluginAdmin(captured,{signal},{background=false}={}){
  const current=()=>{
    if(signal.aborted)throw ownerFriendError('cancelled');
    assertPluginCapture(captured,{background});
  };
  current();const endpoint=await captured.runtime.getConnection(captured.qqAccountId);current();
  if(endpoint?.ownershipVerified!==true||endpoint.endpointId!==captured.endpointId)throw ownerFriendError('changed');
  return {verified:true,endpoint:{port:endpoint.port,token:endpoint.token,endpointId:endpoint.endpointId}};
}
function assertPluginCapture(captured,{background=false}={}){
  const fresh=capturePluginAdmin({accountId:captured.profileId,panelId:captured.panelId},{background});
  if(['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','endpointId','status','componentVersion','workScope','workScopeKind'].some(key=>fresh[key]!==captured[key])||JSON.stringify(fresh.affectedProfiles)!==JSON.stringify(captured.affectedProfiles))throw ownerFriendError('changed');
}
function qceStore(){
  if(!qceCredentials)qceCredentials=new QCECredentialStore({root,vault:safeStorage});
  return qceCredentials;
}
function qceJobs(){
  if(!qceExportJobs)qceExportJobs=new QCEExportJobs({root:path.join(root,'qq-qce-exports'),vault:safeStorage});
  return qceExportJobs;
}
function qceSchedules(){
  if(!qceScheduleStore)qceScheduleStore=new QCEScheduleStore({root:path.join(root,'qq-qce-schedules'),vault:safeStorage});
  return qceScheduleStore;
}
function startQCEScheduleTimer(){
  if(qceScheduleTimer||quitting)return;
  const tick=()=>Promise.resolve().then(()=>qceScheduleRunner.tick()).catch(()=>{});
  qceScheduleTimer=setInterval(()=>void tick(),5000);qceScheduleTimer.unref?.();void tick();
}
async function closeQCEScheduleRuntime(){
  clearInterval(qceScheduleTimer);qceScheduleTimer=null;
  await qceScheduleRunner.close();qceScheduleStore?.close();
}
async function saveQCEExportDownload({capture,signal,assertCurrent,suggestedName,archive},receive){
  if(typeof assertCurrent!=='function'||typeof receive!=='function'||typeof archive!=='boolean')throw ownerFriendError('invalid_request');
  validateQCEExportFileName(suggestedName);
  if(remotePickerBusy||imagePickerBusy||avatarPickerBusy||pluginPackagePickerBusy||qqProgramPickerBusy||voiceFilePickerBusy||qqDiagnosticSaving||qceExportStages.size>=8)throw ownerFriendError('operation_in_progress');
  const check=()=>{if(signal?.aborted)throw ownerFriendError('cancelled');assertCurrent();assertQCECapture(capture);};
  let file;remotePickerBusy=true;
  try{
    check();const picked=await dialog.showSaveDialog(win,{title:config.language==='zh'?'保存聊天记录导出文件':'Save chat export file',defaultPath:suggestedName,properties:['dontAddToRecent']});
    check();if(picked.canceled)return {cancelled:true};
    if(typeof picked.filePath!=='string'||!path.isAbsolute(picked.filePath))throw ownerFriendError('invalid_request');file=picked.filePath;
  }finally{remotePickerBusy=false;}
  check();const stage=new QQRemoteFileStage(),owner={stage,accountId:capture.accountId};qceExportStages.add(owner);
  let result,error,sink;
  try{
    sink=await stage.createSink(file,{signal,assertCurrent:check});check();result=await receive(sink);
    if(result?.saved!==true||!Number.isSafeInteger(result.bytes)||result.bytes<0||!/^[a-f0-9]{64}$/.test(result.sha256)||result.archiveVerified!==archive)throw ownerFriendError('file_download_unknown');
  }catch(e){error=e;if(error&&typeof error==='object'&&!Object.hasOwn(error,'saved')){error.saved=sink?.publicationAttempted?null:false;if(sink?.publicationAttempted){error.bytes=sink.bytes;error.sha256=sink.sha256;}}}
  try{const closed=await stage.close();if(closed?.closed!==true)throw ownerFriendError('file_cleanup_unconfirmed');qceExportStages.delete(owner);}
  catch{const uncertain=ownerFriendError('file_cleanup_unconfirmed');uncertain.saved=error?(error.saved===null?null:error.saved===true):result?.saved===true;uncertain.bytes=error?error.bytes:result?.bytes;uncertain.sha256=error?error.sha256:result?.sha256;if(error?.retainedCopy)uncertain.retainedCopy=error.retainedCopy;throw uncertain;}
  if(error)throw error;return {saved:true,bytes:result.bytes,sha256:result.sha256,archiveVerified:result.archiveVerified,cleanupVerified:true};
}
async function closeQCEExportFiles(accountId){
  const owned=[...qceExportStages].filter(v=>!accountId||v.accountId===accountId);
  const results=await Promise.allSettled(owned.map(async owner=>{const r=await owner.stage.close();if(r?.closed!==true)throw ownerFriendError('file_cleanup_unconfirmed');qceExportStages.delete(owner);return r;}));
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
}
function qceCredentialScope(captured){return {profileId:captured.profileId,qqAccountId:captured.qqAccountId,workScope:captured.workScope};}
function captureQCE(value,{background=false}={}){
  const base=capturePluginAdmin(value,{background}),credential=qceStore().capture(qceCredentialScope(base));
  const pluginVersion=require('./bot/qq-qce-managed-process.cjs').readManagedQCEVersion({runtime:base.runtime,qqAccountId:base.qqAccountId});
  const keys=['generation','characterId','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status','endpointId','componentVersion','workScope','workScopeKind','affectedProfiles'];
  const contextKey=require('node:crypto').createHash('sha256').update(JSON.stringify([...keys.map(key=>base[key]),credential.revision,pluginVersion])).digest('hex');
  // Versions here are requirements; verifyQCE checks the live registry before any QCE request.
  return {accountId:value.accountId,panelId:value.panelId,qqAccountId:base.qqAccountId,contextKey,credentialRevision:credential.revision,workScope:base.workScope,profile:base.profile,runtime:base.runtime,installation:base.installation,componentVersion:'4.18.42',pluginVersion,pluginStatus:'active'};
}
function captureQCEScheduleLocal(value){
  // Local plan management remains available after QQ disconnects or its
  // independent QCE token is removed. This does not authorize any HTTP request.
  if(quitting||!win?.isVisible()||win.isMinimized()||win.isDestroyed()||!accounts||accounts.selectedId!==value.accountId||!qqConsole?.runtime||qqConsole.closed)throw ownerFriendError('changed');
  const profile=accounts.get(value.accountId),qqAccountId=profile.config?.qqAccountId,runtime=qqConsole.runtime;
  if(profile!==bot||profile.config.channel!=='qq'||typeof qqAccountId!=='string'||!/^[1-9]\d{4,14}$/.test(qqAccountId)||!Number.isSafeInteger(Number(qqAccountId)))throw ownerFriendError('unconfigured');
  const profiles=accounts.accounts.map(entry=>({accountId:entry.id,label:entry.name,qqAccountId:accounts.get(entry.id).config?.qqAccountId}));
  const work=capturePluginWorkScope({runtime,qqAccountId,profileId:value.accountId,profiles});
  const credential=qceStore().status({profileId:value.accountId,qqAccountId,workScope:work.workScope});
  const contextKey=require('node:crypto').createHash('sha256').update(JSON.stringify([profile.generation,qqConsole.epoch,qqAccountId,work.workScope,credential.state,credential.revision])).digest('hex');
  return {accountId:value.accountId,panelId:value.panelId,qqAccountId,workScope:work.workScope,credentialRevision:credential.saved?credential.revision:null,contextKey,profile,runtime,installation:qqConsole.installationSettings};
}
function assertQCEScheduleLocal(captured){
  const fresh=captureQCEScheduleLocal({accountId:captured.accountId,panelId:captured.panelId});
  if(Object.keys(fresh).some(key=>fresh[key]!==captured[key]))throw ownerFriendError('changed');
}
function assertQCECapture(captured,{background=false}={}){
  const fresh=captureQCE({accountId:captured.accountId,panelId:captured.panelId},{background});
  if(Object.keys(fresh).some(key=>fresh[key]!==captured[key]))throw ownerFriendError('changed');
}
async function verifyQCE(captured,{signal,assertCurrent},{background=false}={}){
  const current=()=>{if(signal?.aborted)throw ownerFriendError('cancelled');assertCurrent?.();assertQCECapture(captured,{background});};
  current();
  const base=capturePluginAdmin({accountId:captured.accountId,panelId:captured.panelId},{background});
  const verified=await verifyPluginAdmin(base,{signal},{background});current();
  const client=new NapCatWebUI({port:verified.endpoint.port,token:verified.endpoint.token,accountId:captured.qqAccountId});
  try{
    const status=await client.status({signal});current();
    if(status.identityVerified!==true||status.accountId!==captured.qqAccountId)throw ownerFriendError('qq_mismatch');
    if(status.online!==true)throw ownerFriendError('qq_offline');
    const registry=await client.plugins({signal});current();
    if(registry?.pluginManagerNotFound===true||!Array.isArray(registry?.plugins)||registry.plugins.length>128)throw ownerFriendError('qce_unavailable');
    const plugins=registry.plugins.filter(row=>row?.id==='napcat-plugin-qce');
    if(plugins.length!==1||plugins[0].version!==captured.pluginVersion)throw ownerFriendError('qce_version_unsupported');
    if(plugins[0].status!=='active')throw ownerFriendError('qce_unavailable');
    const listener=await verifyQCEListener({runtime:captured.runtime,qqAccountId:captured.qqAccountId,expectedVersion:captured.pluginVersion,signal,assertCurrent:current});current();
    const scope=qceCredentialScope(base),credential=qceStore().capture(scope);
    qceStore().assertCurrent(scope,captured.credentialRevision);current();
    return {verified:true,endpoint:{host:listener.host,port:listener.port,endpointId:listener.endpointId,ownershipVerified:listener.ownershipVerified,token:credential.token}};
  }finally{client.close();}
}
function qceCredentialEnvelope(value,captured,credential,extra={}){
  return {accountId:value.accountId,panelId:value.panelId,qqAccountId:captured.qqAccountId,credential:{state:credential.state,saved:credential.saved,revision:credential.revision},source:'local-credential-store',authenticated:false,...extra};
}
async function readQCECredentialStatus(value){
  qceRequest(value,'status');
  const captured=capturePluginAdmin(value),pending={kind:'qceCredential',accountId:value.accountId,panelId:value.panelId,captured};
  qceCredentialPanel=null;pendingPluginRead=pending;
  try{
    await Promise.all([pluginAdminSession.closeCurrent(),pluginConfigSession.closeCurrent(),pluginPackageSession.closeCurrent(),qceSession.closeCurrent(),qceExportSession.closeCurrent(),qceScheduleSession.closeCurrent(),qceSecuritySession.closeCurrent(),qceNativePlansSession.closeCurrent()]);
    if(pendingPluginRead!==pending)throw ownerFriendError('changed');
    assertPluginCapture(captured);
    const credential=qceStore().status(qceCredentialScope(captured));
    qceCredentialPanel={accountId:value.accountId,panelId:value.panelId,captured,revision:credential.revision};
    return qceCredentialEnvelope(value,captured,credential);
  }finally{if(pendingPluginRead===pending)pendingPluginRead=null;}
}
function changeQCECredential(value,remove=false){
  qceRequest(value,remove?'removeCredential':'saveCredential');
  const panel=qceCredentialPanel;
  if(!panel||panel.accountId!==value.accountId||panel.panelId!==value.panelId||panel.revision!==value.expectedRevision)throw ownerFriendError('changed');
  assertPluginCapture(panel.captured);
  const scope=qceCredentialScope(panel.captured),store=qceStore();
  const credential=remove?store.remove(scope,{expectedRevision:value.expectedRevision}):store.save(scope,{token:value.token,expectedRevision:value.expectedRevision});
  panel.revision=credential.revision;
  return qceCredentialEnvelope(value,panel.captured,credential,remove?{removed:true}:{});
}
// A request waiting for the other view to retire must itself remain cancellable.
// Only the most recent valid Read may construct the next private client.
async function readPluginPanel(kind,value,method='read'){
  const view=pluginPanelView(kind);view.request(value,method==='listJobs'?'jobs':['list','runs'].includes(method)?method:'read');
  const captured=view.capture(value),pending={kind,accountId:value.accountId,panelId:value.panelId,captured};
  if(['qceExport','qceSchedule'].includes(kind)&&!pendingPluginRead&&view.session.accountId===value.accountId&&view.session.panelId===value.panelId){view.assert(captured);qceCredentialPanel=null;return view.session[method](value);}
  pendingPluginRead=pending;qceCredentialPanel=null;
  try{
    await Promise.all([pluginAdminSession.closeCurrent(),pluginConfigSession.closeCurrent(),pluginPackageSession.closeCurrent(),qceSession.closeCurrent(),qceExportSession.closeCurrent(),qceScheduleSession.closeCurrent(),qceSecuritySession.closeCurrent(),qceNativePlansSession.closeCurrent()]);
    if(pendingPluginRead!==pending)throw ownerFriendError('changed');
    view.assert(captured);
    return await view.session[method](value);
  }finally{if(pendingPluginRead===pending)pendingPluginRead=null;}
}
function closePluginPanel(kind,value){
  const view=pluginPanelView(kind);view.request(value,'close');
  if(pendingPluginRead?.kind===kind&&pendingPluginRead.accountId===value.accountId&&pendingPluginRead.panelId===value.panelId)pendingPluginRead=null;
  // Each QCE child starts with the same local credential-status handshake.
  // Closing that exact child must retire its pending/status owner as well.
  if(['qce','qceSecurity','qceExport','qceSchedule','qceNativePlans'].includes(kind)){
    if(pendingPluginRead?.kind==='qceCredential'&&pendingPluginRead.accountId===value.accountId&&pendingPluginRead.panelId===value.panelId)pendingPluginRead=null;
    if(qceCredentialPanel?.accountId===value.accountId&&qceCredentialPanel.panelId===value.panelId)qceCredentialPanel=null;
  }
  return view.session.closeOwned(value);
}
function pluginPanelView(kind){
  if(kind==='qceNativePlans')return {request:qceNativePlansRequest,capture:captureQCE,assert:assertQCECapture,session:qceNativePlansSession};
  if(kind==='qceSecurity')return {request:qceSecurityRequest,capture:captureQCE,assert:assertQCECapture,session:qceSecuritySession};
  if(kind==='qceSchedule')return {request:qceScheduleRequest,capture:captureQCEScheduleLocal,assert:assertQCEScheduleLocal,session:qceScheduleSession};
  if(kind==='qceExport')return {request:qceExportRequest,capture:captureQCE,assert:assertQCECapture,session:qceExportSession};
  if(kind==='qce')return {request:qceRequest,capture:captureQCE,assert:assertQCECapture,session:qceSession};
  if(kind==='qceCredential')return {assert:assertPluginCapture};
  if(kind==='package')return {request:pluginPackageRequest,capture:capturePluginPackage,assert:assertPluginPackageCapture,session:pluginPackageSession};
  return {request:kind==='config'?pluginConfigRequest:pluginAdminRequest,capture:capturePluginAdmin,assert:assertPluginCapture,session:kind==='config'?pluginConfigSession:pluginAdminSession};
}
async function closePluginPanels({accountId,permanent=false}={}){
  if(!accountId||pendingPluginRead?.accountId===accountId)pendingPluginRead=null;
  if(!accountId||qceCredentialPanel?.accountId===accountId)qceCredentialPanel=null;
  const owners=[pluginAdminSession,pluginConfigSession,pluginPackageSession,qceSession,qceExportSession,qceScheduleSession,qceSecuritySession,qceNativePlansSession,ssqqSession].filter(session=>!accountId||session.accountId===accountId);
  const results=await Promise.allSettled(owners.map(session=>{try{return permanent?session.close():session.closeCurrent();}catch(error){return Promise.reject(error);}}));
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  // Older plugin views have a void no-session close contract; the export owner
  // has a positive settlement receipt before its journal or staging can close.
  if(results.some((r,i)=>[qceExportSession,qceScheduleSession,ssqqSession].includes(owners[i])&&r.value?.closed!==true))throw ownerFriendError('file_cleanup_unconfirmed');
  await closeQCEExportFiles(accountId);if(permanent&&!accountId){await closeQCEScheduleRuntime();qceExportJobs?.close();}return results.map(r=>r.value);
}
function observePluginPanels(){
  ssqqSession.observe();
  if(pendingPluginRead)try{pluginPanelView(pendingPluginRead.kind).assert(pendingPluginRead.captured);}catch{pendingPluginRead=null;}
  if(qceCredentialPanel)try{assertPluginCapture(qceCredentialPanel.captured);}catch{qceCredentialPanel=null;}
  pluginAdminSession.observe();pluginConfigSession.observe();pluginPackageSession.observe();qceSession.observe();qceExportSession.observe();qceScheduleSession.observe();qceSecuritySession.observe();qceNativePlansSession.observe();
}
function registerQCEHandlers(){
  register('qqQceStatus',value=>qceResult(value,()=>readQCECredentialStatus(value)));
  register('qqQceSaveCredential',value=>qceResult(value,()=>changeQCECredential(value)));
  register('qqQceRemoveCredential',value=>qceResult(value,()=>changeQCECredential(value,true)));
  register('qqQceRead',value=>qceResult(value,()=>readPluginPanel('qce',value)));
  for(const [suffix,method]of [['Preview','preview'],['Confirm','confirm'],['Dismiss','dismiss']])register('qqQce'+suffix,value=>qceResult(value,()=>qceSession[method](value)));
  register('qqQceClose',value=>qceResult(value,()=>closePluginPanel('qce',value)));
  register('qqQceSecurityRead',value=>qceSecurityResult(value,()=>readPluginPanel('qceSecurity',value)));
  for(const [suffix,method]of [['Preview','preview'],['Confirm','confirm'],['Dismiss','dismiss']])register('qqQceSecurity'+suffix,value=>qceSecurityResult(value,()=>qceSecuritySession[method](value)));
  register('qqQceSecurityClose',value=>qceSecurityResult(value,()=>closePluginPanel('qceSecurity',value)));
  register('qqQceNativePlansRead',value=>qceNativePlansResult(value,()=>readPluginPanel('qceNativePlans',value)));
  for(const [suffix,method]of [['Inspect','inspect'],['Targets','targets'],['Preview','preview'],['Confirm','confirm'],['History','history'],['Dismiss','dismiss']])register('qqQceNativePlans'+suffix,value=>qceNativePlansResult(value,()=>qceNativePlansSession[method](value)));
  register('qqQceNativePlansClose',value=>qceNativePlansResult(value,()=>closePluginPanel('qceNativePlans',value)));
  register('qqQceExportRead',value=>qceExportResult(value,()=>readPluginPanel('qceExport',value)));
  register('qqQceExportJobs',value=>qceExportResult(value,()=>readPluginPanel('qceExport',value,'listJobs')));
  for(const [suffix,method]of [['Preview','preview'],['Confirm','confirm'],['Observe','observeTask'],['Download','download'],['Forget','forgetJob'],['Dismiss','dismiss']])register('qqQceExport'+suffix,value=>qceExportResult(value,()=>qceExportSession[method](value)));
  register('qqQceExportClose',value=>qceExportResult(value,()=>closePluginPanel('qceExport',value)));
  register('qqQceScheduleList',value=>qceScheduleResult(value,async()=>{const result=await readPluginPanel('qceSchedule',value,'list');startQCEScheduleTimer();return result;}));
  register('qqQceScheduleRead',value=>qceScheduleResult(value,()=>readPluginPanel('qceSchedule',value)));
  register('qqQceScheduleRuns',value=>qceScheduleResult(value,()=>readPluginPanel('qceSchedule',value,'runs')));
  for(const [suffix,method]of [['Preview','preview'],['Confirm','confirm'],['ForgetRun','forgetRun'],['Dismiss','dismiss']])register('qqQceSchedule'+suffix,value=>qceScheduleResult(value,()=>qceScheduleSession[method](value)));
  register('qqQceScheduleClose',value=>qceScheduleResult(value,()=>closePluginPanel('qceSchedule',value)));
}
function registerPluginAdminHandlers(){
  register('qqPluginAdminRead',value=>pluginAdminResult(value,()=>readPluginPanel('status',value)));
  register('qqPluginAdminPreview',value=>pluginAdminResult(value,()=>pluginAdminSession.preview(value)));
  register('qqPluginAdminConfirm',value=>pluginAdminResult(value,()=>pluginAdminSession.confirm(value)));
  register('qqPluginAdminDismiss',value=>pluginAdminResult(value,()=>pluginAdminSession.dismiss(value)));
  register('qqPluginAdminClose',value=>pluginAdminResult(value,()=>closePluginPanel('status',value)));
}
function registerPluginConfigHandlers(){
  register('qqPluginConfigRead',value=>pluginConfigResult(value,()=>readPluginPanel('config',value)));
  register('qqPluginConfigPreview',value=>pluginConfigResult(value,()=>pluginConfigSession.preview(value)));
  register('qqPluginConfigConfirm',value=>pluginConfigResult(value,()=>pluginConfigSession.confirm(value)));
  register('qqPluginConfigDismiss',value=>pluginConfigResult(value,()=>pluginConfigSession.dismiss(value)));
  register('qqPluginConfigClose',value=>pluginConfigResult(value,()=>closePluginPanel('config',value)));
}
function registerPluginPackageHandlers(){
  register('qqPluginPackageRead',value=>pluginPackageResult(value,()=>readPluginPanel('package',value)));
  for(const [suffix,method]of [['Catalog','catalog'],['PrepareLocal','prepareLocal'],['PrepareCatalog','prepareCatalog'],['Preview','preview'],['Confirm','confirm'],['Dismiss','dismiss'],['BuiltinRead','builtinRead'],['BuiltinPreview','builtinPreview'],['BuiltinConfirm','builtinConfirm'],['BuiltinDismiss','builtinDismiss']])register('qqPluginPackage'+suffix,value=>pluginPackageResult(value,()=>pluginPackageSession[method](value)));
  register('qqPluginPackageClose',value=>pluginPackageResult(value,()=>closePluginPanel('package',value)));
}
function captureRemoteContext(entry){
  if(quitting||!win||win.isDestroyed()||!win.isVisible()||win.isMinimized())throw Object.assign(Error('Remote panel unavailable'),{code:'scope_unavailable'});
  let association='independent';
  if(entry?.associatedProfileId){
    let service;try{service=accounts.get(entry.associatedProfileId);}catch{throw Object.assign(Error('Remote association changed'),{code:'changed'});}
    if(!remoteServiceIds.has(service))remoteServiceIds.set(service,++remoteServiceSequence);
    association=`${entry.associatedProfileId}:${remoteServiceIds.get(service)}:${service.generation}`;
  }
  return `${win.id}:${remoteLifecycleEpoch}:${accounts?.selectedId||''}:${association}`;
}
async function pickRemoteFiles(kind,{signal,assertCurrent}){
  if(remotePickerBusy||imagePickerBusy||avatarPickerBusy||pluginPackagePickerBusy||qqProgramPickerBusy||voiceFilePickerBusy)throw Object.assign(Error('Picker busy'),{code:'operation_in_progress'});
  const check=()=>{if(signal?.aborted)throw Object.assign(Error('Selection cancelled'),{code:'changed'});assertCurrent();};
  remotePickerBusy=true;
  try{
    check();const cert=await dialog.showOpenDialog(win,{title:config.language==='zh'?(kind==='ca'?'选择远程服务器的可信 CA 证书':'选择新的服务器证书'):(kind==='ca'?'Choose a trusted remote CA certificate':'Choose the new server certificate'),properties:['openFile'],filters:[{name:'PEM certificate',extensions:['pem','crt','cer']}]});
    check();if(cert.canceled)return null;if(cert.filePaths.length!==1||!path.isAbsolute(cert.filePaths[0]))throw Object.assign(Error('Invalid file'),{code:'file_invalid'});
    if(kind==='ca')return cert.filePaths[0];
    const key=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择与证书匹配的私钥':'Choose the matching private key',properties:['openFile'],filters:[{name:'PEM private key',extensions:['pem','key']}]});
    check();if(key.canceled)return null;if(key.filePaths.length!==1||!path.isAbsolute(key.filePaths[0]))throw Object.assign(Error('Invalid file'),{code:'file_invalid'});
    return {certPath:cert.filePaths[0],keyPath:key.filePaths[0]};
  }finally{remotePickerBusy=false;}
}
function initializeRemoteManagement(){
  const registry=new RemoteNapCatRegistry({root,vault:safeStorage,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust});
  remotePanel=new QQRemotePanel({registry,captureContext:captureRemoteContext,validateTrust:validateRemoteTrust,
    pickCA:options=>pickRemoteFiles('ca',options),pickCertificateFiles:options=>pickRemoteFiles('pair',options),
    sessionFactory:options=>new QQRemoteSession({...options,
      pickUploadFiles:options=>pickRemoteTransferFiles('upload',options),
      pickDownloadFile:options=>pickRemoteTransferFiles('download',options),
      passkeyBridge:new WindowsWebAuthn(),getPasskeyContext:captureRemotePasskeyContext,
      qrEncoder:text=>QRCode.toDataURL(text,{width:280,margin:4,errorCorrectionLevel:'M'})}),sessionResult:remoteResult});
  const links=new QQTransferLinks({root,vault:safeStorage,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust});
  transferJobs=new QQTransferJobs({root:path.join(root,'qq-transfer-jobs'),vault:safeStorage});
  transferPanel=new QQTransferPanel({links,jobs:transferJobs,validateTrust:validateRemoteTrust,
    captureParent:captureTransferParent,verifyParent:(value,options)=>remotePanel.session.verifyTransferScope(value,options),
    pickCA:options=>pickRemoteFiles('ca',options),sessionFactory:options=>new QQTransferSession({...options,
      pickUploadFiles:options=>pickRemoteTransferFiles('upload-single',options),
      pickDownloadFile:options=>pickRemoteTransferFiles('download',options)})});
  transferLocal=new QQTransferLocal({jobs:transferJobs,captureContext:captureTransferLocalContext,
    describeBinding:scope=>describeTransferLocalBinding(scope,registry,links),
    getJobOwner:jobId=>transferPanel.session.inspectLocalJobOwner(jobId),
    pauseJobOwner:(owner,options)=>transferPanel.session.pauseLocalJob(owner,options)});
  const supervisorLinks=new QQSupervisorLinks({root,vault:safeStorage,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust});
  supervisorPanel=new QQSupervisorPanel({links:supervisorLinks,captureParent:captureSupervisorParent,validateTrust:validateRemoteTrust,
    pickCA:options=>pickRemoteFiles('ca',options)});
}
function captureSupervisorParent(value){
  // A declared identity is sufficient to contact the separate supervisor while
  // QQ is stopped. No WebUI session or existing credential is given to it.
  const captured=remotePanel._capture(value),entry=captured.entry;
  return structuredClone({remoteId:entry.remoteId,panelId:value.panelId,remoteRevision:entry.revision,
    expectedQQ:entry.expectedQQ,origin:entry.origin,parentGeneration:remotePanel.panel.generation,contextKey:captureRemoteContext(entry)});
}
function captureTransferLocalContext(value){
  const parent=remotePanel._assert(value);
  return structuredClone({panelId:parent.panelId,parentGeneration:parent.generation,contextKey:captureRemoteContext(null)});
}
function describeTransferLocalBinding(scope,registry,links){
  // Public local projections only: a matching record is not network authority.
  const remotes=registry.list(),helpers=links.list();
  if(remotes.state!=='ready'||helpers.state!=='ready')return 'unavailable';
  const remote=remotes.items.find(row=>row.remoteId===scope.remoteId),helper=helpers.items.find(row=>row.helperId===scope.helperId);
  if(!remote||!helper)return 'missing';
  if(remote.revision!==scope.remoteRevision||remote.pendingRotation||
    helper.remoteId!==scope.remoteId||helper.remoteRevision!==scope.remoteRevision||helper.revision!==scope.helperRevision||
    ['origin','instanceId','trustRevision','credentialRevision'].some(key=>helper[key]!==scope[key]))return 'changed';
  return 'current';
}
function captureTransferParent(value){
  const binding=remotePanel._capture(value),parent=remotePanel.session.session;
  const ownerId=owner=>{if(!owner)return null;if(!transferParentIds.has(owner))transferParentIds.set(owner,++transferParentSequence);return transferParentIds.get(owner);};
  return structuredClone({...binding,parentSession:ownerId(parent),parentClient:ownerId(parent?.client),parentKind:parent?.kind||null,parentObservation:parent?.observation?.id||null});
}
async function pickRemoteTransferFiles(kind,{signal,assertCurrent,suggestedName}={}){
  if(!['upload','upload-single','download'].includes(kind)||typeof assertCurrent!=='function')throw Object.assign(Error('Invalid file selection'),{code:'invalid_request'});
  if(remotePickerBusy||imagePickerBusy||avatarPickerBusy||pluginPackagePickerBusy||qqProgramPickerBusy||voiceFilePickerBusy)throw Object.assign(Error('Picker busy'),{code:'operation_in_progress'});
  const check=()=>{if(signal?.aborted)throw Object.assign(Error('Selection cancelled'),{code:'changed'});captureRemoteContext(null);assertCurrent();};
  remotePickerBusy=true;
  try{
    check();
    if(kind==='upload'||kind==='upload-single'){
      const single=kind==='upload-single';
      const result=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择要上传的文件':single?'Choose a file to upload':'Choose files to upload',properties:['openFile',...single?[]:['multiSelections'],'dontAddToRecent']});
      check();if(result.canceled)return null;
      if(!Array.isArray(result.filePaths)||!result.filePaths.length||result.filePaths.length>(single?1:20)||result.filePaths.some(file=>typeof file!=='string'||!path.isAbsolute(file))||new Set(result.filePaths).size!==result.filePaths.length)throw Object.assign(Error('Invalid files'),{code:'file_invalid'});
      return result.filePaths;
    }
    // A server-controlled name is never a local directory or executable action.
    const name=typeof suggestedName==='string'&&suggestedName.length<=180&&/^[^\\/:*?"<>|\p{Cc}\p{Cf}]+$/u.test(suggestedName)&&!/[. ]$/.test(suggestedName)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(suggestedName)?suggestedName:'remote-download.bin';
    const result=await dialog.showSaveDialog(win,{title:config.language==='zh'?'保存下载文件':'Save downloaded file',defaultPath:name,properties:['dontAddToRecent']});
    check();if(result.canceled)return null;
    if(typeof result.filePath!=='string'||!path.isAbsolute(result.filePath))throw Object.assign(Error('Invalid file'),{code:'file_invalid'});
    return result.filePath;
  }finally{remotePickerBusy=false;}
}
function captureRemotePasskeyContext(){
  captureRemoteContext(null);
  if(process.platform!=='win32'||typeof win.getNativeWindowHandle!=='function')throw Object.assign(Error('Passkey unavailable'),{code:'passkey_unavailable'});
  const handle=win.getNativeWindowHandle();
  if(!Buffer.isBuffer(handle)||![4,8].includes(handle.length))throw Object.assign(Error('Passkey unavailable'),{code:'passkey_unavailable'});
  const value=handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE());
  if(value===0n)throw Object.assign(Error('Window unavailable'),{code:'scope_unavailable'});
  return {parentHwnd:'0x'+value.toString(16),ownerPid:process.pid};
}
async function closeRemoteManagement({permanent=false}={}){
  ++remoteLifecycleEpoch;
  const owners=[supervisorPanel,transferLocal,transferPanel,remotePanel].filter(Boolean);
  const results=await Promise.allSettled(owners.map(owner=>{try{return permanent?owner.close():owner.closeCurrent();}catch(error){return Promise.reject(error);}}));
  const failure=results.find(row=>row.status==='rejected');if(failure)throw failure.reason;
  if(results.some(row=>row.value?.closed!==true))throw Object.assign(Error('Remote cleanup unconfirmed.'),{code:'remote_cleanup_unconfirmed'});
  if(permanent&&transferJobs){
    const settled=await transferJobs.settleRetirementCleanup();
    if(settled?.closed!==true)throw Object.assign(Error('Transfer journal cleanup unconfirmed.'),{code:'transfer_cleanup_unconfirmed'});
    const closed=transferJobs.close();
    if(closed?.closed!==true)throw Object.assign(Error('Transfer journal close unconfirmed.'),{code:'transfer_cleanup_unconfirmed'});
  }
  return {closed:true};
}
async function closeTransferParent(input,{exactRemote=false}={}){
  const closing=[];
  if(supervisorPanel){
    try{closing.push(exactRemote?supervisorPanel.closeOwned(structuredClone({panelId:input.panelId,remoteId:input.remoteId})):supervisorPanel.closeParent({panelId:input.panelId}));}catch(error){closing.push(Promise.reject(error));}
  }
  if(transferLocal&&(!exactRemote||remotePanel?.session.remoteId===input?.remoteId)){
    try{closing.push(transferLocal.closeParent(structuredClone({panelId:input.panelId})));}catch(error){closing.push(Promise.reject(error));}
  }
  const owner=transferPanel?.panel??transferPanel?.retiringOwner;
  if(owner?.panelId===input?.panelId&&(!exactRemote||owner.remoteId===input?.remoteId)){
    try{closing.push(transferPanel.closeCurrent());}catch(error){closing.push(Promise.reject(error));}
  }
  const results=await Promise.allSettled(closing),failure=results.find(row=>row.status==='rejected');
  if(failure)throw failure.reason;
  if(results.some(row=>row.value?.closed!==true))throw Object.assign(Error('Transfer cleanup unconfirmed.'),{code:'transfer_cleanup_unconfirmed'});
}
function registerRemoteHandlers(){
  for(const [suffix,method]of [['List','list'],['Create','create'],['Update','update'],['Forget','forget'],['PickCA','pickCAFile'],['RegistryClose','closeOwned']]){
    register('qqRemote'+suffix,value=>remotePanel.result(value,async()=>{
      if(method==='closeOwned'){remotePanel._request(value,['panelId']);await closeTransferParent(value);}
      if(['update','forget'].includes(method)){
        remotePanel._request(value,['panelId','remoteId','revision',...(method==='update'?['patch']:[])]);
        await closeTransferParent(value,{exactRemote:true});
      }
      return remotePanel[method](value);
    }));
  }
  for(const [suffix,method]of Object.entries(remoteSessionMethods))register('qqRemote'+suffix,async value=>{
    try{remoteRequest(value,method==='closeOwned'?'close':method);await closeTransferParent(value,{exactRemote:method==='closeOwned'});}catch(error){return remoteResult(value,()=>{throw error;});}
    return remotePanel.call(method,value);
  });
  for(const [suffix,method]of [['Settings','settings'],['Create','create'],['Update','update'],['Forget','forget'],['ForgetJob','forgetJob'],['PickCA','pickCAFile'],['Close','closeOwned']])register('qqTransfer'+suffix,value=>transferPanel.result(value,()=>transferPanel[method](value)));
  for(const [suffix,method]of Object.entries(transferSessionMethods))register('qqTransfer'+suffix,value=>transferPanel.call(method,value));
  for(const [suffix,method]of [['List','list'],['Detail','detail'],['Pause','pause'],['Preview','preview'],['Confirm','confirm'],['Check','check'],['Dismiss','dismiss'],['Close','closeOwned']])register('qqTransferLocal'+suffix,value=>transferLocalResult(value,method==='closeOwned'?'close':method,()=>transferLocal[method](value)));
  for(const [suffix,method]of [['List','list'],['Create','create'],['Forget','forget'],['PickCA','pickCA'],['Read','read'],['Preview','preview'],['Confirm','confirm'],['RecoveryRead','recoveryRead'],['RecoveryPreview','recoveryPreview'],['RecoveryConfirm','recoveryConfirm'],['LockRead','lockRead'],['LockPreview','lockPreview'],['LockConfirm','lockConfirm'],['ComponentRepairRead','componentRepairRead'],['ComponentRepairPreview','componentRepairPreview'],['ComponentRepairConfirm','componentRepairConfirm'],['ComponentRepairDiscard','componentRepairDiscard'],['ProfileBackupRead','profileBackupRead'],['ProfileBackupPreview','profileBackupPreview'],['ProfileBackupConfirm','profileBackupConfirm'],['NativePasskeyRead','nativePasskeyRead'],['NativePasskeyPreview','nativePasskeyPreview'],['NativePasskeyConfirm','nativePasskeyConfirm'],['OrphanRead','orphanRead'],['OrphanPreview','orphanPreview'],['OrphanConfirm','orphanConfirm'],['OrphanDiscard','orphanDiscard'],['Query','query'],['EndRecovery','endRecovery'],['Dismiss','dismiss'],['Close','closeOwned']]){
    register('qqSupervisor'+suffix,value=>supervisorResult(value,method,()=>supervisorPanel[method](value)));
  }
}
const macQQSetupError=code=>Object.assign(Error('Mac QQ preparation is unavailable.'),{code});
function macQQScope({disconnected=false}={}){
  if(hostGate?.platform!=='darwin'||process.arch!=='arm64')throw macQQSetupError('unsupported_platform');
  if(quitting||!win?.isVisible()||win.isMinimized()||!accounts?.selectedId||!bot||
     (disconnected&&bot.status!=='disconnected')||bot.config.channel!=='qq'||accounts.get(accounts.selectedId)!==bot)throw macQQSetupError('changed');
  return {profileId:accounts.selectedId,service:bot,generation:bot.generation,mode:bot.config.mode};
}
const macQQSetup=createMacQQSetup({
  getScope:()=>macQQScope({disconnected:true}),
  getLaunchScope:macQQScope,
  getConfiguredPorts:profileId=>accounts.configuredQQPorts(profileId),
  openDialog:kind=>dialog.showOpenDialog(win,kind==='node'?{
    title:config.language==='zh'?'选择已签名的 Node 24+':'Choose a signed Node 24+ binary',properties:['openFile'],
  }:{
    title:kind==='prepared'?(config.language==='zh'?'选择此搭档原有的 LLBot 准备目录':'Choose this companion’s prepared LLBot folder'):
      (config.language==='zh'?'选择解包后的 LLBot 目录':'Choose the extracted LLBot folder'),properties:['openDirectory'],
  }),
  saveDialog:()=>dialog.showSaveDialog(win,{
    title:config.language==='zh'?'选择新的 QQ 桥接配置目录':'Choose a new QQ bridge configuration folder',
    buttonLabel:config.language==='zh'?'创建准备目录':'Create preparation folder',
    defaultPath:'Agent Arcade QQ Bridge',
  }),
  openRelease:url=>shell.openExternal(url),
  reveal:file=>shell.showItemInFolder(file),
  copy:command=>clipboard.writeText(command),
});
function imageError(code){return Object.assign(Error('QQ image operation did not complete.'),{code});}
const QQ_IMAGE_SCOPE=['service','generation','scopeId','client','socket','clientGeneration','qqAccountId','ownerId',
  'role','roleId','route','groupRevision'];
const qqImageTarget=({groupId})=>groupId===undefined?{}:{groupId};
const qqImageEnvelope=panel=>({accountId:panel.accountId,panelId:panel.panelId,...qqImageTarget(panel)});
const ownsImagePanel=(value,panel=imagePanel)=>panel?.accountId===value.accountId&&panel.panelId===value.panelId&&panel.groupId===value.groupId;
function imageRequest(value,withTicket=false){
  const allowed=['accountId','panelId','groupId',...(withTicket?['ticketId']:[])];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||
     !Object.hasOwn(value,'accountId')||!Object.hasOwn(value,'panelId')||
     typeof value.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.accountId)||
     typeof value.panelId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.panelId)||
     (Object.hasOwn(value,'groupId')&&(typeof value.groupId!=='string'||!/^[1-9]\d{4,14}$/.test(value.groupId)))||
     (withTicket&&(!Object.hasOwn(value,'ticketId')||typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId)))){
    throw imageError('invalid_request');
  }
}
function captureImage(value){
  if(quitting||accounts?.selectedId!==value.accountId||!win?.isVisible()||win.isMinimized())throw imageError('changed');
  if(hostGate.platform==='darwin'&&value.groupId===undefined)throw imageError('group_unavailable');
  const service=accounts.get(value.accountId);
  if(service!==bot||typeof service.imageTargetBinding!=='function')throw imageError('disconnected');
  const binding=service.imageTargetBinding(value.groupId);
  if(binding.status!=='connected'||binding.channel!=='qq'||binding.groupId!==value.groupId)throw imageError('disconnected');
  return {...qqImageEnvelope(value),service,generation:binding.generation,scopeId:binding.scopeId,
    client:binding.client,socket:binding.client?.socket,clientGeneration:binding.client?.generation,
    qqAccountId:binding.accountId,ownerId:binding.ownerId,role:binding.role,roleId:binding.roleId,
    route:binding.route,groupRevision:binding.groupRevision};
}
function assertImage(panel){
  if(imagePanel!==panel||panel.controller.signal.aborted)throw imageError('changed');
  const current=captureImage(panel);
  if(QQ_IMAGE_SCOPE.some(key=>current[key]!==panel[key]))throw imageError('changed');
}
async function closeImages(){
  const previous=imagePanel;imagePanel=null;if(!previous)return {closed:true};
  previous.controller.abort();try{await previous.service.resetImages();}finally{publish();}return {closed:true};
}
async function closeOwnedImage(value){
  imageRequest(value);
  if(!ownsImagePanel(value))return {closed:true};
  return closeImages();
}
function observeImageBinding(){if(imagePanel){try{assertImage(imagePanel);}catch{void closeImages().catch(()=>{});}}}
function publicImageDraft(value,panel){
  const recipient=value?.recipient;
  if(!value||typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId)||value.kind!=='image'||
     !Number.isSafeInteger(value.width)||value.width<1||value.width>2048||
     !Number.isSafeInteger(value.height)||value.height<1||value.height>2048||
     !Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>4*1024*1024||
     !Number.isSafeInteger(value.expiresAt)||typeof value.preview!=='string'||value.preview.length>710000||
     !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.preview)||
     recipient?.accountId!==panel.qqAccountId||typeof recipient?.role!=='string'||recipient.role.length>64){
    throw imageError('invalid_response');
  }
  const target={accountId:recipient.accountId,role:recipient.role};
  if(panel.groupId===undefined){
    if(recipient.ownerId!==panel.ownerId||recipient.groupId!==undefined)throw imageError('invalid_response');
    target.ownerId=panel.ownerId;
  }else{
    if(recipient.groupId!==panel.groupId||recipient.roleId!==panel.roleId||recipient.role!==panel.role||
       recipient.ownerId!==undefined)throw imageError('invalid_response');
    Object.assign(target,{groupId:panel.groupId,roleId:panel.roleId,...(panel.groupName?{groupName:panel.groupName}:{})});
  }
  return {ticketId:value.ticketId,kind:'image',width:value.width,height:value.height,bytes:value.bytes,
    expiresAt:value.expiresAt,preview:value.preview,recipient:target};
}
async function verifyQQImageGroup(panel){
  if(panel.groupId===undefined)return;
  if(typeof panel.client?.verifyGroupImageTarget!=='function')throw imageError('group_unavailable');
  const result=await panel.client.verifyGroupImageTarget(panel.groupId,panel.controller.signal,{
    assertCurrent:()=>assertImage(panel),
  });
  assertImage(panel);
  if(result?.accountId!==panel.qqAccountId||result.groupId!==panel.groupId||result.revision!==panel.groupRevision){
    throw imageError('group_unavailable');
  }
  if(typeof result.groupName==='string'&&result.groupName&&result.groupName.length<=80&&
     !/[\p{Cc}\p{Cf}]/u.test(result.groupName))panel.groupName=result.groupName;
}
async function pickQQImage(value){
  imageRequest(value);if(pluginPackagePickerBusy||avatarPickerBusy||imagePickerBusy||voiceFilePickerBusy)throw imageError('operation_in_progress');
  const captured=captureImage(value);if(captured.service.imageSnapshot().busy)throw imageError('operation_in_progress');imagePickerBusy=true;
  let panel;
  try{
    await Promise.all([closeImages(),closeQQVoices()]);const current=captureImage(value);
    if(QQ_IMAGE_SCOPE.some(key=>current[key]!==captured[key]))throw imageError('changed');
    panel={...captured,controller:new AbortController()};imagePanel=panel;
    await verifyQQImageGroup(panel);
    assertImage(panel);
    const title=panel.groupId===undefined?
      (config.language==='zh'?'选择要发给主人 QQ 的图片':'Choose an image to send to the owner on QQ'):
      (config.language==='zh'?`选择要发到 QQ 群 ${panel.groupId} 的图片`:`Choose an image for QQ group ${panel.groupId}`);
    const picked=await dialog.showOpenDialog(win,{title,properties:['openFile'],filters:[{name:'PNG / JPEG',extensions:['png','jpg','jpeg']}]});
    assertImage(panel);
    if(picked.canceled){await closeImages();return {cancelled:true,...qqImageEnvelope(panel)};}
    if(!Array.isArray(picked.filePaths)||picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string')throw imageError('invalid_request');
    const draft=await panel.service.selectImage(picked.filePaths[0],{
      signal:panel.controller.signal,...qqImageTarget(panel),groupName:panel.groupName,
    });
    assertImage(panel);
    return {...qqImageEnvelope(panel),draft:publicImageDraft(draft,panel)};
  }catch(error){if(panel&&imagePanel===panel)await closeImages().catch(()=>{});throw error;}
  finally{imagePickerBusy=false;}
}
async function sendQQImage(value){
  imageRequest(value,true);
  if(!ownsImagePanel(value))throw imageError('stale_ticket');
  const panel=imagePanel;
  assertImage(panel);
  // A late receipt belongs to this captured panel, even if the current role changes.
  const result=await panel.service.sendImage({ticketId:value.ticketId,...qqImageTarget(panel)},{signal:panel.controller.signal});
  const base={...qqImageEnvelope(panel),ticketId:value.ticketId,kind:'image'};
  if(result?.ticketId===value.ticketId&&result.outcome==='accepted'&&typeof result.messageId==='string'&&/^-?\d{1,20}$/.test(result.messageId))return {...base,outcome:'accepted',messageId:result.messageId};
  if(result?.ticketId===value.ticketId&&result.outcome==='not_sent'&&typeof result.code==='string'&&/^[a-z_]{1,48}$/.test(result.code))return {...base,outcome:'not_sent',code:result.code};
  return {...base,outcome:'unknown',code:'send_unknown'};
}
function discardQQImage(value){
  imageRequest(value,true);
  if(!ownsImagePanel(value))throw imageError('stale_ticket');
  const panel=imagePanel;
  assertImage(panel);
  return panel.service.discardImage({ticketId:value.ticketId,...qqImageTarget(panel)});
}
const QQ_VOICE_CODES=new Set(['invalid_request','invalid_owner','voice_too_large','voice_invalid','voice_format','voice_duration','voice_not_canonical','unsafe_file','file_changed','file_unavailable','media_unavailable','stale_ticket','expired_ticket','changed','disconnected','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','cancelled','operation_in_progress','closed','send_unknown','voice_failed','invalid_response','group_unavailable','voice_render_unavailable','voice_render_busy','voice_render_limit','voice_render_timeout','voice_render_failed','voice_render_exit_unconfirmed']);
const qqVoiceError=code=>Object.assign(Error('QQ voice operation did not complete.'),{code:QQ_VOICE_CODES.has(code)?code:'voice_failed'});
const qqVoiceResult=async operation=>{try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:QQ_VOICE_CODES.has(error?.code)?error.code:'voice_failed'};}};
const QQ_VOICE_SCOPE=['service','generation','scopeId','client','socket','clientGeneration','qqAccountId','ownerId',
  'role','roleId','route','groupRevision'];
const qqVoiceTarget=({groupId})=>groupId===undefined?{}:{groupId};
const qqVoicePanel=(panel,value)=>panel?.accountId===value.accountId&&panel.panelId===value.panelId&&panel.groupId===value.groupId;
const qqVoiceEnvelope=panel=>({accountId:panel.accountId,panelId:panel.panelId,...qqVoiceTarget(panel)});
function qqVoiceRequest(value,withTicket=false){
  const allowed=['accountId','panelId','groupId',...(withTicket?['ticketId']:[])];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||
     !Object.hasOwn(value,'accountId')||!Object.hasOwn(value,'panelId')||
     typeof value.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.accountId)||
     typeof value.panelId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.panelId)||
     (Object.hasOwn(value,'groupId')&&(typeof value.groupId!=='string'||!/^[1-9]\d{4,14}$/.test(value.groupId)))||
     (withTicket&&(typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId)))){
    throw qqVoiceError('invalid_request');
  }
  return value;
}
function captureQQVoice(value){
  if(quitting||accounts?.selectedId!==value.accountId||!win?.isVisible()||win.isMinimized())throw qqVoiceError('changed');
  if(hostGate?.platform==='darwin'&&value.groupId===undefined)throw qqVoiceError('group_unavailable');
  const service=accounts.get(value.accountId);
  if(service!==bot||typeof service.voiceBinding!=='function')throw qqVoiceError('disconnected');
  const binding=service.voiceBinding(value.groupId);
  if(binding.status!=='connected'||binding.channel!=='qq'||binding.groupId!==value.groupId)throw qqVoiceError('disconnected');
  return {...qqVoiceEnvelope(value),service,generation:binding.generation,scopeId:binding.scopeId,
    client:binding.client,socket:binding.client?.socket,clientGeneration:binding.client?.generation,
    qqAccountId:binding.accountId,ownerId:binding.ownerId,role:binding.role,roleId:binding.roleId,
    route:binding.route,groupRevision:binding.groupRevision};
}
function assertQQVoice(panel){
  if(voiceMediaPanel!==panel||panel.controller.signal.aborted)throw qqVoiceError('changed');
  const current=captureQQVoice(panel);
  if(QQ_VOICE_SCOPE.some(key=>current[key]!==panel[key]))throw qqVoiceError('changed');
}
async function verifyQQVoiceGroup(panel){
  if(panel.groupId===undefined)return;
  assertQQVoice(panel);
  if(typeof panel.client?.verifyGroupVoiceTarget!=='function')throw qqVoiceError('group_unavailable');
  const result=await panel.client.verifyGroupVoiceTarget(panel.groupId,panel.controller.signal,{
    assertCurrent:()=>assertQQVoice(panel),
  });
  assertQQVoice(panel);
  if(result?.accountId!==panel.qqAccountId||result.groupId!==panel.groupId||result.revision!==panel.groupRevision){
    throw qqVoiceError('group_unavailable');
  }
  if(typeof result.groupName==='string'&&result.groupName&&result.groupName.length<=80&&
     !/[\p{Cc}\p{Cf}]/u.test(result.groupName))panel.groupName=result.groupName;
}
async function closeQQVoices(){
  const previous=voiceMediaPanel;voiceMediaPanel=null;const closing=previous||voiceMediaClosingPanel;if(closing)voiceMediaClosingPanel=closing;
  previous?.controller.abort();
  try{await Promise.all([closing?.service.resetVoices(),qqVoiceRenderer.cancel()]);if(voiceMediaClosingPanel===closing)voiceMediaClosingPanel=null;}finally{publish();}return {closed:true};
}
async function closeOwnedQQVoice(value){qqVoiceRequest(value);const panel=voiceMediaPanel||(qqVoiceRenderer.busy?voiceMediaClosingPanel:null);if(!qqVoicePanel(panel,value))return {closed:true};return closeQQVoices();}
function observeQQVoiceBinding(){qqVoiceRenderer.observe?.();if(voiceMediaPanel){try{assertQQVoice(voiceMediaPanel);}catch{void closeQQVoices().catch(()=>{});}}}
function publicQQVoiceDraft(value,panel){
  const recipient=value?.recipient;
  if(!value||typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId)||value.kind!=='voice'||
     ![16000,24000,32000,44100,48000].includes(value.sampleRate)||value.channels!==1||value.bits!==16||
     !Number.isFinite(value.durationSeconds)||value.durationSeconds<0.2||value.durationSeconds>30||
     !Number.isSafeInteger(value.bytes)||value.bytes<44||value.bytes>4*1024*1024||!Number.isSafeInteger(value.expiresAt)||
     typeof value.preview!=='string'||value.preview.length>5592500||!/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.preview)||
     recipient?.accountId!==panel.qqAccountId||typeof recipient?.role!=='string'||recipient.role.length>64){
    throw qqVoiceError('invalid_response');
  }
  const base={accountId:recipient.accountId,role:recipient.role};
  if(panel.groupId===undefined){
    if(recipient.ownerId!==panel.ownerId||recipient.groupId!==undefined)throw qqVoiceError('invalid_response');
    base.ownerId=recipient.ownerId;
  }else{
    if(recipient.groupId!==panel.groupId||recipient.roleId!==panel.roleId||recipient.role!==panel.role||
       recipient.ownerId!==undefined)throw qqVoiceError('invalid_response');
    Object.assign(base,{groupId:panel.groupId,roleId:panel.roleId,...(panel.groupName?{groupName:panel.groupName}:{})});
  }
  return {ticketId:value.ticketId,kind:'voice',sampleRate:value.sampleRate,channels:1,bits:16,
    durationSeconds:value.durationSeconds,bytes:value.bytes,expiresAt:value.expiresAt,preview:value.preview,recipient:base};
}
function qqRenderRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accountId','panelId','groupId','text'].includes(key)))throw qqVoiceError('invalid_request');
  qqVoiceRequest({accountId:value.accountId,panelId:value.panelId,...(Object.hasOwn(value,'groupId')?{groupId:value.groupId}:{})});
  if(typeof value.text!=='string'||!value.text.trim()||value.text.length>240||[...value.text].length>120||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value.text))throw qqVoiceError('voice_render_limit');
}
function groupVoiceProblem(){
  if(voiceMediaPanel||qqVoiceRenderPending||qqVoiceRenderer.busy)return 'voice_render_busy';
  if(!voiceRenderAvailability({root,platform:hostGate?.platform}).available)return 'voice_render_unavailable';
  return null;
}
function qqVoiceAvailability(value){
  qqVoiceRequest(value);captureQQVoice(value);
  const available=voiceRenderAvailability({root,platform:hostGate?.platform}).available===true;
  let progress={stage:'idle'};const panel=voiceMediaPanel;
  if(qqVoicePanel(panel,value)){assertQQVoice(panel);progress=qqVoiceRenderer.progress();}
  return {...qqVoiceEnvelope(value),available,...(available?{}:{reason:'voice_render_unavailable'}),progress};
}
async function renderQQVoice(value){
  qqRenderRequest(value);if(pluginPackagePickerBusy||avatarPickerBusy||voiceFilePickerBusy||imagePickerBusy||qqVoiceRenderPending||qqVoiceRenderer.busy)throw qqVoiceError('operation_in_progress');
  const captured=captureQQVoice(value);if(captured.service.voiceSnapshot().busy)throw qqVoiceError('operation_in_progress');
  if(!voiceRenderAvailability({root,platform:hostGate?.platform}).available)throw qqVoiceError('voice_render_unavailable');
  let panel,bytes;qqVoiceRenderPending=true;
  try{
    // Admit before any asynchronous cleanup so a second same-panel request
    // cannot inherit this controller and cancel the first in its error path.
    const previous=voiceMediaPanel,reuse=qqVoicePanel(previous,captured)&&!previous.controller.signal.aborted&&QQ_VOICE_SCOPE.every(key=>previous[key]===captured[key]);
    const closing=reuse?previous.service.resetVoices():closeQQVoices();panel=reuse?previous:{...captured,controller:new AbortController()};voiceMediaPanel=panel;
    await Promise.all([closing,closeImages(),closeVoice('media-preview')]);assertQQVoice(panel);await verifyQQVoiceGroup(panel);
    bytes=await qqVoiceRenderer.render(value.text,{signal:panel.controller.signal,scope:captured,assertCurrent:()=>assertQQVoice(panel)});assertQQVoice(panel);
    const draft=await panel.service.prepareVoice(bytes,{signal:panel.controller.signal,...qqVoiceTarget(panel)});assertQQVoice(panel);
    return {...qqVoiceEnvelope(panel),draft:publicQQVoiceDraft(draft,panel)};
  }catch(error){if(voiceMediaPanel===panel){try{await closeQQVoices();}catch(cleanup){throw qqVoiceError(cleanup?.code);}}throw qqVoiceError(error?.code);}
  finally{bytes?.fill(0);qqVoiceRenderPending=false;}
}
async function cancelQQVoiceRender(value){qqVoiceRequest(value);const panel=voiceMediaPanel||(qqVoiceRenderer.busy?voiceMediaClosingPanel:null);if(!qqVoicePanel(panel,value))return {cancelled:true};await closeQQVoices();return {cancelled:true};}
async function pickQQVoice(value){
  qqVoiceRequest(value);if(pluginPackagePickerBusy||avatarPickerBusy||voiceFilePickerBusy||imagePickerBusy||qqVoiceRenderer.busy)throw qqVoiceError('operation_in_progress');
  const captured=captureQQVoice(value);if(captured.service.voiceSnapshot().busy)throw qqVoiceError('operation_in_progress');voiceFilePickerBusy=true;
  let panel;
  try{
    const closing=closeQQVoices();panel={...captured,controller:new AbortController()};voiceMediaPanel=panel;
    // Own this intent before awaiting old playback/requests, so closing the
    // drawer during cleanup cannot reopen a file picker or publish a late WAV.
    await Promise.all([closing,closeImages(),closeVoice('media-preview')]);assertQQVoice(panel);await verifyQQVoiceGroup(panel);
    const title=panel.groupId===undefined
      ?(config.language==='zh'?'选择要发给主人 QQ 的语音':'Choose a voice file to send to the owner on QQ')
      :(config.language==='zh'?`选择要发到群 ${panel.groupId} 的语音`:`Choose a voice file for QQ group ${panel.groupId}`);
    const picked=await dialog.showOpenDialog(win,{title,properties:['openFile'],filters:[{name:'Mono PCM16 WAV',extensions:['wav']}]});
    assertQQVoice(panel);if(picked.canceled){await closeQQVoices();return {cancelled:true};}
    if(!Array.isArray(picked.filePaths)||picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string')throw qqVoiceError('invalid_request');
    const draft=await panel.service.selectVoice(picked.filePaths[0],{signal:panel.controller.signal,...qqVoiceTarget(panel)});assertQQVoice(panel);
    return {...qqVoiceEnvelope(panel),draft:publicQQVoiceDraft(draft,panel)};
  }catch(error){if(panel&&voiceMediaPanel===panel)await closeQQVoices().catch(()=>{});throw qqVoiceError(error?.code);}
  finally{voiceFilePickerBusy=false;}
}
async function sendQQVoice(value){
  qqVoiceRequest(value,true);const panel=voiceMediaPanel;if(!qqVoicePanel(panel,value))throw qqVoiceError('stale_ticket');assertQQVoice(panel);
  const result=await panel.service.sendVoice({ticketId:value.ticketId},{signal:panel.controller.signal,...qqVoiceTarget(panel)});
  const base={...qqVoiceEnvelope(panel),ticketId:value.ticketId,kind:'voice'};
  if(result?.ticketId===value.ticketId&&result.kind==='voice'&&result.outcome==='accepted'&&typeof result.messageId==='string'&&/^-?\d{1,20}$/.test(result.messageId))return {...base,outcome:'accepted',messageId:result.messageId};
  if(result?.ticketId===value.ticketId&&result.kind==='voice'&&result.outcome==='not_sent')return {...base,outcome:'not_sent',code:QQ_VOICE_CODES.has(result.code)?result.code:'voice_failed'};
  return {...base,outcome:'unknown',code:'send_unknown'};
}
function discardQQVoice(value){qqVoiceRequest(value,true);const panel=voiceMediaPanel;if(!qqVoicePanel(panel,value))throw qqVoiceError('stale_ticket');assertQQVoice(panel);const result=panel.service.discardVoice({ticketId:value.ticketId},qqVoiceTarget(panel));return {discarded:result?.discarded===true};}
function voiceBinding(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.accountId)||typeof value.panelId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.panelId))throw Error('Choose the current voice conversation.');
  return value.accountId===voiceAccount&&value.panelId===voicePanel&&matchesVoiceOwner(value,voice?.source||voiceOwnerSource);
}
function matchesVoiceOwner(value,source){
  if(source?.kind==='local')return value.sourceKind==='local'&&value.localGeneration===source.generation&&value.localCharacterId===source.character;
  return (value.sourceKind===undefined||value.sourceKind==='channel')&&value.localGeneration===undefined&&value.localCharacterId===undefined;
}
function captureVoiceSource(ready=false){
  const service=bot,accountId=accounts?.selectedId;
  if(!service||!accountId||quitting)throw Error('Voice selection changed.');
  if(desktopConversations.kind()==='local'){
    const local=service.localConversationContext();
    return {...local,kind:'local',bot:service,accountId};
  }
  if(ready)service.socialController();
  const settings=service.socialStore?.config(),client=service.client;
  return {kind:'channel',bot:service,accountId,scope:service.socialScope,generation:service.generation,character:settings?.characterId,settings:JSON.stringify(settings),dispatcher:service.dispatcher,client,socket:client?.socket,clientGeneration:client?.generation,owner:client?.ownerId,self:client?.accountId};
}
function sameVoiceSource(a,b){return !!a&&!!b&&['kind','bot','accountId','scope','generation','character','settings','dispatcher','client','socket','clientGeneration','owner','self'].every(key=>a[key]===b[key]);}
function voiceSourceFields(source){return source?.kind==='local'?{sourceKind:'local',localGeneration:source.generation,localCharacterId:source.character}:{sourceKind:'channel'};}
function voiceSourceScope(source){return `${source.accountId}:${source.kind==='local'?'app:':''}${source.scope}`;}
function assertVoiceSource(value,source){
  if(source.kind==='local'){
    if(value.sourceKind!=='local'||value.localGeneration!==source.generation||value.localCharacterId!==source.character)throw Error('The App voice conversation changed. Reopen its current panel.');
  }else if(value.sourceKind!==undefined&&value.sourceKind!=='channel'||value.localGeneration!==undefined||value.localCharacterId!==undefined)throw Error('The voice source changed. Reopen its current panel.');
}
function voiceReceiptMatches(receipt){
  if(receipt.accountId!==accounts?.selectedId)return false;
  if(receipt.source?.kind==='local'){
    const local=bot?.localSnapshot?.();
    return desktopConversations.kind()==='local'&&receipt.source.bot===bot&&local?.characterId===receipt.source.character;
  }
  return desktopConversations.kind()!=='local'&&receipt.scope===`${accounts.selectedId}:${bot?.socialScope}`;
}
function finishVoiceRetirement(item){
  if(item.promise)return item.promise;
  if(item.entry)item.entry.closeState='closing';
  const operation=Promise.resolve().then(()=>item.previous.close(item.reason)).then(()=>{
    if(item.entry)item.entry.closeState='closed';
    if(voiceRetirements.get(item.previous)===item)voiceRetirements.delete(item.previous);
  },error=>{if(item.entry)item.entry.closeState='failed';throw error;}).finally(()=>{
    if(item.entry&&voiceReceipts.get(item.accountId)===item.entry){item.entry.endedAt=Date.now();}
    if(item.promise===operation)item.promise=null;
  });
  item.promise=operation;return operation;
}
function retryVoiceRetirements(filter=()=>true){return Promise.all([...voiceRetirements.values()].filter(filter).map(finishVoiceRetirement));}
async function settleVoiceRetirements(filter=()=>true){
  await Promise.allSettled([...voiceDiscoveries].filter(filter).map(item=>item.promise));
  await retryVoiceRetirements(filter);
}
function retainVoiceProbe(speech,binding){
  let item=voiceRetirements.get(speech);
  if(!item){item={previous:speech,accountId:binding.accountId,panelId:binding.panelId,source:binding.source,reason:'device-check',entry:null,promise:null};voiceRetirements.set(speech,item);}
  return finishVoiceRetirement(item);
}
async function retainClosedVoice(previous,accountId,panelId,reason){
  if(!previous)return;
  let item=voiceRetirements.get(previous);
  if(!item){
    previous.record('session-close-requested',{reason});
    const state=previous.snapshot(),entry={accountId,panelId,scope:previous.scope||state.scope,source:previous.source,mode:state.mode,reason,closeState:'closing',endedAt:Date.now()};
    voiceReceipts.delete(accountId);voiceReceipts.set(accountId,entry);
    while(voiceReceipts.size>6)voiceReceipts.delete(voiceReceipts.keys().next().value);
    item={previous,accountId,panelId,source:previous.source,reason,entry,promise:null};voiceRetirements.set(previous,item);
  }
  return finishVoiceRetirement(item);
}
async function closeVoice(reason='manual-close'){
  voiceEpoch++;const previous=voice,id=voiceAccount,panelId=voicePanel;voice=null;voiceAccount=null;voicePanel=null;voiceWatch=null;voiceOwnerSource=null;
  try{await Promise.all([retainClosedVoice(previous,id,panelId,reason),settleVoiceRetirements()]);}finally{publish();}
}
async function closeOwnedVoice(value){
  const reason=['manual-close','panel-disposed','view-left','panel-replaced','account-switch','connection-ended'].includes(value?.reason)?value.reason:'manual-close';
  if(voiceBinding(value))await closeVoice(reason);
  else try{await settleVoiceRetirements(item=>item.accountId===value.accountId&&item.panelId===value.panelId&&matchesVoiceOwner(value,item.source));}finally{publish();}
  // This acknowledges completion of this panel's close calls, not another
  // panel's snapshot and not an independent OS process-exit measurement.
  return {status:'closed',accountId:value.accountId,panelId:value.panelId,closeConfirmed:true};
}
async function interruptVoice(value){
  if(!voiceBinding(value)){const retiring=[...voiceRetirements.values()].find(item=>item.accountId===value.accountId&&item.panelId===value.panelId&&matchesVoiceOwner(value,item.source));return retiring?{status:retiring.promise?'closing':'error',error:retiring.promise?'':'Voice shutdown has not been confirmed. Retry ending the session.'}:{status:'closed'};}
  if(!voice)return closeOwnedVoice(value);
  return voice.interrupt();
}
function finishVoice(value){
  if(!voiceBinding(value)||!voice)return {status:'closed'};
  return voice.finishListening();
}
function confirmVoice(value){
  if(!voiceBinding(value)||!voice)throw Error('Select the voice conversation that owns this transcript.');
  if(Object.keys(value).some(key=>!['accountId','panelId','draftId','text','sourceKind','localGeneration','localCharacterId'].includes(key)))throw Error('Invalid transcript confirmation.');
  const current=captureVoiceSource(true);assertVoiceSource(value,current);
  if(!sameVoiceSource(voice.source,current))throw Error('Voice selection changed.');
  return voice.confirmTranscript({draftId:value.draftId,text:value.text});
}
function checkVoiceCapabilities(value){
  voiceBinding(value);
  if(value.accountId!==accounts.selectedId||Object.keys(value).some(key=>!['accountId','panelId','backend','sourceKind','localGeneration','localCharacterId'].includes(key)))throw Error('Select the current voice conversation.');
  if(voiceAccount||voice)throw Error('End the current voice session before checking devices.');
  const source=captureVoiceSource(),id=source.accountId,epoch=voiceEpoch;assertVoiceSource(value,source);
  const check=()=>{if(quitting||epoch!==voiceEpoch||voiceAccount||voice||!sameVoiceSource(source,captureVoiceSource()))throw Error('Voice selection changed.');};
  const earlier=[...voiceDiscoveries],item={accountId:id,panelId:value.panelId,source,promise:null};
  const operation=(async()=>{
    await Promise.allSettled(earlier.map(probe=>probe.promise));
    await retryVoiceRetirements();await prepareDesktopAsr();
    check();
    const result=await voiceCapabilities({closeRuntime:speech=>retainVoiceProbe(speech,{accountId:id,panelId:value.panelId,source}),root,characterId:source.character,backend:value.backend,acquireAsrLease:()=>asrGate.acquire({scopeId:`discovery:${id}`,jobId:require('node:crypto').randomUUID()})});
    check();return {...result,...voiceSourceFields(source)};
  })();
  item.promise=operation;voiceDiscoveries.add(item);operation.then(()=>voiceDiscoveries.delete(item),()=>voiceDiscoveries.delete(item));return operation;
}
async function prepareDesktopAsr(){
  await asrGate.retryCleanup();
  // An idle QQ model must exit before a new microphone host starts. A running
  // QQ job stays owned: neural acquisition reports busy, Windows still works.
  try{await asrGate.closeIdle();}catch(error){if(error?.code!=='busy')throw error;}
}
async function startVoice(options){
  const selectedBot=bot,id=accounts.selectedId;
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['accountId','panelId','mode','locale','voice','headphonesConfirmed','backend','sourceKind','localGeneration','localCharacterId'].includes(key)))throw Error('Invalid voice options.');
  voiceBinding(options);
  if(options.accountId!==id)throw Error('The selected conversation changed. Start voice from its current panel.');
  const source=captureVoiceSource(true);assertVoiceSource(options,source);
  const {accountId,panelId,backend,sourceKind,localGeneration,localCharacterId,...speechOptions}=options;
  // Keep optional local models resident between recordings in the same panel.
  // A new account, scope, provider, connection or explicit close owns a new host.
  if(!voiceMediaPanel&&voice&&voiceBinding(options)&&!voice.closed&&sameVoiceSource(voice.source,source)&&
    (source.kind==='local'||voiceWatch.incomingCount===selectedBot.incomingCount)&&(!backend||voice.runtimeBackend===backend))return voice.startListening(speechOptions);
  const epoch=++voiceEpoch,previous=voice,previousAccount=voiceAccount,previousPanel=voicePanel,incomingCount=selectedBot.incomingCount,scope=voiceSourceScope(source);
  const check=()=>{if(epoch!==voiceEpoch||quitting||!sameVoiceSource(source,captureVoiceSource(true))||source.kind==='channel'&&selectedBot.incomingCount!==incomingCount)throw Error('Voice startup was cancelled because the selected conversation changed.');};
  voice=null;voiceWatch=null;voiceAccount=id;voicePanel=options.panelId;voiceOwnerSource=source;
  await Promise.all([retainClosedVoice(previous,previousAccount,previousPanel,'restarted'),settleVoiceRetirements(),closeQQVoices()]);
  check();voiceWatch={...source,incomingCount};
  await prepareDesktopAsr();
  check();
  const {speech,backend:runtimeBackend}=createVoiceRuntime({root,characterId:source.character,backend,acquireAsrLease:()=>asrGate.acquire({scopeId:`microphone:${scope}`,jobId:require('node:crypto').randomUUID()})});
  voice=new VoiceConversation({speech,scope,respond:async(text,context)=>{
    if(!sameVoiceSource(source,captureVoiceSource(true)))throw Error('Voice selection changed.');
    const result=await (source.kind==='local'?source.dispatcher.respondLocally(text,context):selectedBot.socialReply(text,context));
    if(!sameVoiceSource(source,captureVoiceSource(true)))throw Error('Voice selection changed.');
    return result;
  },onChange:publish});
  voice.source=source;voice.runtimeBackend=runtimeBackend;
  return voice.startListening(speechOptions);
}
function observeVoiceInput(){
  if(!voice||!voiceWatch)return;
  const watched=voiceWatch,service=watched.bot;
  if(watched.kind==='local'){
    let current;try{current=captureVoiceSource(true);}catch{}
    if(!sameVoiceSource(watched,current))void closeVoice('scope-changed').catch(()=>{});
    return;
  }
  if(watched.kind==='channel'){
    let current;try{current=captureVoiceSource(true);}catch{}
    if(!sameVoiceSource(watched,current)){void closeVoice('scope-changed').catch(()=>{});return;}
  }
  const closeReason=voiceAccount!==accounts?.selectedId||service!==bot?'account-switch':service.socialScope!==watched.scope?'scope-changed':service.generation!==watched.generation?'connection-reset':service.status!=='connected'?'connection-ended':null;
  if(closeReason){
    void closeVoice(closeReason).catch(()=>{});return;
  }
  // A local AI turn may have finished while its TTS is still playing. Channel
  // input must cancel that audio as well, independently of model cancellation.
  if(service.incomingCount!==watched.incomingCount){
    watched.incomingCount=service.incomingCount;
    voice.record('channel-interruption',{channel:service.config.channel});
    void voice.interrupt(service.config.channel==='qq'?'qq-message':'channel-message').catch(()=>{});
  }
}

function desktopChatContext(){
  if(quitting||!accounts||!bot||!win||win.isDestroyed())return null;
  if(desktopConversations.kind()==='local'){
    let local;try{local=bot.localConversationContext?.();}catch{return null;}
    const mode=bot.config.mode,model=bot.config[mode+'Model']||({gpt:DEFAULT_CHAT_IMAGE_GPT_MODEL,deepseek:'deepseek-flash'})[mode];
    return local?{...local,accountId:accounts.selectedId,service:bot,kind:'local',imageSupported:companionImageCapability(mode,model)}:null;
  }
  let dispatcher;try{dispatcher=bot.socialController();}catch{return null;}
  const client=bot.client,settings=bot.socialStore?.config();
  if(!client||client.ready===false||!bot.socialScope||!settings?.characterId)return null;
  return {accountId:accounts.selectedId,service:bot,dispatcher,scope:bot.socialScope,character:settings.characterId,
    settings:JSON.stringify(settings),generation:bot.generation,client,clientGeneration:client.generation,socket:client.socket,
    owner:client.ownerId,self:client.accountId,kind:'channel'};
}
async function chooseDesktopImage({signal,title}){
  const fail=code=>{throw Object.assign(Error('App picture unavailable.'),{code});};
  const selectedWindow=win;
  const check=()=>{if(signal?.aborted)fail('cancelled');if(quitting||!selectedWindow||win!==selectedWindow||selectedWindow.isDestroyed()||!selectedWindow.isVisible()||selectedWindow.isMinimized())fail('changed');};
  check();
  if(remotePickerBusy||pluginPackagePickerBusy||avatarPickerBusy||imagePickerBusy||voiceFilePickerBusy||qqProgramPickerBusy||qqDiagnosticSaving)fail('busy');
  imagePickerBusy=true;let raw,prepared,delivered=false;
  try{
    const selected=await dialog.showOpenDialog(selectedWindow,{title:title||(config.language==='zh'?'选择给搭档看的图片':'Choose a picture for your companion'),properties:['openFile','dontAddToRecent'],filters:[{name:'PNG / JPEG',extensions:['png','jpg','jpeg']}]});
    check();if(selected.canceled)return null;
    if(!Array.isArray(selected.filePaths)||selected.filePaths.length!==1||typeof selected.filePaths[0]!=='string')fail('invalid_image');
    // The renderer supplies neither a file path nor encoded pixels. Reuse the
    // bounded picker-file reader and strip metadata before a model can see it.
    raw=await readSelectedImage(selected.filePaths[0],signal);check();
    prepared=canonicalImage(raw,path.extname(selected.filePaths[0]).toLowerCase(),nativeImage);check();
    delivered=true;return prepared;
  }catch(error){
    if(['changed','cancelled','busy'].includes(error?.code))throw error;
    if(error?.code==='image_too_large')fail('image_too_large');
    if(['image_format','image_invalid','image_animated','invalid_image'].includes(error?.code))fail('invalid_image');
    fail('image_read_failed');
  }finally{raw?.fill(0);if(!delivered)prepared?.bytes?.fill(0);imagePickerBusy=false;}
}
let desktopReplyNotification=null;
function closeDesktopReplyNotification(){const previous=desktopReplyNotification;desktopReplyNotification=null;try{previous?.close();}catch{/* Optional OS surface. */}}
function notifyDesktopReply(reply){
  try{
    if(quitting||!win||win.isDestroyed()||!desktopChat.claimReplyNotice(reply)||reply.sourceKind!=='local'||!Notification.isSupported())return;
    const key='app-reply:'+require('node:crypto').createHash('sha256').update(JSON.stringify([reply.accountId,reply.character,'local'])).digest('hex');
    // Gate's existing `done` category means response ended, not task success.
    // This adapter creates no task state. The stable scope key keeps its cooldown.
    if(!gate.allow({changed:true,task:{id:key,state:'done',updatedAt:reply.completedAt}},{enabled:config.notifications,quiet:config.quiet,focused:win.isFocused()&&win.isVisible()},Date.now()))return;
    const selectedWindow=win;
    closeDesktopReplyNotification();
    const notice=new Notification({title:'Agent Arcade',body:config.language==='zh'?'App 对话有新回复。':'Your App conversation has a new reply.',silent:true});
    desktopReplyNotification=notice;
    const released=()=>{if(desktopReplyNotification===notice)desktopReplyNotification=null;};
    notice.once('close',released);notice.once('failed',released);
    notice.once('click',()=>{
      try{
        // Focus only: an old toast cannot select an account/source, start AI or
        // interrupt newer text, speech, permissions or work in the same window.
        if(quitting||win!==selectedWindow||selectedWindow.isDestroyed())return;
        if(selectedWindow.isMinimized())selectedWindow.restore();
        selectedWindow.show();selectedWindow.focus();
      }catch{/* A closed OS surface cannot affect the conversation. */}
    });
    notice.show();
  }catch{closeDesktopReplyNotification();}
}
bus.subscribe({source:'app-chat',kind:'chat.reply'},event=>{
  const reply=event.reply;
  notifyDesktopReply(reply);
  if(quitting||reply.sourceKind!=='local'||!pets)return;
  const service=accounts?.services.get(reply.accountId),run=service?.localCompanion?.run;
  if(run&&!run.stCard&&!run.stGroup&&run.binding.character===reply.character){
    pets.reply(run.binding.mode,reply.character,reply.accountId);
  }
});
bus.subscribe({source:'app-chat',kind:'chat.reply'},event=>petReplyArrived(event.reply));
function publishOrdinaryGroupReply({service,mode,character}){
  if(quitting||!pets||service.status!=='connected'||service.config.channel!=='qq'||service.config.mode!==mode)return;
  const owner=[...(accounts?.services||[])].find(([,candidate])=>candidate===service);
  if(owner)bus.publish({source:'qq-group',kind:'chat.reply',accountId:owner[0],mode,character});
}
bus.subscribe({source:'qq-group',kind:'chat.reply'},({accountId,mode,character})=>{
  if(quitting||!pets||config.quiet)return;
  pets.observe(accounts?.services,accounts?.selectedId);
  pets.reply(mode,character,accountId,{requireBinding:true});
});
const desktopChat=new DesktopChat({getContext:desktopChatContext,isSelecting:()=>desktopConversations.isSelecting(),chooseImage:chooseDesktopImage,renderReplyAudio:(...args)=>appCharacterVoice.reply(...args),onReply:reply=>{bus.publish({source:'app-chat',kind:'chat.reply',reply});},onChange:()=>publish(),prepare:async(context,signal)=>{
  if(signal.aborted||bot!==context.service||accounts.selectedId!==context.accountId)throw Error('Changed local conversation.');
  // Retire only this account's already-owned speech; never start a speech host.
  const work=[];
  if(voiceAccount===context.accountId)work.push(closeVoice('manual-interruption'));
  else work.push(settleVoiceRetirements(item=>item.accountId===context.accountId));
  if(voiceMediaPanel?.accountId===context.accountId)work.push(closeQQVoices());
  await Promise.all(work);
}});
const desktopConversations=new DesktopConversations({getSelection:()=>{
  if(quitting||!accounts||!bot||!win||win.isDestroyed())return null;
  const accountId=accounts.selectedId;
  if(typeof accounts.get==='function'&&accounts.get(accountId)!==bot)return null;
  return {accountId,service:bot};
},retire:reason=>desktopChat.retire(reason),prepare:async selected=>{
  const work=[];
  if(voiceAccount===selected.accountId)work.push(closeVoice('manual-interruption'));
  else work.push(settleVoiceRetirements(item=>item.accountId===selected.accountId));
  if(voiceMediaPanel?.accountId===selected.accountId)work.push(closeQQVoices());
  await Promise.all(work);
},onChange:()=>publish()});
const stickerStudio=new CharacterStickerStudio({async readReference(id,signal){
  try {
    const file=characterLibrary.portraitPath(id);
    if(!file)return null;
    const {readSelected,canonicalGroupSticker}=require('./bot/qq-media.cjs');
    const bytes=await readSelected(file,signal);
    return canonicalGroupSticker(bytes,nativeImage).bytes;
  }catch{return null;}
},canDecode:bytes=>{
  const image=nativeImage.createFromBuffer(bytes),size=image.getSize();
  return !image.isEmpty()&&size.width===1024&&size.height===1024;
},getContext:state=>{
  const selected=desktopConversations.current();
  if(!selected||desktopConversations.isSelecting())return null;
  state??=selected.service.snapshot();
  const appChat=desktopConversations.kind()==='local';
  // A fresh companion can use its own gallery before any chat is configured.
  // The idle channel view has no App conversation to attach a drawing to.
  if(!appChat&&(state.status!=='disconnected'||state.paired))return null;
  const role=stickerRole(state,config.language);
  return role?{...selected,role,companionId:state.local.characterId,epoch:desktopConversations.epoch,generation:state.local.generation,historyId:appChat?state.local.historyId:null,language:config.language}:null;
}});
function registerDesktopChatHandlers(){
  register('desktopCharacterVoice',value=>desktopChatResult(()=>appCharacterVoice.handle(value,()=>{
    const current=desktopChat.observe();
    return current&&!desktopChat.selecting?{...current,contextId:desktopChat.contextId}:null;
  })));
  register('characterStickerConfigureImages',value=>stickerResult(()=>{
    if(accounts?.credentialMigrations.has(value?.accountId))throw Object.assign(Error('Credential migration in progress.'),{code:'credentials_busy'});
    const result=stickerStudio.configureImages(value);
    publish();
    return result;
  }));
  register('characterStickerGenerate',value=>stickerResult(()=>stickerStudio.generate(value)));
  register('characterStickerAppearance',value=>stickerResult(()=>stickerStudio.appearance(value)));
  register('characterStickerReference',value=>stickerResult(()=>stickerStudio.reference(value)));
  register('characterStickerRetryHistory',value=>stickerResult(()=>stickerStudio.retryHistory(value)));
  register('desktopChatDrawingRead',value=>stickerResult(()=>desktopConversations.readDrawing(value)));
  register('characterStickerSave',value=>stickerResult(()=>stickerStudio.save(value)));
  register('characterStickerLookup',value=>stickerResult(()=>stickerStudio.lookup(value)));
  register('characterStickerList',value=>stickerResult(()=>stickerStudio.list(value)));
  register('characterStickerDiscard',value=>stickerResult(()=>stickerStudio.discard(value)));
  register('desktopConversationSelect',value=>desktopChatResult(()=>desktopConversations.select(value)));
  register('desktopLocalStop',value=>desktopChatResult(()=>desktopConversations.stop(value)));
  register('desktopLocalHistory',value=>desktopChatResult(()=>desktopConversations.history(value)));
  register('desktopChannelHistory',value=>desktopChatResult(()=>desktopConversations.channelHistory(value)));
  register('desktopLocalMemory',value=>localMemoryResult(async()=>{
    const selected=desktopConversations.capture(value,['accountId','memoryId','action','id','revision','text']),epoch=desktopConversations.epoch;
    const check=()=>{
      const current=desktopConversations.current();
      if(epoch!==desktopConversations.epoch||current?.accountId!==selected.accountId||current?.service!==selected.service)throw Object.assign(Error('Local memory selection changed.'),{code:'changed'});
    };
    if(typeof selected.service.localMemory!=='function')throw Object.assign(Error('Local memory unavailable.'),{code:'unavailable'});
    const {accountId,...request}=value;
    const result=await selected.service.localMemory(request,{assertCurrent:check,prepare:async()=>{
      check();
      if(desktopConversations.kind()==='local')desktopChat.retire();
      // publish() can already have retired App speech after the edit locked
      // its context. Await that exact ownership, not just a non-null voice.
      if(voiceAccount===accountId&&voiceOwnerSource?.kind==='local')await closeVoice('scope-changed');
      await settleVoiceRetirements(item=>item.accountId===accountId&&item.source?.kind==='local');
      check();
    }});
    check();return {accountId,...result};
  }));
  register('desktopChatOpen',value=>desktopChatResult(()=>desktopChat.open(value)));
  register('desktopChatSelectImage',value=>desktopChatResult(()=>desktopChat.selectImage(value)));
  register('desktopChatRemoveImage',value=>desktopChatResult(()=>desktopChat.removeImage(value)));
  register('desktopChatSend',value=>desktopChatResult(()=>desktopChat.send(value)));
  register('desktopChatCancel',value=>desktopChatResult(()=>desktopChat.cancel(value)));
  register('desktopChatClose',value=>desktopChatResult(()=>desktopChat.close(value)));
}

function publish() {
  syncPet();
  observeQQDiagnosticCache();
  ownerRemarkPanel.observe();ownerHistorySession.observe();friendRequestsPanel.observe();
  ownerFriendSetup.observe();
  selfProfilePanel.observe();
  avatarPanel.observe();
  groupProfileSession.observe();
  groupAdminSession.observe();
  contactAdminSession.observe();
  observePluginPanels();
  remotePanel?.observe();
  supervisorPanel?.observe();
  transferPanel?.observe();
  transferLocal?.observe();
  firstSetupPanel.observe();
  qqComponents?.nodeRepair?.observe();
  observeVoiceInput();
  observeImageBinding();
  observeQQVoiceBinding();
  if (!win || win.isDestroyed()) return;
  // AccountManager notifies synchronously, before the caller adopts its new
  // service. The caller publishes again as soon as both owners agree.
  if(accounts?.services && accounts.services.get(accounts.selectedId)!==bot)return;
  // Still evaluate derived stale status each poll, but do not clone/send the
  // same histories, replies and theme to the renderer every idle second.
  pets?.sync({enabled:config.desktopPets,language:config.language,quiet:config.quiet});
  pets?.observe(accounts?.services,accounts?.selectedId);
  const next = fullSnapshot(), fingerprint = JSON.stringify(next);
  if (fingerprint === lastPublishedSnapshot) return;
  win.webContents.send('arcade:snapshot', next);
  lastPublishedSnapshot = fingerprint;
}
// Desktop pet (src/pet): a small floating view of the companion. It mirrors
// what the app is really doing and never carries message text or approvals.
// The presence is the one description of what she is doing; the desktop window
// and, when one is connected, the desk robot are bodies attached to it.
let petWindow=null,robotPreview=null,petContext=null,petSpeakingReply=null,petSpeakingTimer=null;
let boardHandbackWaiting=false;
let robotConnection=null,robotDeviceBody=null;
const PET_PERSONA='claude-ju',petPresence=new PetPresence();
function onChatRendererGone(_event,details){
  // A crash can retire an already submitted request before its terminal
  // receipt arrives. Closing the panel or stopping a request is deliberate.
  const lostRenderer=!quitting&&['crashed','oom','abnormal-exit'].includes(details?.reason);
  desktopConversations.invalidate({lostRenderer});
}
function syncPet(){
  const context=desktopChat.observe(), run=context?.kind==='local'?context.service.localCompanion?.run:null;
  const mirrors=context?.character===PET_PERSONA&&context.accountId===accounts?.selectedId&&context.service===bot&&!run?.stCard&&!run?.stGroup;
  const selected=mirrors?context:null;
  if(selected!==petContext){
    petContext=selected;petSpeakingReply=null;
    if(petSpeakingTimer)clearTimeout(petSpeakingTimer);
    petSpeakingTimer=null;
    // The board belongs to this app profile across companion switches.
    if(boardHandbackWaiting)petPresence.setActivity('idle');
    else petPresence.reset();
  }
  if(!selected)return;
  const session=desktopChat.session;
  if(petSpeakingReply&&petSpeakingReply===desktopChat.currentReply)petPresence.setActivity('speaking');
  else if(session?.active&&!session.active.controller.signal.aborted)petPresence.setActivity('thinking');
  else petPresence.setActivity(desktopChat.turnIssue||'idle');
}
function petReplyArrived(reply){
  syncPet();
  if(!petPresence.bodies.size||!petContext||reply!==desktopChat.currentReply||reply.contextId!==desktopChat.contextId)return;
  // A stored source reminder can raise attention while a foreground turn
  // still shows a failure or an unknown outcome.
  if(!desktopChat.turnIssue){
    petSpeakingReply=reply;
    if(petSpeakingTimer)clearTimeout(petSpeakingTimer);
    petSpeakingTimer=setTimeout(()=>{petSpeakingReply=null;petSpeakingTimer=null;syncPet();},3300);
    syncPet();petPresence.pulse();
  }
  if(!win||win.isDestroyed()||!win.isVisible()||!win.isFocused())petPresence.raiseAttention();
}
function petTaskHandedBack(){
  if(quitting||!win||win.isDestroyed()||(win.isVisible()&&win.isFocused()))return;
  boardHandbackWaiting=true;
  petPresence.raiseAttention();
}
function clearPetAttention(){
  boardHandbackWaiting=false;
  petPresence.clearAttention();
}
// Its settings have their own channel and its shutdown its own listener, so
// the general settings handler and the quit sequence stay as they were.
function registerPetHandlers(){
  register('desktopPet',patch=>{
    const wanted=patch&&typeof patch==='object'&&!Array.isArray(patch)?patch:{};
    if(wanted.enabled===true&&!petWindow.available())throw Error('The desktop companion is available on Windows and macOS.');
    const previous=config.desktopPet;
    config.desktopPet=normalizePet({...normalizePet(previous),...(typeof wanted.enabled==='boolean'?{enabled:wanted.enabled}:{}),...(typeof wanted.size==='string'?{size:wanted.size}:{})});
    try{saveConfig();}catch(error){config.desktopPet=previous;throw error;}
    petWindow.apply();publish();return snapshot();
  });
  register('petRobot',async patch=>{
    const wanted=patch&&typeof patch==='object'&&!Array.isArray(patch)?patch:{};
    if(wanted.device){
      if(quitting)throw Error('The application is closing.');
      const {action,id}=wanted.device;
      switch(action){
        case 'refresh': return robotConnection.refresh();
        case 'connect': return robotConnection.connect(id);
        case 'disconnect': return robotConnection.disconnect();
        case 'forget': return robotConnection.forget();
        default: throw Error('Unknown robot connection action.');
      }
    }
    if(wanted.preview===true)robotPreview.open();else if(wanted.preview===false)robotPreview.close();
    publish();return snapshot();
  });
}
app.on('will-quit',()=>{clearTimeout(petSpeakingTimer);petWindow?.close();robotPreview?.dispose();robotConnection?.dispose();robotDeviceBody?.dispose();});
function show() { clearPetAttention(); if (win && !hiddenStoreTest) { win.show(); win.focus(); } }
function applyWindow() {
  win.setAlwaysOnTop(config.alwaysOnTop === true);
  win.setMinimumSize(config.compact ? 440 : storeEdition ? 520 : 900, config.compact ? 380 : storeEdition ? 560 : 640);
  win.setSize(config.compact ? 490 : 1200, config.compact ? 600 : 830);
}
// A new manual intent retires the foreground sequence before it can start or
// connect against an obsolete selection. Read-only status never cancels it.
const qqLaunchConflicts=new Set(['accountSelect','accountCreate','accountImport','accountRemove','accountConnect','accountDisconnect','accountMigrateCredentials','accountRetryCredentials','accountResetCredentials','botConnect','botDisconnect','botConfigure','botForget','socialConfigure','characterApply','qqRuntimeStart','qqRuntimeStop','qqRuntimeRecover','qqRuntimeQR','qqRuntimeQuickLogin','qqRuntimeChoose','qqRuntimeConfigure','qqRuntimeLink','qqRuntimeBackupRestore','qqRuntimeOrphanCleanup','qqFirstSetup']);
// Host platform capabilities, set once at startup from the real platform (see
// whenReady). While it is null nothing is gated: that is the state before
// startup and in unit-test harnesses that load only parts of this file.
let hostGate=null;
// A Windows-only channel answers with one fixed result on other platforms and
// never reaches its handler; the interface does not offer those features there.
const macQQMediaChannels=new Set(['qqImagePick','qqImageSend','qqImageDiscard','qqImageClose',
  'qqVoicePick','qqVoiceAvailability','qqVoiceRender','qqVoiceCancelRender',
  'qqVoiceSend','qqVoiceDiscard','qqVoiceClose']);
function unsupportedChannel(channel){
  if(hostGate===null)return false;
  if(hostGate.platform==='darwin'&&macQQMediaChannels.has(channel))return false;
  return hostGate.features.managedQQ.available!==true&&/^qq[A-Z]/.test(channel)||
    hostGate.features.windowsSpeech.available!==true&&/^voice[A-Z]/.test(channel);
}
function register(channel, fn) {
  ipcMain.handle(`arcade:${channel}`, async (event, value) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== indexURL) throw Error('Untrusted sender');
    if(unsupportedChannel(channel))return {ok:false,code:'unsupported_platform'};
    if(['accountSelect','accountCreate','accountImport','accountRemove','accountConnect','accountDisconnect','accountMigrateCredentials','accountRetryCredentials','accountResetCredentials','botConnect','botDisconnect','botConfigure','botForget','socialConfigure','characterApply','voiceStart'].includes(channel))desktopConversations.invalidate();
    if(['accountSelect','accountCreate','accountImport','accountRemove'].includes(channel)){
      groupCardAssignments.invalidate();
      bot?.discardGroupSettingsEditors?.();
      qqConsole?.retireOrphanPreviews?.();
      if(hostGate?.platform==='darwin'){macQQSetup.invalidate();qqSetupGroupRead?.abort();}
    }
    if(qqCompanionLaunch?.snapshot()&&(qqLaunchConflicts.has(channel)||channel==='qqComponents'&&!['status','inspect','preparation-list','pending-list','node-repair-status'].includes(value?.action))&&(channel!=='qqRuntimeOrphanCleanup'||qqConsole?.orphanCleanupChangesRuntime?.(value)===true))await qqCompanionLaunch.closeCurrent();
    return fn(value);
  });
}
// Credential edits belong to the rendered registered profile, not whichever
// profile happens to be selected when a queued renderer message arrives.
function credentialRequest(value,{forget=false}={}) {
  const reject=()=>{throw Object.assign(Error('The selected companion changed. Reopen its connection settings before changing credentials. (credential_scope_changed)'),{code:'credential_scope_changed'});};
  if(!value||Object.prototype.toString.call(value)!=='[object Object]'||quitting)reject();
  const own=key=>Object.hasOwn(value,key),keyChange=own('key');
  const channelChange=['qqToken','qqOfficialSecret','feishuAppSecret','xAccessToken','messengerPageAccessToken','messengerRelayToken'].some(own);
  if(forget&&(Object.keys(value).length!==1||!own('profileId')))reject();
  const scoped=forget||keyChange||channelChange||['profileId','expectedMode','expectedChannel'].some(own);
  const service=bot;
  if(scoped){
    if(typeof value.profileId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.profileId)||accounts?.selectedId!==value.profileId)reject();
    let registered;try{registered=accounts.get(value.profileId);}catch{reject();}
    if(!service||registered!==service)reject();
    if((keyChange||own('expectedMode'))&&value.expectedMode!==(service.config.mode||'api'))reject();
    if((channelChange||own('expectedChannel'))&&value.expectedChannel!==(service.config.channel||'wechat'))reject();
    if(keyChange&&own('mode')&&value.mode!==value.expectedMode)reject();
  }
  if(!service)reject();
  const {profileId,expectedMode,expectedChannel,...patch}=value;
  return {service,patch};
}
async function chooseQQReplyMedia(value,service,request,setting){
  const image=setting==='qqGroupCardImage',owner=setting==='qqOwnerReplyMedia';
  const configAtOpen=service.config,generationAtOpen=service.generation,selectionAtOpen=accounts.selectionRevision;
  const verify=()=>{
    if(quitting||!win?.isVisible()||win.isMinimized()||accounts?.selectedId!==value.profileId||accounts.selectionRevision!==selectionAtOpen||
      credentialRequest(value).service!==service||service.config!==configAtOpen||service.generation!==generationAtOpen)throw qqVoiceError('changed');
    if(image)service.groupCardImageScope(request);
    else if(owner)service.ownerMedia.validate(request);
    else service.groupRecordingScope(request);
  };
  verify();
  if(request.operation==='remove'){
    if(image)service.setGroupCardImage(request);
    else service.setGroupMediaRecording(request);
    return service.snapshot();
  }
  if(image){
    let prepared;
    try{
      if(request.operation==='portrait'){
        prepared=await require('./bot/qq-group-card-images.cjs').prepareCardPortrait(service.characterLibrary,request.roleId,nativeImage,verify);
      }else{
        const title=config.language==='zh'?'选择允许此角色在本群发送的图片':'Choose an image for this character to send to this group';
        prepared=await chooseDesktopImage({title});
      }
      verify();
      if(prepared)service.setGroupCardImage(request,prepared.bytes);
      return service.snapshot();
    }finally{prepared?.bytes?.fill(0);}
  }
  if(voiceFilePickerBusy||imagePickerBusy||pluginPackagePickerBusy||avatarPickerBusy)throw qqVoiceError('operation_in_progress');
  voiceFilePickerBusy=true;
  let bytes;
  try{
    const title=owner
      ? (config.language==='zh'?'选择供鲸鱼娘发给主人的固定录音':'Choose a recording for Whale to send to the owner')
      : (config.language==='zh'?'选择此角色可在本群公开播放的固定录音':'Choose a recording for this character to play in this group');
    const picked=await dialog.showOpenDialog(win,{title,properties:['openFile','dontAddToRecent'],filters:[{name:'WAV',extensions:['wav']}]});
    verify();
    if(picked.canceled)return service.snapshot();
    if(picked.filePaths.length!==1)throw qqVoiceError('invalid_request');
    bytes=await require('./bot/qq-voice.cjs').readVoiceSelection(picked.filePaths[0]);
    verify();
    if(owner)service.ownerMedia.configure(request,bytes);else service.setGroupMediaRecording(request,bytes);
    return service.snapshot();
  }finally{bytes?.fill(0);voiceFilePickerBusy=false;}
}
// All library reads, scope checks and the configuration write are synchronous.
// Resolve the role from the QQ recipient's binding, independently of the open App conversation.
function withQQLibraryImage(service,roleId,name,sourceSha256,use){
  if(typeof sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(sourceSha256))throw imageError('invalid_request');
  const source=readNamedSticker(service.root,roleId,name);
  let image;
  try{
    if(source.name!==name||source.sha256!==sourceSha256)throw imageError('changed');
    image=canonicalGroupSticker(source.bytes,nativeImage);
    return use(image);
  }finally{source.bytes.fill(0);image?.bytes.fill(0);}
}
function readQQStickerLibrary(value,recipient,preview=false){
  try{
    const owner=recipient==='owner';
    if(!value?.profileId||value.expectedChannel!=='qq'||owner&&typeof value.expectedMode!=='string')throw imageError('invalid_request');
    const {service,patch}=credentialRequest(value);
    const {roleId,after,name,sourceSha256}=patch;
    const fields=owner?['accountId','ownerId','roleId','revision']:['expectedAccountId','groupId','roleId'];
    const allowed=[...fields,...(preview?['name','sourceSha256']:['after'])];
    if(Object.keys(patch).some(key=>!allowed.includes(key)))throw imageError('invalid_request');
    if(owner)service.ownerMedia.validate(patch);
    else service.groupNamedStickerScope({expectedAccountId:patch.expectedAccountId,groupId:patch.groupId,roleId,operation:'list'});
    if(!preview)return {ok:true,...listNamedStickers(service.root,roleId,after)};
    return withQQLibraryImage(service,roleId,name,sourceSha256,image=>({ok:true,sourceSha256,dataUrl:image.preview,
      width:image.width,height:image.height,sourceWidth:image.sourceWidth,sourceHeight:image.sourceHeight,resizedForBytes:image.resizedForBytes}));
  }catch(error){
    const known=['changed','not_found','storage_unavailable','invalid_request','invalid_name','image_too_large','image_invalid','image_format','image_animated','decoder_unavailable'];
    return {ok:false,code:known.includes(error?.code)?error.code:'changed'};
  }
}
async function selectedQQImagePreview(value,recipient){
  const owner=recipient==='owner';
  if(!value?.profileId||value.expectedChannel!=='qq'||owner&&typeof value.expectedMode!=='string')return null;
  try{
    const {service,patch}=credentialRequest(value),revision=accounts.selectionRevision;
    const assertSelected=()=>{
      if(accounts.selectionRevision!==revision||credentialRequest(value).service!==service)throw imageError('changed');
    };
    const preview=owner?await service.ownerMedia.previewSticker(patch,nativeImage,assertSelected):
      await service.groupCardImagePreview(patch,nativeImage,assertSelected);
    assertSelected();return preview;
  }catch{return null;}
}
function configureBot(value){
  const {service,patch}=credentialRequest(value);
  if(Object.hasOwn(patch,'qqGroupNamedSticker')){
    if(Object.keys(patch).length!==1||!value.profileId||typeof value.expectedMode!=='string'||value.expectedChannel!=='qq')throw imageError('invalid_request');
    const {name,sourceSha256,...request}=patch.qqGroupNamedSticker||{};
    const choosing=request.operation==='select'||request.operation==='add';
    if(!['select','restore','add','permissions','remove'].includes(request.operation)||!choosing&&(name!==undefined||sourceSha256!==undefined))throw imageError('invalid_request');
    service.groupNamedStickerScope(request);
    if(choosing)withQQLibraryImage(service,request.roleId,name,sourceSha256,image=>service.setGroupNamedSticker(request,{name,sourceSha256,bytes:image.bytes}));
    else service.setGroupNamedSticker(request);
    return service.snapshot();
  }
  if(Object.hasOwn(patch,'qqOwnerReplyMedia')){
    if(Object.keys(patch).length!==1||!value.profileId||typeof value.expectedMode!=='string'||value.expectedChannel!=='qq')throw qqVoiceError('invalid_request');
    const request=patch.qqOwnerReplyMedia;
    if(request?.operation==='selectSticker'){
      const {name,sourceSha256,...scope}=request;
      if(Object.keys(scope).some(k=>!['accountId','ownerId','roleId','revision','operation'].includes(k)))throw imageError('invalid_request');
      service.ownerMedia.validate(scope);
      withQQLibraryImage(service,scope.roleId,name,sourceSha256,image=>service.ownerMedia.configure(scope,{name,sourceSha256,bytes:image.bytes}));
      return service.snapshot();
    }
    if(request?.operation==='choose')return chooseQQReplyMedia(value,service,request,'qqOwnerReplyMedia');
    service.ownerMedia.configure(request);
    return service.snapshot();
  }
  if(Object.hasOwn(patch,'qqGroupMediaRecording')||Object.hasOwn(patch,'qqGroupCardImage')){
    if(Object.keys(patch).length!==1||!value.profileId||typeof value.expectedMode!=='string'||value.expectedChannel!=='qq')throw qqSetupGroupError('invalid_config');
    const setting=Object.hasOwn(patch,'qqGroupCardImage')?'qqGroupCardImage':'qqGroupMediaRecording';
    return chooseQQReplyMedia(value,service,patch[setting],setting);
  }
  if(Object.hasOwn(patch,'qqGroupMediaSelection')){
    if(Object.keys(patch).length!==1||!value.profileId||typeof value.expectedMode!=='string'||value.expectedChannel!=='qq'){
      throw qqSetupGroupError('invalid_config');
    }
    service.groupMediaSelectionSet(patch.qqGroupMediaSelection);
    return service.snapshot();
  }
  if(Object.hasOwn(patch,'qqGroupDirectoryCheck')){
    const {qqGroupDirectoryCheck:check}=patch;
    delete patch.qqGroupDirectoryCheck;
    if(!Object.hasOwn(patch,'qqGroups')||Object.keys(patch).length!==1||!value.profileId||
      typeof value.expectedMode!=='string'||value.expectedChannel!=='qq')throw qqSetupGroupError('invalid_config');
    const identity=checkedQQSetupGroupIdentity(service,check?.accountId);
    if(identity.checkedAt!==check?.checkedAt)throw qqSetupGroupError('changed');
  }
  service.configure(patch,{language:config.language,character:config.character});
  return service.snapshot();
}
async function forgetBotCredentials(value){const {service}=credentialRequest(value,{forget:true});await service.forget();return service.snapshot();}
function recoveryRequest(value,allowed){
  if(!value||Object.prototype.toString.call(value)!=='[object Object]'||!['profileId','expectedMode','expectedChannel'].every(key=>Object.hasOwn(value,key)&&typeof value[key]==='string')||Object.keys(value).some(key=>!allowed.includes(key)))throw Object.assign(Error('The selected companion changed. Reopen its connection settings. (credential_scope_changed)'),{code:'credential_scope_changed'});
  return credentialRequest(value);
}
let qqSetupGroupRead=null;
const qqSetupGroupError=code=>Object.assign(Error('The verified QQ group directory is unavailable.'),{code});
function checkedQQSetupGroupIdentity(service,accountId){
  const check=service.qqCheck;
  if(hostGate?.platform!=='darwin'||service.status!=='disconnected'||service.config.channel!=='qq'||
    typeof accountId!=='string'||!/^[1-9]\d{4,14}$/.test(accountId)||service.config.qqAccountId!==accountId||
    service.config.qqOwnerId===accountId||check?.state!=='checked'||check.accountId!==accountId||
    check.online!==true||!Number.isSafeInteger(check.checkedAt))throw qqSetupGroupError('identity_unverified');
  service.assertCredentialsAvailable();
  return check;
}
async function readQQSetupGroups(value){
  const {service,patch}=recoveryRequest(value,['profileId','expectedMode','expectedChannel','expectedAccountId','checkedAt']);
  const {expectedAccountId:accountId,checkedAt}=patch;
  const check=checkedQQSetupGroupIdentity(service,accountId);
  if(check.checkedAt!==checkedAt)throw qqSetupGroupError('changed');
  const url=service.config.qqUrl,token=service.secret.qqToken;
  qqSetupGroupRead?.abort();
  const controller=new AbortController();
  qqSetupGroupRead=controller;
  try{
    const result=await new QQDirectoryReader().read({kind:'groups',url,token,expectedAccountId:accountId,signal:controller.signal,fresh:true});
    if(controller.signal.aborted||credentialRequest(value).service!==service||
      service.config.qqUrl!==url||service.secret.qqToken!==token||checkedQQSetupGroupIdentity(service,accountId)!==check||
      result.accountId!==accountId)throw qqSetupGroupError('changed');
    return {accountId,checkedAt,items:result.items.map(({id,name})=>({id,name}))};
  }finally{if(qqSetupGroupRead===controller)qqSetupGroupRead=null;}
}
function groupRoleRequest(value,save){
  const fields=['profileId','expectedMode','expectedChannel','expectedAccountId','groupId','cardId'];
  if(save)fields.push('approval');
  const {service,patch}=recoveryRequest(value,save?[...fields,'expectedRoleApproval','reviewToken']:fields);
  if(!fields.every(field=>Object.hasOwn(value,field))||typeof patch.expectedAccountId!=='string')throw Error('Invalid group role request.');
  const target={profileId:value.profileId,expectedAccountId:patch.expectedAccountId,groupId:patch.groupId,cardId:patch.cardId};
  if(service.status==='connected'&&patch.cardId!==null){
    if(!save)return groupCardAssignments.preview(target);
    const applied=groupCardAssignments.apply({...target,approval:patch.approval,reviewToken:patch.reviewToken});
    if(!applied.saved)throw Error('Review this role and its target again before applying it.');
    return {...service.snapshot(),groupRoleResult:applied};
  }
  if(!save)return service.groupRolePreview(patch);
  if(patch.cardId===null && (service.status==='connected'||Object.hasOwn(patch,'expectedRoleApproval'))){
    const previous=service.config.qqGroupRoles?.find(row=>row?.accountId===patch.expectedAccountId&&row.groupId===patch.groupId);
    if(patch.expectedRoleApproval!==(previous?.approval??null))throw Error('The group role changed. Review the current role before restoring the default.');
  }
  const applied=service.groupRoleSet(patch);
  if(applied?.state==='apply_failed')return {...service.snapshot(),groupRoleResult:applied};
  return service.snapshot();
}
function groupLorebookRequest(value,save){
  const fields=['profileId','expectedMode','expectedChannel','expectedAccountId','groupId','bookId'];
  if(save)fields.push('roleId','approval');
  const {service,patch}=recoveryRequest(value,[...fields,'expectedRevision',...(save?[]:['page','roleId'])]);
  if(!fields.every(field=>Object.hasOwn(value,field))||typeof patch.expectedAccountId!=='string'){
    throw Error('Invalid group world book request.');
  }
  if(!save)return service.groupLorebookPreview(patch);
  service.groupLorebookSet(patch);
  return service.snapshot();
}
async function groupKnowledgeRequest(value,feature,actions,method){
  const fields=['profileId','expectedMode','expectedChannel','expectedAccountId','groupId','roleId','action'];
  const prefix='group_'+feature+'_';
  const extra=typeof value?.action==='string'&&Object.hasOwn(actions,value.action)?actions[value.action]:null;
  if(!extra)return {ok:false,code:prefix+'invalid'};
  const allowed=[...fields,...extra];
  const optional=feature==='wiki'&&value.action==='propose'?['quote']:feature==='reflection'&&value.action==='approve'?['text']:
    feature==='output_format'&&value.action==='configure'?['scriptId','approval']:[];
  const accepted=[...allowed,...optional];
  try{
    const {service,patch}=recoveryRequest(value,accepted);
    if(value.expectedChannel!=='qq'||!allowed.every(field=>Object.hasOwn(value,field))||
       typeof patch.expectedAccountId!=='string'||typeof patch.groupId!=='string'||typeof patch.roleId!=='string'){
      return {ok:false,code:prefix+'invalid'};
    }
    const assertCurrent=()=>{
      if(recoveryRequest(value,accepted).service!==service)throw Object.assign(Error('The companion changed.'),{code:prefix+'changed'});
    };
    return {ok:true,...await service[method](patch,assertCurrent)};
  }catch(error){
    const code=error?.code;
    if(typeof code==='string'&&code.startsWith(prefix)&&/^[a-z_]{1,32}$/.test(code.slice(prefix.length)))return {ok:false,code};
    if(code==='credential_scope_changed')return {ok:false,code:prefix+'changed'};
    if(feature==='reflection'&&code==='reflection_rule_cap')return {ok:false,code:prefix+'limit'};
    return {ok:false,code:prefix+'unavailable'};
  }
}
const groupWikiActions=Object.freeze({
  view:[],configure:['revision','read','propose'],propose:['revision','sourceId','title'],ask:['revision','sourceId'],
  approve:['revision','id'],reject:['revision','id'],revoke:['revision','id'],
});
const groupReflectionActions=Object.freeze({
  view:[],configure:['revision','scheduled','hour'],run:['revision'],
  approve:['revision','id'],reject:['revision','id'],rule:['revision','id','enabled'],
});
const groupOutputFormatActions=Object.freeze({
  view:[],preview:['scriptId'],configure:['revision','enabled'],remove:['revision','scriptId'],reorder:['revision','scriptIds'],
});
async function groupSpeakerDispatchRequest(value){
  const actions={view:[],configure:['revision','endpoint','model','keySlot'],enable:['revision'],disable:['revision']};
  const action=value?.action;
  if(typeof action!=='string'||!Object.hasOwn(actions,action))return {ok:false,code:'group_dispatch_invalid'};
  const fields=['profileId','expectedMode','expectedChannel','expectedAccountId','groupId','action',...actions[action]];
  try{
    const {patch}=recoveryRequest(value,fields);
    if(value.expectedChannel!=='qq'||!fields.every(field=>Object.hasOwn(value,field))||
       typeof patch.expectedAccountId!=='string'||typeof patch.groupId!=='string'){
      return {ok:false,code:'group_dispatch_invalid'};
    }
    return {ok:true,...await accounts.groupSpeakerDispatch(value.profileId,patch)};
  }catch(error){
    const code=error?.code;
    if(typeof code==='string'&&/^group_dispatch_[a-z_]{1,27}$/.test(code))return {ok:false,code};
    return {ok:false,code:code==='credential_scope_changed'?'group_dispatch_changed':'group_dispatch_unavailable'};
  }
}
function groupGenerationRequest(value,save){
  const fields=['profileId','expectedMode','expectedChannel','expectedAccountId','groupId','roleId'];
  if(save)fields.push('sampling');
  const {service,patch}=recoveryRequest(value,[...fields,'expectedRevision']);
  if(!fields.every(field=>Object.hasOwn(value,field))||typeof patch.expectedAccountId!=='string'){
    throw Error('Invalid group generation request.');
  }
  if(!save)return service.groupGenerationPreset(patch);
  service.groupGenerationSet(patch);
  return service.snapshot();
}
function groupSourceRequest(value,setter){
  const fields=['profileId','expectedMode','expectedChannel','expectedAccountId','groupId','roleId','sourceId','identity','enabled'];
  const {service,patch}=recoveryRequest(value,fields);
  if(value.expectedChannel!=='qq'||!fields.every(field=>Object.hasOwn(value,field))||typeof patch.expectedAccountId!=='string')throw Error('Invalid group source request.');
  service[setter](patch);
  return service.snapshot();
}
async function retryBotCredentials(value){
  const {service}=recoveryRequest(value,['profileId','expectedMode','expectedChannel']),id=value.profileId,mode=service.config.mode,channel=service.config.channel;
  const result=await service.retryCredentials({isCurrent:()=>!quitting&&bot===service&&accounts.selectedId===id&&service.config.mode===mode&&service.config.channel===channel});
  publish();return result;
}
async function resetBotCredentials(value){
  const {service}=recoveryRequest(value,['profileId','expectedMode','expectedChannel','action','ticket']),id=value.profileId,mode=service.config.mode,channel=service.config.channel;
  if(!['prepare','confirm'].includes(value.action)||value.action==='prepare'&&Object.hasOwn(value,'ticket'))throw Error('Invalid credential recovery request.');
  const isCurrent=()=>!quitting&&bot===service&&accounts.selectedId===id&&service.config.mode===mode&&service.config.channel===channel;
  const result=value.action==='prepare'?service.prepareCredentialReset():await service.resetCredentials({ticket:value.ticket,isCurrent});
  publish();return result;
}
async function accountMigrateCredentials(id){
  const ticket=accounts.captureCredentialMigration(id);
  const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'关闭旧应用后，选择原 Electron 配置目录（包含 Local State）':'Close the old app, then choose its Electron profile folder (contains Local State)',properties:['openDirectory']});
  if(picked.canceled)return {migrated:false,cancelled:true};
  accounts.assertCredentialMigration(ticket);
  const sourceProfile=picked.filePaths[0];
  if(typeof sourceProfile!=='string'||!path.isAbsolute(sourceProfile)||!fs.statSync(path.join(sourceProfile,'Local State')).isFile())throw Error('Choose the original Electron profile folder containing Local State.');
  const result=await accounts.migrateCredentials(ticket,options=>migrateApplicationVault({...options,sourceProfile,electronPath:process.execPath,devAppPath:app.isPackaged?undefined:app.getAppPath(),vault:safeStorage}));
  bot=accounts.current();publish();return result;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    if (!fs.existsSync(path.join(root,'config.json'))) config.language = app.getLocale().startsWith('zh') ? 'zh' : 'en';
    // Platform decisions are taken once, here. Windows-only machinery (local
    // QQ/NapCat management, its remote panels, QCE timers) is neither built nor
    // polled elsewhere; see core/platform.cjs and docs/MACOS.md.
    hostGate=hostPlatform.capabilities({platform:process.platform});
    // A macOS or Linux desktop session can start the app with a PATH that lacks
    // the user's tools (node, claude, git, codex). Append the usual install
    // locations once, before any of them is looked up. Windows is untouched.
    hostPlatform.applyHostPath({platform:process.platform,env:process.env});
    const hostLifecycle=hostPlatform.lifecycle({platform:process.platform}),managedQQ=hostGate.features.managedQQ.available===true;
    if(hostLifecycle.appUserModelId)app.setAppUserModelId('io.github.agentarcade.desktop');
    for (const name of ['workshop','moonbase']) themes.set(name, validateTheme(readJSON(path.join(__dirname, 'themes', `${name}.json`))));
    const custom = readJSON(path.join(root, 'theme.json'), null);
    try { if (custom) themes.set('custom', validateTheme(custom)); } catch { problem = 'Saved theme is invalid; using Workshop.'; }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    accounts = new AccountManager({root,vault:safeStorage,onChange:publish,onGroupReply:publishOrdinaryGroupReply,groupFeedSources:sources,characterLibrary,lorebookLibrary,regexLibrary,groupLibrary,groupOnlyImages:hostGate.platform==='darwin',imageFactory:options=>new QQOwnerImage({...options,nativeImage}),voiceFactory:options=>new QQOwnerVoice(options),
      prepareGroupDrawing:bytes=>canonicalGroupSticker(bytes,nativeImage).bytes,imageNative:nativeImage,
      groupVoiceReady:async voice=>windowsId(voice)?(await characterVoices.list()).some(entry=>entry.id===voice):groupVoiceProblem()===null,
      renderGroupVoice:renderLocalCharacterVoice,
      inboundImagePrepare:(bytes,extension)=>require('./bot/qq-media.cjs').canonicalImage(bytes,extension,nativeImage),
      inboundVoiceAvailability:()=>warmFileAsr.availability(),inboundVoiceFactory:options=>new OwnerVoicePipeline({...options,...warmFileAsr.pipelineOptions(),reader:new OwnerRecordReader()}),
      groupVoiceFactory:options=>new GroupVoicePipeline({...options,...warmFileAsr.pipelineOptions(),reader:new GroupRecordReader({getWindowsDocuments:process.platform==='win32'?()=>app.getPath('documents'):undefined})}),
      personaOptions:()=>({enabled:config.personaVoice,selection:config.character}),qrEncoder:text=>QRCode.toDataURL(text,{width:280,margin:3,errorCorrectionLevel:'M'}),nativeFactory:async options=>createNativeLaunch({...options,...await discoverNative(),sourceDir:path.join(__dirname,'bot')}),nativeProcessFactory:options=>new NativeProcess(options)});
    bot=accounts.current();
    initializeQQStopTrace();
    if(managedQQ){
    qqConsole=new QQConsole({root,componentStoreRoot:qqComponentStoreRoot,vault:safeStorage,profileRoot:app.getPath('userData'),runtimeFactory:options=>new QQRuntimeManager({...options,onStopTrace:qqStopTrace?.record}),onChange:publish,qrEncoder:text=>QRCode.toDataURL(text,{width:280,margin:3,errorCorrectionLevel:'M'})});
    qqComponents=new QQComponents({console:qqConsole,onChange:publish,captureNodeRepairUI});
    }
    workbench = new Workbench({root,discover:discoverNative,onChange:publish});
    taskBoard = createTaskBoard({home:root,bus,discover:discoverNative,observe:id=>live.tasks.get(JSON.stringify([id,''])),onChange:publish,onHandback:petTaskHandedBack,language:()=>config.language});
    const icon = createBrandIcon(nativeImage,256);
    const trayIcon = createBrandIcon(nativeImage,hostLifecycle.trayIconSize);
    // The macOS menu bar wants a small image with a 2x representation; the Dock
    // shows Electron's own icon when running from source unless one is set.
    if(hostLifecycle.trayIconRetina)try{trayIcon.addRepresentation({scaleFactor:2,width:hostLifecycle.trayIconSize*2,height:hostLifecycle.trayIconSize*2,buffer:createBrandIcon(nativeImage,hostLifecycle.trayIconSize*2).toPNG()});}catch{/* The 1x image remains usable. */}
    if(hostLifecycle.dockIcon&&app.isPackaged===false)try{app.dock?.setIcon(createBrandIcon(nativeImage,512));}catch{/* Decorative only. */}
    win = new BrowserWindow({ width:1200, height:830, minWidth:storeEdition?520:900, minHeight:storeEdition?560:640, backgroundColor:appearanceBackground(appearanceSnapshot(config.appearance,nativeTheme?.shouldUseDarkColors).colorScheme), title:'Agent Arcade', autoHideMenuBar:true, show:!hiddenStoreTest, icon,
      webPreferences:{ additionalArguments:[...(storeEdition?['--arcade-store-shell']:[]),`--arcade-appearance=${config.appearance}`,`--arcade-color-scheme=${appearanceSnapshot(config.appearance,nativeTheme?.shouldUseDarkColors).colorScheme}`,`--arcade-platform=${hostGate.platform}`], preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true } });
    if (storeEdition) {
      const {mountSocial}=require('../social-host.cjs');
      const {createSocialImageSaver}=require('./core/store-social-image-save.cjs');
      const {createGroupCardPicker}=require('./core/store-group-card-picker.cjs');
      const configuration=require('../service.json');
      const {mountBothouse}=require('./core/bothouse-management.cjs');
      register('storeBothouse',mountBothouse({window:win,WebContentsView:require('electron').WebContentsView,
        session,dialog,profile:root,language:()=>config.language,socialOrigin:new URL(configuration.origin).origin,
        littleWorldsOrigin:process.env.LITTLE_WORLDS_ORIGIN ?? configuration.littleWorldsOrigin}));
      register('storeSupport',()=>configuration.mode==='store'?
        {mode:'store',contact:configuration.offlineSupport} : {mode:'test'});
      register('storeSocial', mountSocial({
        window:win, WebContentsView:require('electron').WebContentsView, session,
        pickGroupCard:createGroupCardPicker({window:win,WebContentsView:require('electron').WebContentsView,
          library:characterLibrary,lorebookLibrary,nativeImage}),
        configuration,saveImage:createSocialImageSaver(win,dialog),
        readSendShortcut:()=>config.sendShortcut,
      }));
    }
    if(hostGate.platform==='darwin')pets=new PetWindows({
      electron:require('electron'),onChange:publish,
      workArea:saved=>{
        const bounds=saved??(win&&!win.isDestroyed()?win.getBounds():null);
        return (bounds?screen.getDisplayMatching(bounds):screen.getPrimaryDisplay()).workArea;
      },
      onClose:id=>{
        if(quitting||!config.desktopPets.includes(id))return;
        const old=config.desktopPets;
        config.desktopPets=old.filter(value=>value!==id);
        try{saveConfig();}catch{
          config.desktopPets=old;
          pets.failures.add(id);
          problem=config.language==='zh'?'桌宠关闭状态未能保存。':'The desktop pet preference could not be saved.';
        }
        publish();
      },
    });
    if(managedQQ)initializeRemoteManagement();
    installApplicationMenu();
    win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    if(managedQQ)initializeQQCompanionLaunch();
    registerQQCompanionLaunchHandlers();
    registerSSQQHandlers();
    for(const event of ['hide','minimize','close'])win.on(event,()=>qqConsole?.retireOrphanPreviews?.());
    for(const event of ['hide','minimize'])win.on(event,()=>void qqCompanionLaunch?.closeCurrent().catch(()=>{}));
    // macOS: closing the window hides it even without a menu-bar icon; the app
    // stays in the Dock and `activate` shows the window again.
    win.on('close', e => { if (!quitting && (tray || hostLifecycle.closeHidesWindowWithoutTray)) { e.preventDefault();void closeVoice('window-hidden').catch(()=>{});win.hide(); } });
    win.on('hide',()=>void Promise.allSettled([closeImages(),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close()]));
    win.on('close',()=>desktopConversations.invalidate());
    win.webContents.on('render-process-gone',onChatRendererGone);
    win.webContents.on('render-process-gone',()=>void ssqqSession.closeCurrent().catch(()=>{}));
    win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)void ssqqSession.closeCurrent().catch(()=>{});});
    win.on('hide',clearQQDiagnosticCache);
    win.on('minimize',clearQQDiagnosticCache);
    win.on('minimize',()=>void Promise.allSettled([closeImages(),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close()]));
    for(const event of ['hide','minimize'])win.on(event,()=>void closeOwnerFriendSetup().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void selfProfilePanel.closeCurrent().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void avatarPanel.closeCurrent().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void groupProfileSession.closeCurrent().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void groupAdminSession.closeCurrent().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void contactAdminSession.closeCurrent().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void closePluginPanels().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void Promise.resolve(closeRemoteManagement()).catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void dismissPendingUpdate().catch(()=>{}));
    for(const event of ['hide','minimize'])win.on(event,()=>void dismissNodeRepair().catch(()=>{}));
    register('snapshot', fullSnapshot);
    register('appUpdateCheck', () => windowsUpdate.check());
    register('appUpdateStart', version => windowsUpdate.start(version));
    if (storeEdition) {
      register('appUpdateOpenStore', () => windowsUpdate.openStore());
      const {desktopVersion,releaseSource}=require('../service.json');
      const source=path.join(__dirname,'../source.zip');
      const available=async()=>releaseSource?.version&&releaseSource.version===desktopVersion&&
        (await fs.promises.stat(source).catch(()=>null))?.size===releaseSource.bytes;
      register('appReleaseSource',async()=>await available()?releaseSource:null);
      let savingSource=false;
      register('appReleaseSourceSave',async()=>{
        if(savingSource)return 'unavailable';
        savingSource=true;
        try{
          if(!await available())return 'unavailable';
          const chosen=await dialog.showSaveDialog(win,{
            defaultPath:'AgentArcade-Windows-'+desktopVersion+'-'+releaseSource.commit+'.zip',
            filters:[{name:'ZIP',extensions:['zip']}],properties:['dontAddToRecent'],
          });
          if(chosen.canceled||!chosen.filePath)return 'cancelled';
          await fs.promises.copyFile(source,chosen.filePath);
          return 'saved';
        }catch{return 'unavailable';}
        finally{savingSource=false;}
      });
    }
    registerDesktopChatHandlers();
    register('accountSelect', async id => {accounts.get(id);if(id!==accounts.selectedId){bot?.stopGroupWikiProposal?.();bot?.stopGroupReflection?.(undefined,{manualOnly:true});}qqConsole?.retireOrphanPreviews?.();clearQQDiagnosticCache();const closing=Promise.all([closeVoice('account-switch'),closeImages(),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels(),dismissPendingUpdate()]);bot=accounts.select(id);publish();await closing;return fullSnapshot();});
    register('accountRename', value => {accounts.rename(value?.id,value?.name);publish();});
    register('accountCreate', async name => {bot?.stopGroupWikiProposal?.();bot?.stopGroupReflection?.(undefined,{manualOnly:true});qqConsole?.retireOrphanPreviews?.();await Promise.all([closeVoice('account-switch'),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);bot=accounts.add({name});publish();return accounts.snapshot();});
    register('accountImport', async () => {
      qqConsole?.retireOrphanPreviews?.();
      const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择已有角色的数据文件夹（包含 bot-config.json）':'Choose an existing companion data folder',properties:['openDirectory']});
      if(picked.canceled)return null;
      await Promise.all([closeVoice('account-switch'),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);
      const selectedRoot=picked.filePaths[0],saved=readJSON(path.join(selectedRoot,'social-config.json'),{});
      bot=accounts.add({name:typeof saved.name==='string'&&saved.name.trim()?saved.name:'导入的搭档',root:selectedRoot});publish();return accounts.snapshot();
    });
    register('accountRemove', async id => {qqConsole?.retireOrphanPreviews?.();if(selfProfilePanel.session?.accountId===id)await selfProfilePanel.closeCurrent();if(avatarPanel.session?.accountId===id)await avatarPanel.closeCurrent();if(groupProfileSession.session?.accountId===id)await groupProfileSession.closeCurrent();if(groupAdminSession.session?.accountId===id)await groupAdminSession.closeCurrent();if(contactAdminSession.session?.accountId===id)await contactAdminSession.closeCurrent();await closePluginPanels({accountId:id});if(voiceAccount===id)await closeVoice('account-removed');if(voiceMediaPanel?.accountId===id)await closeQQVoices();if(ownerRemarkPanel.session?.accountId===id)await ownerRemarkPanel.closeCurrent();if(ownerHistorySession.session?.accountId===id)await ownerHistorySession.closeCurrent();if(friendRequestsPanel.panel?.accountId===id)await friendRequestsPanel.close();if(firstSetupPanel.panel?.accountId===id)await firstSetupPanel.close();const removingService=accounts.get(id);await removingService.localStop?.();if(accounts.get(id)!==removingService)throw Error('Companion changed during removal.');accounts.remove(id);voiceReceipts.delete(id);bot=accounts.current();publish();});
    const connectCompanion=id=>{
      const entry=accounts.snapshot().accounts.find(item=>item.id===id);
      if(entry?.channel==='qq'&&qqConsole?.busy.has('qq-setup'))throw Object.assign(Error('QQ setup is in progress.'),{code:'operation_in_progress'});
      const known=[entry?.accountId,entry?.expectedQQAccountId,entry?.qqBinding?.accountId].filter(Boolean);
      if(entry?.channel==='qq'&&(known.some(value=>qqStopping.has(value))||!known.length&&qqStopping.size))throw Object.assign(Error('A QQ account is stopping; wait before connecting an unverified profile'),{code:'operation_in_progress'});
      return accounts.connect(id);
    };
    register('accountConnect', async id => {if(typeof id!=='string')return connectQQIntent(id);await Promise.all([closeOwnerFriendSetup(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);return connectCompanion(id);});
    register('accountDisconnect', async id => {if(selfProfilePanel.session?.accountId===id)await selfProfilePanel.closeCurrent();if(avatarPanel.session?.accountId===id)await avatarPanel.closeCurrent();if(groupProfileSession.session?.accountId===id)await groupProfileSession.closeCurrent();if(groupAdminSession.session?.accountId===id)await groupAdminSession.closeCurrent();if(contactAdminSession.session?.accountId===id)await contactAdminSession.closeCurrent();await closePluginPanels({accountId:id});if(voiceAccount===id)await closeVoice('connection-ended');if(voiceMediaPanel?.accountId===id)await closeQQVoices();if(ownerRemarkPanel.session?.accountId===id)await ownerRemarkPanel.closeCurrent();if(ownerHistorySession.session?.accountId===id)await ownerHistorySession.closeCurrent();if(friendRequestsPanel.panel?.accountId===id)await friendRequestsPanel.close();return accounts.disconnect(id);});
    register('accountMigrateCredentials', accountMigrateCredentials);
    register('accountRetryCredentials', retryBotCredentials);
    register('accountResetCredentials', resetBotCredentials);
    const qqResult=async operation=>{try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:typeof error.code==='string'&&/^[a-z_]{1,48}$/.test(error.code)?error.code:'operation_failed'};}};
    const qqArguments=value=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accountId','refresh'].includes(key))||typeof value.accountId!=='string'||!/^\d{5,15}$/.test(value.accountId)||(value.refresh!==undefined&&typeof value.refresh!=='boolean'))throw Object.assign(Error('Invalid QQ action'),{code:'invalid_config'});return value;};
    register('qqImagePick',value=>qqResult(()=>pickQQImage(value)));
    register('qqImageSend',value=>qqResult(()=>sendQQImage(value)));
    register('qqImageDiscard',value=>qqResult(()=>discardQQImage(value)));
    register('qqImageClose',value=>qqResult(()=>closeOwnedImage(value)));
    register('qqVoicePick',value=>qqVoiceResult(()=>pickQQVoice(value)));
    register('qqVoiceAvailability',value=>qqVoiceResult(()=>qqVoiceAvailability(value)));
    register('qqVoiceRender',value=>qqVoiceResult(()=>renderQQVoice(value)));
    register('qqVoiceCancelRender',value=>qqVoiceResult(()=>cancelQQVoiceRender(value)));
    register('qqVoiceSend',value=>qqVoiceResult(()=>sendQQVoice(value)));
    register('qqVoiceDiscard',value=>qqVoiceResult(()=>discardQQVoice(value)));
    register('qqVoiceClose',value=>qqVoiceResult(()=>closeOwnedQQVoice(value)));
    register('qqOwnerRemarkAvailability',value=>ownerRemarkResult(()=>ownerRemarkPanel.availability(value)));
    register('qqOwnerRemarkRead',value=>ownerRemarkResult(()=>ownerRemarkPanel.read(value)));
    register('qqOwnerHistoryRead',value=>ownerHistoryResult(value,()=>ownerHistorySession.read(value)));
    register('qqOwnerHistoryClose',value=>ownerHistoryResult(value,()=>ownerHistorySession.closeOwned(value)));
    register('qqOwnerHistoryImagePage',value=>historyImageResult(value,()=>ownerHistorySession.imagePage(value)));
    register('qqOwnerHistoryImagePreview',value=>historyImageResult(value,()=>ownerHistorySession.imagePreview(value)));
    register('qqOwnerHistoryImageClose',value=>historyImageResult(value,()=>ownerHistorySession.imageClose(value)));
  register('qqOwnerHistoryOpen',value=>ownerHistoryResult(value,()=>ownerHistorySession.open(value)));
  register('qqOwnerHistorySend',value=>ownerComposerResult(value,()=>ownerHistorySession.send(value)));
  register('qqOwnerHistorySendQuery',value=>ownerComposerResult(value,()=>ownerHistorySession.querySend(value)));
    register('qqOwnerRemarkSet',value=>ownerRemarkResult(()=>ownerRemarkPanel.set(value)));
    register('qqOwnerRemarkRestore',value=>ownerRemarkResult(()=>ownerRemarkPanel.restore(value)));
    register('qqOwnerRemarkClose',value=>ownerRemarkResult(()=>ownerRemarkPanel.closeOwned(value)));
    register('qqFriendRequestsRead',value=>friendRequestsResult(()=>friendRequestsPanel.read(value)));
    register('qqFriendRequestsDecide',value=>friendRequestsResult(()=>friendRequestsPanel.decide(value)));
    register('qqFriendRequestsClose',value=>friendRequestsResult(()=>friendRequestsPanel.closeOwned(value)));
    registerOwnerFriendHandlers();
    registerSelfProfileHandlers();
    registerAvatarHandlers();
    registerGroupProfileHandlers();
    registerGroupAdminHandlers();
    registerContactAdminHandlers();
    registerPluginAdminHandlers();
    registerPluginConfigHandlers();
    registerQCEHandlers();
    registerPluginPackageHandlers();
    registerRemoteHandlers();
    register('qqRuntimeRefresh',()=>qqResult(async()=>({state:await qqConsole.refresh()})));
    register('qqComponents',value=>qqResult(()=>qqComponents.execute(value)));
    register('qqFirstSetup',value=>firstSetupResult(value));
    register('qqFirstSetupClose',value=>firstSetupResult(value,{close:true}));
    const prepareQQFriends=createQQFriendContactPreparation({accounts:()=>accounts,directory:(id,options)=>qqConsole.directory(id,options)});
    register('qqPrepareFriendContacts',value=>qqResult(()=>prepareQQFriends(value)));
    register('qqRuntimeDirectory',value=>qqResult(async()=>{const {accountId,...options}=validateDirectoryRequest(value);return {directory:await qqConsole.directory(accountId,options)};}));
    register('qqRuntimeBackups',value=>qqResult(()=>{const {accountId,...options}=validateBackupRequest('list',value);return qqConsole.listBackups(accountId,options);}));
    register('qqRuntimeBackupPreview',value=>qqResult(()=>{const {accountId,...options}=validateBackupRequest('preview',value);return qqConsole.previewBackup(accountId,options);}));
    register('qqRuntimeBackupRestore',value=>qqResult(async()=>{
      const {accountId,...options}=validateBackupRequest('restore',value);
      if(qqStopping.has(accountId))throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});
      const active=accounts.snapshot().accounts.some(item=>{
        const known=[item.accountId,item.expectedQQAccountId,item.qqBinding?.accountId].filter(Boolean);
        return item.channel==='qq'&&item.status!=='disconnected'&&(known.includes(accountId)||!known.length);
      });
      if(active)throw Object.assign(Error('Disconnect the companion before restoring its bridge'),{code:'account_connected'});
      // Also prevent an AI channel from connecting while its bridge changes.
      qqStopping.add(accountId);try{return await qqConsole.restoreBackup(accountId,options);}finally{qqStopping.delete(accountId);}
    }));
    register('qqRuntimeConfigure',value=>qqResult(async()=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accountId','serverName','port','create'].includes(key))||typeof value.accountId!=='string'||!/^\d{5,15}$/.test(value.accountId)||(value.serverName!==undefined&&typeof value.serverName!=='string')||(value.port!==undefined&&!Number.isInteger(value.port))||(value.create!==undefined&&typeof value.create!=='boolean'))throw Object.assign(Error('Invalid QQ configuration'),{code:'invalid_config'});
      const {accountId,...options}=value;return qqConsole.configure(accountId,options);
    }));
    register('qqRuntimeLink',value=>qqResult(async()=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accountId','companionId','ownerId','serverName'].includes(key))||typeof value.accountId!=='string'||!/^\d{5,15}$/.test(value.accountId)||typeof value.companionId!=='string'||typeof value.ownerId!=='string'||(value.serverName!==undefined&&typeof value.serverName!=='string'))throw Object.assign(Error('Invalid QQ connection'),{code:'invalid_config'});
      const service=accounts.services.get(value.companionId);if(!service)throw Object.assign(Error('Companion not found'),{code:'invalid_config'});
      const result=qqConsole.link(value.accountId,value,service);return {...result,companionId:value.companionId};
    }));
    register('qqRuntimeChoose',()=>qqResult(async()=>{
      await Promise.all([ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);
      const generation=qqConsole.epoch;
      const picked=await dialog.showOpenDialog(win,{title:config.language==='zh'?'选择 NapCat 数据目录（包含 components）':'Choose the NapCat data folder (containing components)',properties:['openDirectory']});
      if(picked.canceled)return {cancelled:true};
      if(generation!==qqConsole.epoch)throw Object.assign(Error('QQ manager changed'),{code:'changed'});
      return {state:await qqConsole.setDirectory(picked.filePaths[0])};
    }));
    for(const [name,kind]of [['qqRuntimeStart','start'],['qqRuntimeRecover','recover'],['qqRuntimeQR','qr'],['qqRuntimeQuickLogin','quick']])register(name,value=>qqResult(()=>qqConsole.perform(kind,qqArguments(value))));
    registerQQDiagnosticHandlers();
    register('qqRuntimeStop',value=>qqResult(async()=>{
      const args=qqArguments(value);if(qqStopping.has(args.accountId))throw Object.assign(Error('This QQ account is stopping'),{code:'operation_in_progress'});
      qqStopping.add(args.accountId);
      try{return await qqConsole.perform('stop',args,async()=>{
        await Promise.all([closeOwnerFriendSetup(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);
        const affected=accounts.snapshot().accounts.filter(item=>{
          const known=[item.accountId,item.expectedQQAccountId,item.qqBinding?.accountId].filter(Boolean);
          return item.channel==='qq'&&(known.includes(args.accountId)||!known.length&&['connecting','checking'].includes(item.status));
        });
        for(const item of affected){if(voiceAccount===item.id)await closeVoice('connection-ended');await accounts.disconnect(item.id);}
      });}finally{qqStopping.delete(args.accountId);}
    }));
    const qqOrphanResult=async(operation,accountId)=>{try{return {ok:true,...await operation()};}catch(error){const detail=error?.cleanupAttempted===true?orphanCleanupReceipt(error.cleanup,accountId):null;return {ok:false,code:orphanErrorCode(error),...(error?.cleanupAttempted===true?{cleanupAttempted:true,...(detail?{cleanup:detail}:{})}:{})};}};
    register('qqRuntimeOrphanPreview',value=>qqOrphanResult(async()=>{
      const {accountId}=validateOrphanRequest('preview',value);return {preview:await qqConsole.previewOrphanCleanup(accountId)};
    }));
    register('qqRuntimeOrphanDiscard',value=>qqOrphanResult(async()=>{
      const {accountId,expectedDigest}=validateOrphanRequest('discard',value);return qqConsole.discardOrphanPreview(accountId,{expectedDigest});
    }));
    register('qqRuntimeOrphanCleanup',value=>qqOrphanResult(async()=>{
      const {accountId,expectedDigest}=validateOrphanRequest('cleanup',value);
      if(qqStopping.has(accountId))throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});
      qqStopping.add(accountId);
      try{return await qqConsole.cleanupOrphans(accountId,{expectedDigest},async()=>{
        // This hook runs only after runtime proof/digest validation and before
        // any stop. The runtime rechecks its proof after these awaits.
        const affected=accounts.snapshot().accounts.filter(item=>{
          const known=[item.accountId,item.expectedQQAccountId,item.qqBinding?.accountId].filter(Boolean);
          return item.channel==='qq'&&item.status!=='disconnected'&&(known.includes(accountId)||!known.length);
        }).map(item=>({id:item.id,service:accounts.services.get(item.id)}));
        for(const item of affected){
          if(!item.service||accounts.services.get(item.id)!==item.service)throw Object.assign(Error('QQ companion changed'),{code:'changed'});
          if(voiceAccount===item.id)await closeVoice('connection-ended');
          if(accounts.services.get(item.id)!==item.service)throw Object.assign(Error('QQ companion changed'),{code:'changed'});
          await accounts.disconnect(item.id);
          if(accounts.services.get(item.id)!==item.service||item.service.status!=='disconnected')throw Object.assign(Error('QQ companion is still active'),{code:'account_connected'});
        }
      });}finally{qqStopping.delete(accountId);}
    },typeof value?.accountId==='string'?value.accountId:undefined));
    const providerLogin=createProviderLogin();
    register('useExistingClaude', async scope => {
      const fields=['profileId','expectedMode','expectedChannel'];
      const {service}=recoveryRequest(scope,fields);
      const revision=accounts.selectionRevision;
      if(service.status!=='disconnected')throw Error('Disconnect before changing the AI login.');
      const login=await providerLogin.status('claude');
      if(recoveryRequest(scope,fields).service!==service||accounts.selectionRevision!==revision||service.status!=='disconnected')throw Error('Conversation changed.');
      if(login.state!=='signed_in'||login.code)return {ok:false,code:login.code||login.state};
      if(service.config.mode!=='claude')configureBot({...scope,mode:'claude'});
      return {ok:true};
    });
    register('providerLogin', provider => {
      if(bot.status!=='disconnected')throw Error('Disconnect before changing the AI login.');
      return providerLogin.login(provider);
    });
    register('providerGuide', async provider => {
      const links={claude:'https://code.claude.com/docs/en/setup',codex:'https://developers.openai.com/codex/cli',
        'cloudflare-workers-ai':'https://dash.cloudflare.com/?to=%2F%3Aaccount%2Fai%2Fworkers-ai',
        'claude-api':'https://platform.claude.com/settings/keys',gpt:'https://platform.openai.com/api-keys',deepseek:'https://platform.deepseek.com/api_keys',gemini:'https://aistudio.google.com/apikey',doubao:'https://console.volcengine.com/ark/'};
      if(typeof provider!=='string'||!Object.hasOwn(links,provider))throw Error('Choose an available AI provider.');
      await shell.openExternal(links[provider]);return {opened:true};
    });
    register('botConfigure', configureBot);
    register('botGroupDrawingSettings',async value=>{
      if(!value?.profileId||typeof value.expectedMode!=='string'||value.expectedChannel!=='qq')throw imageError('invalid_request');
      const {service,patch}=credentialRequest(value),{operation,...request}=patch;
      if(operation==='view'||operation==='save'){
        return service.groupDrawing.settings(request,operation==='save',accounts.selectionRevision);
      }
      if(operation==='configureProvider'){
        const {revision,provider,cloudflareAccountId,apiToken,key,...scope}=request;
        return stickerResult(()=>{
          const current=service.groupDrawing.settings(scope,false,accounts.selectionRevision);
          if(revision!==current.revision||accounts.credentialMigrations.has(value.profileId))
            throw Object.assign(Error('Group drawing scope changed.'),{code:'changed'});
          if(provider==='cloudflare'&&key===undefined){
            service.configureCloudflareImageCredentials({accountId:cloudflareAccountId,apiToken});
          }else if(provider==='openai'&&cloudflareAccountId===undefined&&apiToken===undefined){
            service.configureStickerImageKey(key,{replace:service.stickerGenerationReady('openai'),expectedVault:service.vaultFingerprint});
          }else throw Object.assign(Error('Invalid image service.'),{code:'invalid_request'});
          return service.groupDrawing.settings(scope,false,accounts.selectionRevision);
        });
      }
      throw imageError('invalid_request');
    });
    register('botGroupCodexDraft',async value=>{
      if(!value?.profileId||typeof value.expectedMode!=='string'||value.expectedChannel!=='qq')throw imageError('invalid_request');
      const {service,patch}=credentialRequest(value),{action,draft,revision,...scope}=patch;
      if(!['open','copy'].includes(action)||typeof draft!=='string'||draft.length>500||!draft.isWellFormed()||
         typeof revision!=='string'||!revision)throw imageError('invalid_request');
      const scene=draft.replace(/\r\n/g,'\n').trim();
      if(!scene||/(?!\n)[\p{Cc}\p{Cf}]/u.test(scene))throw imageError('invalid_request');
      if(!win?.isVisible()||win.isMinimized()||service.groupDrawing.settings(scope,false,accounts.selectionRevision).revision!==revision)
        throw imageError('changed');
      const prompt='$imagegen\n请按下面的画面描述生成一张静态 PNG 图片。\n'+scene;
      try{
        if(action==='copy'){clipboard.writeText(prompt);return {outcome:'copied'};}
        const composer='codex://threads/new',url=composer+'?prompt='+encodeURIComponent(prompt);
        // Electron caps external URLs at 2081 characters on Windows.
        if((hostGate.platform==='win32'&&url.length>2081)||!app.getApplicationNameForProtocol(composer))return {outcome:'unavailable'};
        await shell.openExternal(url);
        return {outcome:'dispatched'};
      }catch{return {outcome:'unavailable'};}
    });
    register('botGroupNamedStickerList',value=>readQQStickerLibrary(value,'group'));
    register('botGroupNamedStickerPreview',value=>readQQStickerLibrary(value,'group',true));
    register('botOwnerNamedStickerList',value=>readQQStickerLibrary(value,'owner'));
    register('botOwnerNamedStickerPreview',value=>readQQStickerLibrary(value,'owner',true));
    register('botCharacterVoice',async value=>{
      const {service,patch}=credentialRequest(value);
      if(!value.profileId||!value.expectedMode||value.expectedChannel!=='qq')throw qqVoiceError('changed');
      const revision=accounts.selectionRevision;
      const assertSelected=()=>{
        if(accounts.selectionRevision!==revision||credentialRequest(value).service!==service)throw qqVoiceError('changed');
      };
      return Object.hasOwn(patch,'groupId')?characterVoices.handleGroup(patch,service,assertSelected,revision):
        characterVoices.handle(patch,service,assertSelected);
    });
    register('botOwnerSelectedStickerPreview',value=>selectedQQImagePreview(value,'owner'));
    register('botGroupCardImagePreview',value=>selectedQQImagePreview(value,'group'));
    const memberships=onlineGroupMembership({resolve:recoveryRequest,selectionRevision:()=>accounts.selectionRevision});
    register('botGroupMembershipDirectory',memberships.directory);
    register('botGroupMembershipSet',memberships.set);
    register('botGroupPolicySet',value=>{
      const {service,patch}=recoveryRequest(value,['profileId','expectedMode','expectedChannel','expectedAccountId','previous','policy']);
      if(value.expectedChannel!=='qq')throw Error('Invalid QQ group settings.');
      return service.setOnlineGroupPolicy(patch);
    });
    register('groupRolePreview',value=>groupRoleRequest(value,false));
    register('groupRoleSet',value=>groupRoleRequest(value,true));
    register('groupCardTargets',value=>groupCardAssignments.targets(value));
    register('groupCardPreview',value=>groupCardAssignments.preview(value));
    register('groupCardApply',value=>groupCardAssignments.apply(value));
    register('groupLorebookPreview',value=>groupLorebookRequest(value,false));
    register('groupLorebookSet',value=>groupLorebookRequest(value,true));
    register('groupWiki',value=>groupKnowledgeRequest(value,'wiki',groupWikiActions,'groupWikiRequest'));
    register('groupReflection',value=>groupKnowledgeRequest(value,'reflection',groupReflectionActions,'groupReflectionRequest'));
    register('groupOutputFormat',value=>groupKnowledgeRequest(value,'output_format',groupOutputFormatActions,'groupOutputFormatRequest'));
    register('groupSpeakerDispatch',groupSpeakerDispatchRequest);
    register('groupGenerationPreset',value=>groupGenerationRequest(value,false));
    register('groupGenerationSet',value=>groupGenerationRequest(value,true));
    register('groupFeedSet',value=>groupSourceRequest(value,'groupFeedSet'));
    register('groupCalendarSet',value=>groupSourceRequest(value,'groupCalendarSet'));
    register('groupFolderSet',value=>groupSourceRequest(value,'groupFolderSet'));
    register('groupPageSet',value=>groupSourceRequest(value,'groupPageSet'));
    register('socialConfigure', value => bot.socialConfigure(value));
    register('socialContactConfigure', value => {
      if(!value||value.profileId!==accounts.selectedId)throw Object.assign(Error('搭档已切换，请重新查看联系设置。'),{code:'changed'});
      return bot.socialContactConfigure(value);
    });
    register('socialPause', () => bot.socialPause());
    register('socialConsider', () => bot.socialConsider());
    register('socialForget', () => bot.socialForget());
    register('socialEdit', value => bot.socialEdit(value));
    register('socialDraft', () => bot.socialDraft());
    register('socialPublish', id => bot.socialPublish(id));
    register('characterImport', async () => {
      const fallbackCharacterId=bot.socialStore.config().characterId;
      const picked=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Character card JSON',extensions:['json']}]});if(picked.canceled)return null;
      const file=picked.filePaths[0];if(fs.statSync(file).size>characterCards.MAX_BYTES)throw Error('Character card is too large.');return characterCards.parseCard(fs.readFileSync(file),{fallbackCharacterId});
    });
    register('characterApply', card => bot.socialConfigure(characterCards.cardToSettings(characterCards.validateCard(card))));
    register('characterExport', async () => {
      const card=characterCards.cardFromSettings(bot.socialStore.config());
      const picked=await dialog.showSaveDialog(win,{defaultPath:'companion-card.json',filters:[{name:'Agent Arcade character JSON',extensions:['json']}]});if(picked.canceled)return {saved:false};
      fs.writeFileSync(picked.filePath,characterCards.serializeCard(card),'utf8');return {saved:true,path:picked.filePath};
    });
    register('voiceCapabilities', checkVoiceCapabilities);
    register('voiceStart', startVoice);
    register('voiceFinish', finishVoice);
    register('voiceConfirm', confirmVoice);
    register('voiceInterrupt', interruptVoice);
    register('voiceClose', closeOwnedVoice);
    register('botQQPrepare', () => bot.prepareQQ());
    register('botQQMacInspect',value=>macQQSetup.inspect(value));
    register('botQQMacPrepare',value=>macQQSetup.prepare(value));
    register('botQQMacUsePrepared',value=>hostGate.platform==='darwin'&&process.arch==='arm64'
      ?macQQSetup.usePrepared(value):{ok:false,code:'unsupported_platform'});
    for(const [suffix,action] of [['Status','launchStatus'],['Reveal','launchReveal'],['Copy','launchCopy'],['Relink','launchRelink'],['Auth','launchAuth']]){
      register('botQQMacLaunch'+suffix,value=>hostGate.platform==='darwin'&&process.arch==='arm64'
        ?macQQSetup[action](value):{ok:false,code:'unsupported_platform'});
    }
    register('botQQMacOpenRelease',()=>{
      if(hostGate.platform!=='darwin')return {ok:false,code:'unsupported_platform'};
      return qqResult(()=>macQQSetup.guide());
    });
    register('botQQCopyConfig', async () => {
      if(hostGate.platform==='darwin')throw macQQSetupError('unsupported_platform');
      await clipboard.writeText(bot.qqSetupConfig());return {copied:true};
    });
    register('botQQCopyToken', async () => {
      if(hostGate.platform==='darwin')throw macQQSetupError('unsupported_platform');
      await clipboard.writeText(bot.qqSetupToken());return {copied:true};
    });
    register('botQQTest', () => bot.testQQ());
    register('botQQSetupGroups',value=>qqResult(()=>readQQSetupGroups(value)));
    register('botQQOpenGuide', async kind => {await shell.openExternal(qqGuide(kind));});
    register('botProject', async () => {
      const picked=await dialog.showOpenDialog(win,{properties:['openDirectory']});
      if(!picked.canceled)bot.configure({workspace:picked.filePaths[0]});
      return bot.snapshot();
    });
    register('botLogin', () => {const selectedBot=bot;selectedBot.assertCredentialsAvailable();if(selectedBot.status!=='pairing')void selectedBot.login().catch(()=>{selectedBot.problem='WeChat pairing could not start. Check the selected channel and credentials.';publish();});return selectedBot.snapshot();});
    register('botConnect', async () => {const id=accounts.selectedId;await Promise.all([closeOwnerFriendSetup(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);if(accounts.selectedId!==id)throw ownerFriendError('changed');return connectCompanion(id);});
    register('botDisconnect', async () => {const selectedBot=bot,id=accounts.selectedId;if(voiceAccount===id)await closeVoice('connection-ended');if(voiceMediaPanel?.accountId===id)await closeQQVoices();await Promise.all([ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),selfProfilePanel.closeCurrent(),avatarPanel.closeCurrent(),groupProfileSession.closeCurrent(),groupAdminSession.closeCurrent(),contactAdminSession.closeCurrent(),closePluginPanels()]);await selectedBot.disconnect();return selectedBot.snapshot();});
    register('botNativeStart', value => {if(value!==undefined&&(!value||typeof value!=='object'||Object.keys(value).some(key=>key!=='resume')||typeof value.resume!=='boolean'))throw Error('Invalid native start request.');return bot.startNative(value);});
    register('botNativeStop', async () => {await bot.stopNative();return bot.snapshot();});
    register('botForget', forgetBotCredentials);
    register('botCopyNative', () => {const command=bot.snapshot().native?.command;if(!command)throw Error('Connect local mode first.');clipboard.writeText(command);});
    register('copyText', text => {if(typeof text!=='string'||text.length>32000)throw Error('Reply is too large to copy.');clipboard.writeText(text);});
    register('workChooseFolder', async () => {
      const picked=await dialog.showOpenDialog(win,{properties:['openDirectory']});
      if(!picked.canceled)workbench.choose(picked.filePaths[0]);return workbench.snapshot();
    });
    register('workRefresh', () => workbench.refresh());
    register('workObserve', enabled => workbench.observe(enabled));
    register('backgroundCreate', prompt => workbench.create(prompt));
    register('backgroundStop', id => workbench.change(id,'stop'));
    register('backgroundResume', id => workbench.change(id,'resume'));
    register('inspectArtifact', async () => {
      const picked=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'UTF-8 text',extensions:['txt','md','json','csv','log','yaml','yml','js','ts','css','html']}]});
      if(!picked.canceled)return workbench.inspectFile(picked.filePaths[0]);
    });
    register('inspectSample', () => workbench.sample());
    register('inspectionCancel', id => workbench.cancel(id));
    register('inspectionResult', id => workbench.result(id));
    register('resultApp', () => workbench.resource());
    registerSourceHandlers();
    registerCharacterHandlers();
    registerLorebookHandlers();
    registerSTHandlers();
    registerTaskBoardHandlers();
    sources.load();
    register('acknowledge', id => { if (typeof id === 'string') live.acknowledge(id); atomicJSON(path.join(root,'state.json'),live.export()); publish(); });
    register('clear', () => { live.clearFinished(); atomicJSON(path.join(root,'state.json'),live.export()); publish(); });
    register('desktopPetSet',value=>{
      if(!pets||quitting)throw Error('Desktop pets are unavailable.');
      const {id,enabled}=validatePetToggle(value),old=config.desktopPets;
      config.desktopPets=enabled?enabledPets([...old,id]):old.filter(item=>item!==id);
      try{saveConfig();}catch(error){config.desktopPets=old;throw error;}
      publish();return snapshot();
    });
    register('config', patch => {
      if (!patch || typeof patch !== 'object') throw Error('Invalid settings');
      if((Object.hasOwn(patch,'character')||Object.hasOwn(patch,'personaVoice'))&&bot.status!=='disconnected')throw Error('Disconnect before changing the character or conversation style.');
      if(Object.hasOwn(patch,'appearance')&&!validAppearance(patch.appearance))throw Error('Invalid appearance mode');
      if(Object.hasOwn(patch,'sendShortcut')&&!validSendShortcut(patch.sendShortcut))throw Error('Invalid send shortcut');
      const oldCompact = config.compact;
      const next = {...config};
      for (const k of ['notifications','quiet','captureResults','alwaysOnTop','compact','personaVoice']) if (typeof patch[k] === 'boolean') next[k] = patch[k];
      if(['default','sprout'].includes(patch.character))next.character=patch.character;
      if(Object.hasOwn(patch,'appearance'))next.appearance=patch.appearance;
      if (['en','zh'].includes(patch.language)) next.language = patch.language;
      if (['anime','pixel'].includes(patch.portrait)) next.portrait = patch.portrait;
      if (['immersive','messenger','minimal'].includes(patch.layout)) next.layout = patch.layout;
      if (['companion','work'].includes(patch.workspace)) next.workspace = patch.workspace;
      if (Object.hasOwn(patch,'accent')) { if (patch.accent !== 'auto' && !(typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent))) throw Error('Invalid accent colour'); next.accent = patch.accent.toLowerCase(); }
      if (themes.has(patch.theme)) next.theme = patch.theme;
      if(Object.hasOwn(patch,'sendShortcut'))next.sendShortcut=patch.sendShortcut;

      const cleared = patch.captureResults === false ? live.export() : null;
      if (cleared) cleared.tasks = cleared.tasks.map(task => ({...task, result: ''}));
      // Electron delivers a rejected invoke's message across the renderer boundary.
      // These outcomes apply only to writes known to have failed before committing.
      function rejectedWrite(cause) {
        if (['EPERM','EACCES','EBUSY','EROFS'].includes(cause.code)) return new Error('SETTINGS_WRITE_BLOCKED', {cause});
        if (cause.code === 'ENOSPC') return new Error('SETTINGS_DISK_FULL', {cause});
        return new Error('SETTINGS_WRITE_FAILED', {cause});
      }
      try { saveConfig(next); }
      catch (error) { throw rejectedWrite(error); }
      if (cleared) {
        try { atomicJSON(path.join(root, 'state.json'), cleared); }
        catch (error) {
          // The task text is still intact. Restore the previously active preferences.
          try { saveConfig(); }
          catch (restoreError) { throw new AggregateError([error, restoreError], 'SETTINGS_SAVE_UNCONFIRMED'); }
          throw rejectedWrite(error);
        }
        for (const task of live.tasks.values()) task.result = '';
      }
      Object.assign(config, next);
      appearanceController?.refresh(); win.setAlwaysOnTop(config.alwaysOnTop); if (oldCompact !== config.compact) applyWindow(); publish(); return snapshot();
    });
    register('install', async () => {
      // Windows resolves `node` from the user's PATH. A macOS or Linux desktop app
      // can lack that PATH, so the usual install locations are searched too.
      const nodeCommand = hostGate.platform === 'win32' ? 'node' : hostPlatform.findExecutable('node', {platform:hostGate.platform}) || 'node';
      const { stdout } = await promisify(execFile)(nodeCommand, ['-p','process.execPath'], { timeout:5000, windowsHide:true });
      const nodePath = stdout.trim();
      if (!path.isAbsolute(nodePath)) throw Error('Install Node.js 22 or newer, then restart Agent Arcade.');
      const result = integration.install({ settingsFile, root, sourceDir:__dirname, nodePath }); publish(); return result;
    });
    register('uninstall', () => { integration.uninstall(settingsFile); publish(); });
    register('importTheme', async () => {
      const picked = await dialog.showOpenDialog(win, { properties:['openFile'], filters:[{name:'Arcade theme', extensions:['json']}] });
      if (picked.canceled) return;
      const file = picked.filePaths[0]; if (fs.statSync(file).size > 32000) throw Error('Theme must be under 32 KB.');
      const theme = validateTheme(JSON.parse(fs.readFileSync(file,'utf8')));
      atomicJSON(path.join(root,'theme.json'),theme); themes.set('custom',theme); config.theme = 'custom'; saveConfig(); publish();
    });
    try {
      if (storeEdition || trayIcon.isEmpty()) throw Error('Tray icon is empty');
      tray = new Tray(trayIcon);
      tray.setToolTip('Agent Arcade'); tray.on('click',show);
      tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Agent Arcade',click:show},{label:'Quit',click:()=>{quitting=true;app.quit();}}]));
    } catch { tray = null; }
    petWindow=new PetWindow({electron:{BrowserWindow,screen:require('electron').screen,Menu,ipcMain},getSettings:()=>config.desktopPet,saveSettings:next=>{config.desktopPet=normalizePet(next);saveConfig();publish();},onOpen:show,onTouch:kind=>petPresence.touched('window',kind),language:()=>config.language});
    petPresence.attach('window',petWindow);
    robotPreview=new RobotPreview({electron:{BrowserWindow,ipcMain},getPresence:()=>{syncPet();return petPresence.snapshot();},onTouch:kind=>petPresence.touched('robot',kind),onChange:()=>publish(),language:()=>config.language});
    petPresence.attach('robot',robotPreview);
    const pairingFile=path.join(root,'robot-pairing.json');
    robotDeviceBody=new RobotDeviceBody({
      electron:{BrowserWindow,ipcMain},getPresence:()=>{syncPet();return petPresence.snapshot();},
      onTouch:kind=>petPresence.touched('robot-device',kind),language:()=>config.language,
    });
    petPresence.attach('robot-device',robotDeviceBody);
    robotConnection=new RobotConnection({
      openDisplay:options=>robotDeviceBody.open(options),
      loadRemembered:()=>readJSON(pairingFile,null),saveRemembered:record=>atomicJSON(pairingFile,record),
      onChange:()=>publish(),
    });
    robotConnection.start();
    win.on('focus',clearPetAttention);
    registerPetHandlers();
    petWindow.apply();
    appearanceController=new AppearanceController({nativeTheme,preference:()=>config.appearance,onChange:state=>{
      if(win&&!win.isDestroyed())win.setBackgroundColor(appearanceBackground(state.colorScheme));
      publish();
    }});
    appearanceController.refresh();
    applyWindow(); win.loadURL(indexURL);
    // Reading saved plans is local-only. No account or plugin is started here.
    if(managedQQ&&fs.existsSync(path.join(root,'qq-qce-schedules','qce-schedules.sqlite')))startQCEScheduleTimer();
    bus.subscribe({source:'claude-code',kind:'session.'},({change:c}) => {
      if (!gate.allow(c,{enabled:config.notifications,quiet:config.quiet,focused:win.isFocused() && win.isVisible()}) || !Notification.isSupported()) return;
      const zh = config.language === 'zh';
      const labels = zh ? {waiting:'需要你确认',error:'检测到错误',done:'回复结束 · 任务结果尚未验证'} : {waiting:'Needs your attention',error:'Error observed',done:'Response ended · outcome unverified'};
      const n = new Notification({title:`Agent Arcade · ${c.task.project}`,body:labels[c.task.state],silent:true});
      n.on('click',show); n.show();
    });
    let lastGroupReflectionCheck=0;
    const pollEvents = () => {
      // The macOS menu follows the interface language (no-op elsewhere).
      if(applicationMenuLanguage!==null&&applicationMenuLanguage!==config.language)installApplicationMenu();
      workbench.tick();
      taskBoard?.tick();
      bot?.reflectionTick?.(Date.now());
      sources.tick();
      bot?.companionNoticeTick?.({
        sourceEnabled:id=>sources.snapshot().some(source=>source.id===id&&source.enabled&&['companion','both'].includes(source.notify)),
        noticeCurrent:row=>row.kind!=='calendar.upcoming'||sources.ownerCalendarCurrent(row.source,row.id),
        onAppMessage:info=>{desktopChat.localNotice(info.service);publish();},
      });
      for(const service of accounts?.services?.values()||[])void service.groupFeedTick?.();
      const now=Date.now();
      if(!quitting&&(now<lastGroupReflectionCheck||now-lastGroupReflectionCheck>=60000)){
        lastGroupReflectionCheck=now;
        const services=[...(accounts?.services??[])];
        if(!services.some(([,service])=>service.groupReflectionRun)){
          for(const [id,service] of services){
            if(service.groupReflectionTick?.(now,()=>accounts?.services.get(id)===service&&!quitting))break;
          }
        }
      }
      try {
        const changes = drainInbox(root,live,{captureResults:config.captureResults}); problem = quitProblem;
        // A later SessionEnd in this batch can mask the Stop carrying the handback.
        for (const change of changes) taskBoard?.observeHandback(change);
        for (const change of coalesceChanges(changes)) bus.publish({source:'claude-code',kind:'session.'+change.task.state,change});
      } catch (error) { problem = `Event inbox: ${error.message}`; }
      publish();
    };
    // A Quit whose cleanup could not be confirmed leaves the app open; it
    // must keep observing sessions until the retry.
    restartEventPoll = () => { clearInterval(timer); timer = setInterval(pollEvents,1000); };
    restartEventPoll();
  }).catch(error => { dialog.showErrorBox('Agent Arcade',error.message); app.quit(); });
}
const windowsUpdate=storeEdition ? createStoreUpdate({
  version:appVersion,
  enabled:process.platform==='win32' && require('../service.json').mode==='store',
  getWindow:()=>win,
  isClosing:()=>quitting,
  openExternal:uri=>shell.openExternal(uri),
  loadNative:()=>require('../store-update.node'),
  notify:value=>{if(win&&!win.isDestroyed())win.webContents.send('arcade:appUpdate',value);},
}) : createWindowsUpdate({
  version:appVersion,
  binding:process.platform==='win32'&&app.isPackaged ? dailyUpdateBinding(process.env.AGENT_ARCADE_WINDOWS_UPDATE,process.argv) : null,
  identity:()=>({pid:process.pid, profile:app.getPath('userData'), home:root, language:config.language}),
  isClosing:()=>quitting,
  quit:()=>app.quit(),
  notify:value=>{if(win&&!win.isDestroyed())win.webContents.send('arcade:appUpdate',value);},
  confirm:async target=>{
    const zh=config.language==='zh', rc=target.split('.').at(-1);
    const {response}=await dialog.showMessageBox(win,{
      type:'question',title:'Agent Arcade', message:zh?'更新到 RC'+rc+'？':'Update to RC'+rc+'?',
      detail:zh?'应用会正常退出，再用同一档案打开新版。请先保存需要保留的未发送草稿。':'The app will quit normally and reopen the same profile. Save any unsent drafts you want to keep.',
      buttons:zh?['继续使用','更新并重启']:['Keep working','Update and restart'],
      defaultId:0,cancelId:0,noLink:true,
    });
    return response===1;
  },
});

app.on('before-quit', event => {
  closeDesktopReplyNotification();
  pets?.close();
  clearQQDiagnosticCache();
  quitting = true; quitProblem = ''; clearInterval(timer);sources.close();desktopConversations.close();desktopChat.closeCurrent();
  if(cleanedUp)return;
  event.preventDefault();if(shutdownTask)return;
  shutdownTask=(async()=>{
    // Panel and remote access end in the Quit tick itself, before any awaited
    // cleanup, so no pending preview can be acted on while the app is closing.
    const panelsClose=Promise.allSettled([ownerRemarkPanel.close(),ownerHistorySession.close(),friendRequestsPanel.close(),firstSetupPanel.close(),closeOwnerFriendSetup({permanent:true}),selfProfilePanel.close(),avatarPanel.close(),groupProfileSession.close(),groupAdminSession.close(),contactAdminSession.close(),closePluginPanels({permanent:true})]);
    const remoteClosing=Promise.resolve().then(()=>closeRemoteManagement({permanent:true}));remoteClosing.catch(()=>{});
    if(qqCompanionLaunch&&(await qqCompanionLaunch.close())?.closed!==true)throw Object.assign(Error('QQ launch cleanup unconfirmed.'),{code:'qq_launch_cleanup_unconfirmed'});
    if((await ssqqSession.close())?.closed!==true)throw Object.assign(Error('QQ client view cleanup unconfirmed.'),{code:'ssqq_cleanup_unconfirmed'});
    const [,remoteClose,componentsClose]=await Promise.allSettled([
      Promise.allSettled([closeVoice(),closeImages(),closeQQVoices(),accounts?.close(),workbench?.close(),panelsClose]),
      remoteClosing,
      Promise.resolve().then(()=>qqComponents?qqComponents.close():{closed:true}),
    ]);
    try{await qqConsole?.close();}catch{/* Preserve the QQ recovery record. */}
    // AccountManager retains failed local close ownership. Its older allSettled
    // contract is not proof that the independent conversation has actually closed.
    try{for(const service of accounts?.services?.values()||[])service.assertLocalStopped?.();}
    catch{throw Object.assign(Error('Local conversation cleanup unconfirmed.'),{code:'local_cleanup_unconfirmed'});}
    // Do not discard the only proof/cleanup reference to a resident Python
    // process after a failed close. A second Quit retries this exact ownership.
    await asrGate.retryCleanup();const result=await asrGate.close();
    if(result?.closed!==true)throw Error('ASR exit unconfirmed.');
    if(componentsClose.status==='rejected'||componentsClose.value?.closed!==true){
      throw Object.assign(Error('QQ component operation cleanup is unconfirmed.'),{code:'node_repair_cleanup_unconfirmed'});
    }
    if(remoteClose.status==='rejected'||remotePanel&&remoteClose.value?.closed!==true){
      const cause=remoteClose.status==='rejected'?remoteClose.reason?.code:null;
      const code=cause==='file_cleanup_unconfirmed'?'remote_file_cleanup_unconfirmed':cause==='passkey_unavailable'?'remote_helper_exit_unconfirmed':'remote_cleanup_unconfirmed';
      throw Object.assign(Error('Remote cleanup unconfirmed.'),{code});
    }
    try{qqStopTrace?.close();}catch{/* Optional diagnostics do not own workers. */}
    // Native macOS menu Emit drains Promise callbacks before the cancelled
    // Browser::Quit call has returned. Re-entering Quit in that checkpoint lets
    // its outer cancellation overwrite the resumed quit flag. Cross a complete
    // event-loop turn after confirmed cleanup; keep repeated Quit requests on
    // this same shutdownTask until that barrier has passed.
    await new Promise(resolve=>require('node:timers').setImmediate(resolve));
    await windowsUpdate.commit();
    cleanedUp=true;app.quit();
  })().catch(error=>{
    quitting=false;
    pets?.reopen();
    problem=error?.code==='qq_launch_cleanup_unconfirmed'
      ?(config.language==='zh'?'QQ 启动操作尚未结束。请再次选择“退出”重试。':'The QQ startup operation has not settled. Choose Quit again to retry.')
      :error?.code==='local_drawing_cleanup_unconfirmed'
      ?(config.language==='zh'?'本轮启动的 ComfyUI 尚未确认退出。请再次选择“退出”重试。':'The ComfyUI started by this app has not confirmed exit. Choose Quit again to retry.')
      :error?.code==='local_cleanup_unconfirmed'
      ?(config.language==='zh'?'App 对话尚未完全停止。请再次选择“退出”重试；应用保留了这次对话的清理记录。':'The App conversation has not fully stopped. Choose Quit again to retry; the app retained its cleanup record.')
      :error?.code==='node_repair_cleanup_unconfirmed'
      ?(config.language==='zh'?'QQ 组件操作的清理尚未确认。请再次选择“退出”重试；应用保留了这次操作的清理记录。':'QQ component operation cleanup is unconfirmed. Choose Quit again to retry; the app has retained its cleanup record.')
      :error?.code==='remote_file_cleanup_unconfirmed'
      ?(config.language==='zh'?'远程文件操作或本机临时文件的清理尚未确认。请再次选择“退出”重试；应用保留了这次操作的清理记录。':'Cleanup of a remote file operation or its local temporary files is unconfirmed. Choose Quit again to retry; the app has retained its cleanup record.')
      :error?.code==='remote_cleanup_unconfirmed'
      ?(config.language==='zh'?'远程管理的清理尚未确认。请再次选择“退出”重试；应用保留了这次操作的清理记录。':'Remote management cleanup is unconfirmed. Choose Quit again to retry; the app has retained its cleanup record.')
      :error?.code==='remote_helper_exit_unconfirmed'
      ?(config.language==='zh'?'无法确认通行密钥验证助手已退出。请再次选择“退出”重试；应用保留了这次进程的清理记录。':'Passkey helper exit is unconfirmed. Choose Quit again to retry; the app has retained its cleanup record.')
      :(config.language==='zh'?'无法确认本机语音进程已退出。请再次选择“退出”重试；应用保留了这次进程的清理记录。':'Local speech process exit is unconfirmed. Choose Quit again to retry; the app has retained its cleanup record.');
    windowsUpdate.failed();
    quitProblem=problem;restartEventPoll();
    if(win&&!win.isDestroyed()){win.show();win.focus();publish();}
  }).finally(()=>{shutdownTask=null;});
});
app.on('will-quit',()=>appearanceController?.close());
// Windows and Linux quit with their last window. macOS keeps the application in
// the Dock; clicking it (`activate`) shows the hidden window again.
app.on('window-all-closed', () => { if (hostPlatform.lifecycle({platform:process.platform}).quitWhenAllWindowsClosed) app.quit(); });
app.on('activate', () => { if (hostPlatform.lifecycle({platform:process.platform}).showWindowOnActivate && win && !win.isDestroyed()) show(); });
