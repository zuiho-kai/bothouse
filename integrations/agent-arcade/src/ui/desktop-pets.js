'use strict';

(() => {
  const card = document.getElementById('desktop-pets-card');
  const options = document.getElementById('desktop-pets-options');
  const status = document.getElementById('desktop-pets-status');
  const rows = new Map();
  const busy = new Set();
  let latest;
  function render(state) {
    latest = state;
    if (!card || !options || !status) return;
    card.hidden = !state.desktopPets?.supported || typeof window.arcade?.desktopPetSet !== 'function';
    if (card.hidden) return;
    const zh = state.config.language === 'zh';
    document.getElementById('desktop-pets-title').textContent = zh ? '3D 桌宠' : '3D desktop pets';
    document.getElementById('desktop-pets-help').textContent = zh
      ? '按 AI 开启。拖标题移动窗口，拖角色旋转。窗口的 × 会关闭该桌宠。'
      : 'Turn on each AI separately. Drag its title to move the window or drag the character to turn it. Use × to close that pet.';
    for (const pet of state.desktopPets.pets) {
      let row = rows.get(pet.id);
      if (!row) {
        const label = document.createElement('label');
        const text = document.createElement('span');
        const control = document.createElement('input');
        control.type = 'checkbox';
        control.id = 'desktop-pet-' + pet.id;
        control.addEventListener('change', async () => {
          busy.add(pet.id);
          control.disabled = true;
          status.textContent = '';
          try {
            const next = await window.arcade.desktopPetSet({id:pet.id,enabled:control.checked});
            render(next);
          } catch {
            control.checked = !control.checked;
            status.textContent = zh ? '未能保存桌宠设置。' : 'The desktop pet preference could not be saved.';
          } finally {
            busy.delete(pet.id);
            render(latest);
          }
        });
        label.append(text, control);
        options.append(label);
        row = {text, control};
        rows.set(pet.id, row);
      }
      const label = pet.provider ? pet.provider + ' · ' + pet.name[zh ? 'zh' : 'en'] : pet.name[zh ? 'zh' : 'en'];
      row.text.textContent = pet.unavailable ? label + (zh ? '（启动失败）' : ' (could not start)') : label;
      if (!busy.has(pet.id)) row.control.checked = pet.enabled;
      row.control.disabled = busy.has(pet.id);
    }
  }
  window.renderDesktopPets = render;
})();
