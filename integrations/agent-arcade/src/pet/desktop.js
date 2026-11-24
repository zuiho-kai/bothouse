// The installed window loads the portrait. The model tools retain their own
// renderer for old recordings and for inspecting the GLB from different angles.
const query = new URLSearchParams(location.search);
if (query.has('preview') || query.get('model') === '3d') {
  await import('./pet.js');
} else {
  try {
    const {openPortrait} = await import('./portrait/window.js');
    await openPortrait();
  } catch (error) {
    document.title = 'pet-error';
    console.error(error);
    window.petHost?.failed(String(error?.message || error));
  }
}
