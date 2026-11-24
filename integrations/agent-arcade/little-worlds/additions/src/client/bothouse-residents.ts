import * as T from 'three';
import { portPoint } from '../shared/ports.ts';
import { GroundWorld, STEP_HEIGHT } from '../shared/physics/world.ts';
import { TownResidentMotion } from '../shared/town-resident-motion.ts';
import type { Vec3 } from '../shared/world.ts';
import type { PlanetResident } from '../shared/planet-residents.ts';
import { residentPortrait } from '../shared/resident-portrait.ts';
import { createBothouseResidentModel } from './bothouse-resident-model.ts';

type Resident = PlanetResident & Parameters<typeof residentPortrait>[1];
type Portrait = ReturnType<typeof residentPortrait>;
const actions = {
  idle:['Idle','休息中'], thinking:['Thinking','思考中'], working:['Working','工作中'],
  talking:['Talking','说话中'], waiting:['Waiting','等待中'], offline:['Offline','离线'],
  unknown:['Status unknown','状态未知'],
} as const;
const zh=()=>document.documentElement.lang.startsWith('zh');

class ResidentFigure {
  readonly model: ReturnType<typeof createBothouseResidentModel>;
  readonly motion: TownResidentMotion;
  readonly card = document.createElement('span');
  private label = new T.Sprite(new T.SpriteMaterial({transparent:true,depthWrite:false,toneMapped:false}));
  private up=new T.Vector3();
  private forward=new T.Vector3();
  private right=new T.Vector3();
  private basis=new T.Matrix4();
  private turn=new T.Quaternion();
  private phase:number;
  private elapsed=0;
  private step=0;
  private badge?:T.Texture;
  private portrait:Portrait;
  private image?:HTMLImageElement;
  private disposed=false;
  private lastText='';
  private text=document.createElement('span');

  constructor(scene:T.Scene, world:GroundWorld, public role:Resident, readonly slot:number,
    feet:T.Vector3, readonly key:string, portrait:Portrait) {
    this.model=createBothouseResidentModel(key);
    this.model.animate(role.activity,0,true);
    const start=feet.clone().normalize(), pad=portPoint(world.planetId);
    const outward=start.clone().sub(new T.Vector3(...pad)).projectOnPlane(start).normalize();
    const end=start.clone().addScaledVector(outward,1.15/world.baseRadius).normalize().toArray() as Vec3;
    this.phase=slot*.75;
    this.motion=new TownResidentMotion(world,{position:start.toArray() as Vec3,facing:pad,
      route:[start.toArray() as Vec3,end],activity:'walk',phase:this.phase,speed:.55});
    this.label.scale.set(1.38,.33,1);
    scene.add(this.model.root,this.label);
    this.align(true,0);
    this.model.root.visible=this.label.visible=this.motion.valid;
    this.card.append(this.text);
    this.update(role,portrait);
  }
  private setPortrait(portrait:Portrait) {
    if(this.portrait?.url===portrait?.url){this.portrait=portrait;return;}
    this.portrait=portrait;
    this.model.setBadge(null);this.badge?.dispose();this.badge=undefined;
    this.image?.remove();this.image=undefined;
    if(portrait){
      const img=this.image=document.createElement('img');
      img.width=32;img.height=32;img.alt='';img.style.verticalAlign='middle';img.style.objectFit='contain';
      img.addEventListener('error',()=>img.hidden=true,{once:true});
      img.addEventListener('load',()=>{
        if(this.disposed||this.image!==img)return;
        const texture=new T.Texture(img);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
        this.badge=texture;this.model.setBadge(texture);
      },{once:true});
      img.src=portrait.url;
      this.card.prepend(img);
    }
  }
  update(role:Resident,portrait:Portrait) {
    this.setPortrait(portrait);
    if(role.activity!==this.role.activity)this.model.animate(role.activity,0,true);
    this.role=role;
    const activity=actions[role.activity][zh()?1:0], title=role.displayName+' · '+activity;
    this.text.textContent=title+(portrait?' ('+portrait.credit+')':'');
    if(this.lastText===title)return;
    this.lastText=title;
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=112;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='rgba(26,46,49,.92)';ctx.beginPath();ctx.roundRect(0,0,480,112,24);ctx.fill();
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='600 37px system-ui';
    ctx.fillText(role.displayName,240,47,452);ctx.fillStyle='#ceeddf';ctx.font='31px system-ui';
    ctx.fillText(activity,240,93,452);
    this.label.material.map?.dispose();
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    this.label.material.map=texture;this.label.material.needsUpdate=true;
  }
  private align(initial:boolean,dt:number) {
    const {motion,model}=this;
    this.up.fromArray(motion.pose.position);
    this.forward.fromArray(motion.heading).projectOnPlane(this.up).normalize();
    this.right.crossVectors(this.up,this.forward).normalize();
    this.forward.crossVectors(this.right,this.up).normalize();
    this.turn.setFromRotationMatrix(this.basis.makeBasis(this.right,this.up,this.forward));
    if(initial)model.root.quaternion.copy(this.turn);
    else model.root.quaternion.rotateTowards(this.turn,dt*2.7);
    model.root.position.copy(this.up).multiplyScalar(motion.pose.radius);
    this.label.position.copy(this.up).multiplyScalar(motion.pose.radius+1.99);
  }
  frame(dt:number,reduced:boolean,viewer:Vec3,neighbours:Vec3[]) {
    if(!this.motion.valid)return;
    const activity=this.role.activity, live=activity!=='offline'&&activity!=='unknown';
    if(!reduced&&live)this.elapsed+=dt;
    // A short walk between rests uses the same capsule, slope and neighbour checks as town residents.
    if(!reduced&&activity==='idle'){
      this.step+=dt;
      if(this.step>=.05){this.motion.tick(this.step,viewer,neighbours);this.step=0;}
    }else{this.motion.moving=false;this.step=0;}
    this.align(false,live&&!reduced?dt:0);
    this.model.animate(activity,this.elapsed+this.phase,reduced||!live,Number(this.motion.moving));
  }
  setVisible(visible:boolean) {this.model.root.visible=this.label.visible=visible;}
  dispose() {
    this.disposed=true;this.model.root.removeFromParent();this.model.dispose();this.badge?.dispose();
    this.label.removeFromParent();this.label.material.map?.dispose();this.label.material.dispose();
    this.card.remove();
  }
}

// Use the same support and capsule checks as TownResidentMotion. Hub-authored shops do not exist on a garden.
function landingSites(world:GroundWorld,count:number) {
  const sites:T.Vector3[]=[];
  const pad=new T.Vector3(...portPoint(world.planetId));
  const north=new T.Vector3(0,0,-1).projectOnPlane(pad).normalize();
  const east=new T.Vector3().crossVectors(north,pad),radius=world.baseRadius;
  for(let distance=3.5;distance<Math.PI*radius-1&&sites.length<count;distance+=2.6){
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
      if(!world.blocked(pose)&&sites.every(site=>site.distanceToSquared(feet)>1.8**2))sites.push(feet);
    }
  }
  return sites;
}

/** Fence every asynchronous roster read to its acknowledged outdoor visit. */
export class BothouseResidents {
  private visit='';private next=0;
  private request:AbortController|null=null;
  private seats:T.Vector3[]=[];
  private center=new T.Vector3();
  private frustum=new T.Frustum();
  private projection=new T.Matrix4();
  private bounds=new T.Sphere(new T.Vector3(),1.5);
  private figures=new Map<string,ResidentFigure>();
  private summary=document.createElement('p');
  private settings=document.createElement('a');
  private closure=document.createElement('aside');
  private closureText=document.createElement('p');
  private back=document.createElement('a');
  constructor(private scene:T.Scene,private reduced:boolean) {
    this.summary.className='presence-summary';this.summary.id='bothouse-residents';
    this.summary.dataset.i18nVerbatim='';this.summary.hidden=true;
    document.querySelector('#presence-summary')!.after(this.summary);
    this.closure.id='friend-visit-closure';this.closure.hidden=true;this.closure.dataset.i18nVerbatim='';
    this.closureText.setAttribute('role','status');
    this.back.href='/.well-known/agent-arcade-return-chat';this.back.className='quiet';
    this.back.hidden=new URLSearchParams(location.search).get('appReturn')!=='chat';
    this.closure.append(this.closureText,this.back);
    document.querySelector('.minimal-bar')!.after(this.closure);
    this.settings.href='/resident-settings';this.settings.className='quiet';this.settings.hidden=true;
    document.querySelector('#planet-card .planet-actions')!.append(this.settings);
  }
  frame(world:GroundWorld|null,planet:string|null,epoch:number,now:number,owner:boolean) {
    this.settings.hidden=!owner;
    const settingsText=zh()?'连接星球搭档':'Connect planet companions';
    if(owner&&this.settings.textContent!==settingsText)this.settings.textContent=settingsText;
    if(!this.closure.hidden){
      const welcome=document.querySelector('#welcome-panel[open] .welcome-card');
      const host=document.querySelector('.scene-loading-overlay[open]')??welcome??document.body;
      if(this.closure.parentElement!==host){
        if(host===welcome)host.prepend(this.closure);
        else host.append(this.closure);
      }
    }
    const visit=planet?planet+'/'+epoch+'/'+(world?.revision??'loading'):'';
    if(visit!==this.visit){
      this.visit=visit;this.request?.abort();this.request=null;this.clear();this.closure.hidden=true;this.next=0;
    }
    if(!planet||now<this.next||this.request)return;
    const request=this.request=new AbortController();
    void this.refresh(planet,world,request);
  }
  animate(dt:number,viewer:Vec3,camera:T.Camera,enabled:boolean) {
    if(!this.figures.size)return;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const near:ResidentFigure[]=[];
    for(const f of this.figures.values()){
      const pose=f.motion.pose;
      this.center.fromArray(pose.position);
      this.bounds.center.copy(this.center).multiplyScalar(pose.radius+.9);
      const visible=f.motion.valid&&this.frustum.intersectsSphere(this.bounds)&&
        this.bounds.center.dot(camera.position)>=pose.radius**2-2.8*camera.position.length();
      f.setVisible(visible);
      if(enabled&&visible&&this.bounds.center.distanceTo(camera.position)<18)near.push(f);
    }
    // Include neighbours just outside the camera, as well as those being animated.
    for(const f of near){
      const neighbours:Vec3[]=[];
      if(f.role.activity==='idle'&&!this.reduced){
        for(const other of this.figures.values())if(other!==f&&other.motion.valid)neighbours.push(other.motion.pose.position);
      }
      f.frame(dt,this.reduced,viewer,neighbours);
    }
  }
  /** Opt-in frame evidence; uses the same transforms rendered in the game. */
  snapshot(camera:T.Camera) {
    return Array.from(this.figures.values(),f=>{
      const root=f.model.root;
      const center=root.position.clone().addScaledVector(new T.Vector3(...f.motion.pose.position),.8).project(camera);
      let meshes=0,sprites=0;
      root.traverse(node=>{if(node instanceof T.Mesh)meshes++;if(node instanceof T.Sprite)sprites++;});
      const badge=root.getObjectByName('public-portrait-badge') as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>|undefined;
      const badgeImage=badge?.visible?badge.material.map?.image as HTMLImageElement|undefined:undefined;
      return {id:f.role.id,model:root.name,body:root.uuid,badge:badgeImage?.getAttribute('src')??null,look:f.key,activity:f.role.activity,position:root.position.toArray(),
        rotation:root.quaternion.toArray(),moving:f.motion.moving,meshes,sprites,center:center.toArray()};
    });
  }
  private clear() {
    for(const figure of this.figures.values())figure.dispose();
    this.seats=[];this.figures.clear();this.summary.hidden=true;this.summary.replaceChildren();
  }
  private async refresh(planet:string,world:GroundWorld|null,request:AbortController) {
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);
      const response=await fetch('/api/planets/'+encodeURIComponent(planet)+'/residents',{cache:'no-store',signal});
      if(!response.ok)throw Error('Roster unavailable');
      const {residents,visitClosed,visitReopen}=await response.json() as {
        residents:Resident[];visitClosed?:boolean;visitReopen?:boolean
      };
      if(request!==this.request)return;
      this.closure.hidden=!visitClosed&&!visitReopen;
      if(visitClosed||visitReopen){
        this.clear();
        if(visitClosed){
          this.closureText.textContent=zh()?'好友来访已关闭。':'This friend visit has closed.';
        }else if(this.back.hidden){
          this.closureText.textContent=zh()
            ?'请用上方的「返回消息」回到原聊天，再打开好友星球。'
            :'Use Return to messages above, then reopen your friend’s planet from the original chat.';
        }else{
          this.closureText.textContent=zh()
            ?'请返回原聊天，再打开好友星球。'
            :'Return to the original chat, then reopen your friend’s planet.';
        }
        this.back.textContent=zh()?'返回原聊天':'Return to chat';
        return;
      }
      if(!world)return;
      const ids=new Set(residents.map(r=>r.id));
      for(const [id,figure] of this.figures)if(!ids.has(id)){figure.dispose();this.figures.delete(id);}
      const used=new Set(Array.from(this.figures.values(),f=>f.slot));
      const needed=Math.max(residents.length,...Array.from(used,i=>i+1));
      if(this.seats.length<needed)this.seats=landingSites(world,needed);
      const seats=this.seats;
      const cards:(Node|string)[]=[];
      for(const role of residents){
        if(!Object.hasOwn(actions,role.activity))role.activity='unknown';
        const portrait=residentPortrait(planet,role);
        const key=portrait===undefined?role.appearanceKey:'default';
        let figure=this.figures.get(role.id);
        if(!figure||figure.key!==key){
          const slot=figure?.slot??seats.findIndex((_,i)=>!used.has(i));
          if(slot<0||!seats[slot])continue;
          figure?.dispose();figure=new ResidentFigure(this.scene,world,role,slot,seats[slot],key,portrait);
          used.add(slot);this.figures.set(role.id,figure);
        }else figure.update(role,portrait);
        if(cards.length)cards.push(' / ');cards.push(figure.card);
      }
      this.summary.replaceChildren(...cards);this.summary.hidden=!cards.length;
    }catch{
      if(request!==this.request)return;
      this.clear();
      if(new URLSearchParams(location.search).get('visit')===planet&&!this.closure.hidden)return;
      this.summary.textContent=zh()?'暂时看不到搭档的动态。':'Companion activity is unavailable.';this.summary.hidden=false;
    }finally{if(request===this.request){this.request=null;this.next=performance.now()+3000;}}
  }
}
