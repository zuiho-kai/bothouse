// Run in the model checkout. All textures and source modules stay on loopback.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const baseline=process.argv[3];
if(baseline&&!/^[a-f0-9]{40}$/.test(baseline))throw Error('Pass a full local baseline commit');
const modelPath='src/client/bothouse-resident-model.ts';
const plugins=baseline?[{name:'read-frozen-model',enforce:'pre',transform(code,id){
  if(id.replaceAll('\\','/').endsWith('/'+modelPath))return execFileSync('git',['show',baseline+':'+modelPath],{encoding:'utf8'});
}}]:[];
const out=resolve(process.argv[2]);
await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,plugins,root:process.cwd(),server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1080,height:720}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/src/client/bothouse-resident-model.ts');
  const measured=await page.evaluate(async()=>{
    document.head.innerHTML='<meta charset="utf-8">';
    document.body.innerHTML='<canvas></canvas>';document.body.style.cssText='margin:0;overflow:hidden';
    const {createBothouseResidentModel}=await import('/src/client/bothouse-resident-model.ts');
    const {configureRenderer,configureGroundLighting}=await import('/src/client/presentation.ts');
    const T=await import('/node_modules/three/build/three.module.js');
    const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1080,720);renderer.setScissorTest(true);
    const scene=new T.Scene();scene.background=new T.Color('#e9e5da');
    const fill=new T.AmbientLight(),sun=new T.DirectionalLight();scene.add(fill,sun);
    configureRenderer(renderer,'world');configureGroundLighting('garden',scene,fill,sun);
    sun.position.set(-12,24,7);
    const keys=['orange','dragon','whale','rainbow','grok','lanxi'];
    const models=keys.map(k=>createBothouseResidentModel(k));
    const ready=models.flatMap(m=>{const promises=[];m.root.traverse(o=>{if(o.isMesh)for(const mat of [].concat(o.material)){if(mat.userData.ready)promises.push(mat.userData.ready);}});return promises;});
    await Promise.all(ready);
    window.draw=(mode,angle=0)=>{
      for(let i=0;i<6;i++){
        const multi=mode==='profiles', target=mode==='distance'?.85:1.33, size=mode==='distance'?.965:.33;
        const model=models[multi?(i<3?1:2):i];scene.add(model.root);model.root.rotation.y=multi?(i%3)*Math.PI/4:angle;
        model.animate(mode==='talk'?'talking':'idle',mode==='blink'?.18:.73,mode!=='blink'&&mode!=='talk');
        const cam=new T.OrthographicCamera(-size,size,size,-size,.01,12);cam.position.set(0,target+.07,4);cam.lookAt(0,target,0);
        const x=i%3*360,y=(1-Math.floor(i/3))*360;renderer.setScissor(x,y,360,360);renderer.setViewport(x,y,360,360);renderer.render(scene,cam);scene.remove(model.root);
      }
    };
    return models.map((m,i)=>{
      const face=m.root.getObjectByName('authored-face');
      if(!face)return {look:keys[i],authored:false};
      const keysByName=face.morphTargetDictionary,weights=face.morphTargetInfluences;
      m.animate('idle',.18,false);const blink=weights[keysByName.blink];
      m.animate('talking',.70,false);const speech=weights[keysByName.speech];
      m.animate('idle',0,true);
      if(blink!==1||speech<=0||weights[keysByName.speech]!==0)throw Error('Pose failed: '+keys[i]);
      return {look:keys[i],authored:true,vertices:face.geometry.attributes.position.count,
        triangles:face.geometry.index.count/3,blink,speech,skinSharedWithNeck:face.material[7]===m.root.getObjectByName('painted-neck')?.material};
    });
  });
  for(const [mode,angle] of [['profiles',0],['faces',0],['distance',.12],['blink',0],['talk',.15],['back',Math.PI]]){
    await page.evaluate(([mode,angle])=>window.draw(mode,angle),[mode,angle]);
    await page.locator('canvas').screenshot({path:join(out,mode+'.png')});
  }
  if(!baseline&&measured.some(x=>!x.skinSharedWithNeck||x.vertices!==2054))throw Error('Missing authored face or neck material');
  if(errors.length)throw Error(errors.join('\n'));await writeFile(join(out,'capture.json'),JSON.stringify({baseline,measured,viewport:[1080,720],errors,keys:['orange','dragon','whale','rainbow','grok','lanxi'],profiles:['dragon','whale'],angles:[0,45,90]},null,2));
}finally{await browser.close();await server.close();}
