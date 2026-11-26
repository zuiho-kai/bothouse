'use strict';

// The unversioned entry also serves cached HTML from releases before pinned assets.
(() => {
  const build=document.documentElement.dataset.friendsRelease;
  const recoveryKey='friends-reload';
  const url=new URL(location.href);
  function recover(){
    if(!url.searchParams.has(recoveryKey)){
      url.searchParams.set(recoveryKey,build||'legacy');
      location.replace(url);
      return;
    }
    const retry=document.createElement('a');
    retry.href=url.pathname+url.hash;
    retry.textContent='重新加载好友页面';
    const message=document.createElement('p');
    message.setAttribute('role','status');
    message.append('无法加载好友页面。',retry);
    (document.querySelector('#auth-loading')||document.body).replaceChildren(message);
  }
  if(!/^[a-f0-9]{64}$/.test(build||'')){
    recover();
    return;
  }
  // Keep the application as a parser-discovered module so the desktop host's
  // load completion still happens after the module has set up its listeners.
  window.addEventListener('error',event=>{
    if(event.target.id==='friends-app')recover();
  },true);
})();
