export interface ResidentPortrait {sha256:string; pack:string; author:string; license:string}
export function residentPortrait(planet:string, resident:{id:string; portrait?:ResidentPortrait & {slug:string}|null}){
  if(!Object.hasOwn(resident,'portrait'))return undefined;
  const d=resident.portrait;
  if(!d||!/^p-[a-f0-9-]{36}$/.test(planet)||!/^bh_[a-f0-9]{21}$/.test(resident.id)||!/^[a-f0-9]{64}$/.test(d.sha256))return null;
  return {url:'/api/planets/'+planet+'/residents/'+resident.id+'/art/'+d.sha256+'.png',
    credit:[d.pack+'/'+d.slug,d.author,d.license].join(' · '),stand:1};
}
