import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {applyArtMaterial} from './art-profile.ts';

export type Point=[number,number,number];
export const finish=()=>applyArtMaterial(new T.MeshStandardMaterial({vertexColors:true,roughness:.9,metalness:0}));
const zero:Point=[0,0,0],one:Point=[1,1,1];
export function joint(parent:T.Object3D,name:string,x:number,y:number,z:number){
  const g=new T.Group();g.name=name;g.position.set(x,y,z);parent.add(g);return g;
}
// Bake rigid details into one vertex-coloured mesh per moving joint. No skinning,
// per-petal draw calls or view-dependent face planes.
export class Sculpture{
  private parts=new Map<T.Object3D,T.BufferGeometry[]>();
  shape(parent:T.Object3D,g:T.BufferGeometry,color:string,pos:Point=zero,scale:Point=one,rot:Point=zero){
    g.scale(...scale);g.applyQuaternion(new T.Quaternion().setFromEuler(new T.Euler(...rot)));g.translate(...pos);
    if(!g.getAttribute('color')){
      const c=new T.Color(color),n=g.getAttribute('position').count,a=new Float32Array(n*3);
      for(let i=0;i<n;i++)c.toArray(a,i*3);
      g.setAttribute('color',new T.BufferAttribute(a,3));
    }
    if(g.index){const flat=g.toNonIndexed();g.dispose();g=flat;}
    for(const k of Object.keys(g.attributes))if(!['position','normal','color'].includes(k))g.deleteAttribute(k);
    const list=this.parts.get(parent)??[];list.push(g);this.parts.set(parent,list);
  }
  oval(p:T.Object3D,c:string,pos:Point,scale:Point,rot:Point=zero){
    this.shape(p,new T.SphereGeometry(1,12,9),c,pos,scale,rot);
  }
  box(p:T.Object3D,c:string,pos:Point,scale:Point,rot:Point=zero){
    this.shape(p,new T.BoxGeometry(),c,pos,scale,rot);
  }
  band(p:T.Object3D,c:string,pos:Point,top:number,bottom:number,height:number,depth:number,rot:Point=zero){
    this.shape(p,new T.CylinderGeometry(top,bottom,height,18),c,pos,[1,1,depth],rot);
  }
  // Elliptical lock/cord with a taper. Control points trace the actual swept
  // volume in local space, including the thickness seen from the side.
  strand(p:T.Object3D,c:string,points:Point[],width:number,depth:number,tip=c,ends:[number,number]=[.5,.025]){
    const path=new T.CatmullRomCurve3(points.map(a=>new T.Vector3(...a)));
    const start=new T.Color(c),end=new T.Color(tip),shade=new T.Color();
    const verts:number[]=[],colors:number[]=[],indices:number[]=[];
    const steps=Math.max(6,points.length*2),sides=8;
    for(let j=0;j<=steps;j++){
      const u=j/steps,pt=path.getPoint(u),t=path.getTangent(u);
      const lateral=new T.Vector3().crossVectors(t,Math.abs(t.z)>.96?new T.Vector3(0,1,0):new T.Vector3(0,0,1)).normalize();
      const thick=new T.Vector3().crossVectors(t,lateral).normalize();
      const radius=Math.max(.025,Math.sin(Math.PI*u)**.65*.76+(1-u)*ends[0]+u*ends[1]);
      shade.copy(start).lerp(end,u*u);
      for(let k=0;k<sides;k++){
        const angle=2*Math.PI*k/sides;
        verts.push(...pt.clone().addScaledVector(lateral,Math.cos(angle)*width*radius).addScaledVector(thick,Math.sin(angle)*depth*radius).toArray());
        colors.push(shade.r,shade.g,shade.b);
        if(j<steps){
          const a=j*sides+k,b=j*sides+(k+1)%sides;
          indices.push(a,b,a+sides,b,b+sides,a+sides);
        }
      }
    }
    for(let k=1;k<sides-1;k++){indices.push(0,k+1,k,steps*sides,steps*sides+k,steps*sides+k+1);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));
    g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();this.shape(p,g,c);
  }
  // Solid bevelled pieces for wing membranes, ribbons and ears.
  panel(p:T.Object3D,c:string,points:number[][],pos:Point,depth=.022,rot:Point=zero){
    const outline=new T.Shape(points.map(q=>new T.Vector2(q[0],q[1])));
    this.shape(p,new T.ExtrudeGeometry(outline,{depth,bevelEnabled:true,bevelThickness:.004,bevelSize:.004,bevelSegments:1,steps:1}),c,pos,one,rot);
  }
  skirt(p:T.Object3D,c:string,waist:number,hem:number,top:number,bottom:number,fold:number){
    const vertices:number[]=[],indices:number[]=[],segments=40;
    for(const [y,r,amp] of [[top,waist,.03],[(top+bottom)/2,(waist+hem)/2,.065],[bottom,hem,.10],[bottom+.008,hem-.018,.09]]){
      for(let n=0;n<segments;n++){
        const a=n/segments*Math.PI*2,radius=r*(1+fold*amp*Math.cos(10*a));
        vertices.push(radius*Math.sin(a),y,radius*.79*Math.cos(a));
      }
    }
    for(let i=0;i<3;i++)for(let j=0;j<segments;j++){
      const a=i*segments+j,b=i*segments+(j+1)%segments;indices.push(a,a+segments,b,b,a+segments,b+segments);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();this.shape(p,g,c);
  }
  bake(material:T.Material){
    for(const [p,parts] of this.parts){
      const g=mergeGeometries(parts)!;const mesh=new T.Mesh(g,material);
      mesh.name=p.name+'-sculpt';mesh.castShadow=true;mesh.receiveShadow=true;p.add(mesh);
      for(const part of parts)part.dispose();
    }
    this.parts.clear();
  }
}
