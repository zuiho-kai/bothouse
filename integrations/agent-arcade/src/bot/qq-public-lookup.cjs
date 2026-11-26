'use strict';

const {isIP}=require('node:net');
const {setTimeout:delay}=require('node:timers/promises');

const userAgent='AgentArcade/0.4 (https://github.com/Ray0766/agent-arcade)';
const commons='https://commons.wikimedia.org/w/api.php';
const mwmbl='https://api.mwmbl.org/api/v2/search/';
const anonymousIntervalMs=1000;
let nextAnonymousSearch=0;
let anonymousWaiting=false;
const privateTerms=/\d{5}|密码|密钥|令牌|验证码|手机号|住址|身份证|聊天记录|群号|群友|私聊|本群|群里|相册|我们|我家|你家|他家|她家|同事|同学|刚才|上面|刚发|私图|自拍|聊天截图|qq\s*号|token|api[ _-]?key|password|secret/iu;
const privateWebTarget=/内网|内部\s*的?\s*(?:官网|网站|网页|文档|系统|资料|链接|地址|门户|服务器|资源|页面|知识库)|\bintranet\b|\b(?:internal|private)\s+(?:docs?|documentation|site|website|portal|server|wiki)\b/iu;
const webSearchCancelled=/(?:别|不要|不用|不必|不需要|无需|先不|暂时?不|停止|取消|撤回)\s*(?:(?:再|继续|帮我|帮忙|替我)\s*)*(?:(?:上网|联网|网上)\s*)?(?:搜|查|找|检索)|(?:算了|取消)(?:吧|了)?$/u;
const webSearchDeferred=/(?:先(?:放一放|缓一缓|搁一搁|等等)|(?:等[会下]儿?|晚点|稍后|改天)再(?:上网|联网|网上)?(?:搜|查|找|检索))(?:吧|了)?$/u;
const genericWebQuestion=/^(?:(?:一[些点]|下|相关|公开|网上|网络上的?)\s*)*(?:资料|信息|网页|东西|内容|结果)?\s*(?:(?:可以|好|行)?[吗么]|行不行|可不可以|$)/u;
const webArtifact=/官方网站|官网|官方文档|官方主页|官方发布记录|公开资料/u;
const webArtifactEnding=/^(?:的?(?:链接|地址|网址)|在哪(?:儿|里)?|是什么|是哪个)?(?:可以吗|好吗|[吗吧呗])?$/u;
// Presets for generic moods. Descriptive requests have their own subject and
// action terms, which must also be supported by the file metadata.
const reactions={
  cat:['cat reaction meme', /cat|kitten|lolcat/iu],
  annoyed:['annoyed reaction meme', /annoyed|irritated|eye.roll/iu],
  happy:['laughing reaction meme', /laugh|happy|laughing/iu],
  surprised:['surprised reaction meme', /surpris|shock/iu],
  sad:['crying reaction meme', /sad|crying|tears/iu],
  confused:['confused reaction meme', /confus|puzzl/iu],
  approve:['approval thumbs up reaction meme', /approv|thumbs.up/iu],
  dog:['dog reaction meme', /doge|shiba|dog/iu],
};

function searchEndpoint(value){
  if(typeof value!=='string'||value.length>240||value!==value.trim())return null;
  try{
    const url=new URL(value);
    if(url.href===mwmbl)return mwmbl;
    if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/search'))return null;
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname)))return null;
    return url.href;
  }catch{return null;}
}

function publicKeywords(value){
  const query=value.trim().replace(/\s+/gu,' ');
  return /^[\p{L}\p{M}\d][\p{L}\p{M}\d .+_#-]{1,95}$/u.test(query)&&!privateTerms.test(query)&&!privateWebTarget.test(query)?query:'';
}

function publicWebRequest(text,{plainSearch=false}={}){
  if(typeof text!=='string')return null;
  const body=text.trim().replace(/[？?。！!]+$/u,'').trim();
  if(webSearchCancelled.test(body)||webSearchDeferred.test(body))return null;
  const request=body.replace(/^(?:(?:请|麻烦)\s*)?(?:你\s*)?(?:(?:可以|能不能|能否|能)\s*)?(?:(?:帮我|帮忙)\s*)?/u,'');
  const explicit=/^(?:上网|联网|网上)\s*(?:搜索|搜一搜|搜|查询|查找|查一查|查)(?:一下)?(?:公开资料)?([：:])?\s*(.*)$/u.exec(request);
  const requested=explicit?.[2]??/^(?:查找|查一查|查询|查|搜一搜|搜索|搜|找)(?:一下)?\s*(.+)$/u.exec(request)?.[1];
  if(explicit&&!explicit[1]&&requested&&genericWebQuestion.test(requested))return null;
  const found=requested?.match(webArtifact);
  if(found){
    // Anchor the ending to the first artifact. A later one could belong to another clause.
    const [artifact]=found;
    const subject=requested.slice(0,found.index).trimEnd().replace(/的$/u,'');
    if(subject&&webArtifactEnding.test(requested.slice(found.index+artifact.length).trim())){
      const topic=publicKeywords(subject);
      if(!topic)return false;
      const website=/^(?:官方网站|官网|官方主页)$/u.test(artifact);
      const latin=/^[\x20-\x7e]+$/u.test(topic);
      const qualifier=latin?({'官方文档':'documentation','官方发布记录':'release notes'})[artifact]:artifact;
      const query=website&&latin?topic:publicKeywords([topic,qualifier].filter(Boolean).join(' '));
      return query?{query,...(website?{website:topic}:{})}:false;
    }
    // Only a direct colon command declares the rest as literal keywords.
    if(!explicit?.[1]||request!==body)return null;
  }
  if(!explicit){
    if(!plainSearch)return null;
    const spoken=/^(?:搜一搜|搜(?:索)?一下|查一查|查一下)\s*(.*?)$/u.exec(request)?.[1];
    if(spoken===undefined)return null;
    if(!spoken||genericWebQuestion.test(spoken))return false;
    const query=publicKeywords(spoken.replace(/(?:可以吗|好吗|行吗|[吗吧呗])$/u,''));
    return query?{query}:false;
  }
  const query=publicKeywords(explicit[1]?requested:requested.replace(/(?:可以吗|好吗|行吗|[吗吧呗])$/u,''));
  return query?{query}:false;
}

function publicStickerDescription(value){
  return typeof value==='string'&&/^[\p{L}][\p{L}\p{M} -]{1,35}$/u.test(value)&&
    !privateTerms.test(value)&&!/(?:[我你他她]的|私人的?|私藏|文件夹|本地|上一张|这张|那张|头像|原图|转发|发到|发送|忽略|指令)/u.test(value)?value:null;
}

function stickerSearchTerms(value){
  if(!value||typeof value!=='object'||Object.keys(value).length!==2||
     typeof value.subject!=='string'||typeof value.reaction!=='string')return null;
  const terms=text=>text.trim().toLowerCase().replace(/\s+/gu,' ');
  const subject=terms(value.subject), reaction=terms(value.reaction);
  const phrase=/^[a-z]{2,24}(?:[ -][a-z]{1,24}){0,4}$/u;
  if(!phrase.test(subject)||reaction&&!phrase.test(reaction)||privateTerms.test(`${subject} ${reaction}`))return null;
  return {subject,reaction};
}

function plainText(value,limit){
  return typeof value==='string'?value.slice(0,4096).replace(/<[^>]*>/gu,' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gu,(_,entity)=>({amp:'&',lt:'‹',gt:'›',quot:'"',apos:"'",nbsp:' ','#39':"'"})[entity])
    .replace(/[\p{Cc}\p{Cf}\[\]<>]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,limit).toWellFormed():'';
}

function sourceUrl(value){
  if(typeof value!=='string'||value.length>320||/[\p{Cc}\p{Cf}\[\]<>]/u.test(value))return null;
  try{
    const url=new URL(value), host=url.hostname;
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!host.includes('.')||isIP(host)||
       /(?:\.(?:local|internal|localhost|test|invalid|example))\.?$/iu.test(host))return null;
    return url;
  }catch{return null;}
}

async function boundedResponse(fetcher,url,options,limit,type){
  const response=await fetcher(url,{...options,redirect:'error',credentials:'omit',cache:'no-store'});
  const body=response.body;
  if(!response.ok||!body||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!==type||
     Number(response.headers.get('content-length'))>limit){
    await body?.cancel().catch(()=>{});
    throw Error('source_unavailable');
  }
  let length=0;
  const chunks=[];
  for await(const chunk of body){
    options.signal.throwIfAborted();
    length+=chunk.byteLength;
    if(length>limit)throw Error('source_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,length);
}

function deadline(signal){
  const timeout=AbortSignal.timeout(6500);
  return signal?AbortSignal.any([signal,timeout]):timeout;
}

const searchKey=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

async function anonymousSearch(signal,assertCurrent,request){
  if(anonymousWaiting)throw Object.assign(Error('source_busy'),{code:'source_busy'});
  if(performance.now()<nextAnonymousSearch){
    // Keep one waiting request across all companions so neither a burst nor
    // a different group can bypass the anonymous provider's interval.
    anonymousWaiting=true;
    try{
      let wait;
      while((wait=nextAnonymousSearch-performance.now())>0)await delay(Math.ceil(wait),undefined,{signal});
    }finally{anonymousWaiting=false;}
  }
  signal.throwIfAborted();
  assertCurrent?.();
  nextAnonymousSearch=performance.now()+anonymousIntervalMs;
  return request();
}

async function publicWebSearch(endpoint,query,{signal,fetcher=globalThis.fetch,website,assertCurrent}={}){
  if(!searchEndpoint(endpoint)||typeof query!=='string'||!query||publicKeywords(query)!==query)throw Error('invalid_request');
  const active=deadline(signal);
  const options={signal:active,headers:{Accept:'application/json','User-Agent':userAgent}};
  const anonymous=endpoint===mwmbl;
  if(anonymous){
    endpoint+='?'+new URLSearchParams({q:query});
  }else{
    options.method='POST';
    options.body=new URLSearchParams({q:query,format:'json',categories:'general',safesearch:'2',language:'all'});
  }
  active.throwIfAborted();
  assertCurrent?.();
  const fetchSearch=async(url,request)=>{
    const response=await fetcher(url,request);
    if(response.status===429){
      await response.body?.cancel().catch(()=>{});
      throw Object.assign(Error('source_rate_limited'),{code:'source_rate_limited'});
    }
    return response;
  };
  const request=()=>boundedResponse(fetchSearch,endpoint,options,512*1024,'application/json');
  const bytes=await (anonymous?anonymousSearch(active,assertCurrent,request):request());
  const {results}=JSON.parse(bytes);
  if(!Array.isArray(results))throw Error('invalid_response');
  const sources=[];
  const target=typeof website==='string'?searchKey(website):'';
  for(const result of results.slice(0,30)){
    const url=sourceUrl(result?.url),title=plainText(result?.title,75);
    const snippet=anonymous?'':plainText(result?.content,115);
    if(!url||!title||sources.some(row=>row.host===url.hostname.replace(/^www\./u,'')))continue;
    const host=url.hostname.replace(/^www\./u,'');
    const nameMatch=target&&searchKey(title).includes(target);
    const hostMatch=target&&searchKey(host.split('.')[0])===target;
    if(target&&!nameMatch&&!hostMatch)continue;
    const rank=hostMatch?2:nameMatch&&/官网|官方网站|\bofficial (?:site|website)\b/iu.test(title)?1:0;
    sources.push({title,snippet,url:url.href,host,rank});
    if(!target&&sources.length===2)break;
  }
  if(target)sources.sort((a,b)=>b.rank-a.rank);
  return sources.slice(0,2).map(({title,snippet,url,host})=>({title,snippet,url,host}));
}

function commonsCandidate(page,matches,{reactionOnly=true}={}){
  if(page?.ns!==6||page.imagerepository!=='local'||!Number.isSafeInteger(page.pageid)||page.pageid<=0)return null;
  const title=plainText(page.title,120).replace(/^File:/u,''), info=page.imageinfo?.[0];
  if(!info||!['image/jpeg','image/png'].includes(info.mime)||!Number.isSafeInteger(info.size)||info.size<1||info.size>2*1024*1024||
     ![info.width,info.height].every(n=>Number.isSafeInteger(n)&&n>=96&&n<=2048))return null;
  const meta=info.extmetadata;
  const description=plainText(meta?.ImageDescription?.value,200), evidence=title+'; '+description;
  if(!title||reactionOnly&&!/(?:\bmeme\b|\blolcat\b|\breaction image\b|表情包|反应图|反應圖)/iu.test(evidence)||!matches(title,description)||
     /logo|icon|emoji|emoticon|screenshot|template|sample page/iu.test(title)||meta?.Restrictions?.value!=='')return null;
  const media=sourceUrl(info.url), license=sourceUrl(meta?.LicenseUrl?.value);
  if(media?.origin!=='https://upload.wikimedia.org'||!media.pathname.startsWith('/wikipedia/commons/')||
     license?.origin!=='https://creativecommons.org'||!/^\/(?:licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/?$/u.test(license.pathname))return null;
  const author=plainText(meta?.Artist?.value,100);
  const licenseName=plainText(meta?.LicenseShortName?.value,28);
  if(!author||!licenseName)return null;
  media.search=''; media.hash='';
  license.search=''; license.hash='';
  const pageUrl='https://commons.wikimedia.org/wiki/Special:Redirect/page/'+page.pageid;
  return {url:media.href,mime:info.mime,extension:info.mime==='image/png'?'.png':'.jpg',size:info.size,
    source:{url:pageUrl,title,author,license:licenseName,licenseUrl:license.href},
    caption:`${title} · ${author} · ${licenseName}（转为 PNG）\n${pageUrl}\n${license.href}`};
}

function matchesComedicEdit(description,subject){
  // An edit describes the image, not an expression performed by its subject.
  // The description must introduce the depicted subject, then explicitly say
  // that the same image was edited for comic effect.
  const depicts=new RegExp(`^(?:this|the|a|an) ${subject} (?:was|is) (?:photographed|depicted|drawn|illustrated)\\b`,'u');
  const edit=/^(?:the|this) (?:original )?(?:image|photo|photograph|drawing|illustration) (?:was|is|has been) (?:modified|edited|adapted) for (?:comedic|humorous|comic|funny) (?:purposes?|effect)\b/u;
  const sentences=description.toLowerCase().split(/[.!?]+/u).map(line=>line.replace(/[^a-z]+/gu,' ').trim());
  return sentences.some((line,index)=>depicts.test(line)&&edit.test(sentences[index+1]??''));
}

function reactionSearch(request){
  if(typeof request==='string'){
    if(!Object.hasOwn(reactions,request))return null;
    const [query,motif]=reactions[request];
    return {query,matches:(title,description)=>motif.test(title+'; '+description)};
  }
  const terms=stickerSearchTerms(request);
  if(!terms)return null;
  const {subject,reaction}=terms;
  const actor=subject.replace(/-/gu,' ');
  const motion=reaction.replace(/-/gu,' ').split(' ').join(' (?:its |their |and )?');
  const comedic=/^(?:comedic|humorous|comic|funny)$/u.test(reaction);
  // Metadata must say who makes the expression. Avoid crossing a title,
  // sentence, or unrelated verb to associate a reaction with another actor.
  const relation=new RegExp(reaction?`\\b(?:${motion} ${actor}|${actor} (?:that is |is |was |is shown )?${motion})\\b`:`\\b${actor}\\b`,'u');
  return {query:[subject,reaction,'meme'].filter(Boolean).join(' '),matches:(title,description)=>{
    if(comedic&&matchesComedicEdit(description,actor))return true;
    return (title+'; '+description).toLowerCase().split(/[.;!?,:\n]/u).some(clause=>{
      const words=clause.replace(/[^a-z]+/gu,' ');
      return !/\b(?:not|no|never)\b/u.test(words)&&relation.test(words);
    });
  }};
}

async function publicReaction(request,{signal,assertCurrent,prepareImage,fetcher=globalThis.fetch}={}){
  const search=reactionSearch(request);
  if(!search||typeof prepareImage!=='function')return null;
  const url=new URL(commons);
  url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrnamespace:'6',
    gsrsearch:search.query,gsrlimit:'8',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',
    iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|ImageDescription|Restrictions'});
  const active=deadline(signal), options={signal:active,headers:{'User-Agent':userAgent}};
  const sourceError=error=>{
    assertCurrent();
    signal?.throwIfAborted();
    const code=active.reason?.name==='TimeoutError'||error?.name==='TimeoutError'?'sticker_source_timeout':'sticker_source_unavailable';
    return Object.assign(Error(code),{code});
  };
  assertCurrent();
  let pages;
  try{
    const json=await boundedResponse(fetcher,url.href,options,160*1024,'application/json');
    active.throwIfAborted();
    const response=JSON.parse(json);
    if(response?.error||response?.errors)throw Error('invalid_response');
    pages=response?.query?.pages;
    if(pages===undefined&&response?.batchcomplete===true)return null;
    if(!Array.isArray(pages))throw Error('invalid_response');
  }catch(error){throw sourceError(error);}
  let failed;
  for(const page of pages.slice(0,8).sort((a,b)=>(a?.index||0)-(b?.index||0))){
    const item=commonsCandidate(page,search.matches);
    if(!item)continue;
    assertCurrent();
    let raw;
    try{
      active.throwIfAborted();
      raw=await boundedResponse(fetcher,item.url,options,item.size,item.mime);
      active.throwIfAborted();
      if(raw.length!==item.size)throw Error('invalid_response');
      const bytes=prepareImage(raw,item.extension);
      try{assertCurrent();}catch(error){bytes.fill(0);throw error;}
      return {bytes,caption:item.caption};
    }catch(error){
      failed=sourceError(error);
      if(failed.code==='sticker_source_timeout')throw failed;
    }finally{raw?.fill(0);}
  }
  if(failed)throw failed;
  return null;
}

module.exports={MWMBL_SEARCH_ENDPOINT:mwmbl,searchEndpoint,publicWebRequest,publicStickerDescription,stickerSearchTerms,publicWebSearch,publicReaction,boundedResponse,commonsCandidate};
