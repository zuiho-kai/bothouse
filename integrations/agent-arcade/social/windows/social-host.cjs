'use strict';

const { createSocialView } = require('./social-view.cjs');

function mountSocial({window, WebContentsView, session, configuration, saveImage, pickGroupCard, readSendShortcut}) {
  let guest, wanted = false, loaded = false, loading, top = 0, visibilityEpoch = 0;

  function fit() {
    if (!guest || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const y = Math.max(0, Math.min(height, Math.ceil(top * window.webContents.getZoomFactor())));
    guest.view.setBounds({x:0, y, width, height:height-y});
  }
  function hide() {
    const wasVisible=wanted&&loaded;
    wanted = false;
    visibilityEpoch++;
    if (wasVisible && guest) guest.deactivate();
    if (guest) guest.view.setVisible(false);
  }
  function remove() {
    const previous = guest;
    guest = undefined;
    loaded = false;
    loading = undefined;
    if (previous && !previous.view.webContents.isDestroyed()) previous.view.webContents.close();
  }
  window.on('resize', fit);
  window.on('closed', remove);
  window.webContents.on('render-process-gone', hide);
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) hide();
  });

  return async ({active, headerBottom, focus = false, imageFeedback = false, aiChatAccount} = {}) => {
    if (!active) { hide(); return true; }
    if (!Number.isFinite(headerBottom) || headerBottom < 1 || headerBottom > 200) return false;
    const epoch=visibilityEpoch;
    const wasWanted=wanted;
    wanted = true;
    top = headerBottom;
    if (!guest || guest.view.webContents.isDestroyed()) {
      remove();
      const view = createSocialView({ WebContentsView, session, configuration, saveImage, pickGroupCard, readSendShortcut,
        visitFriend:request=>window.webContents.send('arcade:storeFriendVisit',request),
        isActive:()=>wanted&&guest===view&&!window.isDestroyed() });
      guest=view;
      const contents = guest.view.webContents;
      guest.view.setVisible(false);
      window.contentView.addChildView(guest.view);
      contents.on('focus', () => {
        if(wanted&&guest===view&&!window.isDestroyed())window.webContents.send('arcade:storeSocialFocus');
      });
      contents.on('before-input-event',(event,input)=>{
        if(!wanted||guest!==view||window.isDestroyed()||input.type!=='keyDown'||!input.control||
            !input.shift||input.alt||input.meta||input.key?.toLowerCase()!=='m')return;
        event.preventDefault();
        window.webContents.focus();
        window.webContents.send('arcade:storeToolsRequested');
      });
      contents.on('render-process-gone', () => {
        const wasVisible = wanted;
        window.contentView.removeChildView(guest.view);
        remove();
        if (wasVisible) window.webContents.send('arcade:storeSocialUnavailable');
      });
    }
    fit();
    if (loaded) {
      guest.view.setVisible(true);
      if(!wasWanted)guest.activate();
      if(focus===true)guest.view.webContents.focus();
      if(imageFeedback===true)await guest.openImageFeedback(()=>wanted&&epoch===visibilityEpoch);
      if(aiChatAccount)await guest.openWorldAiChat(aiChatAccount,()=>wanted&&epoch===visibilityEpoch);
      return true;
    }
    if (!loading) {
      const current = guest;
      loading = current.load().then(() => {
        if (guest !== current || window.isDestroyed()) return false;
        loaded = true;
        current.view.setVisible(wanted);
        if(wanted)current.activate();
        else current.deactivate();
        return true;
      }).catch(() => false).finally(() => { if (guest === current) loading = undefined; });
    }
    const ready=await loading;
    if(ready&&wanted&&focus===true&&guest?.view.webContents&&!guest.view.webContents.isDestroyed())
      guest.view.webContents.focus();
    if(ready&&wanted&&imageFeedback===true&&epoch===visibilityEpoch)
      await guest.openImageFeedback(()=>wanted&&epoch===visibilityEpoch);
    if(ready&&wanted&&aiChatAccount&&epoch===visibilityEpoch)
      await guest.openWorldAiChat(aiChatAccount,()=>wanted&&epoch===visibilityEpoch);
    return ready;
  };
}
module.exports = {mountSocial};
