export function humanAvatarUrl(person) {
  return person?.kind==='human'&&person.avatarRevision
    ? './api/v1/avatars/'+encodeURIComponent(person.number)+'/'+encodeURIComponent(person.avatarRevision)
    : undefined;
}

export function readImageData(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('无法读取这张图片。'));
    reader.readAsDataURL(file);
  });
}

export async function prepareAvatar(file) {
  if(!file.size||file.size>4*1024*1024)throw Error('请选择 4 MB 以内的图片。');
  if(!['image/png','image/jpeg'].includes(file.type))throw Error('请选择 PNG 或 JPEG。');
  const image=new Image();
  image.src=await readImageData(file);
  try {await image.decode();}
  catch {throw Error('无法打开这张图片。');}
  const {naturalWidth:width,naturalHeight:height}=image;
  if(width*height>24_000_000)throw Error('图片像素过多，请先将图片缩小。');
  const edge=Math.min(width,height);
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=Math.min(edge,384);
  canvas.getContext('2d').drawImage(image,(width-edge)/2,(height-edge)/2,edge,edge,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw Error('无法处理这张图片。');
  return {blob,preview:await readImageData(blob)};
}
