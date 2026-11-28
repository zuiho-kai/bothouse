import type {Vec3} from '../shared/world.ts';
import {ART_PALETTE} from './art-profile.ts';

// The town reader's book, centred on the cover instead of the reader's body.
export const townResidentLedger: ReadonlyArray<{color:string; offset:Vec3; size:Vec3; detail?:boolean}> = [
  {color:ART_PALETTE.clay, offset:[0,0,0], size:[.39,.065,.27]},
  {color:ART_PALETTE.cream, offset:[0,.04,0], size:[.35,.025,.23]},
  {color:ART_PALETTE.wood, offset:[0,.057,0], size:[.018,.012,.23], detail:true},
];
