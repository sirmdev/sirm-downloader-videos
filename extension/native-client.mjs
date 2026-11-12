// Cliente do auxiliar nativo (protocolo em native/host.mjs). Vive no service worker; um port aberto o mantém ativo.
const TERMINAL=new Set(['complete','error','cancelled']);
export function createNativeClient(chrome,{host='com.turbovideo.downloader',readyTimeoutMs=10000,idleMs=30000}={}){
  let port;let idleTimer;let state='idle';let info;let reason;let connecting;let seq=0;
  const holds=new Set();const waiters=new Set();const pending=new Map();const messageListeners=new Set();const statusListeners=new Set();
  const status=()=>({state,...(info&&(state==='ready'||state==='idle')?{info}:{}),...(reason?{reason}:{})});
  const setState=(next,why)=>{state=next;reason=why;if(next!=='ready'&&next!=='idle')info=undefined;for(const fn of statusListeners)try{fn(status());}catch{/* falha isolada */}};
  const unavailable=message=>Object.assign(new Error(message),{code:'native_unavailable',retryable:false});
  function close(){clearTimeout(idleTimer);const old=port;port=undefined;if(old){try{old.disconnect();}catch{/* falha isolada */}}if(state!=='idle')setState('idle');}
  function armIdle(){clearTimeout(idleTimer);if(holds.size||!port||state!=='ready')return;idleTimer=setTimeout(()=>{if(!holds.size&&port&&state==='ready')close();},idleMs);idleTimer?.unref?.();}
  function connect(){
    let opened;
    try{opened=chrome.runtime.connectNative(host);}catch(error){setState('missing',error?.message||'Auxiliar local não encontrado.');for(const w of [...waiters])w(false);return;}
    port=opened;setState('connecting');
    opened.onMessage.addListener(message=>{if(port===opened)handle(message);});
    opened.onDisconnect.addListener(()=>{
      if(port!==opened)return;
      const why=chrome.runtime.lastError?.message;const wasReady=state==='ready';port=undefined;
      setState(wasReady?'disconnected':'missing',why||(wasReady?'Auxiliar encerrado.':'Auxiliar local não encontrado ou encerrado.'));
      for(const key of [...holds])if(key.startsWith('job:'))holds.delete(key);
      for(const [id,p] of [...pending]){pending.delete(id);p.reject(Object.assign(new Error('A conexão com o auxiliar foi encerrada.'),{code:'native_disconnected',retryable:true}));}
      for(const w of [...waiters])w(false);
    });
    try{opened.postMessage({type:'hello'});}catch{/* falha isolada */}
  }
  function handle(message){
    if(message?.type==='ready'){
      info={folder:message.folder,parallel:!!message.parallel,supportsFilename:!!message.supportsFilename,supportsFolders:!!message.supportsFolders,supportsModules:!!message.supportsModules};
      setState('ready');for(const w of [...waiters])w(true);armIdle();return;
    }
    const wait=pending.get(message?.id);
    if(wait){if(message.type==='info'||message.type==='error'){pending.delete(message.id);wait.resolve(message);}return;}
    if(TERMINAL.has(message?.type)&&message.id)release('job:'+message.id);
    for(const fn of [...messageListeners])try{fn(message);}catch{/* falha isolada */}
  }
  function ensureReady(){
    if(state==='ready'&&port){armIdle();return Promise.resolve(info);}
    if(connecting)return connecting;
    connecting=new Promise((resolve,reject)=>{
      const finish=ok=>{clearTimeout(timer);waiters.delete(finish);if(ok)resolve(info);else reject(unavailable(reason||'Não consegui conectar o auxiliar. Execute Instalar.cmd.'));};
      const timer=setTimeout(()=>{const old=port;port=undefined;if(old){try{old.disconnect();}catch{/* falha isolada */}}setState('missing','O auxiliar não respondeu a tempo.');finish(false);},readyTimeoutMs);
      waiters.add(finish);connect();
    }).finally(()=>{connecting=undefined;});
    return connecting;
  }
  function send(message){
    if(state!=='ready'||!port)return false;
    if(message?.type==='download'&&message.id)hold('job:'+message.id);
    try{port.postMessage(message);return true;}catch{if(message?.type==='download')holds.delete('job:'+message.id);return false;}
  }
  async function request(message,{timeoutMs=90000}={}){
    const id=message.id||`req-${Date.now()}-${++seq}`;const key='req:'+id;holds.add(key);
    try{
      await ensureReady();
      return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('O auxiliar não respondeu a tempo.'),{code:'timeout',retryable:true}));},timeoutMs);
        pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
        if(!send({...message,id})){clearTimeout(timer);pending.delete(id);reject(Object.assign(new Error('Auxiliar desconectado.'),{code:'native_disconnected',retryable:true}));}
      });
    }finally{release(key);}
  }
  function hold(key){holds.add(key);clearTimeout(idleTimer);}
  function release(key){holds.delete(key);armIdle();}
  return {ensureReady,send,request,status,hold,release,
    onMessage(fn){messageListeners.add(fn);return()=>messageListeners.delete(fn);},
    onStatus(fn){statusListeners.add(fn);return()=>statusListeners.delete(fn);}};
}
