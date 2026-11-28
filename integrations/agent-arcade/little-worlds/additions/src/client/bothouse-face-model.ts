import * as T from 'three';
import face from '../assets/resident-face/face.json' with {type:'json'};
import {costumes,type Look} from './bothouse-costume-model.ts';

type Builtin=Exclude<Look,'generic'>;
// Width, height, depth and a resting expression from the original shape keys.
const profiles={
  orange:[1.02,.97,.98,'joy',.15],dragon:[.98,1.03,1.02,'focus',.22],
  whale:[1.02,1.01,1.00,'calm',.23],rainbow:[.99,.95,.98,'joy',.32],
  grok:[.95,1.03,1.01,'focus',.34],lanxi:[1.05,.96,.99,'joy',.21],
} as const;
// Cheek fullness and outer-corner lift, measured in the source face's metres.
const contours={
  orange:[1.12,.0015],dragon:[.96,.0040],whale:[1.10,-.0009],
  rainbow:[1.14,.0048],grok:[.94,.0053],lanxi:[1.16,-.0025],
} as const;
const irises={orange:'#d99151',dragon:'#b593dc',whale:'#64b5eb',rainbow:'#f4ae4d',grok:'#588fe7',lanxi:'#db8850'};
const names=['mouth','white','liner','lash','brow','iris','glint','skin'] as const;
const urls=names.map(name=>new URL(`../assets/resident-face/${name}.png`,import.meta.url).href);
function bytes(s:string){return Uint8Array.from(atob(s),ch=>ch.charCodeAt(0)).buffer;}
function geometry(look:Builtin){
  const g=new T.BufferGeometry();
  const positions=new Float32Array(bytes(face.position));
  g.setAttribute('position',new T.BufferAttribute(positions,3));
  g.setAttribute('normal',new T.BufferAttribute(new Float32Array(bytes(face.normal)),3));
  g.setAttribute('uv',new T.BufferAttribute(new Float32Array(bytes(face.uv)),2));
  const indices=new Uint16Array(bytes(face.index));
  g.setIndex(new T.BufferAttribute(indices,1));
  for(const [offset,count,material] of face.groups)g.addGroup(offset,count,material);

  // The iris paint preserves the source's pupil and catchlight. Tint each iris
  // separately so the rainbow resident retains her two distinct colours.
  const colors=new Float32Array(positions.length).fill(1);
  for(const [off,count,slot] of face.groups){
    if(slot!==5)continue;
    for(const vertex of indices.subarray(off,off+count)){
      const color=new T.Color(look==='rainbow'&&positions[vertex*3]>0?'#e57fae':irises[look]);
      color.toArray(colors,vertex*3);
    }
  }
  g.setAttribute('color',new T.BufferAttribute(colors,3));
  g.morphTargetsRelative=true;
  g.morphAttributes.position=Object.entries(face.morphs).map(([name,s])=>{
    const source=new DataView(bytes(s)),delta=new Float32Array(positions.length);
    for(let at=0;at<source.byteLength;at+=8){
      const vertex=source.getUint16(at,true);
      for(let k=0;k<3;k++)delta[vertex*3+k]=source.getInt16(at+2+2*k,true)/100000;
    }
    const a=new T.BufferAttribute(delta,3);a.name=name;return a;
  });
  // Bake registration into vertex positions so scale acts around the eyes.
  for(let i=0;i<positions.length;i+=3){
    positions[i+1]-=1.483;
    const [cheek,lift]=contours[look], y=positions[i+1];
    const lower=1-T.MathUtils.smoothstep(y,-.066,-.012);
    positions[i]*=1+(cheek-1)*lower;
    const eyeBand=Math.exp(-Math.pow(y/.033,2));
    positions[i+1]+=lift*eyeBand*T.MathUtils.smoothstep(Math.abs(positions[i]),.022,.071);
    // Top of the original scalp lies underneath the unchanged costume fringe.
    const aboveBrow=T.MathUtils.smoothstep(positions[i+1],.025,.098);
    positions[i+2]+=.054*aboveBrow;
    positions[i]*=1-.08*aboveBrow;
    if(positions[i+1]>.075)positions[i+1]=.075+(positions[i+1]-.075)*.50;
  }
  return g;
}

let atlas:{map:T.Texture,ready:Promise<void>}[]|undefined;
let users=0;
function acquirePaint(){
  users++;
  if(!atlas&&typeof document!=='undefined'){
    const loader=new T.TextureLoader();
    atlas=urls.map(url=>{
      let map!:T.Texture;
      const ready=new Promise<void>((resolve,reject)=>{map=loader.load(url,()=>resolve(),undefined,reject);});
      // An unavailable texture must not leave an unhandled rejection in play.
      void ready.catch(()=>{});
      map.colorSpace=T.SRGBColorSpace;map.flipY=false;return {map,ready};
    });
  }
  return atlas;
}

export function attachResidentFace(head:T.Object3D,body:T.Object3D,look:Builtin){
  const paint=acquirePaint();
  const materials=names.map((name,i)=>{
    const tint=name==='liner'||name==='lash'?'#512f39':name==='brow'?costumes[look].hair:'#ffffff';
    const options={map:paint?.[i].map??null,color:tint,vertexColors:i===5,side:T.DoubleSide,alphaTest:.20};
    // The VRM supplies sRGB painted details with an unlit glTF fallback. Only
    // skin takes a soft scene-light tint, using the author's warm MToon shade.
    const mat=name==='skin'?new T.MeshLambertMaterial(options):new T.MeshBasicMaterial(options);
    if(name==='skin'){
      mat.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
          float facingLight = dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722))
            / max(.001,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
          outgoingLight = diffuseColor.rgb * mix(vec3(.97,.81,.86),vec3(1.),smoothstep(.02,.55,facingLight));
          #include <opaque_fragment>`);
      };
    }
    if(paint)mat.userData.ready=paint[i].ready;
    return mat;
  });
  // Same neck silhouette and pivot as the resident rig. Sample the plain
  // forehead pigment on every vertex so jaw and neck share one paint and light.
  const neckGeometry=new T.SphereGeometry(1,16,12);
  const uv=neckGeometry.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,.50,.23);
  const neck=new T.Mesh(neckGeometry,materials[7]);neck.name='painted-neck';
  neck.position.set(0,.222,0);neck.scale.set(.071,.085,.068);body.add(neck);
  const mesh=new T.Mesh(geometry(look),materials);mesh.name='authored-face';
  const [width,height,depth,expression,weight]=profiles[look];
  mesh.rotation.y=Math.PI;mesh.scale.set(2.00*width,2.02*height,1.85*depth);
  mesh.position.set(0,.002,.033);head.add(mesh);
  mesh.morphTargetInfluences![mesh.morphTargetDictionary![expression]]=weight;
  return ()=>{
    for(const m of materials)m.dispose();
    if(--users===0){for(const entry of atlas??[])entry.map.dispose();atlas=undefined;}
  };
}
