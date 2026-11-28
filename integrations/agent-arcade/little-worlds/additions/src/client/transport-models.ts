import * as T from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import cargoA from '../assets/kenney-space-kit/craft_cargoA.obj?raw';
import cargoB from '../assets/kenney-space-kit/craft_cargoB.obj?raw';
import {markShared} from '../assets/claude-geometry/core/dispose.ts';
import {STARTERS,type ShipDesign} from '../assets/claude-geometry/ship/design.ts';
import {createShipModel} from '../assets/claude-geometry/ship/factory.ts';
import type {StyleLibrary} from '../assets/claude-geometry/style/materials.ts';
import {applyArtMaterial} from './art-profile.ts';

const colours = {metal:'#c3c2ad', metalDark:'#657477', metalRed:'#cb873e', dark:'#25323a'};
// A starter saved by the shipyard gets a new ID. Match its visual choices,
// leaving custom parts, paint, markings and every saved identity intact.
function skinKey({parts,paint,glow,registration}:ShipDesign){
  return JSON.stringify([parts.hull,parts.cockpit,parts.wings,parts.engines,parts.tail,parts.dorsal,
    paint.primary,paint.secondary,paint.trim,glow,registration]);
}
const stock = STARTERS.slice(0,2).map(skinKey);
const assets = {courier:cargoA, hauler:cargoB};
type Vehicle = keyof typeof assets;
const cache = new Map<Vehicle,T.Group>();

function vehicle(kind:Vehicle){
  let source=cache.get(kind);
  if(!source){
    source=new OBJLoader().parse(assets[kind]);
    source.name='Kenney '+kind;
    source.traverse(child=>{
      if(!(child instanceof T.Mesh))return;
      markShared(child.geometry);
      const paint=(original:T.Material)=>{
        const name=original.name as keyof typeof colours;
        original.dispose();
        return markShared(applyArtMaterial(new T.MeshStandardMaterial({
          color:colours[name]??colours.metal,roughness:.86,flatShading:true,
        })));
      };
      child.material=Array.isArray(child.material)?child.material.map(paint):paint(child.material);
      child.castShadow=child.receiveShadow=true;
    });
    cache.set(kind,source);
  }
  return source.clone(true);
}

export function createTravelShip(design:ShipDesign,library:StyleLibrary){
  const model=createShipModel(design,library,'medium');
  const preset=stock.indexOf(skinKey(design));
  if(preset<0)return model;
  const body=vehicle(preset===0?'courier':'hauler');
  // Keep the solid envelope used by the ground camera and the existing pads.
  // The stock flight frame points along -Z. Kenney's cockpit faces +Z.
  body.rotation.y=Math.PI;
  const source=new T.Box3().setFromObject(body);
  body.scale.copy(model.bounds.getSize(new T.Vector3()).divide(source.getSize(new T.Vector3())));
  body.position.copy(model.bounds.getCenter(new T.Vector3())).sub(source.getCenter(new T.Vector3()).multiply(body.scale));
  model.object.getObjectByName('hull-structure')!.visible=false;
  // Navigation lights and the painted registration belong to the procedural skin.
  for(const child of model.object.children){
    if(child instanceof T.Mesh && child.name!=='plume' && child.name!=='plume-depth')child.visible=false;
  }
  model.object.add(body);
  return model;
}
