'use strict';

const contact=document.querySelector('#privacy-contact-value');
if(contact){
  const button=document.querySelector('#copy-privacy-contact');
  const status=document.querySelector('#privacy-copy-status');
  // The Friends view blocks external destinations. Its renderer needs no host bridge.
  const desktop=/\bElectron\//.test(navigator.userAgent);
  const link=document.querySelector('#open-privacy-contact');
  link.hidden=desktop;
  document.addEventListener('DOMContentLoaded',()=>{
    if(desktop&&document.documentElement.dataset.arcadePrivacyLink==='https'&&link.protocol==='https:')link.hidden=false;
  },{once:true});
  button.hidden=false;
  button.addEventListener('click',async()=>{
    if(!desktop&&navigator.clipboard?.writeText){
      try{
        await navigator.clipboard.writeText(contact.value);
        status.textContent='已复制联系方式。';
        return;
      }catch{ /* Use the selected text if clipboard access is unavailable. */ }
    }
    contact.focus();
    contact.select();
    let copied=false;
    try {copied=document.execCommand('copy');} catch {}
    status.textContent=copied?'已复制联系方式。':'已选中联系方式，可按 Ctrl+C 或用系统菜单复制。';
  });
}
