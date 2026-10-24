// Self-contained: Chrome serializes this function into the selected course tab.
export async function readCoursePage({expandModules=false}={}){
  const current=new URL(location.href);
  const clean=value=>String(value || '').replace(/\s+/g,' ').trim();
  const visible=node=>Boolean(node.getClientRects().length);
  const moduleName=/^M[oó]dulo(?:\s+\d+)?(?:\s*[-–—:]|\s+)\s*\S/i;
  const caption=node=>clean(node.textContent).replace(/^(?:\d+\s*%|[✓✔]+)\s*/u,'');
  const validLink=a=>{try{const u=new URL(a.href);return u.origin===current.origin&&u.pathname.replace(/\/$/,'')===current.pathname.replace(/\/$/,'')&&u.searchParams.has('classId');}catch{return false;}};
  const links=root=>[...root.querySelectorAll('a[href]')].filter(validLink);
  const record=a=>({href:a.href,title:a.innerText || a.textContent || a.getAttribute('aria-label') || ''});
  const structuralHeaders=new WeakSet();let knownLabels=[];
  const headerFor=section=>{
    const header=section.firstElementChild;
    return header&&visible(header)&&!header.matches('a,input')&&!header.querySelector('a[href],input,video,iframe')&&caption(header)&&caption(header).length<=150?header:null;
  };
  const labels=()=>{
    const candidates=[...document.querySelectorAll('button,[role="button"],summary,h1,h2,h3,h4,h5,h6,p,span,strong,div')].filter(el=>visible(el)&&!el.closest('a[href]')&&clean(el.textContent).length<=150&&moduleName.test(clean(el.textContent)));
    // Infer peer module cards from a real lesson list; names need no special prefix.
    for(const anchor of links(document)){
      for(let section=anchor.parentElement,depth=0;section&&section!==document.body&&depth<10;section=section.parentElement,depth++){
        if(section.querySelector('video,iframe'))break;
        const header=headerFor(section);const semantic=header&&(header.matches('button[aria-expanded],[role="button"][aria-expanded],summary')||header.querySelector('button[aria-expanded],[role="button"][aria-expanded],summary'));
        if(!section.parentElement||section.children.length<2||!header||links(section).length<(semantic?1:2))continue;
        const peers=[...section.parentElement.children].filter(peer=>peer.tagName===section.tagName&&!peer.querySelector('video,iframe')&&headerFor(peer));
        if(peers.length<2)continue;
        for(const peer of peers){const header=headerFor(peer);structuralHeaders.add(header);candidates.push(header);}
        break;
      }
    }
    // Accessible controls must belong to an inferred card or a proven lesson panel.
    for(const toggle of document.querySelectorAll('button[aria-expanded],[role="button"][aria-expanded],summary')){
      const scope=toggle.closest('aside,nav,[data-course-list],[data-module-list]');
      if(!scope||scope.querySelector('video,iframe')||!visible(toggle)||toggle.closest('a[href]')||!caption(toggle)||caption(toggle).length>150)continue;
      const controls=(toggle.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)).filter(Boolean);
      const moduleHeader=candidates.some(header=>structuralHeaders.has(header)&&(header===toggle||header.contains(toggle)||toggle.contains(header)));
      if(moduleHeader||controls.some(panel=>links(panel).length>0)||(toggle.tagName==='SUMMARY'&&links(toggle.parentElement).length>0)){structuralHeaders.add(toggle);candidates.push(toggle);}
    }
    candidates.push(...knownLabels.filter(el=>el.isConnected&&visible(el)));
    const unique=[...new Set(candidates)];
    knownLabels=unique.filter(el=>!unique.some(other=>other!==el&&el.contains(other))).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    return knownLabels;
  };
  const sectionFor=(label,all)=>{
    let section=label;
    while(section.parentElement&&section.parentElement!==document.body&&section.parentElement!==document.documentElement&&!section.parentElement.querySelector('video,iframe')&&all.filter(h=>section.parentElement.contains(h)).length===1)section=section.parentElement;
    return section;
  };
  const scanned=[];const modules=[];const warnings=[];
  if(expandModules){
    const titles=labels().map(caption);
    for(const [moduleIndex,title] of titles.entries()){
      let all=labels();let label=all[moduleIndex];let section=label?sectionFor(label,all):null;
      let found=section?links(section):[];
      if(!found.length&&label){
        const toggle=label.closest('button,[role="button"],summary') || (structuralHeaders.has(label)?label:label.parentElement);
        if(toggle&&!toggle.closest('a[href]')&&!toggle.disabled&&toggle.getAttribute('aria-disabled')!=='true'){
          const expanded=toggle.getAttribute('aria-expanded')==='true'||(toggle.tagName==='SUMMARY'&&toggle.parentElement.open);
          if(!expanded)toggle.click();
          const deadline=Date.now()+6000;
          while(Date.now()<deadline){
            all=labels();label=all[moduleIndex];section=label?sectionFor(label,all):null;found=section?links(section):[];
            if(found.length)break;
            await new Promise(resolve=>setTimeout(resolve,100));
          }
        }
      }
      scanned.push(...found.map(a=>({...record(a),module:title,moduleIndex})));
      modules.push({title,count:found.length});
      if(!found.length)warnings.push(`Não foi possível ler as aulas de “${title}”. Expanda esse módulo no site e busque novamente.`);
    }
  }
  const nodes=links(document);
  const seen=new Set(scanned.map(a=>a.href));
  const anchors=[...scanned,...nodes.filter(a=>!seen.has(a.href)).map(record)];
  const usable=node=>visible(node)&&!node.closest('a[href]')&&clean(node.textContent).length<=120&&!moduleName.test(clean(node.textContent))&&!modules.some(m=>m.title===caption(node))&&!/^(aulas?|conte[uú]dos?|m[oó]dulos?|principal|menu|progresso)$/i.test(clean(node.textContent));
  const explicit=[...document.querySelectorAll('[data-course-title],[data-category-title]')].find(usable);
  let category=explicit?clean(explicit.textContent):'';
  let container=nodes[0]?.parentElement;
  while(container&& !nodes.every(a=>container.contains(a)))container=container.parentElement;
  if(!category && nodes.length>1){
    for(let level=0;container&&level<3&&!category;level++,container=container.parentElement){
      if(container===document.body || container===document.documentElement)break;
      if(container.querySelector('video,iframe'))break;
      const headings=[...container.querySelectorAll('h1,h2,h3,h4,h5,[role="heading"]')].filter(usable);
      if(headings.length===1)category=clean(headings[0].textContent);
      if(!category){
        const previous=container.previousElementSibling;
        if(previous&&usable(previous)&&!previous.matches('button,input')&&!previous.querySelector('a[href],input,video,iframe')&&!/\d\s*%|^(buscar|pesquisar|selecionar)\b/i.test(clean(previous.textContent)))category=clean(previous.textContent);
      }
    }
  }
  if(!category){
    const key=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^ead[\s_-]+/,'').replace(/[^a-z0-9]/g,'');
    const slug=decodeURIComponent(current.pathname.split('/').filter(Boolean).at(-1) || '').replace(/\d{10,}$/,'');
    const exact=[...document.querySelectorAll('h1,h2,h3,h4,h5,[role="heading"]')].filter(usable).filter(h=>key(h.textContent)===key(slug));
    if(exact.length)category=clean(exact[0].textContent);
  }
  return {anchors,category,modules,warnings,incomplete:warnings.length>0};
}
