import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,mkdirSync} from 'node:fs'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=(process.env.DADA_QA_URL||'http://127.0.0.1:5201').replace(/\/$/,'')
const output=process.env.DADA_QA_OUTPUT||'/tmp/dada-theme-package-storage'
mkdirSync(output,{recursive:true})
const binary=readFileSync(new URL('../node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2',import.meta.url))
const browser=await chromium.launch({headless:true})
try{
 const context=await browser.newContext()
 const external=[]
 await context.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();external.push(route.request().url());return route.abort()})
 const page=await context.newPage()
 await page.goto(base+'/theme-preview.html')
 await page.waitForSelector('.preview-waiting')
 const result=await page.evaluate(async({fontBase64})=>{
   const resource=await import('/src/lib/fontResource.ts'),fonts=await import('/src/lib/fonts.ts'),codec=await import('/src/lib/themePackages/codec.ts'),repository=await import('/src/lib/themePackages/repository.ts'),{db}=await import('/src/lib/db.ts')
   const buffer=Uint8Array.from(atob(fontBase64),letter=>letter.charCodeAt(0)).buffer
   const sha256=await resource.sha256Bytes(buffer)
   const manifest={packageId:'browser.storage',version:'1.0.0',digest:'0'.repeat(64),kind:'declarative-theme',schemaVersion:1,name:'真实备份夹具',description:'独立浏览器无用户数据',requiredRenderers:[{skin:'paper',shell:'standard',skinVersion:1,shellVersion:1}],contributions:[{id:'main',kind:'theme',design:{name:'本地字体',description:'固定样本',skin:'paper',shell:'standard',overrides:{},fonts:[{family:'Local Main',role:'serif',resourceId:'Main'}]}}],resources:[{id:'Main',mime:'font/woff2',bytes:buffer.byteLength,sha256}]}
   manifest.digest=await codec.themePackageDigest(manifest)
   const ref={packageId:manifest.packageId,version:manifest.version,digest:manifest.digest,resourceId:'Main',sha256}
   const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="font-src 'none'";document.head.appendChild(meta)
   const violations=[];document.addEventListener('securitypolicyviolation',event=>violations.push(event.violatedDirective))
   const before=document.documentElement.getAttribute('style')
   const lease=fonts.acquireThemeFonts(document,[{family:'Local Main',role:'serif',resource:ref}],{localResources:async()=>buffer.slice(0)})
   const ready=await lease.ready
   const actual=[...document.fonts].find(face=>face.family===resource.localThemeFontFamily(ref))?.status
   const unchanged=before===document.documentElement.getAttribute('style')
   lease.release()
   const remaining=[...document.fonts].filter(face=>face.family===resource.localThemeFontFamily(ref)).length
   const imported=await codec.parseThemePackage(JSON.stringify({manifest,resources:[{id:'Main',base64:fontBase64}]}))
   await repository.installThemePackage(imported)
   const row=await db.get('themePackages','browser.storage@1.0.0')
   await db.put('themePackages',{...row,enabled:true})
   const storage=await import('/src/lib/storage.ts')
   const backup=await storage.exportBackupSnapshot()
   const saved=backup.indexedDB.themePackages[0]
   const tampered=structuredClone(backup)
   const bytes=Uint8Array.from(atob(tampered.indexedDB.themePackages[0].file.resources[0].base64),letter=>letter.charCodeAt(0));bytes[bytes.length-1]^=1
   tampered.indexedDB.themePackages[0].file.resources[0].base64=btoa(String.fromCharCode(...bytes))
   let rejected=false
   try{await storage.importBackup(tampered)}catch{rejected=true}
   const afterBad=await db.get('themePackages','browser.storage@1.0.0')
   window.storageBackupFixture=backup
   return {ready,actual,unchanged,remaining,violations,version:backup.version,savedEnabled:saved.enabled,base64Equal:saved.file.resources[0].base64===fontBase64,rejected,afterBadEnabled:afterBad.enabled}
 },{fontBase64:binary.toString('base64')})
 assert.equal(result.ready.ready,true);assert.equal(result.actual,'loaded');assert.equal(result.unchanged,true);assert.equal(result.remaining,0);assert.deepEqual(result.violations,[])
 console.log('通过：真实WOFF2在font-src none下ArrayBuffer FontFace加载，无root修改、无URL、释放后无face')
 assert.equal(result.version,4);assert.equal(result.savedEnabled,false);assert.equal(result.base64Equal,true)
 console.log('通过：真实IndexedDB包资源完整导出为backup4，字节一致且不复制enabled')
 assert.equal(result.rejected,true);assert.equal(result.afterBadEnabled,true)
 console.log('通过：真实IndexedDB恢复前hash篡改拒绝，原包启用状态不变')
 const reloaded=page.waitForEvent('load')
 await page.evaluate(async()=>{await(await import('/src/lib/storage.ts')).importBackup(window.storageBackupFixture)}).catch(error=>{if(!error.message.includes('Execution context was destroyed'))throw error})
 await reloaded
 const restored=await page.evaluate(async()=>{const {db}=await import('/src/lib/db.ts');const rows=await db.all('themePackages');return rows.map(row=>({enabled:row.enabled,bytes:row.resources[0].bytes.byteLength}))})
 assert.equal(restored.length,1);assert.equal(restored[0].enabled,false);assert.equal(restored[0].bytes,binary.byteLength)
 assert.equal(external.length,0)
 console.log('通过：真实完整恢复后资源字节保留、统一disabled，整个测试零外网请求')
 console.log('本地主题包字体与完整备份浏览器回归：4/4')
}finally{await browser.close()}
