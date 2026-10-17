'use strict';

(async () => {
  try {
    const response = await fetch('/api/devices', { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取设备名单。');
    const { devices } = await response.json();
    for (const device of devices) {
      const card = document.createElement('section');
      card.className = 'panel';
      const heading = document.createElement('h2');
      heading.textContent = device.name;
      const detail = document.createElement('p');
      detail.textContent = '固定伙伴：' + device.role_name;
      const link = document.createElement('a');
      link.className = 'primary-button';
      link.href = '/device/' + encodeURIComponent(device.device_id);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '打开这台设备 ↗';
      card.append(heading, detail, link);
      document.getElementById('devices').append(card);
    }
  } catch (error) {
    const element = document.getElementById('error');
    element.textContent = error.message;
    element.hidden = false;
  }
})();
