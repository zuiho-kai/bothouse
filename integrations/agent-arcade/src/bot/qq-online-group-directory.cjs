'use strict';

const {QQDirectoryReader} = require('./qq-directory.cjs');

// Only choices shown for this selected profile and verified live connection
// can be added. Check directory membership again when the owner applies it.
function onlineGroupMembership({resolve, selectionRevision, reader = new QQDirectoryReader()}) {
  const choices = new WeakMap();
  const identityFields = ['profileId','expectedMode','expectedChannel','expectedAccountId','expectedRevision'];
  const changed = () => Object.assign(Error('群名单或连接已变化，请重新打开群设置。'), {code:'group_membership_changed'});

  function context(value, edit) {
    const {service,patch} = resolve(value, edit ? [...identityFields,'groupId','action'] : identityFields);
    const {expectedAccountId,expectedRevision} = patch;
    const client = service.client;
    if (value.expectedChannel !== 'qq' || !expectedAccountId || service.status !== 'connected' ||
        service.config.qqAccountId !== expectedAccountId || client?.accountId !== expectedAccountId ||
        !client.ready || client.closed || client.socket?.readyState !== 1 || typeof expectedRevision !== 'string' ||
        !expectedRevision || service.membershipRevision() !== expectedRevision) throw changed();
    return {service, patch, client, selection:selectionRevision()};
  }

  async function read(value, edit) {
    const before = context(value, edit);
    const {service,patch,client,selection} = before;
    const result = await reader.read({kind:'groups', expectedAccountId:patch.expectedAccountId,
      url:service.config.qqUrl || 'ws://127.0.0.1:3001', token:service.secret.qqToken, fresh:true});
    const after = context(value, edit);
    if (after.client !== client || after.service !== service || after.selection !== selection ||
        result.accountId !== patch.expectedAccountId) throw changed();
    return {items:result.items.map(({id,name})=>({id,name})), before};
  }

  async function directory(value) {
    const {items,before:{service,client,selection,patch}} = await read(value, false);
    choices.set(service,{client,selection,revision:patch.expectedRevision,ids:new Set(items.map(row=>row.id))});
    return {accountId:patch.expectedAccountId,membershipRevision:patch.expectedRevision,items};
  }

  async function set(value) {
    const {service,client,patch,selection} = context(value, true);
    if (patch.action === 'add') {
      const listed = choices.get(service);
      if (!listed || listed.client !== client || listed.selection !== selection || listed.revision !== patch.expectedRevision ||
          !listed.ids.has(patch.groupId)) throw changed();
      const {items} = await read(value, true);
      if (!items.some(row=>row.id === patch.groupId) || context(value, true).client !== client ||
          selectionRevision() !== selection) throw changed();
    }
    const saved = service.setOnlineGroupMembership(patch);
    if (patch.action === 'add' || patch.action === 'resume') {
      await client.waitForGroupReceiveSecond(patch.groupId, service.groupRoute.groupActiveSince.get(patch.groupId));
      const current = context({...value, expectedRevision:saved.qq.groups.membershipRevision}, true);
      if (current.service !== service || current.client !== client || current.selection !== selection) throw changed();
      return service.snapshot();
    }
    return saved;
  }
  return {directory,set};
}

module.exports = {onlineGroupMembership};
