'use strict';
// Original yauzl adapter: the caller retains and closes the held descriptor.
const fs=require('node:fs'),{Readable}=require('node:stream'),yauzl=require('yauzl');
class QQHeldZipReader extends yauzl.RandomAccessReader{
 constructor(held){super();this.held=held;}
 _readStreamForRange(start,end){const {held}=this;return Readable.from((function*(){for(let at=start;at<end;){held.assert();const b=Buffer.allocUnsafe(Math.min(65536,end-at));if((held.readSync||fs.readSync)(held.fd,b,0,b.length,at)!==b.length)throw Object.assign(new Error('Archive read incomplete.'),{code:'file_archive_invalid'});at+=b.length;yield b;}})());}
 close(callback){callback(null);} // Reader lifetime never transfers FD ownership.
}
module.exports={QQHeldZipReader};
