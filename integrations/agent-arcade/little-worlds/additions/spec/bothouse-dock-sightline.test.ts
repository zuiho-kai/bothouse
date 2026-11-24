import {expect,it} from 'vitest';
import {Vector3} from 'three';
import {landingSites} from '../src/client/bothouse-resident-sites.ts';
import {GroundWorld} from '../src/shared/physics/world.ts';
import {canBoard,portPoint} from '../src/shared/ports.ts';
import type {Vec3} from '../src/shared/world.ts';

it('skips a safe walking anchor behind a dock-side lamp',()=>{
  const planet={id:'p-lamp-test',revision:1,radius:10,objects:[],blueprints:{}};
  const plain=new GroundWorld(planet);
  const old=landingSites(plain,1)[0];
  const dock=new Vector3(...portPoint(planet.id));
  const lamp=dock.clone().lerp(old.clone().normalize(),.55).normalize().toArray() as Vec3;
  const world=new GroundWorld({...planet,objects:[{id:'lamp',kind:'lamp',position:lamp,rotation:0,version:1}]});
  const eye=dock.clone().multiplyScalar(world.radius(dock.toArray() as Vec3)+1.32);
  const visible=(feet:Vector3)=>[.91,1.43,1.99].every(height=>{
    const target=feet.clone().addScaledVector(feet.clone().normalize(),height);
    return world.cameraDistance(eye,target,.18)>=eye.distanceTo(target)-.001;
  });
  expect(world.blocked(world.pose(old.clone().normalize().toArray() as Vec3))).toBe(false);
  expect(visible(old)).toBe(false);
  const [first,second]=landingSites(world,2);
  expect(visible(first)).toBe(true);
  expect(first.distanceTo(second)).toBeGreaterThan(1.8);
  for(const spot of [first,second]){
    expect(canBoard(planet.id,spot.clone().normalize().toArray() as Vec3,world.baseRadius)).toBe(false);
    expect(world.blocked(world.pose(spot.clone().normalize().toArray() as Vec3))).toBe(false);
  }
});
