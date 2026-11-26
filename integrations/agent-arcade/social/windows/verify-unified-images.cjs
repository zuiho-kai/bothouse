'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function verifyImages({a,b,guest,until,scratch,click,openRow,hasText,moderate,activeHash,wait}) {
  const dialogState=()=>b.app.evaluate(()=>({
    choices:globalThis.imageSaveProbe.choices,
    warnings:globalThis.imageSaveProbe.warnings,
  }));
  await b.app.evaluate(({dialog})=>{
    globalThis.imageSaveProbe={choices:[],warnings:0,resume:null};
    dialog.showSaveDialog=(parent,options)=>{
      if(parent.isVisible())throw Error('Unexpected visible test window');
      globalThis.imageSaveProbe.choices.push(options.filters[0].extensions);
      return new Promise(resolve=>{globalThis.imageSaveProbe.resume=resolve;});
    };
    dialog.showMessageBox=async ()=>{
      globalThis.imageSaveProbe.warnings++;
      return {response:0};
    };
  });
  const finish=target=>b.app.evaluate((_electron,dest)=>{
    const resolve=globalThis.imageSaveProbe.resume;
    globalThis.imageSaveProbe.resume=null;
    if(!resolve)throw Error('Save chooser missing');
    resolve(dest?{canceled:false,filePath:dest}:{canceled:true,filePath:''});
  },target);
  const samples=await guest(a,`['image/png','image/jpeg'].map((mime,i)=>{
    const canvas=document.createElement('canvas');
    canvas.width=128;canvas.height=96;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle=i?'#224467':'#226644';ctx.fillRect(0,0,128,96);
    ctx.fillStyle='#e4d2a1';ctx.fillRect(20,20,65,40);
    return canvas.toDataURL(mime).split(',')[1];
  })`);
  const png=Buffer.from(samples[0],'base64');
  const raw=Buffer.from(samples[1],'base64');
  const exif=Buffer.from('45786966000049492a0008000000010012010300010000000100000000000000','hex');
  const segment=Buffer.from([0xff,0xe1,0,exif.length+2]);
  const jpeg=Buffer.concat([raw.subarray(0,2),segment,exif,raw.subarray(2)]);
  async function upload(bytes,mime) {
    await click(a,'图片');
    assert(await hasText(a,'#dialog','原图可能保留拍摄时间或位置'));
    await guest(a,`(()=>{
      const transfer=new DataTransfer();
      const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),char=>char.charCodeAt(0));
      const mime=${JSON.stringify(mime)};
      transfer.items.add(new File([bytes],mime==='image/png'?'image.png':'image.jpg',{type:mime}));
      const input=document.querySelector('#dialog input[type=file]');
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await until(()=>guest(a,`!!document.querySelector('#dialog button[type=submit]:enabled')`),'validated upload preview');
    await click(a,'发送图片');
    await until(()=>guest(a,`!document.querySelector('#dialog').open`),'upload completed');
  }
  const lastImage=client=>guest(client,`[...document.querySelectorAll('#history [data-image-id]')].at(-1)?.dataset.imageId`);
  async function openOriginal(id) {
    await until(()=>guest(b,`!!document.querySelector('[data-image-id="${id}"]')`),'receiver has uploaded image');
    await guest(b,`document.querySelector('[data-image-id="${id}"]').click()`);
    await until(()=>guest(b,`!!document.querySelector('.save-chat-image:not([hidden])')`),'original save action');
    assert(await hasText(b,'#dialog','选择文件夹和文件名'));
  }
  let chooserCount=0;
  async function startSaving(extension){
    await guest(b,`document.querySelector('.save-chat-image').click()`);
    await until(async()=>(await dialogState()).choices.length===chooserCount+1,'actual Store save chooser');
    assert.deepEqual((await dialogState()).choices[chooserCount++],[extension]);
  }
  async function saveImage(bytes,extension,name) {
    await startSaving(extension);
    const target=path.join(scratch,name);
    await finish(target);
    await until(()=>fs.existsSync(target),'saved original');
    assert.deepEqual(fs.readFileSync(target),bytes);
  }
  const privacy=await guest(a,"fetch('/privacy.html').then(r=>r.text())");
  assert.match(privacy,/数据库备份也包含原图/);
  assert.match(privacy,/拍摄时间或位置/);
  assert.match(privacy,/发给真人的图片不会因此发送给云模型/);
  await upload(png,'image/png');
  await openOriginal(await lastImage(a));
  await saveImage(png,'png','私聊原图.png');
  await click(b,'关闭');

  await click(a,'发起群聊');
  await guest(a,`document.querySelector('#dialog [name=title]').value='保存原图合成群';
    document.querySelector('#dialog input[value=tls_bravo]').click()`);
  await click(a,'创建群聊');
  await until(()=>hasText(a,'#chat-title','保存原图合成群'),'photo group created');
  await click(b,'消息');
  await openRow(b,'保存原图合成群');
  await upload(jpeg,'image/jpeg');
  const groupId=(await activeHash(a)).split('/').at(-1);
  const jpegId=await lastImage(a);
  await openOriginal(jpegId);
  await saveImage(jpeg,'jpg','群聊原图.jpg');

  await startSaving('jpg');
  await finish(null);
  await wait(300);
  assert.equal((await dialogState()).warnings,0);
  assert.deepEqual(fs.readdirSync(scratch).filter(name=>/\.(png|jpg)$/u.test(name)).sort(),['私聊原图.png','群聊原图.jpg']);

  await startSaving('jpg');
  const imageRoute='/api/v1/conversations/'+groupId+'/messages/'+jpegId;
  const report=await guest(a,`fetch(${JSON.stringify(imageRoute+'/report')},{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'合成原图移除测试'})}).then(r=>r.json())`);
  assert.equal(moderate('remove',report.report.id).status,'removed');
  const removed=path.join(scratch,'不可保存的移除原图.jpg');
  await finish(removed);
  await until(async()=>(await dialogState()).warnings===1,'moderated image blocked at save');
  assert(!fs.existsSync(removed));
  await until(()=>guest(b,`!document.querySelector('#dialog').open`),'viewer closed after moderation');

  await upload(png,'image/png');
  const nextId=await lastImage(a);
  await openOriginal(nextId);
  await startSaving('png');
  await click(a,'群成员');
  await guest(a,`document.querySelector('[aria-label="移出群聊 加密乙（tls_bravo）"]').click()`);
  await click(a,'确认移出');
  await until(()=>hasText(a,'#dialog','群成员'),'owner removal processed');
  const revoked=path.join(scratch,'不可保存的旧群原图.png');
  await finish(revoked);
  await until(async()=>(await dialogState()).warnings===2,'removed member blocked at save');
  assert(!fs.existsSync(revoked));
  await until(()=>guest(b,`!location.hash&&!document.querySelector('#dialog').open`),'removed member viewer closed');
  await click(a,'关闭');
  for(const [client,peer] of [[a,'加密乙'],[b,'加密甲']]){
    await click(client,'消息');
    await openRow(client,peer);
  }
  return {pngSha256:sha(png),jpegWithExifSha256:sha(jpeg),sameBytes:true,cancelledNoFile:true,
    moderatedWhileChoosingNoFile:true,removedWhileChoosingNoFile:true,viewerClosed:true,chooserCount};
}

module.exports={verifyImages};
