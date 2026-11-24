'use strict';
// Notes page (Companion workspace): the owner's own Markdown notes, the line-level changes
// characters propose for them, and per-character reflection. Lists are fetched on demand and
// redrawn only by the owner's own actions, so the periodic snapshot never interrupts typing.
// Nothing here writes a note or a rule without an explicit Approve from the owner.
(() => {
  const root=document.getElementById('notes-content'),K=window.ArcadeKit,api=window.arcade;
  if(!root||!K||typeof api?.wikiTree!=='function')return;
  const CODES={
    wiki_path_invalid:['这个页面路径不可用。','This page path cannot be used.'],
    wiki_not_found:['笔记库里还没有这个页面或文件夹。','The notes do not hold this page or folder yet.'],
    wiki_unavailable:['笔记文件夹现在打不开，请检查本机存储后重试。','The notes folder cannot be opened right now. Check local storage and try again.'],
    wiki_name_invalid:['名称要以文字或数字开头，只能用文字、数字、“-”和“_”，最多 40 个字符，不能有空格或路径分隔符。','A name starts with a letter or digit and may hold letters, digits, “-” and “_” only: up to 40 characters, no spaces or path separators.'],
    wiki_exists:['已经有同名的领域或主题。','A domain or topic with this name already exists.'],
    wiki_domains_full:['领域数量已达上限，不能再新建领域。可以把主题放进已有的领域。','The domain limit is reached. Put the topic in an existing domain instead.'],
    wiki_topics_full:['这个领域的主题数量已达上限。','This domain already holds the maximum number of topics.'],
    wiki_full:['笔记库的总页数或总大小已达上限。','The notes have reached their page or size limit.'],
    wiki_line_too_long:['这一行太长了。请把简介或内容写短一些。','This line is too long. Shorten the description or the text.'],
    wiki_section_invalid:['提议指向的小节不在允许的小节名单里。','The proposal points at a section that is not allowed.'],
    wiki_target_invalid:['要替换或删除的那一行已经不在原来的位置。请拒绝这条提议，之后再让角色整理一次。','The line to replace or remove is no longer where it was. Reject this proposal and let the character propose again later.'],
    wiki_text_invalid:['这一行不能为空，也不能以 #、--- 或 ``` 开头。','The line cannot be empty or start with #, --- or ```.'],
    wiki_lint_failed:['写入后页面会超出篇幅或格式要求，所以没有写入。可以把这一行改短，或先在编辑器里整理这个页面。','Writing this would break the page budget or format, so nothing was written. Shorten the line, or tidy the page in your editor first.'],
    wiki_page_changed:['页面在提议之后改过了，需要重新提议。','The page changed after this proposal was made; it has to be proposed again.'],
    wiki_propose_off:['这个角色的“可提议”没有打开。','“May propose” is off for this character.'],
    wiki_proposal_not_found:['这条提议已经不存在。','This proposal no longer exists.'],
    wiki_proposal_decided:['这条提议已经处理过了。','This proposal has already been decided.'],
    wiki_proposals_full:['待处理的提议已满。请先处理一些再整理。','The proposal inbox is full. Decide some before asking for more.'],
    reflection_off:['这个角色的反思没有开启。','Reflection is off for this character.'],
    reflection_invalid_request:['有内容不符合要求，请检查后再试。','Something entered is not valid. Check it and try again.'],
    reflection_rule_invalid:['规则文字为空或太长。','The rule text is empty or too long.'],
    reflection_rule_cap:['已生效的规则达到上限。请先停用或移除一条。','The active rules are at their limit. Switch one off or remove one first.'],
    reflection_candidate_not_found:['这条候选已经不存在。','This candidate no longer exists.'],
    reflection_candidate_decided:['这条候选已经处理过了。','This candidate has already been decided.'],
    reflection_rule_not_found:['这条规则已经不存在。','This rule no longer exists.'],
    reflection_limit:['数量已达上限。请先处理现有的候选或规则。','A limit is reached. Decide existing candidates or rules first.'],
    reflection_unavailable:['当前档案暂时不能使用反思。','Reflection is not available for this profile right now.'],
    busy:['正在回复或处理上一项操作，请等它结束后再试。','A reply or another action is still running. Try again when it ends.'],
    character_missing:['这个角色已不在角色库中。','This character is no longer in the library.'],
    credentials_missing:['还没有保存这个角色所用 AI 的凭据。请先到对话页的设置里保存。','No credentials are saved for this character’s AI yet. Save them in the chat settings first.'],
    unsupported:['当前 AI 方式不支持这个操作。','The current AI method does not support this action.'],
    invalid_request:['有内容不符合要求，请检查后再试。','Something entered is not valid. Check it and try again.'],
    unavailable:['这项功能现在不能使用，请稍后再试。','This is not available right now. Please try again.'],
  };
  const LINT={
    front_matter:['页面开头的说明块缺失或格式不对','the header block at the top of the page is missing or malformed'],
    line_too_long:['有一行超过长度上限','a line is longer than allowed'],
    no_sections:['页面里没有规定的小节','the page has none of the expected sections'],
    page_budget:['页面超出篇幅上限','the page is over its size budget'],
    page_near_budget:['页面接近篇幅上限','the page is close to its size budget'],
    section_illegal:['有不在名单里的小节标题','a section heading is not one of the allowed ones'],
    domain_unlisted:['这个领域没有列在 MEMORY.md 里','the domain is not listed in MEMORY.md'],
    index_line_too_long:['MEMORY.md 里有一行太长','a line in MEMORY.md is too long'],
    index_other_lines:['MEMORY.md 里有领域链接以外的内容','MEMORY.md holds something other than domain links'],
    link_refused:['有链接指向不允许的位置','a link points somewhere that is not allowed'],
    missing_page:['目录里列出的页面不存在','a listed page does not exist'],
    orphan_page:['页面没有列在所属领域的 README.md 里','the page is not listed in its domain’s README.md'],
    page_name_duplicate:['有只差大小写的同名页面','two pages differ only by letter case'],
    page_unreadable:['页面读不出来','the page could not be read'],
    readme_line_too_long:['README.md 里有一行太长','a line in README.md is too long'],
    readme_missing:['领域文件夹里没有 README.md','the domain folder has no README.md'],
    too_many_domains:['领域太多','too many domains'],
    too_many_pages:['页面太多','too many pages'],
    too_many_topics:['这个领域的主题太多','too many topics in this domain'],
    topics_near_budget:['这个领域的主题数接近上限','the domain is close to its topic limit'],
    top_level_page:['页面要放进领域文件夹，不能放在最外层','pages belong in a domain folder, not at the top level'],
    wiki_too_large:['笔记库总大小超出上限','the notes are over their total size limit'],
    link_without_page:['目录里的链接没有对应的页面','a listed link has no page'],
    subdirectory_ignored:['更深一层的子文件夹不会被读取','a deeper sub-folder is not read'],
  };
  let zh=true,lang='',latest=null,busy=false,characters=null;
  const tr=(a,b)=>zh?a:b,colon=()=>tr('：',': ');
  const explain=result=>{const code=K.codeOf(result);return Object.hasOwn(CODES,code)?tr(...CODES[code]):tr('操作没有完成，请稍后再试。','The action did not complete. Please try again.');};
  const fk=(node,key)=>{node.dataset.fk=key;return node;};
  const panels={notes:el('div',''),proposals:el('div',''),reflection:el('div','')};
  const tabs=K.tabs('notes',Object.entries(panels),id=>void ensure(id,true));
  root.append(tabs.node,...Object.values(panels));
  const loaded={notes:false,proposals:false,reflection:false};

  function syncBusy(){for(const node of root.querySelectorAll('button:not([role=tab]),input,select,textarea'))node.disabled=busy||node.dataset.locked==='true';}
  function focusKey(key){const target=[...root.querySelectorAll('[data-fk]')].find(node=>node.dataset.fk===key&&!node.disabled&&node.offsetParent!==null);if(target)target.focus({preventScroll:true});return !!target;}
  // Runs one owner action with every control disabled. `fn` may return the focus key to land on.
  async function run(fn){
    if(busy)return;
    const held=root.contains(document.activeElement)?document.activeElement.dataset.fk||'':'';
    busy=true;syncBusy();let next;
    try{next=await fn();}finally{busy=false;syncBusy();}
    if(document.body.dataset.view!=='notes')return;
    const lost=[document.body,null].includes(document.activeElement)||document.activeElement?.disabled||!document.activeElement?.isConnected;
    if(lost&&!(typeof next==='string'&&focusKey(next))&&!(held&&focusKey(held)))document.getElementById(`notes-tab-${tabs.current()}`)?.focus({preventScroll:true});
  }
  function fill(container,nodes){
    const held=container.contains(document.activeElement)?document.activeElement.dataset.fk||'':'';
    container.replaceChildren(...nodes);syncBusy();
    if(held&&[document.body,null].includes(document.activeElement))focusKey(held);
  }
  const card=(...children)=>{const node=el('article','settings-card st-card kn-card');node.append(...children);return node;};
  const builtinId=()=>latest?.bot?.local?.characterId;
  const knowledgeScope=()=>JSON.stringify([latest?.accounts?.selectedId,builtinId()]);
  function builtinName(id){
    const setting=latest?.bot?.st?.settings, social=latest?.bot?.social?.config;
    if(id===builtinId()&&!setting?.builtinPersonaId&&social?.characterId===id&&social.name?.trim())return social.name.trim();
    const name=latest?.personas?.find(person=>person.id===id)?.name;
    return name?.[zh?'zh':'en']||name?.zh||name?.en;
  }
  // Longer explanations and size budgets sit behind a small disclosure that keeps its state across redraws.
  const openMore=new Set();
  function more(key,label,lines){
    const box=el('details','more-note'),summary=fk(el('summary','',label),'more:'+key);
    box.open=openMore.has(key);box.addEventListener('toggle',()=>{if(box.open)openMore.add(key);else openMore.delete(key);});
    box.append(summary,...lines.filter(Boolean).map(line=>typeof line==='string'?el('p','kn-meta',line):line));return box;
  }
  // The built-in companion first, then every library character.
  function people(){
    const rows=[],builtin=builtinId(),name=builtinName(builtin);
    if(builtin&&name)rows.push({id:builtin,name,builtin:true});
    for(const item of characters||[])if(typeof item?.id==='string')rows.push({id:item.id,name:item.name||tr('未命名角色','Unnamed character'),builtin:false});
    return rows;
  }
  async function loadCharacters(){try{const list=await api.charactersList();characters=Array.isArray(list)?list:[];}catch{characters=characters||[];}}

  // ================= Notes =================
  const N={tree:null,problem:'',lint:null,path:'',page:null,pageProblem:'',form:null,message:'',error:false,lintOpen:false};
  const firstPath=tree=>{for(const domain of tree?.domains||[])for(const topic of domain.topics||[])if(topic.path)return topic.path;return '';};
  const hasPath=(tree,path)=>(tree?.domains||[]).some(domain=>(domain.topics||[]).some(topic=>topic.path===path));
  async function loadNotes(){
    const [tree,lint]=await Promise.all([K.call(()=>api.wikiTree()),K.call(()=>api.wikiLint())]);
    // wikiLint's own "ok" means "no errors"; a failed call carries a code instead of the lists.
    N.lint=Array.isArray(lint.errors)?lint:null;
    if(tree.ok===false){N.tree=null;N.problem=explain(tree);}
    else{N.tree=tree;N.problem='';if(!hasPath(tree,N.path)){N.path=firstPath(tree);N.page=null;}}
    loaded.notes=true;
    if(N.path)await openPage(N.path,false);else drawNotes();
  }
  async function openPage(path,focus=true){
    N.path=path;const result=await K.call(()=>api.wikiPage(path));
    if(result.ok===false){N.page=null;N.pageProblem=explain(result);}else{N.page=result;N.pageProblem='';}
    drawNotes();
    if(focus)document.getElementById('notes-page-title')?.focus({preventScroll:true});
  }
  // Markdown is shown as plain structured text: headings, list items and paragraphs become nodes.
  function pageBody(text){
    const out=[],lines=String(text||'').split(/\r?\n/);let index=0,list=null;
    if(lines[0]?.trim()==='---'){const end=lines.indexOf('---',1);if(end>0)index=end+1;}
    for(;index<lines.length;index++){
      const line=lines[index].replace(/\s+$/,''),heading=/^(#{1,4})\s+(.*)$/.exec(line),item=/^\s*[-*]\s+(.*)$/.exec(line);
      if(!item)list=null;
      if(!line.trim())continue;
      if(heading)out.push(el(heading[1].length<=1?'h3':'h4',heading[1].length<=1?'kn-page-h1':'kn-page-h2',heading[2]));
      else if(item){if(!list){list=el('ul','kn-page-list');out.push(list);}list.append(el('li','',item[1]));}
      else out.push(el('p','kn-page-p',line));
    }
    return out;
  }
  function lintLine(){
    const lint=N.lint;if(!lint)return el('p','st-note',tr('没有读到检查结果。','The check result could not be read.'));
    const errors=lint.errors||[],warnings=lint.warnings||[],limits=N.tree?.limits;
    const summary=`${tr('检查','Check')}${colon()}${errors.length||warnings.length?tr(`${errors.length} 个问题，${warnings.length} 个提醒`,`${errors.length} problem(s), ${warnings.length} note(s)`):tr('没有发现问题','no problems found')} · ${tr(`${lint.pages||0} 页，${lint.bytes||0} 字节`,`${lint.pages||0} page(s), ${lint.bytes||0} bytes`)}`;
    // The budget text itself lives behind the "Limits" disclosure in drawNotes().
    budgetText=limits?(tr(`篇幅上限：每页最多 ${limits.pageLines} 行、${limits.pageChars} 字符，每行最多 ${limits.bodyLine} 字符；最多 ${limits.domains} 个领域，每个领域 ${limits.topics} 个主题。超出的页面会在这里列出。`,`Budgets: a page holds up to ${limits.pageLines} lines and ${limits.pageChars} characters, a line up to ${limits.bodyLine} characters; up to ${limits.domains} domains with ${limits.topics} topics each. Pages over budget are listed here.`)):'';
    if(!errors.length&&!warnings.length){const wrap=el('div','kn-lint');wrap.append(el('p','st-note kn-lint-ok',summary));return wrap;}
    const details=el('details','kn-lint'),head=fk(el('summary','',summary),'lint'),list=el('ul','kn-lint-list');
    details.open=N.lintOpen;details.addEventListener('toggle',()=>{N.lintOpen=details.open;});details.dataset.errors=String(errors.length>0);
    const row=(item,kind)=>{const li=el('li','');li.dataset.kind=kind;li.append(el('span','kn-lint-kind',kind==='error'?tr('问题','Problem'):tr('提醒','Note')),el('span','',`${item.path||tr('整个笔记库','All notes')}${colon()}${Object.hasOwn(LINT,item.code)?tr(...LINT[item.code]):item.code}${item.detail?tr(`（${item.detail}）`,` (${item.detail})`):''}`));return li;};
    list.append(...errors.map(item=>row(item,'error')),...warnings.map(item=>row(item,'warning')));
    details.append(head,list);return details;
  }
  let budgetText='';
  function createForm(){
    const f=N.form,box=el('section','st-group kn-form'),domains=(N.tree?.domains||[]).map(domain=>domain.name),limit=N.tree?.limits;
    const domain=K.input(40,f.domain),topic=K.input(40,f.topic),description=K.input(60,f.description),scope=K.input(200,f.scope),list=el('datalist','');
    list.id='notes-domain-list';list.append(...domains.map(name=>{const o=el('option','');o.value=name;return o;}));domain.setAttribute('list',list.id);
    domain.oninput=()=>{f.domain=domain.value;};topic.oninput=()=>{f.topic=topic.value;};description.oninput=()=>{f.description=description.value;};scope.oninput=()=>{f.scope=scope.value;};
    const status=K.status(),save=fk(K.button('primary',tr('创建','Create')),'create-save'),cancel=fk(K.button('secondary',tr('取消','Cancel')),'create-cancel'),row=el('div','st-save-row');
    status.say(f.message,f.error);row.append(save,cancel,status.node);
    const tell=(text,error=false)=>{f.message=text;f.error=error;status.say(text,error);};
    cancel.onclick=()=>{N.form=null;drawNotes();focusKey('new');};
    save.onclick=()=>{
      const d=domain.value.trim(),t=topic.value.trim(),about=description.value.trim();
      if(!d){tell(tr('请先填写领域。','Enter a domain first.'),true);domain.focus();return;}
      if(!t&&domains.includes(d)){tell(tr('这个领域已经有了。请再填一个主题名。','This domain already exists. Enter a topic name as well.'),true);topic.focus();return;}
      if(t&&!about){tell(tr('请用一句话写下这个主题记什么。','Say in one sentence what this topic is for.'),true);description.focus();return;}
      void run(async()=>{
        tell(tr('正在创建…','Creating…'));
        const result=await K.call(()=>api.wikiCreate({domain:d,...(t?{topic:t}:{}),description:about,...(t&&scope.value.trim()?{scope:scope.value.trim()}:{})}));
        if(result.ok===false){tell(`${tr('没有创建','Not created')}${colon()}${explain(result)}`,true);return 'create-save';}
        N.form=null;N.message=t?tr(`已创建主题“${d}/${t}”。现在可以在编辑器里往这个页面写内容。`,`Created the topic “${d}/${t}”. You can now write into this page in your editor.`):tr(`已创建领域“${d}”。`,`Created the domain “${d}”.`);N.error=false;
        if(t)N.path=`${d}/${t}.md`;
        await loadNotes();return 'new';
      });
    };
    box.append(el('h3','',tr('新建主题','New topic')),el('p','st-note',tr('领域是一个文件夹，主题是里面的一个 Markdown 页面。填已有的领域名就放进那个领域；填新的名字会同时新建领域。','A domain is a folder and a topic is one Markdown page inside it. An existing domain name puts the topic there; a new name creates the domain too.')),
      el('div','st-fields'),row);
    box.children[2].append(K.field(tr('领域（最多 40 字符，不含空格）','Domain (up to 40 characters, no spaces)'),domain,'notes-new-domain',limit?tr(`最多 ${limit.domains} 个领域`,`Up to ${limit.domains} domains`):''),list,
      K.field(tr('主题（最多 40 字符；只建领域可留空）','Topic (up to 40 characters; leave empty to create only the domain)'),topic,'notes-new-topic'),
      K.field(tr('一句话简介（最多 60 字）','One-line description (up to 60 characters)'),description,'notes-new-description'),
      K.field(tr('范围说明（可选，最多 200 字）','Scope (optional, up to 200 characters)'),scope,'notes-new-scope',tr('写清这个页面记什么、不记什么。留空则用简介。','What belongs on this page and what does not. Empty uses the description.')));
    return box;
  }
  function drawNotes(){
    const tree=N.tree,empty=!!tree&&!(tree.domains||[]).some(domain=>(domain.topics||[]).length||domain.hasReadme);
    const intro=el('p','st-note',tr('本机一个文件夹里的 Markdown 页面，可以用任何编辑器直接修改。角色不会改这些文件，只能提议，由你在“提议”页批准后才写入。','Markdown pages in a folder on this computer; edit them in any editor you like. Characters never edit these files. They can only propose changes, written after you approve them under Proposals.'));
    const tools=el('div','button-row'),create=fk(K.button('secondary',tr('新建主题…','New topic…')),'new'),open=fk(K.button('secondary',tr('在文件夹中打开','Open in folder')),'open'),reload=fk(K.button('plain',tr('重新读取','Reload')),'reload'),status=K.status('st-status kn-status');
    status.say(N.message,N.error);
    create.onclick=()=>{N.form=N.form||{domain:'',topic:'',description:'',scope:'',message:'',error:false};drawNotes();document.getElementById('notes-new-domain')?.focus({preventScroll:true});};
    create.setAttribute('aria-expanded',String(!!N.form));
    open.onclick=()=>void run(async()=>{const result=await K.call(()=>api.wikiOpenFolder());N.message=result.ok===false?(K.codeOf(result)==='wiki_not_found'?tr('笔记文件夹还不存在。先新建一个主题，文件夹就会出现。','The notes folder does not exist yet. Create a topic first and it will appear.'):explain(result)):tr('已在文件管理器中打开。','Opened in the file manager.');N.error=result.ok===false;drawNotes();});
    reload.onclick=()=>void run(async()=>{N.message='';await loadNotes();});
    tools.append(create,open,reload);
    const head=card(el('h2','',tr('你的笔记','Your notes')),intro,tools,status.node);
    if(N.form)head.append(createForm());
    if(tree){head.append(lintLine());head.append(more('notes-limits',tr('限额说明','Limits'),[budgetText||tr('每个页面有篇幅上限，超出时“检查”会指出来。','Each page has a size budget; the check says when one is over.')]));}
    const nodes=[head];
    if(N.problem)nodes.push(card(el('p','st-problem',N.problem)));
    else if(!tree)nodes.push(card(el('p','st-note',tr('正在读取…','Loading…'))));
    else if(empty){
      const start=card(el('h2','',tr('还没有笔记','No notes yet')),el('p','st-note',tr('从一个主题开始：点上面的“新建主题…”，填一个领域（比如“工作”）和一个主题（比如“周报格式”），再用一句话说明它记什么。应用会建好文件夹和页面，之后你可以在编辑器里往里写。','Start with one topic: choose “New topic…” above, enter a domain (say “work”) and a topic (say “weekly-report”), and say in one sentence what it is for. The app creates the folder and the page; after that you write into it in your editor.')));
      start.classList.add('kn-empty');nodes.push(start);
    }else{
      const browser=el('div','kn-browser'),side=el('nav','kn-tree'),view=el('article','settings-card st-card kn-card kn-page');
      side.setAttribute('aria-label',tr('领域与主题','Domains and topics'));
      for(const domain of tree.domains||[]){
        const group=el('section','kn-domain'),title=el('h3','kn-domain-name',domain.name),list=el('ul','kn-topics');
        group.append(title);
        if(domain.description)group.append(el('p','kn-meta',domain.description));
        if(domain.listed===false)group.append(el('p','kn-meta kn-warn',tr('没有列在 MEMORY.md 里，角色读不到这个领域。','Not listed in MEMORY.md, so characters cannot read this domain.')));
        for(const topic of domain.topics||[]){
          const li=el('li',''),b=fk(K.button('kn-topic',''),'topic:'+topic.path);b.append(el('strong','',topic.name),el('span','kn-meta',topic.description||''));
          if(topic.path===N.path)b.setAttribute('aria-current','true');
          b.onclick=()=>void run(()=>openPage(topic.path));li.append(b);list.append(li);
        }
        if(!(domain.topics||[]).length)list.append(el('li','kn-meta',tr('这个领域还没有主题。','No topics in this domain yet.')));
        group.append(list);side.append(group);
      }
      const page=N.page;
      if(N.pageProblem)view.append(el('p','st-problem',N.pageProblem));
      else if(!page)view.append(el('p','st-note',tr('从左边选一个主题来查看。','Choose a topic on the left to read it.')));
      else{
        const title=el('h2','',page.front?.name||page.path);title.id='notes-page-title';title.tabIndex=-1;
        view.append(title,el('p','kn-meta kn-path',page.path));
        if(page.front?.description)view.append(el('p','st-note',page.front.description));
        view.append(el('p','kn-meta',`${tr(`${page.lines} 行，${page.chars} 字符`,`${page.lines} lines, ${page.chars} characters`)} · ${tr('只读预览，修改请用编辑器','read-only preview; edit in your editor')}`));
        if(page.truncated)view.append(el('p','st-problem',tr('页面很长，这里只显示开头的一部分。','The page is long; only its beginning is shown here.')));
        const body=el('div','kn-page-body'),parts=pageBody(page.text);
        // The page's own top heading repeats the title shown above.
        if(parts[0]?.classList.contains('kn-page-h1')&&parts[0].textContent.trim()===title.textContent.trim())parts.shift();
        body.append(...parts);
        if(!body.childElementCount)body.append(el('p','st-note',tr('这个页面还没有内容。','This page has no content yet.')));
        view.append(body);
      }
      browser.append(side,view);nodes.push(browser);
    }
    fill(panels.notes,nodes);
  }

  // ================= Proposals =================
  const P={list:null,problem:'',message:'',error:false,rowStatus:new Map(),edits:new Map(),notes:new Map(),access:{},accessKey:'',historyOpen:false};
  const OPS={add:['在这一节加一行','Add a line to this section'],replace:['把原来的一行换成新的','Replace an existing line'],remove:['删掉原来的一行','Remove an existing line']};
  const STATES={approved:['已批准并写入','Approved and written'],rejected:['已拒绝','Rejected'],superseded:['页面已变，未写入','Page changed; not written'],pending:['待处理','Pending']};
  const WHY={wiki_empty:['笔记库还是空的。先在“笔记”页新建至少一个主题，角色才有地方提议。','The notes are still empty. Create at least one topic under Notes so there is somewhere to propose into.'],no_new_messages:['上次整理之后，你在和它的 App 对话里没有说新的话。','You have said nothing new in its App conversation since the last time.'],runner_failed:['这次调用 AI 没有成功。请检查网络和这个角色的 AI 设置后再试。','The AI call did not succeed. Check the network and this character’s AI settings, then try again.'],invalid_output:['AI 返回的内容不符合格式，已全部丢弃，没有生成提议。','The AI’s answer was not in the expected form and was discarded. No proposal was made.']};
  const accessOf=id=>{const item=P.access[id];return {read:item?.read===true,propose:item?.propose===true};};
  const nameOf=id=>people().find(person=>person.id===id)?.name||builtinName(id)||tr('一个已不在角色库的角色','a character no longer in the library');
  async function loadProposals(){
    const scope=knowledgeScope();
    const [result]=await Promise.all([K.call(()=>api.wikiProposals({})),loadCharacters()]);
    if(scope!==knowledgeScope())return;
    if(result.ok===false){P.list=[];P.problem=explain(result);}else{P.list=Array.isArray(result.proposals)?result.proposals:[];P.problem='';}
    loaded.proposals=true;drawProposals();
  }
  function accessCard(){
    const available=!!latest?.bot?.st?.available,rows=people(),box=card(el('h2','',tr('哪些角色可以用笔记','Which characters may use the notes')));
    box.append(el('p','st-note',tr('“可读”让角色回复时参考相关的笔记页；“可提议”允许你让它整理对话、提出修改建议。两个开关默认都关。','“May read” lets a character consult relevant note pages when it replies; “May propose” lets you ask it to go through the conversation and suggest changes. Both start off.')),
      el('p','st-note',tr('整理一次会把你在那段对话里新说的话发给该角色的 AI 服务一次，按该服务计费；它只能提议，写不写由你决定。','One pass sends what you newly said in that conversation to the character’s AI provider once, billed by that provider. It can only suggest; you decide what is written.')),
      more('access',tr('更多说明','More detail'),[tr('笔记权限用于 App 对话，包括内置角色。切换内置角色后，这里显示新角色自己的设置。','Note access applies to App conversations, including built-in characters. When you switch built-in characters, this page shows the newly selected character’s settings.'),tr('点击“让它整理新对话”时，只整理该角色自己的 App 单人对话。','“Go through new messages” reviews only that character’s own one-to-one App conversation.')]));
    if(!available){box.append(el('p','st-problem',tr('当前档案暂时不能使用 App 对话，所以这里的开关不能修改。','The App conversation is not available for this profile right now, so these switches cannot be changed.')));return box;}
    const table=el('div','kn-access');table.setAttribute('role','group');table.setAttribute('aria-label',tr('角色的笔记权限','Note access per character'));
    for(const person of rows){
      const row=el('div','kn-access-row'),name=el('div','kn-access-name'),value=accessOf(person.id),read=K.check(tr('可读','May read'),`notes-read-${person.id}`),propose=K.check(tr('可提议','May propose'),`notes-propose-${person.id}`),go=fk(K.button('secondary',tr('让它整理新对话','Go through new messages')),'go:'+person.id),status=K.status('st-status kn-row-status');
      name.append(el('strong','',person.name));if(person.builtin)name.append(el('span','groups-badge',tr('内置角色','Built-in character')));
      fk(read.box,'read:'+person.id);fk(propose.box,'propose:'+person.id);read.box.checked=value.read;propose.box.checked=value.propose;
      read.box.setAttribute('aria-label',`${tr('可读','May read')}${colon()}${person.name}`);propose.box.setAttribute('aria-label',`${tr('可提议','May propose')}${colon()}${person.name}`);
      go.setAttribute('aria-label',`${tr(`让 ${person.name} 整理新对话`,`Let ${person.name} go through new messages`)}`);go.hidden=!value.propose;
      const saved=P.rowStatus.get(person.id);if(saved)status.say(saved.text,saved.error);
      const tell=(text,error=false)=>{P.rowStatus.set(person.id,{text,error});status.say(text,error);};
      const save=()=>void run(async()=>{
        const scope=knowledgeScope();
        const next={characterId:person.id,read:read.box.checked,propose:propose.box.checked};
        const result=await K.call(()=>api.wikiAccess(next));
        if(scope!==knowledgeScope())return;
        if(result.ok===false){tell(`${tr('没有保存','Not saved')}${colon()}${explain(result)}`,true);}
        else{P.access={...P.access,[person.id]:{read:next.read,propose:next.propose}};tell(tr('已保存。','Saved.'));}
        drawProposals();
      });
      read.box.onchange=save;propose.box.onchange=save;
      go.onclick=()=>void run(async()=>{
        tell(tr(`正在让 ${person.name} 整理新对话，这需要调用一次 AI，请稍等…`,`${person.name} is going through new messages. This takes one AI call; please wait…`));
        const result=await K.call(()=>api.wikiPropose({characterId:person.id}));
        if(result.ok===false)tell(`${tr('没有整理','Not done')}${colon()}${explain(result)}`,true);
        else if(result.problem)tell(Object.hasOwn(WHY,result.problem)?tr(...WHY[result.problem]):tr('这次没有生成提议。','No proposal was made this time.'),result.problem!=='no_new_messages');
        else tell(tr(`读了你的 ${result.read||0} 条新消息，提出 ${result.proposed||0} 条提议${result.dropped?`，另有 ${result.dropped} 条因为缺少你的原话或不合格式被丢弃`:''}。${result.proposed?'请在下面逐条处理。':''}`,`Read ${result.read||0} new message(s) of yours and made ${result.proposed||0} proposal(s)${result.dropped?`; ${result.dropped} more were discarded for lacking your own words or the right form`:''}.${result.proposed?' Decide them one by one below.':''}`));
        await loadProposals();
      });
      row.append(name,read.wrap,propose.wrap,go,status.node);table.append(row);
    }
    if(!characters)table.append(el('p','st-note',tr('正在读取角色库…','Loading the character library…')));
    box.append(table);return box;
  }
  const where=item=>`${item.page||''} › ${item.section||''}`;
  function evidence(list,withDay=false){
    const wrap=el('div','kn-evidence'),rows=Array.isArray(list)?list:[];
    wrap.append(el('h4','',tr('依据：你的原话','Evidence: your own words')));
    if(!rows.length){wrap.append(el('p','kn-meta',tr('没有附带原话。','No quote attached.')));return wrap;}
    for(const item of rows){const quote=el('blockquote','kn-quote',String(item.quote||''));if(withDay&&item.day)quote.append(el('span','kn-meta kn-quote-day',String(item.day)));wrap.append(quote);}
    return wrap;
  }
  function proposalCard(item,index,pending){
    const box=el('article','kn-item'),head=el('div','kn-item-head'),title=el('h3','',where(item)),key='p:'+item.id,needsText=item.op!=='remove';
    box.dataset.id=item.id;head.append(title,el('span','kn-meta',`${nameOf(item.characterId)} · ${K.stamp(item.createdAt,zh)}`));
    box.append(head,el('p','kn-op',Object.hasOwn(OPS,item.op)?tr(...OPS[item.op]):String(item.op)));
    if(item.op!=='add'){const old=el('div','kn-old');old.append(el('span','kn-meta',`${item.op==='remove'?tr('要删掉的一行','Line to remove'):tr('原来的一行','Current line')}${Number.isInteger(item.targetLine)?tr(`（第 ${item.targetLine} 行）`,` (line ${item.targetLine})`):''}`),el('p','',String(item.targetText||'')));box.append(old);}
    const line=K.input(298,P.edits.has(item.id)?P.edits.get(item.id):String(item.text||''));
    if(needsText){line.oninput=()=>{P.edits.set(item.id,line.value);};fk(line,key+':text');box.append(K.field(tr('要写入的一行（批准前可以改）','Line to write (you may edit it before approving)'),line,`notes-proposal-${item.id}`));}
    box.append(evidence(item.evidence));
    const note=K.input(200,P.notes.get(item.id)||'');note.oninput=()=>{P.notes.set(item.id,note.value);};fk(note,key+':note');
    box.append(K.field(tr('拒绝时的备注（可选）','Note when rejecting (optional)'),note,`notes-proposal-note-${item.id}`));
    const row=el('div','st-save-row'),approve=fk(K.button('primary',tr('批准并写入','Approve and write')),key+':approve'),reject=fk(K.button('secondary',tr('拒绝','Reject')),key+':reject'),status=K.status();
    approve.setAttribute('aria-label',`${tr('批准并写入','Approve and write')}${colon()}${where(item)}`);reject.setAttribute('aria-label',`${tr('拒绝','Reject')}${colon()}${where(item)}`);
    const nextKey=()=>{const other=pending[index+1]||pending[index-1];return other?`p:${other.id}:approve`:'proposals-refresh';};
    const decide=action=>void run(async()=>{
      const text=line.value.trim();
      if(action==='approve'&&needsText&&!text){status.say(tr('要写入的一行不能为空。','The line to write cannot be empty.'),true);return key+':text';}
      status.say(tr('正在处理…','Working…'));
      const payload=action==='approve'?{id:item.id,action,...(needsText&&text!==String(item.text||'').trim()?{text}:{})}:{id:item.id,action,...(note.value.trim()?{note:note.value.trim()}:{})};
      const result=await K.call(()=>api.wikiDecide(payload));
      if(result.ok===false&&!['wiki_page_changed','wiki_proposal_decided','wiki_proposal_not_found'].includes(K.codeOf(result))){status.say(`${tr('没有处理','Not done')}${colon()}${explain(result)}`,true);return key+':'+action;}
      const state=result.ok===false?'':result.state;
      P.message=`${where(item)}${colon()}${result.ok===false?explain(result):state==='approved'?tr('已批准，这一行已写入页面。','approved; the line is written to the page.'):state==='superseded'?tr('页面已变，需重新提议。这条提议已作废，没有写入任何内容。','the page changed, so it has to be proposed again. This proposal is void and nothing was written.'):tr('已拒绝，没有写入任何内容。','rejected; nothing was written.')}`;
      P.error=result.ok===false||state==='superseded';P.edits.delete(item.id);P.notes.delete(item.id);
      const to=nextKey();await loadProposals();if(state==='approved')loaded.notes=false;return to;
    });
    approve.onclick=()=>decide('approve');reject.onclick=()=>decide('reject');
    row.append(approve,reject,status.node);box.append(row);return box;
  }
  function drawProposals(){
    const list=P.list||[],pending=list.filter(item=>item.state==='pending'),decided=list.filter(item=>item.state!=='pending');
    if(!characters&&!P.list&&!P.problem){fill(panels.proposals,[card(el('p','st-note',tr('正在读取…','Loading…')))]);return;}
    // Nothing to switch on yet: one sentence and the way to the library, unless something was already saved.
    const inbox=card(el('h2','',tr(`待处理的提议（${pending.length}）`,`Pending proposals (${pending.length})`))),tools=el('div','button-row'),refresh=fk(K.button('plain',tr('重新读取','Reload')),'proposals-refresh'),status=K.status('st-status kn-status');
    inbox.append(el('p','st-note',tr('每条提议只改一行，并附上你说过的原话作为依据。批准后才会写进页面；批准前可以改写这一行。','Each proposal changes one line and quotes what you said as its evidence. It is written to the page only after you approve; you may reword the line first.')));
    refresh.onclick=()=>void run(async()=>{P.message='';await loadProposals();});tools.append(refresh);status.say(P.message,P.error);inbox.append(tools,status.node);
    if(P.problem)inbox.append(el('p','st-problem',P.problem));
    else if(!P.list)inbox.append(el('p','st-note',tr('正在读取…','Loading…')));
    else if(!pending.length)inbox.append(el('p','st-note kn-empty-line',tr('现在没有待处理的提议。给某个角色打开“可提议”，再点“让它整理新对话”，提议会出现在这里。','No proposals are waiting. Switch “May propose” on for a character and press “Go through new messages”; proposals then appear here.')));
    else{const items=el('div','kn-items');items.append(...pending.map((item,index)=>proposalCard(item,index,pending)));inbox.append(items);}
    const nodes=[accessCard(),inbox];
    if(decided.length){
      const history=el('details','settings-card st-card kn-card kn-history'),summary=fk(el('summary','',tr(`已处理的提议（${decided.length}）`,`Decided proposals (${decided.length})`)),'history'),rows=el('ul','kn-history-list');
      history.open=P.historyOpen;history.addEventListener('toggle',()=>{P.historyOpen=history.open;});
      for(const item of decided){const li=el('li',''),state=el('span','kn-state',Object.hasOwn(STATES,item.state)?tr(...STATES[item.state]):String(item.state));state.dataset.state=item.state;
        li.append(state,el('strong','',where(item)),el('span','kn-meta',`${Object.hasOwn(OPS,item.op)?tr(...OPS[item.op]):item.op} · ${nameOf(item.characterId)} · ${K.stamp(item.decidedAt||item.createdAt,zh)}`),el('p','',String(item.op==='remove'?item.targetText||'':item.text||'')));
        if(item.note)li.append(el('p','kn-meta',`${tr('备注','Note')}${colon()}${item.note}`));rows.append(li);}
      history.append(summary,rows);nodes.push(history);
    }
    fill(panels.proposals,nodes);
  }

  // ================= Reflection =================
  const R={id:'',status:null,candidates:null,rules:null,problem:'',message:'',error:false,runMessage:'',runError:false,drafts:new Map()};
  const KINDS={correction:['你纠正过它','You corrected it'],preference:['你表达过的偏好','A preference you stated'],rule_violated:['已有的规则又被违反','An existing rule was broken again']};
  const OUTCOMES={ok:['完成','finished'],no_new_messages:['没有新消息可看','no new messages to review'],invalid_output:['AI 返回的内容不符合格式，已丢弃','the AI’s answer was not in the expected form and was discarded'],runner_failed:['调用 AI 没有成功','the AI call did not succeed'],cancelled:['被取消','cancelled'],unavailable:['当时不可用','not available at the time'],failed:['没有成功','did not succeed']};
  const outcome=id=>Object.hasOwn(OUTCOMES,id)?tr(...OUTCOMES[id]):String(id||'');
  async function loadReflection(){
    const scope=knowledgeScope();
    if(!characters)await loadCharacters();
    if(scope!==knowledgeScope())return;
    const rows=people();if(!rows.some(person=>person.id===R.id))R.id=rows[0]?.id||'';
    if(!R.id){R.status=null;R.candidates=null;R.rules=null;loaded.reflection=true;drawReflection();return;}
    const value={characterId:R.id},[status,candidates,rules]=await Promise.all([K.call(()=>api.reflectionStatus(value)),K.call(()=>api.reflectionCandidates(value)),K.call(()=>api.reflectionRules(value))]);
    if(scope!==knowledgeScope())return;
    R.problem=status.ok===false?explain(status):'';R.status=status.ok===false?null:status;R.candidates=candidates.ok===false?null:candidates;R.rules=rules.ok===false?null:rules;
    loaded.reflection=true;drawReflection();
  }
  function candidateCard(item,index,list){
    const box=el('article','kn-item'),head=el('div','kn-item-head'),key='c:'+item.id,draft=K.input(R.rules?.limits?.text||200,R.drafts.has(item.id)?R.drafts.get(item.id):String(item.ruleDraft||''));
    head.append(el('h3','',Object.hasOwn(KINDS,item.kind)?tr(...KINDS[item.kind]):String(item.kind)),el('span','kn-meta',tr(`出现 ${item.count||0} 次`,`seen ${item.count||0} time(s)`)));
    draft.oninput=()=>{R.drafts.set(item.id,draft.value);};fk(draft,key+':text');
    const row=el('div','st-save-row'),approve=fk(K.button('primary',tr('批准为规则','Approve as a rule')),key+':approve'),reject=fk(K.button('secondary',tr('拒绝','Reject')),key+':reject'),status=K.status();
    approve.setAttribute('aria-label',`${tr('批准为规则','Approve as a rule')}${colon()}${item.ruleDraft||''}`);reject.setAttribute('aria-label',`${tr('拒绝','Reject')}${colon()}${item.ruleDraft||''}`);
    const decide=action=>void run(async()=>{
      const text=draft.value.trim();
      if(action==='approve'&&!text){status.say(tr('规则文字不能为空。','The rule text cannot be empty.'),true);return key+':text';}
      const result=await K.call(()=>api.reflectionDecide({id:item.id,action,...(action==='approve'&&text!==String(item.ruleDraft||'').trim()?{text}:{})}));
      if(result.ok===false&&!['reflection_candidate_decided','reflection_candidate_not_found'].includes(K.codeOf(result))){status.say(`${tr('没有处理','Not done')}${colon()}${explain(result)}`,true);return key+':'+action;}
      R.message=result.ok===false?explain(result):action==='approve'?tr('已批准。这条规则会加入该角色的提示词，从下一次回复起生效。','Approved. The rule joins this character’s prompt from its next reply.'):tr('已拒绝，没有新增规则。','Rejected; no rule was added.');R.error=result.ok===false;R.drafts.delete(item.id);
      const other=list[index+1]||list[index-1];await loadReflection();return other?`c:${other.id}:approve`:'reflect-run';
    });
    approve.onclick=()=>decide('approve');reject.onclick=()=>decide('reject');row.append(approve,reject,status.node);
    box.append(head,K.field(tr('规则草稿（批准前可以改）','Rule draft (you may edit it before approving)'),draft,`notes-candidate-${item.id}`),evidence(item.evidence,true),row);return box;
  }
  function drawReflection(){
    const rows=people(),nodes=[],s=R.status;
    if(!characters&&!loaded.reflection){fill(panels.reflection,[card(el('p','st-note',tr('正在读取…','Loading…')))]);return;}
    const setup=card(el('h2','',tr('反思','Reflection'))),choose=K.select(rows.map(item=>[item.id,item.builtin?`${item.name}${tr('（内置角色）',' (built-in character)')}`:item.name]),R.id);
    setup.append(el('p','st-note',tr('回看你在某个角色的 App 对话里说过的话，把你不止一次纠正它的地方整理成“规则候选”。候选要你批准后才生效；每个角色单独设置，默认关闭。','Reviews what you said in one character’s App conversation and turns things you corrected more than once into “rule candidates”. A candidate is used only after you approve it; set per character, off by default.')));
    if(!rows.length){setup.append(el('p','st-note',tr('还没有可以设置的角色。','There is no character to set up yet.')));fill(panels.reflection,[setup]);return;}
    fk(choose,'reflect-who');choose.onchange=()=>void run(async()=>{R.id=choose.value;R.message='';R.runMessage='';await loadReflection();return 'reflect-who';});
    setup.append(K.field(tr('角色','Character'),choose,'notes-reflect-who'));
    if(R.problem)setup.append(el('p','st-problem',R.problem));
    if(s){
      const enable=K.check(tr('为这个角色开启反思','Turn reflection on for this character'),'notes-reflect-enabled'),hours=K.select(Array.from({length:24},(_,hour)=>[String(hour),`${String(hour).padStart(2,'0')}:00`]),String(s.hour)),status=K.status('st-status kn-status'),runStatus=K.status('st-status kn-status');
      fk(enable.box,'reflect-enabled');fk(hours,'reflect-hour');enable.box.checked=!!s.enabled;enable.box.setAttribute('aria-describedby','notes-reflect-disclosure');
      const disclosure=el('p','st-note kn-disclosure',tr('开启后，每运行一次，就会把当天这段对话的文字再发给这个角色的 AI 服务一次，产生额外费用。它只在应用开着的时候、到你选的整点运行；如果那时应用没开，不会补跑，只会在这里提示你可以手动运行一次。','When on, each run sends that day’s conversation text to this character’s AI provider once more, at extra cost. It runs at the hour you choose and only while the app is open; if the app was closed then, nothing is run later on its own. You are only offered a manual run here.'));
      disclosure.id='notes-reflect-disclosure';
      const configure=patch=>void run(async()=>{
        const result=await K.call(()=>api.reflectionConfigure({characterId:R.id,...patch}));
        R.message=result.ok===false?`${tr('没有保存','Not saved')}${colon()}${explain(result)}`:tr('已保存。','Saved.');R.error=result.ok===false;await loadReflection();
      });
      enable.box.onchange=()=>configure({enabled:enable.box.checked});hours.onchange=()=>configure({hour:Number(hours.value)});
      status.say(R.message,R.error);
      const facts=el('ul','kn-facts');
      facts.append(el('li','',`${tr('上次运行','Last run')}${colon()}${s.lastRunAt?`${K.stamp(s.lastRunAt,zh)}${s.lastOutcome?tr(`，结果：${outcome(s.lastOutcome)}`,`; result: ${outcome(s.lastOutcome)}`):''}${Number.isInteger(s.lastRead)?tr(`，读了你的 ${s.lastRead} 条消息`,`; read ${s.lastRead} message(s) of yours`):''}`:tr('还没有运行过','never')}`));
      if(s.missed){const missed=el('li','kn-warn',tr('错过了上次定时，可手动运行。','The last scheduled run was missed; you can run it by hand.'));facts.append(missed);}
      if(s.running)facts.append(el('li','',tr('正在运行…','Running now…')));
      const runRow=el('div','st-save-row'),go=fk(K.button('secondary',tr('现在运行一次','Run once now')),'reflect-run');
      go.dataset.locked=String(!s.enabled||!!s.running);if(!s.enabled){const why=el('span','kn-meta',tr('开启后才能运行。','Turn it on to run.'));why.id='notes-reflect-run-why';go.setAttribute('aria-describedby',why.id);runRow.append(go,why);}else runRow.append(go);
      runStatus.say(R.runMessage,R.runError);runRow.append(runStatus.node);
      go.onclick=()=>void run(async()=>{
        runStatus.say(tr('正在回看对话，这需要调用一次 AI，请稍等…','Reviewing the conversation. This takes one AI call; please wait…'));
        const result=await K.call(()=>api.reflectionRun({characterId:R.id}));
        if(result.ok===false){R.runMessage=`${tr('没有运行','Not run')}${colon()}${explain(result)}`;R.runError=true;}
        else if(result.outcome==='ok'){R.runMessage=tr(`读了你的 ${result.read||0} 条消息：新增 ${result.created||0} 条候选，合并进已有候选 ${result.merged||0} 条，现在共有 ${result.pending||0} 条待处理。`,`Read ${result.read||0} message(s) of yours: ${result.created||0} new candidate(s), ${result.merged||0} merged into existing ones, ${result.pending||0} now waiting.`);R.runError=false;}
        else{R.runMessage=`${tr('这次没有产生候选','No candidates this time')}${colon()}${outcome(result.outcome)}${tr('。','.')}`;R.runError=!['no_new_messages'].includes(result.outcome);}
        await loadReflection();return 'reflect-run';
      });
      setup.append(enable.wrap,disclosure,K.field(tr('每天几点运行（本机时间）','Hour of the daily run (local time)'),hours,'notes-reflect-hour'),status.node,facts,runRow);
    }
    nodes.push(setup);
    if(R.candidates){
      const list=R.candidates.candidates||[],box=card(el('h2','',tr(`规则候选（${list.length}）`,`Rule candidates (${list.length})`)));
      box.append(el('p','st-note',tr('同一件事被你纠正不止一次才会成为候选。每条都附有你当时的原话和日期。','Something becomes a candidate only after you corrected it more than once. Each one quotes what you said, with the date.')));
      if(R.candidates.seenOnce)box.append(el('p','kn-meta',tr(`另有 ${R.candidates.seenOnce} 件事只出现过一次，还不算候选。`,`${R.candidates.seenOnce} other thing(s) were seen only once and are not candidates yet.`)));
      if(R.candidates.atCap)box.append(el('p','st-problem',tr('生效的规则已满。批准新的之前，请先停用或移除一条。','The active rules are full. Switch one off or remove one before approving another.')));
      if(!list.length)box.append(el('p','st-note kn-empty-line',tr('现在没有候选。','No candidates right now.')));
      else{const items=el('div','kn-items');items.append(...list.map((item,index)=>candidateCard(item,index,list)));box.append(items);}
      nodes.push(box);
    }
    if(R.rules){
      const rules=R.rules.rules||[],limits=R.rules.limits||{rules:20,chars:1500},box=card(el('h2','',tr('已批准的规则','Approved rules'))),usage=el('p','kn-meta kn-usage',tr(`生效中：${R.rules.count||0} 条`,`Active: ${R.rules.count||0} rule(s)`)),status=K.status('st-status kn-status');
      box.append(usage,more('rules-limits',tr('限额说明','Limits'),[tr(`生效的规则最多 ${limits.rules} 条，合计最多 ${limits.chars} 字；现在用了 ${R.rules.count||0} 条、${R.rules.chars||0} 字。`,`Up to ${limits.rules} active rules and ${limits.chars} characters in total; ${R.rules.count||0} rule(s) and ${R.rules.chars||0} characters are in use.`)]));
      if(R.rules.atCap)box.append(el('p','st-problem',tr('已到上限：新的候选要等你停用或移除一条规则后才能批准。','At the limit: a new candidate can be approved only after you switch off or remove a rule.')));
      if(!rules.length)box.append(el('p','st-note kn-empty-line',tr('还没有批准过规则。','No rule has been approved yet.')));
      const items=el('ul','kn-rules');
      rules.forEach((rule,index)=>{
        const li=el('li','kn-rule'),toggle=K.check(rule.text,`notes-rule-${rule.id}`),remove=fk(K.button('plain',tr('移除','Remove')),'rule-remove:'+rule.id);
        fk(toggle.box,'rule:'+rule.id);toggle.box.checked=!!rule.enabled;toggle.box.setAttribute('aria-label',`${tr('启用规则','Use the rule')}${colon()}${rule.text}`);remove.setAttribute('aria-label',`${tr('移除规则','Remove the rule')}${colon()}${rule.text}`);
        const change=(patch,done,to)=>void run(async()=>{const result=await K.call(()=>api.reflectionRule({id:rule.id,...patch}));R.ruleMessage=result.ok===false?`${tr('没有保存','Not saved')}${colon()}${explain(result)}`:done;R.ruleError=result.ok===false;await loadReflection();return to;});
        toggle.box.onchange=()=>change({enabled:toggle.box.checked},toggle.box.checked?tr('规则已启用。','The rule is on.'):tr('规则已停用。','The rule is off.'),'rule:'+rule.id);
        K.twoClick(remove,tr('再点一次确认移除','Click again to remove'),()=>{const other=rules[index+1]||rules[index-1];change({remove:true},tr('已移除这条规则。','The rule was removed.'),other?'rule-remove:'+other.id:'reflect-run');});
        li.append(toggle.wrap,remove);items.append(li);
      });
      status.say(R.ruleMessage||'',!!R.ruleError);box.append(items,status.node);nodes.push(box);
    }
    fill(panels.reflection,nodes);
  }

  const loaders={notes:loadNotes,proposals:loadProposals,reflection:loadReflection},draws={notes:drawNotes,proposals:drawProposals,reflection:drawReflection};
  const loading={};
  async function ensure(id,fresh=false){
    if(busy||loading[id]||(loaded[id]&&!fresh))return;
    const scope=knowledgeScope();
    loading[id]=true;
    try{await loaders[id]();}catch{loaded[id]=false;}
    finally{
      loading[id]=false;
      if(id!=='notes'&&scope!==knowledgeScope()&&document.body.dataset.view==='notes'&&tabs.current()===id)void ensure(id,true);
    }
  }
  window.ArcadeNotes=Object.freeze({open(tab){switchView('notes');tabs.select(tab);void ensure(tab,true);}});
  let displayedScope='';
  window.renderNotes=data=>{
    latest=data;zh=data.config?.language==='zh';
    const scope=knowledgeScope();
    if(displayedScope!==scope&&!busy){
      displayedScope=scope;
      P.list=null;P.problem='';P.rowStatus.clear();
      R.status=null;R.candidates=null;R.rules=null;R.problem='';R.message='';R.runMessage='';R.ruleMessage='';R.drafts.clear();
      loaded.proposals=loaded.reflection=false;
      if(tabs.current()==='reflection')drawReflection();
    }
    const access=data.bot?.st?.settings?.wikiAccess||{},accessKey=JSON.stringify([access,data.bot?.st?.available,builtinId(),builtinName(builtinId()),data.accounts?.selectedId]);
    if(lang!==data.config?.language){
      lang=data.config?.language;P.access=access;P.accessKey=accessKey;
      tabs.node.setAttribute('aria-label',tr('笔记的三个部分','Sections of the notes page'));
      tabs.label('notes',tr('笔记','Notes'));tabs.label('proposals',tr('提议','Proposals'));tabs.label('reflection',tr('反思','Reflection'));
      for(const id of Object.keys(draws))draws[id]();
    }else if(accessKey!==P.accessKey&&!busy){P.access=access;P.accessKey=accessKey;if(tabs.current()==='proposals')drawProposals();}
    if(document.body.dataset.view==='notes')void ensure(tabs.current());
  };
  // The library changed elsewhere: read it again the next time a tab needs it.
  document.addEventListener('arcade-library-changed',()=>{characters=null;loaded.proposals=loaded.reflection=false;});
  // Coming back to the page reads the current tab again (the files may have been edited meanwhile).
  let seenView=document.body.dataset.view;
  new MutationObserver(()=>{const now=document.body.dataset.view;if(now===seenView)return;seenView=now;if(now==='notes')void ensure(tabs.current(),true);}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
})();
