import * as T from 'three';
import {Sculpture,type Point} from './bothouse-sculpt-model.ts';
import type {residentBodyLooks} from '../shared/planet-residents.ts';

const ivory='#ffedcf',inky='#393440',gold='#d8a354',silver='#b8afce',skin='#efd0ae';
export const costumes={
  orange:{hair:'#b55832',light:'#e69a62',tips:'#c16c3e',coat:'#4b3934',sleeve:'#ffdfb2',skirt:'#f0d6aa',eye:'#9b512d'},
  dragon:{hair:'#e4dbeb',light:'#fff6f3',tips:'#b6a5d0',coat:'#eee6f2',sleeve:'#f3eaf1',skirt:'#e4dced',eye:'#84709e'},
  whale:{hair:'#344975',light:'#566e99',tips:'#527998',coat:'#2b4366',sleeve:'#30476c',skirt:'#293d5c',eye:'#5789af'},
  rainbow:{hair:'#655497',light:'#9384cf',tips:'#c279cc',coat:'#494673',sleeve:'#635687',skirt:'#696291',eye:'#c57b38'},
  grok:{hair:'#e5be82',light:'#ffe4b4',tips:'#c89e69',coat:'#342c39',sleeve:'#3f3340',skirt:'#382e3d',eye:'#5487ba'},
  lanxi:{hair:'#e58055',light:'#ffad79',tips:'#db7a86',coat:'#f3dfbe',sleeve:'#ffe9c9',skirt:'#dd8b87',eye:'#ab653e'},
  generic:{hair:'#5a4542',light:'#77594d',tips:'#5a4542',coat:'#4f7577',sleeve:'#62888a',skirt:'#54696a',eye:'#5b6d5f'}
} satisfies Record<(typeof residentBodyLooks)[number] | 'generic', Record<string,string>>;
export type Look=keyof typeof costumes;
function bow(s:Sculpture,p:T.Object3D,x:number,y:number,z:number,color:string,size:number){
  for(const side of [-1,1]){
    s.oval(p,color,[x+side*size*.51,y+.009,z],[size*.53,size*.31,size*.19],[0,0,side*.28]);
    s.strand(p,color,[[x,y,z],[x+side*size*.32,y-size*.47,z],[x+side*size*.49,y-size*.86,z-.012]],size*.21,size*.07);
  }
  s.oval(p,color,[x,y,z+.005],[size*.22,size*.22,size*.21]);
}
function star(s:Sculpture,p:T.Object3D,c:string,pos:Point,r:number){
  const pts=Array.from({length:10},(_,i)=>{const a=Math.PI*.5+i*Math.PI/5,k=i%2?r*.48:r;return [Math.cos(a)*k,Math.sin(a)*k];});
  s.panel(p,c,pts,pos,.009);
}
function membrane(s:Sculpture,p:T.Object3D,side:number,small:boolean){
  const points=small?[[0,0],[.04,.08],[.105,.045],[.13,.10],[.205,.015],[.226,-.066],[.16,-.04],[.125,-.09],[.08,-.045],[.038,-.072]]:
    [[0,-.025],[.12,.10],[.27,.20],[.37,.21],[.32,.11],[.35,-.06],[.27,-.018],[.18,-.115],[.13,-.067],[.045,-.145]];
  const orig:Point=small?[side*.22,.16,-.035]:[side*.105,.10,-.155];
  const wing=new T.Group();p.add(wing);wing.position.set(...orig);wing.rotation.y=side*(small?.12:.53);wing.name=small?'bat-ribbon':'dragon-wing';
  s.panel(wing,small?'#4c3a4f':'#c6b4d8',points.map(([x,y])=>[side*x,y]),[0,0,0],small?.017:.026);
  if(!small){
    for(const [x,y] of [[.35,-.06],[.18,-.115],[.045,-.145]]){
      s.strand(wing,'#9387ac',[[side*.35,.202,.029],[side*(x+.35)*.48,.082,.033],[side*x,y,.03]],.009,.009);
    }
  }
}
export function hairAndHeadwear(s:Sculpture,h:T.Group,k:Look){
  const v=costumes[k];
  // Scalp envelops the back of the head. The overlapping tapered fringe
  // leaves the eyes unobscured and carries on around the temples.
  s.shape(h,new T.SphereGeometry(1,18,10,0,2*Math.PI,0,1.46),v.hair,[0,.033,-.013],[.221,.223,.205]);
  s.oval(h,v.hair,[0,.025,-.084],[.222,.225,.146]);
  for(const [x,y,end] of [[-.14,.19,-.188],[-.079,.21,-.14],[.035,.22,-.053],[.11,.208,.078],[.142,.18,.176]]){
    const terminalY=Math.abs(end)>.14?-.018:.051;
    s.strand(h,v.hair,[[x,y,.080],[x*.97,y*.77,.15],[end*.99,.106,.186],[end,terminalY,.181]],.062,.035,v.light);
  }
  const long=k==='orange'||k==='dragon'||k==='whale'||k==='rainbow';
  if(long){
    const length=k==='orange'?.75:k==='dragon'?.66:.52;
    for(let i=-3;i<=3;i++){
      const x=i*.057,a=i/3,wave=k==='dragon'?.055:k==='whale'?.069:.041;
      const direction=i<0?-1:1, tipx=x*1.34+direction*wave;
      const tone=new T.Color(v.hair).lerp(new T.Color(v.light),i%2===0?.32:.06).getStyle();
      const points:Point[]=[[x*.7,.173,-.10],[x*1.15,.01,-.179+.063*a*a],
        [x*1.34+wave*.48,-length*.35,-.197+.064*a*a],[x*1.27-wave*.51,-length*.64,-.229+.045*a*a],
        [tipx+direction*.025,-length*.86,-.218],[tipx,-length+Math.abs(a)*.074,-.187]];
      s.strand(h,tone,points,.068,.058,v.tips,[.46,.08]);
      if(i%2===0){
        const glint=points.slice(1,5).map(([px,py,pz]):Point=>[px+.010,py,pz-.050]);
        s.strand(h,v.light,glint,.012,.007,v.tips,[.12,.03]);
      }
    }
  }
  for(const side of [-1,1]){
    const bob=k==='lanxi'||k==='grok'||k==='generic';
    const end=bob?-.22:k==='dragon'?-.42:-.40;
    const x=side*.191;
    s.strand(h,v.hair,[[x*.72,.17,.084],[x,.081,.097],[x*1.11,-.081,.093],
      [x*1.08,end*.68,.102],[x*(k==='lanxi'?1.35:1.14),end,.085]],bob?.049:.073,.050,v.tips);
    if(long&&k!=='dragon')s.strand(h,v.light,[[x,.07,-.02],[x*1.28,-.085,.004],[x*1.17,-.22,.026],[x*1.42,-.33,.010],[x*1.33,-.44,.035]],.050,.042,v.tips);
  }
  switch(k){
    case 'orange':{
      // Flower and black ribbon share one clasp at the wearer's left temple.
      bow(s,h,.207,.116,.145,inky,.110);
      const x=.174,y=.153,z=.204;
      for(let i=0;i<11;i++){
        const a=i*2*Math.PI/11;s.oval(h,i%2?'#be702f':'#f4b856',[x+.048*Math.cos(a),y+.048*Math.sin(a),z],[.017,.033,.013],[0,0,a-Math.PI/2]);
      }
      s.oval(h,'#956136',[x,y,z+.009],[.028,.028,.021]);
      for(const side of [-1,1])s.strand(h,ivory,[[.216,.12,.15],[.247+side*.014,.038,.129],[.262+side*.018,-.050,.112]],.015,.009);
      break;
    }
    case 'dragon':{
      for(const side of [-1,1]){
        s.strand(h,'#c9bad7',[[side*.143,.158,-.056],[side*.202,.231,-.065],[side*.203,.304,-.07],[side*.166,.357,-.079]],.046,.040,'#fff5e9',[.64,.015]);
        for(const [x,y] of [[.180,.202],[.204,.253],[.201,.286]])s.oval(h,'#b4a1c2',[side*x,y,-.066],[.035,.009,.032],[0,0,-side*.2]);
        s.panel(h,skin,[[0,-.045],[side*.115,.044],[side*.038,-.071]],[side*.175,.005,.03],.025);
      }
      for(let a=0;a<6;a++){const t=a*Math.PI/3;s.oval(h,'#a899be',[.190+.028*Math.cos(t),.12+.028*Math.sin(t),.193],[.026,.018,.014],[0,0,t+.8]);}
      s.oval(h,ivory,[.190,.12,.209],[.021,.018,.012]);break;
    }
    case 'whale':{
      for(let i=0;i<=10;i++){
        const a=i/10*Math.PI;
        s.oval(h,'#f3e9de',[.226*Math.cos(a),.044+.215*Math.sin(a),.004],[.039,.041,.056],[0,0,a-Math.PI/2]);
      }
      for(const side of [-1,1])bow(s,h,side*.219,.057,.119,'#659cc6',.072);
      break;
    }
    case 'rainbow':{
      for(const side of [-1,1]){
        const pts=[[0,0],[side*.017,.181],[side*.137,.036]];
        s.panel(h,'#7867ac',pts,[side*.104,.142,-.014],.074,[0,0,-side*.08]);
        s.panel(h,'#ebb2bf',[[0,0],[side*.016,.112],[side*.089,.021]],[side*.122,.176,.067],.008,[0,0,-side*.08]);
      }
      star(s,h,'#e3ba56',[.17,.115,.195],.080);
      const colors=['#d69ed3','#93d3d8','#8398da','#ffd07c','#e9b5cf'];
      for(let i=0;i<5;i++){
        const a=Math.PI/2+i*2*Math.PI/5,b=a+Math.PI/5;
        s.panel(h,colors[i],[[0,0],[Math.cos(a)*.070,Math.sin(a)*.070],[Math.cos(b)*.032,Math.sin(b)*.032]],[.17,.115,.210],.004);
      }
      for(const side of [-1,1])s.strand(h,v.light,[[side*.156,.148,-.061],[side*.235,.176,-.083],[side*.259,.118,-.11],[side*.211,.078,-.12]],.047,.037,v.hair);
      break;
    }
    case 'grok':{
      for(const side of [-1,1]){
        const plume:Point[]=[[side*.168,.18,-.03],[side*.256,.199,-.083],[side*.296,.017,-.103],
          [side*.273,-.22,-.125],[side*.342,-.38,-.09],[side*.376,-.45,-.053],[side*.323,-.50,-.048]];
        s.strand(h,v.hair,plume,.082,.070,v.light,[.50,.05]);
        s.strand(h,v.light,plume.slice(1).map(([px,py,pz])=>[px+side*.032,py,pz+.031]),.028,.022,v.tips);
        bow(s,h,side*.205,.169,-.008,'#352b39',.079);membrane(s,h,side,true);
        s.panel(h,skin,[[0,-.045],[side*.09,.035],[side*.035,-.057]],[side*.176,-.016,.03],.024);
      }
      s.band(h,gold,[0,.237,0],.087,.079,.023,.83);
      for(let i=0;i<5;i++){
        const a=i*2*Math.PI/5;s.shape(h,new T.ConeGeometry(.022,.056,5),gold,[.072*Math.sin(a),.264,.063*Math.cos(a)]);
      }
      s.oval(h,'#8f5563',[0,.258,.065],[.014,.016,.009]);break;
    }
    case 'lanxi':{
      s.oval(h,'#fbedd6',[-.017,.207,-.016],[.242,.109,.215],[0,0,-.13]);
      s.band(h,'#b96d62',[-.009,.164,.004],.215,.214,.020,.91,[0,0,-.10]);
      s.oval(h,ivory,[-.017,.176,.104],[.211,.041,.126],[.08,0,-.11]);
      for(const side of [-1,1])for(let n=0;n<3;n++){
        const x=side*(.075+n*.045);
        s.strand(h,n%2?v.hair:v.light,[[x,.111,-.144],[x*1.2,-.027,-.198+n*.018],
          [x*1.34,-.121,-.162],[x*1.22,-.177,-.158],[x*1.63,-.210+n*.009,-.120]],.051,.046,v.tips);
      }
      bow(s,h,-.213,.11,.116,'#bf5268',.074);
      for(let i=-1;i<=1;i++)s.box(h,'#cf7771',[.009+i*.018,.222,.185],[.010,i===0?.049:.027,.009],[0,0,.08]);
      break;
    }
  }
}

export function clothing(s:Sculpture,body:T.Group,k:Look){
  const v=costumes[k];
  if(k==='generic'){
    s.band(body,v.coat,[0,-.13,0],.178,.217,.25,.77);
    s.oval(body,'#dec098',[0,.185,.067],[.144,.047,.11]);
    s.box(body,'#9e714d',[.126,-.10,-.133],[.04,.40,.038],[0,0,-.47]);
    s.oval(body,'#b58b62',[.111,-.126,-.163],[.113,.12,.05]);return;
  }
  const dress=k==='dragon'||k==='orange'||k==='grok';
  const hem=dress?-.59:k==='lanxi'?-.44:-.41;
  const wide=k==='grok'?.31:k==='dragon'?.287:.261;
  s.skirt(body,k==='grok'?'#a58054':ivory,.136,wide*.97,-.14,hem-.018,1);
  s.skirt(body,v.skirt,.135,wide,-.105,hem,1);
  s.skirt(body,k==='grok'?'#ba9361':k==='dragon'?'#c4b7d5':k==='lanxi'?'#f0b8aa':ivory,wide-.003,wide+.004,hem+.027,hem+.010,1);
  s.band(body,k==='dragon'?silver:k==='lanxi'?'#bd746a':gold,[0,-.076,0],.151,.151,.032,.90);
  if(k==='orange'){
    for(const side of [-1,1])s.strand(body,'#b3744d',[[side*.11,-.114,.080],[side*.17,-.30,.12],[side*.214,hem,.115]],.035,.024);
    s.oval(body,ivory,[0,.169,.102],[.139,.066,.065]);bow(s,body,0,.142,.155,'#bd773f',.056);
    // Closed, embossed book with a page block sandwiched between two covers.
    const book=new T.Group();book.name='bound-book';body.add(book);book.position.set(-.046,-.026,.218);book.rotation.set(-.13,-.12,-.22);
    s.box(book,'#edd2a1',[0,0,0],[.161,.222,.035]);
    for(const z of [-.021,.021])s.box(book,'#694733',[0,0,z],[.175,.238,.013]);
    s.box(book,'#49332d',[-.085,0,0],[.023,.235,.048]);star(s,book,gold,[0,0,.034],.035);
    for(const side of [-1,1]){
      s.box(book,gold,[side*.072,0,.030],[.006,.211,.004]);
      s.box(book,gold,[0,side*.105,.030],[.146,.006,.004]);
    }
  }else if(k==='dragon'){
    for(const side of [-1,1]){
      membrane(s,body,side,false);
      s.strand(body,'#ae9cbe',[[side*.143,.164,.078],[side*.093,.091,.14],[.008,-.022,.153]],.020,.010);
      s.strand(body,'#bcb1cd',[[side*.089,-.14,.104],[side*.12,-.32,.15],[side*.157,hem,.17]],.013,.009);
    }
    s.oval(body,'#8979ad',[0,.069,.159],[.026,.036,.017]);
  }else if(k==='whale'){
    s.oval(body,'#f7eddc',[0,-.191,.126],[.162,.202,.053]);
    for(const side of [-1,1])s.strand(body,ivory,[[side*.13,.207,.062],[side*.129,.105,.137],[side*.093,-.02,.144]],.026,.012);
    s.oval(body,'#689bbe',[0,-.224,.18],[.057,.030,.008]);
    for(const x of [-.137,.137])for(let i=0;i<5;i++)s.oval(body,ivory,[x*(1-i*.07),-.093-i*.052,.147],[.029,.038,.015]);
    s.panel(body,'#689bbe',[[0,0],[.031,.035],[.047,.038],[.04,.016],[.059,.01],[.047,-.005],[.013,-.012]],[.036,-.217,.181],.008);
    bow(s,body,0,-.07,-.17,ivory,.113);
  }else if(k==='rainbow'){
    s.oval(body,ivory,[0,.147,.099],[.148,.077,.071]);bow(s,body,0,.122,.158,'#66558e',.084);
    star(s,body,'#e6b760',[0,.122,.187],.031);
    for(const side of [-1,1])s.strand(body,'#ab8ec3',[[side*.079,-.10,.112],[side*.12,-.25,.139],[side*.15,hem,.155]],.023,.012);
  }else if(k==='grok'){
    s.band(body,'#462e3a',[0,.217,0],.076,.083,.055,.98);
    for(const side of [-1,1])for(let i=0;i<4;i++)s.oval(body,'#c3a68b',[side*(.070+i*.021),.176-i*.020,.102+i*.002],[.019,.022,.013]);
    for(const side of [-1,1]){
      s.strand(body,gold,[[side*.168,.141,.074],[side*.126,.083,.126],[0,-.001,.161]],.011,.008);
      s.strand(body,'#ad8256',[[side*.018,-.118,.128],[side*.134,-.284,.174],[side*.228,hem+.016,.146]],.011,.009);
    }
    s.oval(body,gold,[0,-.06,.151],[.040,.038,.017]);s.oval(body,'#6b455a',[0,-.06,.167],[.022,.021,.013]);
  }else{
    s.oval(body,ivory,[0,.135,.085],[.159,.088,.084]);
    for(const side of [-1,1]){
      s.strand(body,'#d98583',[[side*.134,.194,-.085],[side*.153,.20,.018],[side*.118,.129,.12],[side*.105,-.11,.127]],.023,.012);
      s.strand(body,'#d98583',[[side*.134,.194,-.085],[side*.134,.096,-.13],[side*.103,-.095,-.131]],.022,.013);
    }
    bow(s,body,0,.113,.160,'#de8989',.064);
  }
}
