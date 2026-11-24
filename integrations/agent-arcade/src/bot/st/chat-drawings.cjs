'use strict';
const {createHash}=require('node:crypto');
const MAX_BYTES=8*1024*1024;
const PNG=Buffer.from('89504e470d0a1a0a','hex');
const HASH=/^[a-f0-9]{64}$/;
const drawingId=requestId=>'local-out:command:drawing:'+requestId;
const stickerId=inboundId=>'local-out:command:sticker:'+inboundId.slice('local:'.length);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=reason=>Object.assign(Error('Invalid drawing history.'),{code:'social_invalid_input',reason});

function initializeDrawings(db,columns){
  for(const name of ['drawing_sha','drawing_request_key','drawing_kind','drawing_credit']){
    if(!columns.has(name))db.exec(`ALTER TABLE messages ADD COLUMN ${name} TEXT`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS chat_drawing_images (sha256 TEXT PRIMARY KEY,png BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS message_drawing ON messages(drawing_sha) WHERE drawing_sha IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS delete_unused_chat_drawing AFTER DELETE ON messages WHEN OLD.drawing_sha IS NOT NULL
    BEGIN DELETE FROM chat_drawing_images WHERE sha256=OLD.drawing_sha AND NOT EXISTS
      (SELECT 1 FROM messages WHERE drawing_sha=OLD.drawing_sha); END;`);
}

function attachDrawing(db,scope,id,{bytes,requestKey,kind=null,credit=null}){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES||!bytes.subarray(0,8).equals(PNG)||!HASH.test(requestKey))throw invalid('invalid_request');
  if(kind!==null&&kind!=='sticker'||credit!==null&&(kind!=='sticker'||typeof credit!=='string'||credit.length>600||/[\p{Cc}\p{Cf}]/u.test(credit.replace(/\n/gu,''))))throw invalid('invalid_request');
  const sha256=digest(bytes);
  db.prepare('INSERT OR IGNORE INTO chat_drawing_images(sha256,png) VALUES(?,?)').run(sha256,bytes);
  const saved=db.prepare(`UPDATE messages SET drawing_sha=?,drawing_request_key=?,drawing_kind=?,drawing_credit=? WHERE scope=? AND id=? AND role='assistant'
    AND (drawing_sha IS NULL OR (drawing_sha=? AND drawing_request_key=? AND drawing_kind IS ? AND drawing_credit IS ?))`)
    .run(sha256,requestKey,kind,credit,scope,id,sha256,requestKey,kind,credit);
  if(saved.changes!==1)throw invalid('changed');
}

function readDrawing(db,scope,id,requestKey){
  // An explicit null asks for this conversation's latest image, including
  // earlier pages. Equal timestamps follow the same row order as history.
  const latest=id===null;
  if(latest&&requestKey!==undefined)throw invalid('invalid_request');
  const row=latest
    ?db.prepare("SELECT id,drawing_sha FROM messages WHERE scope=? AND role='assistant' AND drawing_sha IS NOT NULL AND drawing_kind IS NULL ORDER BY at DESC,rowid DESC LIMIT 1").get(scope)
    :db.prepare("SELECT drawing_sha,drawing_request_key,drawing_kind,drawing_credit FROM messages WHERE scope=? AND id=? AND role='assistant'").get(scope,id);
  if(latest&&row&&!row.drawing_sha)throw invalid('drawing_corrupt');
  if(!row?.drawing_sha){
    // A legacy text receipt or the surviving input of a deleted image cannot
    // authorize a second paid request for that same turn.
    if(requestKey&&(row||db.prepare('SELECT 1 FROM messages WHERE scope=? AND id=?').get(scope,id.replace('local-out:command:','local-in:'))))throw invalid('changed');
    return null;
  }
  if(requestKey&&requestKey!==row.drawing_request_key)throw invalid('invalid_request');
  const blob=db.prepare('SELECT png FROM chat_drawing_images WHERE sha256=? AND length(png) BETWEEN 1 AND ?').get(row.drawing_sha,MAX_BYTES);
  if(!blob||digest(blob.png)!==row.drawing_sha)throw invalid('drawing_corrupt');
  return {bytes:Buffer.from(blob.png),sha256:row.drawing_sha,...(latest?{messageId:row.id}:{}),
    ...(row.drawing_kind==='sticker'?{sticker:true,...(row.drawing_credit?{credit:row.drawing_credit}:{})}:{})};
}
module.exports={initializeDrawings,attachDrawing,readDrawing,drawingId,stickerId};
