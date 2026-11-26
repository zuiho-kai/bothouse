'use strict';
// A migration worker uses the original Electron profile, has no application
// window and must bypass the desktop guard without loading ordinary services.
if(process.argv.includes('--arcade-vault-migration-worker')){
  module.exports=require('./bot/vault-migration-worker.cjs').run();
}else{
  const credentialCommand=process.argv.includes('--arcade-credential-authorize-worker')||process.argv.includes('--arcade-credential-self-test');
  if(!credentialCommand)require('./core/desktop-stdio.cjs').guardDesktopOutput();
  const {app,BrowserWindow,dialog}=require('electron');
  // Older launchers may request sample mode with a live profile. Never open that profile as a live session.
  if(process.argv.includes('--demo')){
    app.exit(0);
  }else if(app.isPackaged&&process.platform==='darwin'&&!require('./core/credential-startup-policy.cjs').credentialStartupAllowed(process.argv)){
    app.exit(1);
  }else if(credentialCommand){
    module.exports=require('./core/mac-credential-command.cjs').runCredentialCommand({mode:process.argv.includes('--arcade-credential-authorize-worker')?'authorize':'self-test'});
  }else{
  require('./core/app-identity.cjs').configureAppIdentity(app);
  const {acquireSingleInstance}=require('./core/single-instance.cjs');
  const namespace=require('../package.json').storeEdition
    ? 'agent-arcade-store-'+require('node:crypto').createHash('sha256').update(app.getPath('userData').toLowerCase()).digest('hex').slice(0,24)
    : undefined;
  let guard,pendingRaise=false,quitting=false;
  function flushRaise(){
    if(!pendingRaise||quitting||!app.isReady())return;
    const window=BrowserWindow.getAllWindows().find(item=>!item.isDestroyed());
    if(!window)return;
    pendingRaise=false;
    if(window.isMinimized())window.restore();
    // main.cjs already owns showing/focusing its window. Never forward another
    // invocation's profile, arguments or file paths into the running app.
    app.emit('second-instance',{},[],process.cwd());
  }
  const flushLater=()=>setImmediate(flushRaise);
  app.on('ready',flushLater);app.on('browser-window-created',flushLater);
  app.once('will-quit',()=>{quitting=true;void guard?.close();});
  module.exports=acquireSingleInstance({namespace,onRaise:()=>{pendingRaise=true;flushLater();},onLost:()=>{quitting=true;app.quit();}}).then(result=>{
    if(!result.primary){app.exit(0);return;}
    guard=result;
    if(quitting){void guard.close();return;}
    require('./main.cjs');flushLater();
  }).catch(async error=>{
    quitting=true;await guard?.close();
    dialog.showErrorBox('Agent Arcade',error?.code==='UPDATE_BACKUP_FAILED'
      ?'更新前的数据备份未能完成，已停止启动以保护原数据。请检查数据目录的可用空间和访问权限，保留原目录后重试。'
      :error?.code==='CAPTURE_CLEANUP_FAILED'
      ?'上次关闭了观察器回复采集。请解除数据目录的文件占用或检查写入权限，然后重新打开 Agent Arcade 以完成清理。'
      :error?.code==='INSTANCE_UNKNOWN'
      ?'无法确认已有的 Agent Arcade 窗口。请正常关闭旧版后重试；没有启动第二个窗口。'
      :'无法启动 Agent Arcade 的唯一窗口。请正常关闭旧版后重试。');
    app.exit(1);
  });
}
}
