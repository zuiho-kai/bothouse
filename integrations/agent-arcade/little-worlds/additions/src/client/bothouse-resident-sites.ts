import * as T from 'three';
import {portPoint} from '../shared/ports.ts';
import {GroundWorld,STEP_HEIGHT} from '../shared/physics/world.ts';
import type {Vec3} from '../shared/world.ts';

export function residentWalkEnd(start:T.Vector3,pad:T.Vector3,radius:number) {
  const outward=start.clone().sub(pad).projectOnPlane(start).normalize();
  return start.clone().addScaledVector(outward,.65/radius).normalize();
}

// Use the terrain and object proxies already used by the game camera. Check
// both ends of the short walk from the dock and from a step down the path.
export function landingSites(world:GroundWorld,count:number) {
  const sites:T.Vector3[]=[],fallback:T.Vector3[]=[];
  const pad=new T.Vector3(...portPoint(world.planetId));
  const north=new T.Vector3(0,0,-1).projectOnPlane(pad).normalize();
  const east=new T.Vector3().crossVectors(north,pad),radius=world.baseRadius;
  const approach=pad.clone().addScaledVector(north,.85/radius).normalize();
  const eyes=[pad,approach].map(direction=>direction.clone().multiplyScalar(
    world.support(direction.toArray() as Vec3,Infinity).radius+1.32));
  const spaced=(feet:T.Vector3)=>sites.every(site=>site.distanceToSquared(feet)>1.8**2);
  const clear=(normal:T.Vector3)=>{
    const support=world.support(normal.toArray() as Vec3,Infinity).radius;
    return [.91,1.43,1.99].every(height=>{
      const target=normal.clone().multiplyScalar(support+height);
      return eyes.every(eye=>world.cameraDistance(eye,target,.32)>=eye.distanceTo(target)-.001);
    });
  };
  for(let distance=2.65;distance<Math.PI*radius-1&&sites.length<count;distance+=1.25){
    const angle=distance/radius;
    const slots=Math.max(1,Math.floor(2*Math.PI*radius*Math.sin(angle)/1.15));
    for(let slot=0;slot<slots&&sites.length<count;slot++){
      // Place the first pair just to either side of the traveller's forward view.
      const yaw=Math.ceil((slot+1)/2)*(slot%2 ? -1 : 1)*2*Math.PI/slots;
      const normal=pad.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(north,Math.sin(angle)*Math.cos(yaw)).addScaledVector(east,Math.sin(angle)*Math.sin(yaw));
      const position=normal.toArray() as Vec3,pose=world.pose(position);
      const support=world.support(position,Infinity);
      if(support.radius>pose.radius+STEP_HEIGHT)continue;
      pose.radius=support.radius;
      const feet=normal.multiplyScalar(pose.radius+.03);
      if(world.blocked(pose)||!spaced(feet))continue;
      if(distance<9&&Math.abs(yaw)<1&&clear(normal)&&clear(residentWalkEnd(normal,pad,radius))){
        sites.push(feet);
      }else if(fallback.length<count*3&&fallback.every(site=>site.distanceToSquared(feet)>1.8**2)){
        fallback.push(feet);
      }
    }
    if(distance>=8.7&&fallback.length>=count)break;
  }
  for(const feet of fallback)if(sites.length<count&&spaced(feet))sites.push(feet);
  return sites;
}
