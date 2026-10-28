import {COMPONENT_NAMES} from './catalog'

/**
 * 小程序的「逻辑沙盒」。
 *
 * 它是一个看不见的 iframe（sandbox="allow-scripts"，没有 allow-same-origin，CSP 禁止直连网络），
 * 只跑 AI 写的 JavaScript，不画任何界面。界面由主页用 Lobe UI 渲染：
 *
 *   沙盒：state ──view()──▶ 积木树（纯 JSON） ──postMessage──▶ 主页渲染成真控件
 *   主页：点击 / 输入 ──postMessage──▶ 沙盒里对应的函数 ──▶ 改 state ──▶ 重新 view()
 *
 * 所以逻辑自由（任意 JS、可 import 库），界面统一（只能用目录里的积木），交互是真的。
 */

const ESM_HOSTS = 'https://esm.sh https://cdn.jsdelivr.net https://unpkg.com'

const RUNNER = String.raw`
(()=>{
  const NAMES=__NAMES__,session=__SESSION__;
  const post=(m)=>parent.postMessage({applet:1,session,...m},'*');
  let seq=0;const calls=new Map();
  const call=(op,p)=>new Promise((res,rej)=>{
    const id=++seq;calls.set(id,{res,rej});post({k:'call',id,op,...p});
    /* 取数可能先等用户确认域名，其他操作仍保持原来的超时。 */
    setTimeout(()=>{if(calls.delete(id))rej(new Error(op+' 超时'))},op==='fetch'?300000:20000);
  });
  const fail=(e,where)=>{
    const msg=(e&&e.message)||String(e);
    post({k:'error',message:(where?where+'：':'')+msg});
  };

  /* 沙盒里没有 localStorage / 剪贴板权限，AI 常会顺手用到，给个不会崩的替身 */
  const memory=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v))},removeItem:k=>{m.delete(k)},clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};
  for(const name of ['localStorage','sessionStorage']){
    try{window[name].getItem('x')}catch{try{Object.defineProperty(window,name,{value:memory(),configurable:true})}catch{}}
  }
  try{Object.defineProperty(navigator,'clipboard',{value:{writeText:(t)=>call('copy',{text:String(t)})},configurable:true})}catch{}

  let def=null,state={},persist=[],handlers=new Map(),hid=0,dirty=false,started=false,dark=false,lastSent='',lastConfirmed='',saveSeq=0,confirmedSeq=0,count=0,settings={},surface='widget',viewport=Object.freeze({width:0,compact:true}),initRequested=false,lifecycle=Promise.resolve();
  const freeze=(v)=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
  const context=(m)=>{settings=freeze(m.settings&&typeof m.settings==='object'&&!Array.isArray(m.settings)?m.settings:{});surface=typeof m.surface==='string'?m.surface:'widget'};
  const settingsKey=(value)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const resize=(value)=>{const width=value&&Number.isFinite(value.width)?Math.max(0,Math.round(value.width)):0;viewport=Object.freeze({width,compact:width<480})};
  /* init and setting hooks share a queue: asynchronous hooks observe each setting version in order. */
  const enqueue=(fn,where)=>{lifecycle=lifecycle.then(fn).catch(e=>{fail(e,where);schedule()});return lifecycle};
  const timers=new Set();

  const isNode=(x)=>x&&typeof x==='object'&&typeof x.$t==='string';
  const flat=(list,out=[])=>{
    for(const x of list){
      if(x==null||x===false||x===true)continue;
      if(Array.isArray(x))flat(x,out);
      else if(isNode(x))out.push(x);
      else out.push({$t:'Text',p:{text:String(x)},c:[]});
    }
    return out;
  };
  const ui={};
  for(const name of NAMES)ui[name]=(...args)=>{
    let p={};
    const first=args[0];
    if(first&&typeof first==='object'&&!Array.isArray(first)&&!isNode(first))p=args.shift();
    return{$t:name,p,c:flat(args)};
  };
  window.ui=ui;

  const ser=(n)=>{
    if(++count>4000)throw new Error('界面节点太多（上限 4000 个），请分页或只渲染可见的部分');
    const p={};
    for(const k in n.p){
      const v=n.p[k];
      if(v===undefined)continue;
      if(typeof v==='function'){const id=++hid;handlers.set(id,v);p[k]={$fn:id}}
      else p[k]=v;
    }
    return{t:n.$t,p,c:n.c.map(ser)};
  };

  const pick=()=>{const o=Object.create(null);for(const k of persist)if(Object.hasOwn(state,k))o[k]=state[k];return o};
  /* 比较缓存前拒绝 JSON.stringify 会忽略或转换的值；宿主仍执行完整预算校验。 */
  const serializable=(value,seen=new Set(),depth=0)=>{
    if(depth>100)throw new Error('应用数据嵌套不能超过 100 层');
    if(value===null||typeof value==='string'||typeof value==='boolean')return;
    if(typeof value==='number'&&Number.isFinite(value))return;
    if(typeof value!=='object'||seen.has(value))throw new Error('持久字段必须是完整 JSON，不能包含循环或非 JSON 值');
    const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
    if(!array&&proto!==null&&Object.getPrototypeOf(proto)!==null)throw new Error('持久字段只能使用普通 JSON 对象');
    const keys=Reflect.ownKeys(value);
    if(array&&(keys.length!==value.length+1||!Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean)))throw new Error('持久数组不能包含空缺项或附加字段');
    seen.add(value);
    for(const key of keys){
      if(array&&key==='length')continue;
      const d=Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=='string'||!d.enumerable||!('value' in d))throw new Error('持久字段必须是普通 JSON 值');
      serializable(d.value,seen,depth+1);
    }
    seen.delete(value);
  };
  const saves=new Map();
  /* 捕获持久字段不等待下一帧 view；关窗前已经发出的保存继续由宿主完成。 */
  const save=(force=false)=>{
    if(!started||!persist.length)return;
    try{
      const data=pick();serializable(data);const text=JSON.stringify(data);
      if(!force&&text===lastSent&&(saves.size||text===lastConfirmed))return;
      const id=++saveSeq;
      post({k:'save',id,data});
      saves.set(id,text);lastSent=text;
    }catch(e){lastSent='';post({k:'storage-error',id:++saveSeq,message:(e&&e.message)||String(e)})}
  };

  const render=()=>{
    dirty=false;
    if(!def||!started)return;
    handlers=new Map();hid=0;count=0;
    let tree;
    try{tree=def.view(state,ctx)}catch(e){return fail(e,'view')}
    const nodes=flat([tree]);
    const root=nodes.length===1?nodes[0]:{$t:'Stack',p:{},c:nodes};
    try{post({k:'view',tree:ser(root)})}catch(e){fail(e,'界面里有不能传递的值（函数只能放在 onXxx 事件上）')}
  };
  const schedule=()=>{save();if(dirty)return;dirty=true;setTimeout(render,0)};

  /* 事件处理：同步或异步都行，结束后刷新；异步中途也刷新一次，让「加载中」能显示出来 */
  const run=async(fn,...a)=>{
    try{const r=fn(...a);if(r&&typeof r.then==='function'){schedule();await r}}
    catch(e){fail(e,'事件处理')}
    schedule();
  };

  const ctx={
    render:schedule,
    fetch:(url)=>call('fetch',{url:String(url)}),
    copy:(text)=>call('copy',{text:String(text)}),
    open:(url)=>call('open',{url:String(url)}),
    ask:(text)=>call('ask',{text:String(text)}),
    toast:(text,kind)=>call('toast',{text:String(text),kind:kind||'info'}),
    every:(ms,fn)=>{const id=setInterval(()=>run(fn),Math.max(50,Number(ms)||1000));timers.add(id);return()=>{clearInterval(id);timers.delete(id)}},
    after:(ms,fn)=>{const id=setTimeout(()=>run(fn),Math.max(0,Number(ms)||0));timers.add(id);return()=>clearTimeout(id)},
    get dark(){return dark},
    get settings(){return settings},
    get surface(){return surface},
    get viewport(){return viewport},
  };

  window.applet=(d)=>{
    if(!d||typeof d.view!=='function'){fail(new Error('applet({...}) 需要一个 view 函数'));return}
    def=d;
    if(d.state&&typeof d.state==='object')state=d.state;
    persist=Array.isArray(d.persist)?d.persist.map(String):[];
    post({k:'ready'});
  };

  addEventListener('message',(e)=>{
    const m=e.data;
    if(e.source!==parent||!m||m.applet!==1||m.session!==session)return;
    if(m.k==='init'){
      if(initRequested)return;initRequested=true;
      return enqueue(async()=>{
        dark=!!m.dark;
        context(m);resize(m.viewport);
        const saved=m.saved&&typeof m.saved==='object'?m.saved:{};
        for(const k of persist)if(saved[k]!==undefined)state[k]=saved[k];
        try{const initial=pick();serializable(initial);lastSent=lastConfirmed=JSON.stringify(initial)}catch{lastSent=lastConfirmed=''}
        try{if(typeof def.init==='function')await def.init(state,ctx)}catch(err){fail(err,'init')}
        started=true;
        save();render();
      },'init');
    }else if(m.k==='event'){
      const fn=handlers.get(m.fn);
      if(fn)run(fn,m.payload);
    }else if(m.k==='save-reply'){
      const text=saves.get(m.id);if(text===undefined)return;saves.delete(m.id);
      if(m.error){if(m.id===saveSeq)lastSent=''}
      else if(m.id>confirmedSeq){confirmedSeq=m.id;lastConfirmed=text}
    }else if(m.k==='retry-save'){
      save(true);
    }else if(m.k==='reply'){
      const p=calls.get(m.id);if(!p)return;calls.delete(m.id);
      m.error?p.rej(new Error(m.error)):p.res(m.result);
    }else if(m.k==='dark'){
      dark=!!m.dark;schedule();
    }else if(m.k==='context'){
      return enqueue(async()=>{
        const previous=settings;
        const previousKey=settingsKey(previous);
        context(m);
        if(started&&previousKey!==settingsKey(settings)&&typeof def.onSettingsChange==='function'){
          try{await def.onSettingsChange(state,ctx,previous)}catch(err){fail(err,'onSettingsChange')}
        }
        schedule();
      },'设置更新');
    }else if(m.k==='viewport'){
      resize(m.viewport);schedule();
    }
  });

  addEventListener('error',(e)=>fail(e.error||e.message));
  addEventListener('unhandledrejection',(e)=>fail(e.reason));
  addEventListener('load',()=>setTimeout(()=>{if(!def)fail(new Error('脚本没有调用 applet({...})，界面不会出现'))},4000));
})();
`

export function buildRunnerDoc(source: string, session = ''): string {
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${ESM_HOSTS}`,
    // 逻辑沙盒不直连网络，取数一律走 ctx.fetch，由主页校验授权
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
  const runner = RUNNER.replace('__NAMES__', JSON.stringify(COMPONENT_NAMES)).replace('__SESSION__', () => JSON.stringify(session))
  // 用户代码里的 </script> 会提前结束标签
  const user = source.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${runner}</script></head><body><script type="module">${user}</script></body></html>`
}
