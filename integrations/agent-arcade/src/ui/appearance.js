// The system media query supplies the initial/browser-preview palette. Electron
// snapshots take precedence so native controls, window and page agree.
(()=>{
 const root=document.documentElement,media=window.matchMedia('(prefers-color-scheme: dark)');
 // Host platform for shortcut labels and platform-specific rules: named by the
 // preload bridge in the desktop app, guessed from the browser in a preview.
 const host=window.arcade?.platform?.os;
 root.dataset.platform=['win32','darwin','linux'].includes(host)?host:typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||'')?'darwin':'win32';
 const seed=window.arcade?.initialAppearance;
 let current=seed&&['system','light','dark'].includes(seed.preference)&&['light','dark'].includes(seed.colorScheme)?{config:{appearance:seed.preference},appearance:seed}:null;
 function apply(snapshot){if(snapshot)current={config:{appearance:snapshot.config?.appearance},appearance:snapshot.appearance};const value=current?.config?.appearance,preference=['light','dark'].includes(value)?value:'system',native=current?.appearance;
  const colorScheme=preference!=='system'?preference:native?.preference===preference&&['light','dark'].includes(native.colorScheme)?native.colorScheme:media.matches?'dark':'light';
  const changed=root.dataset.colorScheme!==colorScheme;root.dataset.appearance=preference;root.dataset.colorScheme=colorScheme;root.style.colorScheme=colorScheme;
  if(changed)window.dispatchEvent(new CustomEvent('arcade:appearance',{detail:{colorScheme}}));
 }
 media.addEventListener('change',()=>apply());
 window.ArcadeAppearance=Object.freeze({apply});apply();
})();
