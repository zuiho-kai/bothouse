// Opened from a post in the current, account-scoped feed.
export function openComments(post,{account,api,el,button,openDialog,closeDialog,clientNonce,textError,current,refresh}){
  const path='/friend-feed/'+post.id+'/comments',key='arcade.feed.comment.'+account+'.'+post.id;
  const list=el('div',null,'post-comments'),status=el('p',null,'minor');
  status.setAttribute('role','status');
  const more=button('更早的评论',()=>void read(cursor));
  const reload=button('重新读取',()=>void read(failedPage));
  const form=el('form'),label=el('label','写评论'),input=el('textarea');
  input.rows=2;input.maxLength=1000;input.required=true;label.append(input);
  const send=el('button','发送评论','primary');send.type='submit';
  form.append(label,el('p','评论对能看这条动态的你和你的好友可见。','minor'),send);
  more.hidden=reload.hidden=form.hidden=true;
  let cursor=null,failedPage=null,pending;
  try{pending=JSON.parse(sessionStorage.getItem(key));}catch{}
  if(typeof pending?.text==='string')input.value=pending.text;
  const scope=openDialog('动态评论',[el('p',post.text,'feed-post__body'),list,more,reload,form,status]);
  function remember(value){
    pending=value;
    try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}
  }
  function unavailable(error){
    if(error?.message!=='unknown_post'&&error?.message!=='feed_session')return false;
    remember(null);closeDialog();
    void refresh(error.message==='unknown_post'?'这条动态已删除或不再可见。':'账号已切换，请重新打开好友动态。');
    return true;
  }
  async function read(before){
    more.disabled=reload.disabled=true;status.textContent='正在读取评论…';
    try{
      const result=await api(path+(before?'?before='+before:''));
      if(!current(scope))return;
      if(result.account!==account){unavailable(new Error('feed_session'));return;}
      if(!before)list.replaceChildren();
      for(const row of result.comments){
        const line=el('p');line.append(el('strong',row.author.displayName+'（'+row.author.number+'）：'),document.createTextNode(row.text));
        list.append(line);
      }
      cursor=result.nextBefore;more.hidden=!cursor;reload.hidden=true;form.hidden=false;
      status.textContent=list.childElementCount?'':'还没有评论。';
    }catch(error){
      if(!current(scope)||unavailable(error))return;
      failedPage=before;status.textContent=textError(error);reload.hidden=false;
    }finally{more.disabled=reload.disabled=false;}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(!text||send.disabled||!current(scope))return;
    if(Array.from(text).length>500){status.textContent='评论最多 500 字。';return;}
    const attempt=pending?.text===text?pending:{clientId:clientNonce(),text,expectedAccount:account};
    remember(attempt);send.disabled=input.disabled=true;status.textContent='正在发送评论…';
    try{
      const result=await api(path,attempt);
      if(!current(scope))return;
      if(result.account!==account){unavailable(new Error('feed_session'));return;}
      remember(null);closeDialog();await refresh('评论已发送。');
    }catch(error){
      if(!current(scope)||unavailable(error))return;
      if(error.message==='comment_conflict')remember(null);
      status.textContent=textError(error)+' 仍可点击“发送评论”重试。';
    }finally{send.disabled=input.disabled=false;}
  });
  void read(null);
}
