'use strict';
const MODES=new Set(['system','light','dark']);
const validAppearance=value=>MODES.has(value);
const normalizeAppearance=value=>validAppearance(value)?value:'system';
function appearanceSnapshot(value,systemDark){const preference=normalizeAppearance(value);return {preference,colorScheme:preference==='system'?(systemDark===true?'dark':'light'):preference};}
const appearanceBackground=scheme=>scheme==='dark'?'#211d27':'#faf6f9';
// Electron's themeSource affects this application, never the operating-system preference.
class AppearanceController{
 constructor({nativeTheme,preference,onChange}){this.nativeTheme=nativeTheme;this.preference=preference;this.onChange=onChange;this.closed=false;this.last='';this.listener=()=>this.refresh();nativeTheme.on('updated',this.listener);}
 refresh(){if(this.closed)return;const preference=normalizeAppearance(this.preference());if(this.nativeTheme.themeSource!==preference)this.nativeTheme.themeSource=preference;const state=appearanceSnapshot(preference,this.nativeTheme.shouldUseDarkColors),key=JSON.stringify(state);if(key!==this.last){this.last=key;this.onChange(state);}return state;}
 close(){if(this.closed)return;this.closed=true;this.nativeTheme.removeListener('updated',this.listener);}
}
module.exports={validAppearance,normalizeAppearance,appearanceSnapshot,appearanceBackground,AppearanceController};
