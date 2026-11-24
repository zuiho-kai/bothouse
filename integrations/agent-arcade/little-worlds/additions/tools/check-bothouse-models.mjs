// Local-only reference and turntable capture. No world login, service, or external assets.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const [bothouse,output,mode]=process.argv.slice(2);
if(!bothouse||!output)throw Error('Pass the local Bothouse checkout and evidence directory');
const slugs=['orange','dragon','whale','rainbow','grok','lanxi'];
const keys=[...slugs,'generic'];
const names=['橘','龙娘','鲸鱼娘','彩虹猫','Grok','岚汐','自定义居民'];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
let server;
try{
  const page=await browser.newPage({viewport:{width:1540,height:630},deviceScaleFactor:1});
  await page.route(/^https?:\/\//,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const html=await readFile(join(bothouse,'dsh/collab/desk/index.html'),'utf8');
  const sheets=JSON.parse(html.match(/<script type="application\/json" id="spriteData">([^<]+)</)[1]);
  const sources=[];
  for(const slug of slugs){
    const bytes=await readFile(join(bothouse,'dsh/collab/avatars',slug+'.png'));
    sources.push({slug,avatar:'data:image/png;base64,'+bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),sheet:sheets[slug]});
  }
  await page.setContent('<style>*{box-sizing:border-box}body{margin:0;background:#e9e4d7;color:#263738;font:19px Segoe UI,sans-serif}main{display:flex;padding:18px;gap:8px}section{text-align:center;flex:1}h3{font-size:20px}canvas{image-rendering:pixelated;width:70px;height:85px;object-fit:contain}p{font-size:15px}img{width:196px;height:196px}</style><main></main>');
  await page.evaluate(async({sources,names})=>{
    const image=async src=>{const im=new Image();im.src=src;await im.decode();return im;};
    for(const [i,s] of sources.entries()){
      const cell=document.createElement('section');document.querySelector('main').append(cell);
      const title=document.createElement('h3');title.textContent=names[i]+' · '+s.slug;cell.append(title,await image(s.avatar),document.createElement('hr'));
      if(!s.sheet){cell.append('工作台无专属转面图');continue;}
      const sheet=await image(s.sheet.src);
      for(const frame of [0,4,8]){
        const c=document.createElement('canvas');c.width=s.sheet.w;c.height=s.sheet.h;
        c.getContext('2d').drawImage(sheet,frame*c.width,0,c.width,c.height,0,0,c.width,c.height);cell.append(c);
      }
    }
  },{sources,names});
  await page.locator('main').screenshot({path:join(output,'Bothouse原造型.png')});
  if(mode!=='--references'){
    const shell='<meta charset=utf-8><style>*{box-sizing:border-box}body{margin:0;background:#eae6dc;font:17px Segoe UI,sans-serif;color:#253e40}.labels{display:flex;width:100%;padding:0 24px;margin:0}.labels span{flex:1;text-align:center}canvas{display:block}</style><canvas></canvas><div class=labels></div>';
    server=await createServer({configFile:false,root:resolve('.'),server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'local-inspection',configureServer(s){s.middlewares.use('/model-inspection',(_,res)=>{res.setHeader('Content-Type','text/html');res.end(shell);});}}]});
    await server.listen();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/model-inspection');
    await page.setViewportSize({width:1694,height:440});
    const counts=await page.evaluate(async({keys,names})=>{
      const {createBothouseResidentModel}=await import('/src/client/bothouse-resident-model.ts');
      const {sampleCourier}=await import('/src/client/character-sample.ts');
      const {ART_LIGHT}=await import('/src/client/art-profile.ts');
      const T=await import('/node_modules/three/build/three.module.js');
      const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(1694,395);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;
      const scene=new T.Scene();scene.background=new T.Color('#e9e5da');
      const width=8.4,height=width*395/1694;
      const camera=new T.OrthographicCamera(-width/2,width/2,height/2,-height/2,.01,100);
      camera.position.set(0,2.10,12);camera.lookAt(0,.86,0);
      scene.add(new T.AmbientLight(ART_LIGHT.fill,ART_LIGHT.fillIntensity));
      const sun=new T.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.sunIntensity);sun.position.set(-3,6,4);scene.add(sun);
      const models=keys.map((k,i)=>{
        const model=createBothouseResidentModel(k);model.root.position.x=(i-3)*1.2;
        scene.add(model.root);model.animate('idle',0,true);
        const shadow=new T.Mesh(new T.CircleGeometry(.28,32),new T.MeshBasicMaterial({color:'#d2cdbf'}));
        shadow.rotation.x=-Math.PI/2;shadow.position.set(model.root.position.x,.004,0);scene.add(shadow);
        const label=document.createElement('span');label.textContent=names[i];document.querySelector('.labels').append(label);return model;
      });
      const badge=document.createElement('canvas');badge.width=64;badge.height=64;const ctx=badge.getContext('2d');
      ctx.fillStyle='#075554';ctx.fillRect(0,0,64,64);ctx.fillStyle='#ffe3a0';ctx.beginPath();ctx.arc(32,29,19,0,Math.PI*2);ctx.fill();ctx.fillStyle='#203742';ctx.fillRect(21,25,5,5);ctx.fillRect(38,25,5,5);
      const tex=new T.CanvasTexture(badge);tex.colorSpace=T.SRGBColorSpace;models[6].setBadge(tex);
      window.turn=(angle,action='idle')=>{models.forEach(m=>{m.root.rotation.y=angle;m.animate(action,1.2,true);});renderer.render(scene,camera);};
      window.turn(0);
      window.showCourier=()=>{
        models[6].root.visible=false;
        const courier=sampleCourier('clay');courier.animate(0,0,true);
        courier.root.position.copy(models[6].root.position);courier.root.rotation.y=.28;scene.add(courier.root);
        document.querySelector('.labels').lastChild.textContent='Little Worlds 邮差';
        renderer.render(scene,camera);
        const height=o=>new T.Box3().setFromObject(o,true).getSize(new T.Vector3()).y;
        return {courier:height(courier.root),builtins:models.slice(0,6).map(m=>height(m.root))};
      };
      const other=createBothouseResidentModel('generic');
      const badgeOf=m=>m.root.getObjectByName('public-portrait-badge');
      if(badgeOf(other).visible||!badgeOf(models[6]).visible)throw Error('Badge not scoped to its resident');
      models[6].setBadge(null);
      if(badgeOf(models[6]).visible||badgeOf(models[6]).material.map)throw Error('Old badge survived clearing');
      models[6].setBadge(tex);other.dispose();
      return models.map(m=>{
        let meshes=0,triangles=0,sprites=0;
        m.root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}if(o.isSprite)sprites++;});
        return {meshes,triangles,sprites};
      });
    },{keys,names});
    for(const [file,angle] of [['正面',0],['侧面',Math.PI/2],['背面',Math.PI],['四分之三',.49]]){
      await page.evaluate(a=>window.turn(a),angle);await page.screenshot({path:join(output,file+'.png'),clip:{x:0,y:0,width:1694,height:431}});
    }
    await page.evaluate(()=>window.turn(.16,'working'));await page.screenshot({path:join(output,'工作姿态.png')});
    if(mode==='--video'){
      const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','12','-i','pipe:0',
        '-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(output,'同场转身.mp4')],{windowsHide:true,stdio:['pipe','ignore','inherit']});
      const done=once(encoder,'exit');
      try{
        for(let i=0;i<60;i++){
          await page.evaluate(a=>window.turn(a),Math.PI*2*i/59);
          const frame=await page.screenshot({clip:{x:0,y:0,width:1694,height:430}});
          if(!encoder.stdin.write(frame))await once(encoder.stdin,'drain');
        }
      }finally{encoder.stdin.end();}
      assert.equal((await done)[0],0);
    }
    await page.evaluate(()=>window.turn(.28));
    const heights=await page.evaluate(()=>window.showCourier());
    await page.screenshot({path:join(output,'与本地邮差同场.png')});
    assert.equal(errors.length,0,errors.join('\n'));assert(counts.every(r=>r.meshes>=5&&!r.sprites));
    assert(heights.builtins.every(h=>h>heights.courier*.85&&h<heights.courier*1.20));
    await writeFile(join(output,'receipt.json'),JSON.stringify({keys,counts,heights,errors,upstream:sources.map(({slug,sha256,sheet})=>({slug,sha256,deskFrames:sheet?.n??0})),views:['正面','侧面','背面','四分之三','工作姿态','与本地邮差同场'],environment:'headless Edge, local Vite, actual Three.js WebGL, synthetic badge, no world connection'},null,2));
  }
}finally{await browser.close();await server?.close();}
