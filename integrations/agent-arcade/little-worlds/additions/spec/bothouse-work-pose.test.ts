import {expect,it} from 'vitest';
import {createBothouseResidentModel} from '../src/client/bothouse-resident-model.ts';

it('shows the town ledger for work and keeps the reduced-motion pose still',()=>{
  const resident=createBothouseResidentModel('dragon');
  try{
    const ledger=resident.root.getObjectByName('work-ledger')!;
    const rig=resident.root.getObjectByName('rig')!;
    const hand=resident.root.getObjectByName('elbow1');
    const footBaseline=rig.position.y;
    expect(ledger.parent).toBe(hand);
    expect(ledger.visible).toBe(false);

    resident.animate('working',2,true);
    expect(ledger.visible).toBe(true);
    const still=ledger.getWorldQuaternion(ledger.quaternion.clone()).toArray();
    resident.animate('working',8,true);
    expect(ledger.getWorldQuaternion(ledger.quaternion.clone()).toArray()).toEqual(still);
    expect(rig.position.y).toBe(footBaseline);

    for(const activity of ['idle','thinking','talking','waiting','offline','unknown'] as const){
      resident.animate('working',1,false);
      resident.animate(activity,2,false);
      expect(ledger.visible).toBe(false);
    }
  }finally{resident.dispose();}
});
