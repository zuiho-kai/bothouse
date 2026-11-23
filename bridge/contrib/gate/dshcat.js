// 解 DSH session.v4.jsonl.zstd：按 zstd 魔数切帧逐帧解（同 dsh-session-persistence-jsonl PublicZstdFrameDecoder）
const z=require('zlib'),fs=require('fs');
for (const f of process.argv.slice(2)) {
  let b; try { b=fs.readFileSync(f) } catch(e) { continue }
  const st=[]; for (let i=0;i+3<b.length;i++) if (b[i]===0x28&&b[i+1]===0xb5&&b[i+2]===0x2f&&b[i+3]===0xfd) st.push(i);
  let i=0;
  while (i<st.length) { let ok=false;
    for (let j=i+1;j<=st.length;j++) { const end=j<st.length?st[j]:b.length;
      try { const o=z.zstdDecompressSync(b.subarray(st[i],end)); process.stdout.write(f+'\t'+o.toString('utf8').split('\n').filter(Boolean).join('\n'+f+'\t')+'\n'); i=j; ok=true; break } catch(e) {} }
    if (!ok) break; }
}
