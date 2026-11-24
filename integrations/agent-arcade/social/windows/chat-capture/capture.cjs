'use strict';
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
  const byId = id => document.getElementById(id);
  const target = byId('target'), status = byId('status'), take = byId('take');
  const canvas = byId('frame'), box = byId('box'), use = byId('use');
  let anchor, selection;
  const cancel = () => ipcRenderer.send('crop:cancel');
  byId('cancel').onclick = cancel;
  window.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  target.onchange = () => { take.disabled = !target.value; };

  // As in Bothouse desktop-pet's captureDisplayFrame: a muted video supplies
  // one frame to Canvas, then all tracks stop before the selection is shown.
  take.onclick = async () => {
    take.disabled = target.disabled = true;
    const video = document.createElement('video');
    let stream, timeout;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      video.srcObject = stream;
      video.muted = true;
      await Promise.race([
        video.play(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('frame')), 6000); })
      ]);
      if (!video.videoWidth || !video.videoHeight) throw Error('empty frame');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      byId('choose').hidden = true;
      byId('stage').hidden = byId('whole').hidden = use.hidden = false;
      status.textContent = '拖动框选需要的区域，或选择全幅。';
      byId('whole').focus();
    } catch {
      status.textContent = '无法截取这个目标。请确认窗口仍打开，或选择其他目标。';
      take.disabled = target.disabled = false;
    } finally {
      clearTimeout(timeout);
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      ipcRenderer.send('crop:framed');
    }
  };

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const pixel = (pos, start, length, size) =>
      Math.max(0, Math.min(size, Math.round((pos-start)*size/length)));
    return { x: pixel(event.clientX, rect.left, rect.width, canvas.width),
      y: pixel(event.clientY, rect.top, rect.height, canvas.height) };
  }
  function select(a, b) {
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
    const width = Math.abs(a.x-b.x), height = Math.abs(a.y-b.y);
    selection = width && height ? { x, y, width, height } : null;
    use.disabled = box.hidden = !selection;
    if (!selection) return;
    const sx = canvas.clientWidth / canvas.width, sy = canvas.clientHeight / canvas.height;
    Object.assign(box.style, { left: x*sx+'px', top: y*sy+'px', width: width*sx+'px', height: height*sy+'px' });
    status.textContent = '选区 '+width+' × '+height+' 像素';
  }
  canvas.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    anchor = point(event);
    select(anchor, anchor);
  };
  canvas.onpointermove = event => { if (anchor && event.isPrimary) select(anchor,point(event)); };
  canvas.onpointerup = event => {
    if (anchor && event.isPrimary) { select(anchor, point(event)); anchor = null; }
  };
  canvas.onlostpointercapture = () => { anchor = null; };
  byId('whole').onclick = () => select({ x:0, y:0 },{ x:canvas.width, y:canvas.height });
  window.addEventListener('resize', () => {
    if (selection) select(selection,{ x:selection.x+selection.width, y:selection.y+selection.height });
  });
  use.onclick = async () => {
    if (!selection) return;
    const {x,y,width,height} = selection, crop = document.createElement('canvas');
    if (width > 8192 || height > 8192 || width*height > 16*1024*1024) {
      status.textContent = '选区像素过多，请缩小后预览。';
      return;
    }
    crop.width = width; crop.height = height;
    crop.getContext('2d').drawImage(canvas, x,y,width,height, 0,0,width,height);
    const png = await new Promise(resolve => crop.toBlob(resolve, 'image/png'));
    if (!png || png.size > 4*1024*1024) {
      status.textContent = '选区图片超过 4 MB 或无法编码，请缩小选区。';
      return;
    }
    ipcRenderer.send('crop:accept', new Uint8Array(await png.arrayBuffer()));
  };
  try {
    const choices = await ipcRenderer.invoke('crop:choices');
    choices.forEach(({ name,screen }, i) => target.add(new Option((screen?'屏幕 · ':'窗口 · ')+name, String(i+1))));
    if (!choices.length) status.textContent = '没有可供截取的窗口或屏幕。';
    target.focus();
  } catch { status.textContent = '无法列出窗口或屏幕。请关闭后重试。'; }
});
