'use strict';

const {fail,string}=require('./store.cjs');

const validId=id=>/^[1-9]\d*$/u.test(id)&&Number.isSafeInteger(Number(id));
const friends=(a,b)=>`EXISTS (SELECT 1 FROM friend_chats WHERE first_user=min(${a},${b}) AND second_user=max(${a},${b}))`;

// Keep both the reader and the commenter inside the current post audience.
// On a role's post the viewer may see their own or their friends' comments.
function commentPage(store,viewer,post,before=null,limit=20){
  if(before!==null&&!validId(before))fail(400,'feed_filter','评论分页无效');
  const rows=store.all(`SELECT c.id,c.body AS text,c.created AS createdAt,u.number,u.name AS displayName
    FROM friend_post_comments c JOIN users u ON u.number=c.author
    WHERE c.post=$post AND ($before IS NULL OR c.id<$before)
      AND (c.author=$viewer OR c.author=$owner OR ${friends('c.author','$viewer')})
      AND (c.author=$owner OR
        ($kind='human' AND ${friends('c.author','$owner')}) OR
        ($kind='ai' AND EXISTS (SELECT 1 FROM ai_feed_follows WHERE account=c.author AND role=$owner)))
    ORDER BY c.id DESC LIMIT $limit`,
    {$post:post.id,$owner:post.author.number,$kind:post.author.kind,$viewer:viewer,$before:before===null?null:Number(before),$limit:limit+1});
  return {comments:rows.slice(0,limit).map(({id,text,createdAt,number,displayName})=>({id,text,createdAt,author:{number,displayName}})),
    nextBefore:rows.length>limit?rows[limit-1].id:null};
}
function commentsRoute(store,viewer,id,method,params,body){
  const post=validId(id)&&store.visibleFriendPost(viewer,Number(id));
  if(!post)fail(404,'unknown_post','这条动态已删除或不再可见');
  if(method==='GET')return {account:viewer,...commentPage(store,viewer,post,params.get('before'))};
  if(body.expectedAccount!==viewer)fail(409,'feed_session','账号已切换，请重新打开好友动态');
  if(store.user(viewer).kind!=='human')fail(403,'feed_human_only','请使用本人的好友账号评论');
  if(Object.keys(body).some(k=>!['clientId','text','expectedAccount'].includes(k))||
     typeof body.clientId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/u.test(body.clientId))
    fail(400,'comment_request','评论请求无效');
  const text=string(body.text,500,'评论');
  const existing=store.one('SELECT id,body FROM friend_post_comments WHERE post=? AND author=? AND nonce=?',
    post.id,viewer,body.clientId);
  if(existing&&existing.body!==text)fail(409,'comment_conflict','该编号已用于另一条评论');
  const commentId=existing?.id??store.run('INSERT INTO friend_post_comments(post,author,nonce,body,created) VALUES(?,?,?,?,?)',
    post.id,viewer,body.clientId,text,new Date().toISOString()).lastInsertRowid;
  return {account:viewer,commentId};
}
module.exports={commentPage,commentsRoute};
