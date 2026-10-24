export function collectLessonLinks(pageUrl,anchors){
  const page=new URL(pageUrl);const found=new Map();
  for(const anchor of anchors){
    try{
      const url=new URL(anchor.href,page);const id=url.searchParams.get('classId');
      if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.origin!==page.origin || url.pathname.replace(/\/$/,'')!==page.pathname.replace(/\/$/,'') || !id || !/^[\w-]{1,80}$/.test(id))continue;
      const title=String(anchor.title || '').replace(/\s+/g,' ').trim().normalize('NFC');if(!title)continue;
      url.search='';url.hash='';url.searchParams.set('classId',id);
      const module=String(anchor.module || '').replace(/\s+/g,' ').trim().normalize('NFC');
      if(!found.has(id))found.set(id,{url:url.href,title,...(module?{module,moduleIndex:Number.isInteger(anchor.moduleIndex)?anchor.moduleIndex:0}:{})});
    }catch{/* Ignore navigation links outside this course. */}
  }
  return [...found.values()];
}
export function lessonFilename(index,title){
  const clean=String(title).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
  return `${String(index+1).padStart(2,'0')} - ${(clean || 'Aula').slice(0,110)}`;
}
export function orderedLessons(pageUrl,anchors){
  const counts=new Map();
  return collectLessonLinks(pageUrl,anchors).map(item=>{
    const key=item.module?item.moduleIndex+'\n'+item.module:'';const index=counts.get(key) || 0;counts.set(key,index+1);
    const moduleFolder=item.module?`${String(item.moduleIndex+1).padStart(2,'0')} - ${item.module.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim()}`.slice(0,80).replace(/[. ]+$/g,''):'';
    return {...item,filename:lessonFilename(index,item.title),moduleFolder};
  });
}
