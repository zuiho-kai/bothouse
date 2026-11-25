const poses = ['idle', 'thinking', 'speaking', 'pat', 'huff'];

export async function loadPortraitPlates() {
  const images = new Map(await Promise.all(poses.map(async pose => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = new URL(`./art/${pose}.png`, import.meta.url).href;
    await image.decode();
    return [pose, image];
  })));
  const plates = new Map();
  let width = 0;
  let height = 0;

  // Keep the whole painted silhouette, including hands extending sideways.
  // The same bounds position the head-stroke target in CSS pixels.
  function bounds(name, w, h) {
    const image = images.get(name) || images.get('idle');
    const scale = Math.min(w * 0.96 / image.naturalWidth, h * 0.89 / image.naturalHeight);
    const artWidth = image.naturalWidth * scale, artHeight = image.naturalHeight * scale;
    return {x: (w - artWidth) / 2, y: h * 0.992 - artHeight, width: artWidth, height: artHeight};
  }

  return {
    bounds,
    get(name, widthPx, heightPx) {
      if (!Number.isSafeInteger(widthPx) || !Number.isSafeInteger(heightPx) ||
          widthPx < 1 || heightPx < 1) throw new RangeError('Expected positive integer portrait canvas dimensions');
      if (width !== widthPx || height !== heightPx) {
        width = widthPx;
        height = heightPx;
        plates.clear();
      }
      const pose = images.has(name) ? name : 'idle';
      if (!plates.has(pose)) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d'), box = bounds(pose, width, height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(images.get(pose), box.x, box.y, box.width, box.height);
        plates.set(pose, canvas);
      }
      return plates.get(pose);
    },
  };
}
