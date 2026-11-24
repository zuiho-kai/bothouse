'use strict';
// Native image encoding only. No BrowserWindow or application/account startup.
const fs=require('node:fs'),path=require('node:path');
const {app,nativeImage,BrowserWindow}=require('electron');
const {createBrandIcon,encodeIco,BRAND,ICON_SIZES,MAC_ICON_SIZE,MAC_ICON_FILE}=require('../src/core/icon.cjs');
try {
  const frames=ICON_SIZES.map(size=>({size,png:createBrandIcon(nativeImage,size,{allowFallback:false}).toPNG()}));
  const ico=encodeIco(frames),png=frames.at(-1).png;
  // macOS packaging converts one large square PNG into the .icns bundle icon.
  const macIcon=createBrandIcon(nativeImage,MAC_ICON_SIZE,{allowFallback:false}),macPng=macIcon.toPNG(),macSize=macIcon.getSize();
  if(macSize.width!==MAC_ICON_SIZE||macSize.height!==MAC_ICON_SIZE||macPng.readUInt32BE(16)!==MAC_ICON_SIZE||macPng.readUInt32BE(20)!==MAC_ICON_SIZE)throw new Error('brand_mac_icon_invalid');
  const dir=path.resolve(__dirname,'../src/assets');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'app.png'),png);
  fs.writeFileSync(path.join(dir,'app.ico'),ico);
  fs.writeFileSync(path.join(dir,MAC_ICON_FILE),macPng);
  if(!fs.readFileSync(path.join(dir,'app.png')).equals(png)||!fs.readFileSync(path.join(dir,'app.ico')).equals(ico)||!fs.readFileSync(path.join(dir,MAC_ICON_FILE)).equals(macPng))throw new Error('brand_write_mismatch');
  if(BrowserWindow.getAllWindows().length!==0)throw new Error('unexpected_brand_window');
  console.log(JSON.stringify({brand:BRAND.file,sourceSha256:BRAND.sha256,sourceSize:{width:BRAND.width,height:BRAND.height},fit:BRAND.fit,sizes:ICON_SIZES,icoBytes:ico.length,macIcon:{file:MAC_ICON_FILE,size:MAC_ICON_SIZE,bytes:macPng.length},windowsCreated:0}));
  app.exit(0);
} catch(error) {
  console.error('Brand icon build failed:',error.message);
  app.exit(1);
}
