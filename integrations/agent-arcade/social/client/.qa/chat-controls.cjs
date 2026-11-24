'use strict';

const button=(scope,name)=>scope.getByRole('button',{name,exact:true});

async function openChatSettings(page){
  const trigger=button(page,'会话设置');
  if(await trigger.isVisible()&&!await page.locator('#chat-settings').isVisible())await trigger.click();
}

async function clickChatSetting(page,name){
  const control=button(page,name);
  if(!await control.isVisible())await openChatSettings(page);
  await control.click();
}

async function reportMessage(page,bubble){
  const trigger=button(bubble,'消息操作');
  if(await trigger.isVisible()){
    await trigger.click();
    await button(page.locator('#message-actions'),'举报消息').click();
  }else await button(bubble,'举报消息').click();
}

module.exports={openChatSettings,clickChatSetting,reportMessage};
