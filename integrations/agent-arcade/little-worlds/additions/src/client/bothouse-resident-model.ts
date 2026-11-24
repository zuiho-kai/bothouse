import * as T from 'three';
import type {PlanetResident} from '../shared/planet-residents.ts';
import {Sculpture,finish,joint} from './bothouse-sculpt-model.ts';
import {clothing,costumes,hairAndHeadwear,type Look} from './bothouse-costume-model.ts';

import {attachResidentFace} from './bothouse-face-model.ts';
import {townResidentLedger} from './town-resident-ledger.ts';

type Activity=PlanetResident['activity'];
const cream='#f6ead3',skin='#f0ceac',ink='#42353f';
const hipHeight=.625, shinPivotDrop=.260;
const shoeCenterDrop=.292, shoeHalfHeight=.056, soleCenterDrop=.324, soleHalfHeight=.022;
// Both curved shoe pieces count toward the lowest resting point.
const shoeBottom=Math.max(shoeCenterDrop+shoeHalfHeight,soleCenterDrop+soleHalfHeight);
const standingSoleOffset=hipHeight-shinPivotDrop-shoeBottom;
function sculpt(look:Look){
  const s=new Sculpture(),v=costumes[look],root=new T.Group();root.name='bothouse-'+look;
  // Joint hierarchy, metre scale and front direction follow the local sample
  // courier. Feet, pelvis, shoulder and head pivots remain on the same levels.
  const rig=joint(root,'rig',0,0,0),body=joint(rig,'body',0,.88,0),head=joint(body,'head',0,.45,.005);
  s.oval(body,v.coat,[0,.016,0],[.190,.235,.144]);
  s.band(body,v.coat,[0,-.075,0],.16,.148,.13,.86);
  if(look==='generic')s.oval(body,skin,[0,.222,0],[.071,.085,.068]);
  const releaseFace=look==='generic'?undefined:attachResidentFace(head,body,look);
  if(look==='generic'){
    s.oval(head,skin,[0,0,0],[.208,.226,.186]);
    s.oval(head,skin,[0,-.077,.038],[.165,.143,.153]);
  }
  for(const side of [-1,1]){
    if(look==='generic'){
      s.oval(head,skin,[side*.202,-.029,-.001],[.037,.054,.032]);
      s.oval(head,'#e7a990',[side*.123,-.066,.147],[.036,.012,.007],[0,side*.5,0]);
      const eye=joint(head,'eye'+side,side*.081,.005,.169);eye.rotation.y=side*.35;
      s.oval(eye,'#fff2dd',[0,0,0],[.047,.047,.018]);
      const iris=v.eye;
      s.oval(eye,iris,[0,-.002,.014],[.032,.040,.013]);
      s.oval(eye,ink,[0,.003,.024],[.017,.025,.007]);
      s.oval(eye,'#fff6df',[-.009,.016,.03],[.008,.010,.005]);
      s.strand(eye,ink,[[-side*.042,.009,.004],[0,.038,.013],[side*.036,.030,.005],[side*.056,.041,0]],.008,.007);
      s.strand(head,v.hair,[[side*.044,.080,.176],[side*.089,.087,.166],[side*.137,.073,.148]],.010,.007);
    }
    const upper=joint(body,'upper'+side,side*.211,.151,0);
    s.oval(upper,v.sleeve,[side*.010,-.071,0],[.083,.116,.083]);
    s.band(upper,v.sleeve,[0,-.135,0],.069,.061,.131,.97);
    const elbow=joint(upper,'elbow'+side,0,-.209,0);
    const cuff=look==='grok'||look==='dragon';
    s.band(elbow,v.sleeve,[0,-.085,0],.064,cuff?.098:.060,.169,.96);
    s.band(elbow,look==='generic'?'#bb9b71':cream,[0,-.168,0],cuff?.098:.063,cuff?.101:.065,.027,.96);
    s.oval(elbow,skin,[0,-.21,.012],[.051,.065,.048]);
    s.oval(elbow,skin,[-side*.037,-.198,.032],[.022,.040,.022],[.20,0,side*.25]);
    const leg=joint(rig,'hip'+side,side*.096,hipHeight,0);
    s.oval(leg,look==='generic'?'#465b58':cream,[0,-.105,0],[.078,.150,.075]);
    const knee=joint(leg,'knee'+side,0,-shinPivotDrop,0);
    const socks=look==='grok'?'#52444f':look==='rainbow'?'#e6d9ec':look==='generic'?'#415759':'#f7e9d9';
    s.oval(knee,socks,[0,.004,0],[.062,.056,.066]);
    s.band(knee,socks,[0,-.116,0],.061,.052,.257,.98);
    s.oval(knee,look==='dragon'?'#bfb2cc':look==='grok'?'#453441':'#735449',[0,-shoeCenterDrop,.037],[.071,shoeHalfHeight,.109]);
    s.oval(knee,'#574c4c',[0,-soleCenterDrop,.040],[.073,soleHalfHeight,.113]);
    s.band(knee,look==='grok'?'#514052':'#a28471',[0,-.239,-.005],.055,.057,.068,1);
  }
  if(look==='generic'){
    s.oval(head,skin,[0,-.043,.188],[.019,.028,.022]);
    s.strand(head,'#9c6a60',[[-.033,-.103,.177],[0,-.111,.184],[.034,-.098,.179]],.006,.005);
  }
  hairAndHeadwear(s,head,look);clothing(s,body,look);
  const ledger=joint(root.getObjectByName('elbow1')!,'work-ledger',-.012,-.217,.025);
  for(const {color,offset,size} of townResidentLedger)s.box(ledger,color,offset,size);
  ledger.visible=false;
  if(look==='generic'){
    for(const side of [-1,1])s.strand(body,'#745b41',[[side*.062,.209,.048],[side*.094,.148,.127],[0,.069,.165]],.009,.008);
    s.shape(body,new T.CylinderGeometry(.098,.093,.025,24),'#b79b69',[0,.001,.162],[1,1,1],[Math.PI/2,0,0]);
    s.shape(body,new T.CylinderGeometry(.087,.087,.020,24),'#536966',[0,.001,.183],[1,1,1],[Math.PI/2,0,0]);
  }
  const material=finish();s.bake(material);
  return {root,material,releaseFace,users:0};
}
const templates=new Map<Look,ReturnType<typeof sculpt>>();

/** Owner of the visitor frame supplies pose time in seconds and a normalized
 * walking amount. It also owns approved badge textures and stale-load checks. */
export function createBothouseResidentModel(appearanceKey:string){
  const look:Look=Object.hasOwn(costumes,appearanceKey)?appearanceKey as Look:'generic';
  let prototype=templates.get(look);
  if(!prototype){prototype=sculpt(look);templates.set(look,prototype);}
  const asset=prototype;asset.users++;
  const root=asset.root.clone(true);
  const get=(name:string)=>root.getObjectByName(name)!;
  const body=get('body'),rig=get('rig'),head=get('head');
  const ledger=get('work-ledger');
  const face=root.getObjectByName('authored-face') as T.Mesh|undefined;
  const limbs=[-1,1].map(side=>({side,arm:get('upper'+side),elbow:get('elbow'+side),hip:get('hip'+side),knee:get('knee'+side),eye:get('eye'+side)}));
  const badge=new T.Mesh(new T.CircleGeometry(.082,32),new T.MeshStandardMaterial({color:0xffffff,roughness:.86,metalness:0}));
  badge.name='public-portrait-badge';
  badge.position.set(0,.001,look==='generic'?.195:.22);
  badge.visible=false;
  body.add(badge);
  let disposed=false;
  const animate=(activity:Activity,seconds:number,reducedMotion:boolean,walk=0)=>{
    const t=reducedMotion?0:seconds,pace=reducedMotion?0:T.MathUtils.clamp(walk,0,1);
    const rest=activity==='offline',think=activity==='thinking',talk=activity==='talking',work=activity==='working';
    const swing=Math.sin(t*6.2)*pace;
    rig.position.y=-standingSoleOffset+Math.abs(swing)*.014;
    ledger.visible=work;
    body.rotation.x=work?.10:rest?.045:.018*pace;
    head.rotation.set(think?.10:work?.14:rest?.19:talk?-.025:0,reducedMotion?0:Math.sin(t*.73)*.042,think?-.105:0);
    if(face?.morphTargetInfluences&&face.morphTargetDictionary){
      const weights=face.morphTargetInfluences, keys=face.morphTargetDictionary;
      weights[keys.blink]=rest?.58:!reducedMotion&&t%5.1>.12&&t%5.1<.23?1:0;
      weights[keys.speech]=talk?(reducedMotion?.16:.19+.16*Math.sin(t*13)):0;
    }
    for(const l of limbs){
      const sign=l.side;
      if(l.eye)l.eye.scale.y=rest?.40:!reducedMotion&&t%5.1>.12&&t%5.1<.23?.16:1;
      l.hip.rotation.x=sign*swing*.48;l.knee.rotation.x=Math.max(0,-sign*swing)*.56;
      const book=look==='orange';
      if(work){
        // Hold the reader's ledger beside the hair and sleeves. The free
        // hand repeats the town sorter's small reach as the resident works.
        const holding=sign===1;
        l.arm.rotation.set(holding?-.61:-.68+(reducedMotion?0:Math.sin(t*2.8)*.10),0,holding?.19:-.42);
        l.elbow.rotation.set(holding?-.79:-.77,0,holding?-.32:.18);
      }else{
        l.arm.rotation.set(think&&sign===1?-.82:talk&&sign===1?-.49:book?-.50:sign*swing*.31,0,
          -sign*(book?.09:talk&&sign===1?.33:think&&sign===1?.10:.07));
        l.elbow.rotation.set(think&&sign===1?-1.55:talk&&sign===1?-.85:book?-.92:-.18,0,think&&sign===1?-.37:book?-sign*.43:0);
      }
    }
    if(work)ledger.rotation.set(1.37,.08,-.36);
  };
  animate('idle',0,true);
  return {root,animate,
    setBadge(texture:T.Texture|null){
      if(disposed)return;
      badge.material.map=texture;badge.material.needsUpdate=true;badge.visible=!!texture;
    },
    dispose(){
      if(disposed)return;disposed=true;root.removeFromParent();
      badge.material.map=null;badge.material.dispose();badge.geometry.dispose();
      if(--asset.users===0){
        asset.root.traverse(node=>{if(node instanceof T.Mesh)node.geometry.dispose();});
        asset.releaseFace?.();asset.material.dispose();templates.delete(look);
      }
    }
  };
}
