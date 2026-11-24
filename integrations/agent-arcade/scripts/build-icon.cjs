'use strict';
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {readBrandSource}=require('../src/core/icon.cjs');
// Validate before starting Electron, and never silently package the fallback mark.
readBrandSource();
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawnSync(require('electron'),[path.join(__dirname,'brand-icon-worker.cjs')],{
  env,windowsHide:true,stdio:'inherit',timeout:30000
});
if(child.error)throw child.error;
if(child.status!==0)throw new Error('brand_icon_build_failed');
