'use strict';
/* Orbit 星账 · 星空 Demo — 星座图谱版（零依赖 Canvas 2D）
   星星 = 白热星核 + 彩色辉光（无硬边圆球）；
   L1 = 金额轨迹星座折线；下钻 = 花销×标签二部图专属视图；
   物理 = 锚点系留真漂浮（无中心引力）；星轨 = 日/月/年连续变焦 + 左右拖拽 */
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
function hash01(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return((h>>>0)%10000)/10000}
function hexRgb(h){h=h.replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function rgba(hex,a){const[r,g,b]=hexRgb(hex);return`rgba(${r},${g},${b},${a})`}
function shade(hex,k){const[r,g,b]=hexRgb(hex);return`rgb(${Math.round(r*k)},${Math.round(g*k)},${Math.round(b*k)})`}
function mulberry(seed){let a=seed;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const easeOutBack=x=>{const c=1.70158;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};

/* ---------- 数据（编造） ---------- */
const CATS=[
 {id:'food', name:'餐饮', color:'#ff9f6b'},
 {id:'trans',name:'交通', color:'#5ad7ff'},
 {id:'fun',  name:'娱乐', color:'#b48cff'},
 {id:'home', name:'居住', color:'#ff7a9e'},
 {id:'daily',name:'日用', color:'#6fe3a8'},
 {id:'study',name:'学习', color:'#ffd166'},
 {id:'trip', name:'旅行', color:'#6b9dff'},
];
const CTXS=[
 {id:'fr',  name:'和朋友', color:'#ff9f6b'},
 {id:'solo',name:'独处',   color:'#8ea2c8'},
 {id:'love',name:'和对象', color:'#ff7a9e'},
 {id:'work',name:'通勤',   color:'#5ad7ff'},
 {id:'fam', name:'家庭',   color:'#6fe3a8'},
 {id:'none',name:'未标注', color:'#7a8299', dashed:true},
];
const EXP_TPL={
 food:[['海底捞','和朋友',168],['瑞幸咖啡','独处',18],['楼下小馆','和对象',46],['面包房','独处',28],['深夜烧烤','和朋友',96]],
 trans:[['地铁月卡','通勤',120],['打车','和朋友',38],['共享单车','通勤',15],['高铁票','家庭',210]],
 fun:[['电影票','和对象',88],['剧本杀','和朋友',128],['游戏充值','独处',45],['Livehouse','和朋友',180]],
 home:[['房租','未标注',1500],['水电燃气','未标注',160],['物业费','未标注',120]],
 daily:[['超市采购','家庭',132],['洗护用品','独处',58],['咖啡豆','独处',88]],
 study:[['专业书','独处',76],['网课','独处',199],['文具','独处',32]],
 trip:[['机票','和朋友',680],['酒店','和对象',420],['伴手礼','家庭',150]],
};
const CTX_TPL={
 fr:[['火锅','餐饮',168],['剧本杀','娱乐',128],['Livehouse','娱乐',180]],
 solo:[['咖啡','餐饮',18],['地铁','交通',40],['买书','学习',76]],
 love:[['电影','娱乐',88],['晚餐','餐饮',156],['酒店','旅行',420]],
 work:[['地铁月卡','交通',120],['打车','交通',38]],
 fam:[['超市','日用',132],['房租分摊','居住',800]],
 none:[['水电','居住',160],['杂费','日用',48]],
};
/* 月序列：2024-01 → 2026-06（有记录的第一月起，可前翻） */
const MONTHS=[];
(function(){
  const cw=[['home',.28],['food',.20],['fun',.13],['trans',.10],['daily',.11],['study',.07],['trip',.11]];
  for(let y=2024;y<=2026;y++){
    const mEnd=y===2026?6:12;
    for(let m=1;m<=mEnd;m++){
      const rnd=mulberry(y*100+m);
      const seasonal=1+0.25*Math.sin((m-1)/12*Math.PI*2);
      const total=Math.round((1050+rnd()*950)*seasonal);
      let tw=rnd(),top='home',acc=0;
      for(const[id,w]of cw){acc+=w;if(tw<acc){top=id;break}}
      MONTHS.push({label:m+'月',full:y+'年'+m+'月',total,top,y,m});
    }
  }
})();
const TODAY=MONTHS.length-1;
const YEARS=[2024,2025,2026].map(y=>{
  const ms=MONTHS.filter(m=>m.y===y);
  const total=ms.reduce((a,m)=>a+m.total,0);
  const cnt={};ms.forEach(m=>cnt[m.top]=(cnt[m.top]||0)+1);
  return{label:y+'年',total,top:Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0]};
});
/* 日序列：2024-01-01 → 2026-06-30（全量，可一路前翻），品类/情境双口径 */
const DAYS=[];
(function(){
  const cw={food:.22,trans:.10,fun:.13,home:.28,daily:.11,study:.06,trip:.10};
  const xw={fr:.24,solo:.26,love:.12,work:.14,fam:.12,none:.12};
  let i=0;
  for(let d=new Date(2024,0,1);d<=new Date(2026,5,30);d=new Date(d.getTime()+864e5),i++){
    const rnd=mulberry(i*7919+11), wd=d.getDay();
    let total=Math.round(34+rnd()*66+((wd===0||wd===6)?24+rnd()*30:0));
    if(rnd()<0.06)total+=Math.round(140+rnd()*260);
    const splitW=(w)=>{const o={};let s=0;for(const k in w){o[k]=w[k]*(0.6+rnd()*0.8);s+=o[k]}return{o,s}};
    const a=splitW(cw), b=splitW(xw), cats={}, ctxs={};
    let top='home',tv=0;
    for(const k in a.o){cats[k]=Math.round(total*a.o[k]/a.s);if(cats[k]>tv){tv=cats[k];top=k}}
    for(const k in b.o)ctxs[k]=Math.round(total*b.o[k]/b.s);
    DAYS.push({label:(d.getMonth()+1)+'月'+d.getDate()+'日',total,top,cats,ctxs,
      monthIdx:(d.getFullYear()-2024)*12+d.getMonth()});
  }
})();
const DAY_TODAY=DAYS.length-1;

/* ---------- 状态 ---------- */
const S={dim:'category',ledger:'life',view:'l1',focus:null,hover:null,hoverKind:null};
const TL={z:1,scroll:1,sel:{level:'month',idx:TODAY}};
const ledgerFactor=()=>S.ledger==='life'?1:0.62;
const catList=()=>S.dim==='category'?CATS:CTXS;
const ctxByName=n=>CTXS.find(c=>c.name===n)||CTXS[5];
/* 下钻外环另一端：品类维度下是情境，情境维度下是品类——按名跨表解析 */
const tagByName=n=>CATS.find(c=>c.name===n)||CTXS.find(c=>c.name===n)||CTXS[5];

/* 月口径金额（品类/情境通用） */
function amountsFor(mi){
  const m=MONTHS[mi],items=catList(),out={};let acc=0;
  const topW=0.42+hash01(m.label+S.dim)*0.14;
  const topId=(m.top&&items.some(c=>c.id===m.top))?m.top:items[0].id;
  items.forEach((c,i)=>{
    const last=i===items.length-1;
    let v=c.id===topId?Math.round(m.total*ledgerFactor()*topW)
      :(last?Math.round(m.total*ledgerFactor())-acc
      :Math.round(m.total*ledgerFactor()*(1-topW)/(items.length-1)*(0.7+hash01(c.id+m.label)*0.6)));
    if(last)v=Math.round(m.total*ledgerFactor())-acc;
    out[c.id]=Math.max(18,v);acc+=out[c.id];
  });
  return out;
}
function avgWeights(){
  const items=catList(),w={};items.forEach(c=>w[c.id]=0);
  MONTHS.forEach((m,mi)=>{const a=amountsFor(mi);items.forEach(c=>w[c.id]+=a[c.id]/(m.total*ledgerFactor()))});
  items.forEach(c=>w[c.id]/=MONTHS.length);return w;
}
/* 当前时间选择对应的各 tag 金额 */
function amountsForTime(){
  const f=ledgerFactor(),items=catList(),out={};
  if(TL.sel.level==='day'){const d=DAYS[TL.sel.idx],src=S.dim==='category'?d.cats:d.ctxs;
    for(const c of items)out[c.id]=Math.max(2,Math.round((src[c.id]||0)*f));return out}
  if(TL.sel.level==='year'){const y=YEARS[TL.sel.idx],w=avgWeights();let acc=0;
    items.forEach((c,i)=>{const last=i===items.length-1;
      let v=last?Math.round(y.total*f)-acc:Math.round(y.total*f*(w[c.id]||0));
      out[c.id]=Math.max(20,v);acc+=out[c.id]});return out}
  return amountsFor(TL.sel.idx);
}
function selTotal(){
  const f=ledgerFactor();
  if(TL.sel.level==='day')return Math.round(DAYS[TL.sel.idx].total*f);
  if(TL.sel.level==='year')return Math.round(YEARS[TL.sel.idx].total*f);
  return Math.round(MONTHS[TL.sel.idx].total*f);
}
function selLabel(){
  if(TL.sel.level==='day')return DAYS[TL.sel.idx].label;
  if(TL.sel.level==='year')return YEARS[TL.sel.idx].label;
  return MONTHS[TL.sel.idx].full;
}
function prevTotal(){
  if(TL.sel.level==='day')return TL.sel.idx>0?Math.round(DAYS[TL.sel.idx-1].total*ledgerFactor()):Math.round(selTotal()*0.92);
  if(TL.sel.level==='year')return TL.sel.idx>0?Math.round(YEARS[TL.sel.idx-1].total*ledgerFactor()):Math.round(selTotal()*0.88);
  return TL.sel.idx>0?Math.round(MONTHS[TL.sel.idx-1].total*ledgerFactor()):Math.round(selTotal()*0.9);
}
function expensesFor(catId,catAmount){
  const tpl=(S.dim==='category'?EXP_TPL[catId]:CTX_TPL[catId])||EXP_TPL.food;
  const sum=tpl.reduce((a,t)=>a+t[2],0);
  return tpl.map((t,i)=>({id:catId+'-e'+i,name:t[0],ctx:t[1],amount:Math.max(6,Math.round(t[2]/sum*catAmount))}));
}

/* ---------- Canvas ---------- */
const bgC=$('#bg'),gC=$('#graph'),oC=$('#orbit');
const bg=bgC.getContext('2d'),g=gC.getContext('2d'),oc=oC.getContext('2d');
let W=0,H=0,DPR=1;
function fit(c){const r=c.getBoundingClientRect();c.width=Math.max(2,Math.round(r.width*DPR));c.height=Math.max(2,Math.round(r.height*DPR))}
function resize(){
  DPR=Math.min(2,window.devicePixelRatio||1);
  W=innerWidth;H=innerHeight;
  bgC.style.width=W+'px';bgC.style.height=H+'px';
  gC.style.width=W+'px';gC.style.height=H+'px';
  fit(bgC);fit(gC);fit(oC);
  bg.setTransform(DPR,0,0,DPR,0,0);g.setTransform(DPR,0,0,DPR,0,0);oc.setTransform(DPR,0,0,DPR,0,0);
  initBg();buildGraph();
}
addEventListener('resize',resize);
/* 图谱区（左给洞察面板让位） */
const TOP=76,ORBIT_H=190;
const gx0=()=>300, gx1=()=>W-60, gy0=()=>TOP+26, gy1=()=>H-ORBIT_H-44;
const gcx=()=>(gx0()+gx1())/2, gcy=()=>(gy0()+gy1())/2;

/* ---------- 光晕精灵 ---------- */
const glowCache={};
function glowSprite(color){
  if(glowCache[color])return glowCache[color];
  const s=128,cv=document.createElement('canvas');cv.width=cv.height=s;
  const c=cv.getContext('2d');
  const gr=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  gr.addColorStop(0,rgba(color,.85));gr.addColorStop(.3,rgba(color,.30));gr.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle=gr;c.fillRect(0,0,s,s);
  glowCache[color]=cv;return cv;
}

/* ---------- 背景星空 ---------- */
let stars=[],shoots=[],nextShoot=4;
function initBg(){
  stars=[];
  const n=Math.round(W*H/3800);
  for(let i=0;i<n;i++){
    const layer=Math.random();
    stars.push({x:Math.random()*W,y:Math.random()*H,
      r:layer<.6?.4+Math.random()*.7:layer<.9?.8+Math.random()*.9:1.1+Math.random()*1.2,
      a:.25+Math.random()*.5,tw:.6+Math.random()*2,ph:Math.random()*7,
      px:.15+Math.random()*.5,near:layer>=.9});
  }
}
function drawBg(t,dt,mx,my){
  bg.clearRect(0,0,W,H);
  bg.fillStyle='#030510';bg.fillRect(0,0,W,H);
  for(const s of stars){
    const ox=(mx-.5)*14*s.px,oy=(my-.5)*10*s.px;
    const tw=.7+.3*Math.sin(t*s.tw+s.ph);
    bg.globalAlpha=s.a*tw;
    if(s.near){const sz=s.r*8;bg.drawImage(glowSprite('#9fc0ff'),s.x+ox-sz/2,s.y+oy-sz/2,sz,sz)}
    bg.fillStyle=s.near?'#e8f0ff':'#b9c6e4';
    bg.beginPath();bg.arc(s.x+ox,s.y+oy,s.r,0,7);bg.fill();
  }
  bg.globalAlpha=1;
  nextShoot-=dt;
  if(nextShoot<0){nextShoot=6+Math.random()*9;
    shoots.push({x:W*.3+Math.random()*W*.6,y:-20,vx:-(420+Math.random()*380),vy:260+Math.random()*200,life:1})}
  shoots=shoots.filter(p=>p.life>0);
  for(const p of shoots){
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt*.9;
    const len=130*p.life, hyp=Math.hypot(p.vx,p.vy)||1, dx=-p.vx/hyp, dy=-p.vy/hyp;
    const gr=bg.createLinearGradient(p.x,p.y,p.x+dx*len,p.y+dy*len);
    gr.addColorStop(0,`rgba(255,255,255,${.9*p.life})`);gr.addColorStop(1,'rgba(140,190,255,0)');
    bg.strokeStyle=gr;bg.lineWidth=1.6;bg.lineCap='round';
    bg.beginPath();bg.moveTo(p.x,p.y);bg.lineTo(p.x+dx*len,p.y+dy*len);bg.stroke();
  }
}

/* ---------- 图谱：星座节点 + 真漂浮 ---------- */
/* L1 锚点（归一化，北斗式 sweeping 曲线） */
const ANCHOR={trip:[.50,.14],fun:[.72,.28],food:[.80,.56],trans:[.62,.80],home:[.36,.76],daily:[.17,.52],study:[.24,.24],
 fr:[.74,.52],solo:[.58,.78],love:[.34,.72],work:[.24,.42],fam:[.42,.22],none:[.66,.24]};
let nodes=[],links=[],poly=[],enterT=9;
const tagR=a=>Math.min(24,5.5+Math.sqrt(a)*0.55);
const expR=a=>2.4+Math.sqrt(a)*0.12;
const ctxR=()=>9;

function buildGraph(){
  nodes=[];links=[];poly=[];enterT=0;S.hover=null;S.hoverKind=null;tip.hidden=true;
  const amts=amountsForTime(),items=catList();
  const X0=gx0(),X1=gx1(),Y0=gy0(),Y1=gy1();
  const P=(nx,ny)=>({x:X0+nx*(X1-X0),y:Y0+ny*(Y1-Y0)});
  if(S.view==='l1'){
    items.forEach((c,i)=>{
      const a=ANCHOR[c.id]||[.5,.5], p=P(a[0],a[1]), R=tagR(amts[c.id]||60);
      const va=hash01(c.id+'v')*6.28;
      nodes.push({kind:'cat',id:c.id,ref:c,amount:amts[c.id]||60,R,tr:R,
        x:p.x+(hash01(c.id)-.5)*60,y:p.y+(hash01(c.id+'y')-.5)*44,
        vx:Math.cos(va)*.5,vy:Math.sin(va)*.5,ax:p.x,ay:p.y,k:0.0011,
        seed:hash01(c.id)*7,idx:i,
        sats:[0,1].map(k=>({a0:hash01(c.id+k)*6.28,d:2.1+hash01(c.id+'d'+k)*.9,s:.8+hash01(c.id+'s'+k),sp:(.3+hash01(c.id+'v'+k)*.4)*(k?1:-1)}))});
    });
    // 消费轨迹折线：按金额降序连成北斗式折线
    poly=[...nodes].sort((a,b)=>b.amount-a.amount).map(n=>n.id);
    poly.forEach(()=>{});
    for(let i=0;i<poly.length-1;i++)links.push({s:poly[i],t:poly[i+1],w:.9,ph:Math.random(),sp:.25});
  }else{
    const f=items.find(c=>c.id===S.focus)||items[0];
    S.focus=f.id;
    const c0=P(.5,.5);
    const fR=tagR(amts[f.id]||100)*1.3;
    nodes.push({kind:'cat',id:f.id,ref:f,amount:amts[f.id]||100,R:fR,tr:fR,
      x:c0.x,y:c0.y,vx:0,vy:0,ax:c0.x,ay:c0.y,k:0.004,seed:1.3,idx:0,center:true,sats:[]});
    const exps=expensesFor(f.id,amts[f.id]||100);
    const R1=Math.min(X1-X0,Y1-Y0)*0.30;
    exps.forEach((e,i)=>{
      const a=i/exps.length*6.28-1.2, er=expR(e.amount);
      const col=tagByName(e.ctx).color;
      nodes.push({kind:'exp',id:e.id,ref:e,cat:f.id,ctxColor:col,amount:e.amount,R:er,tr:er,
        x:c0.x+Math.cos(a)*R1,y:c0.y+Math.sin(a)*R1*.86,
        vx:(hash01(e.id)-.5)*.5,vy:(hash01(e.id+'y')-.5)*.5,
        ax:c0.x+Math.cos(a)*R1,ay:c0.y+Math.sin(a)*R1*.86,k:0.0022,seed:i*1.7,idx:i+1});
      links.push({s:e.id,t:f.id,w:1.3,rest:135,ph:Math.random(),sp:.5});
    });
    // 情境标签外环（二部图的另一端）
    const ctxSeen={};
    exps.forEach(e=>{ctxSeen[e.ctx]=ctxSeen[e.ctx]||{sum:0,n:0};ctxSeen[e.ctx].sum+=e.amount;ctxSeen[e.ctx].n++});
    const names=Object.keys(ctxSeen), R2=Math.min(X1-X0,Y1-Y0)*0.47;
    names.forEach((nm,i)=>{
      const a=i/names.length*6.28+0.5, ref=tagByName(nm);
      const id='x-'+nm;
      nodes.push({kind:'ctx',id,ref:{...ref,amount:ctxSeen[nm].sum},amount:ctxSeen[nm].sum,R:ctxR(),tr:ctxR(),
        x:c0.x+Math.cos(a)*R2,y:c0.y+Math.sin(a)*R2*.8,
        vx:(hash01(id)-.5)*.4,vy:(hash01(id+'y')-.5)*.4,
        ax:c0.x+Math.cos(a)*R2,ay:c0.y+Math.sin(a)*R2*.8,k:0.0016,seed:i*2.3+4,idx:20+i});
      exps.forEach(e=>{if(e.ctx===nm)links.push({s:e.id,t:id,w:.7,rest:105,ph:Math.random(),sp:.3})});
    });
  }
}
const byId=id=>nodes.find(n=>n.id===id);
function related(a,b){
  if(!a||!b||a===b)return true;
  const A=byId(a),B=byId(b);if(!A||!B)return false;
  if(A.kind==='exp'&&B.kind!=='exp')return A.cat===B.id||('x-'+A.ref.ctx)===B.id;
  if(B.kind==='exp'&&A.kind!=='exp')return B.cat===A.id||('x-'+B.ref.ctx)===A.id;
  return links.some(l=>(l.s===a&&l.t===b)||(l.s===b&&l.t===a));
}
/* L1：锚点系留真漂浮（星座构图稳定）；下钻：真·力导向（斥力+弹簧+质心引力） */
let tNow=0;
function tick(dt){
  enterT+=dt*1.7;
  if(S.view==='detail')tickDetail(dt);else tickL1(dt);
  for(const l of links)l.ph=(l.ph+l.sp*dt)%1;
}
function tickL1(dt){
  for(const n of nodes){
    n.vx+=(n.ax-n.x)*n.k*60*dt;n.vy+=(n.ay-n.y)*n.k*60*dt;
    n.vx+=(hash01(n.id+((tNow*0.7)|0))-.5)*.05;n.vy+=(hash01(n.id+'y'+((tNow*0.7)|0))-.5)*.05;
    n.vx*=.94;n.vy*=.94;
    const sp=Math.hypot(n.vx,n.vy),mx=1.5;
    if(sp>mx){n.vx*=mx/sp;n.vy*=mx/sp}
    if(!n.pin){n.x+=n.vx*60*dt;n.y+=n.vy*60*dt}
    const m=20+n.tr;
    if(n.x<m){n.x=m;n.vx=Math.abs(n.vx)*.85}
    if(n.x>W-m){n.x=W-m;n.vx=-Math.abs(n.vx)*.85}
    if(n.y<TOP+m){n.y=TOP+m;n.vy=Math.abs(n.vy)*.85}
    if(n.y>H-ORBIT_H-m+24){n.y=H-ORBIT_H-m+24;n.vy=-Math.abs(n.vy)*.85}
  }
  // 分离（只排斥、不吸引）
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j];
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,min=a.tr+b.tr+16;
    if(d<min){const p=(min-d)*.05/d;a.x-=dx*p;a.y-=dy*p;b.x+=dx*p;b.y+=dy*p}
  }
}
const fMass=n=>n.center?4:(n.kind==='ctx'?2:1);
const fRep=n=>n.center?12000:(n.kind==='exp'?1500:3000);
function tickDetail(dt){
  const f=60*dt, cx=gcx(), cy=gcy();
  // 万有斥力（被拖住的节点照样施力）
  for(let i=0;i<nodes.length;i++){
    const a=nodes[i];
    for(let j=i+1;j<nodes.length;j++){
      const b=nodes[j];
      let dx=b.x-a.x, dy=b.y-a.y, d2=dx*dx+dy*dy;
      if(d2<1){dx=(hash01(a.id)-.5);dy=(hash01(b.id)-.5);d2=1}
      const d=Math.sqrt(d2);
      let F=Math.sqrt(fRep(a)*fRep(b))/d2;
      if(F>3.2)F=3.2;
      const ux=dx/d, uy=dy/d;
      if(!a.pin){a.vx-=ux*F/fMass(a)*f;a.vy-=uy*F/fMass(a)*f}
      if(!b.pin){b.vx+=ux*F/fMass(b)*f;b.vy+=uy*F/fMass(b)*f}
    }
  }
  // 连线弹簧
  for(const l of links){
    const s=byId(l.s),t=byId(l.t);if(!s||!t)continue;
    const rest=l.rest||130;
    const dx=t.x-s.x,dy=t.y-s.y,d=Math.hypot(dx,dy)||1;
    const F=(d-rest)*0.022*f, ux=dx/d, uy=dy/d;
    if(!s.pin){s.vx+=ux*F/fMass(s);s.vy+=uy*F/fMass(s)}
    if(!t.pin){t.vx-=ux*F/fMass(t);t.vy-=uy*F/fMass(t)}
  }
  // 质心引力 + 微扰（活着） + 阻尼 + 积分
  for(const n of nodes){
    const gv=n.center?0.012:0.004;
    n.vx+=(cx-n.x)*gv*f;n.vy+=(cy-n.y)*gv*f;
    n.vx+=(hash01(n.id+((tNow*0.9)|0))-.5)*.03;n.vy+=(hash01(n.id+'y'+((tNow*0.9)|0))-.5)*.03;
    n.vx*=.86;n.vy*=.86;
    const sp=Math.hypot(n.vx,n.vy),mx=3;
    if(sp>mx){n.vx*=mx/sp;n.vy*=mx/sp}
    if(!n.pin){n.x+=n.vx*60*dt;n.y+=n.vy*60*dt}
    const m=14+n.tr; // 软边界（加速度推回，不断裂）
    if(n.x<300+m)n.vx+=(300+m-n.x)*.02*f;
    if(n.x>W-m)n.vx-=(n.x-(W-m))*.02*f;
    if(n.y<TOP+m)n.vy+=(TOP+m-n.y)*.02*f;
    if(n.y>H-ORBIT_H-m+24)n.vy-=(n.y-(H-ORBIT_H-m+24))*.02*f;
  }
}

/* ---------- 星星绘制（无硬边） ---------- */
let bursts=[];
function burst(x,y,color,n=26){
  for(let i=0;i<n;i++){const a=Math.random()*6.28,v=1+Math.random()*3.4;
    bursts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-1,r:1+Math.random()*2.2,c:Math.random()<.3?'#ffffff':color,life:.8+Math.random()*.6})}
}
function drawStar(x,y,R,color,tw,spiky){
  g.save();g.globalCompositeOperation='lighter';
  const hs=R*(R>15?4.6:6.2);
  g.globalAlpha=.6*tw;g.drawImage(glowSprite(color),x-hs/2,y-hs/2,hs,hs);
  g.globalAlpha=.95;
  const gr=g.createRadialGradient(x,y,0,x,y,R);
  gr.addColorStop(0,'rgba(255,255,255,1)');
  gr.addColorStop(.32,'rgba(255,255,255,.95)');
  gr.addColorStop(.55,color);
  gr.addColorStop(1,rgba(color,0)); // 透明收边，无轮廓
  g.fillStyle=gr;g.beginPath();g.arc(x,y,R,0,7);g.fill();
  if(spiky){
    g.globalAlpha=.30*tw;g.strokeStyle='#fff';g.lineCap='round';
    for(let k=0;k<4;k++){
      const an=k*Math.PI/2+.4, L=R*(k%2?1.6:2.6);
      g.lineWidth=k%2?1:1.3;
      g.beginPath();g.moveTo(x+Math.cos(an)*R*.4,y+Math.sin(an)*R*.4);
      g.lineTo(x+Math.cos(an)*L,y+Math.sin(an)*L);g.stroke();
    }
  }
  g.restore();
}
function label(text,sub,x,y,a,hot){
  g.save();g.globalAlpha=a;g.textAlign='center';g.textBaseline='alphabetic';
  g.shadowColor='rgba(0,0,5,.9)';g.shadowBlur=7;
  g.font='600 12px Inter,"PingFang SC","Microsoft YaHei",sans-serif';
  g.fillStyle=hot?'#fff':'rgba(232,238,252,.92)';
  g.fillText(text,x,y);
  g.font='10.5px Inter,sans-serif';g.fillStyle='rgba(150,165,195,.85)';
  g.fillText(sub,x,y+15);
  g.restore();
}
function drawGraph(t){
  g.clearRect(0,0,W,H);
  const hov=S.hover, hovG=(hov&&S.hoverKind!=='month')?hov:null;
  const dimA=id=>!hovG?1:(related(hovG,id)?1:.13);
  const esc=clamp(enterT,0,1.4);

  // 星座连线 / 二部图边
  for(const l of links){
    const s=byId(l.s),t2=byId(l.t);if(!s||!t2)continue;
    const on=hovG&&(related(hovG,s.id)||related(hovG,t2.id));
    let a=(l.w>1?.30:.20);
    if(hovG)a=on?.7:.04;
    a*=clamp(enterT,0,1);
    if(a<=.01)continue;
    const c1=s.kind==='exp'?'#cdd8f2':(s.kind==='ctx'?s.ref.color:s.ref.color);
    const c2=t2.kind==='exp'?'#cdd8f2':(t2.kind==='ctx'?t2.ref.color:t2.ref.color);
    const gr=g.createLinearGradient(s.x,s.y,t2.x,t2.y);
    gr.addColorStop(0,rgba(c1.startsWith('#')?c1:'#9fb4d8',a));
    gr.addColorStop(1,rgba(c2.startsWith('#')?c2:'#9fb4d8',a));
    g.strokeStyle=gr;g.lineWidth=on?1.8:1.1;
    if(s.ref&&s.ref.dashed||t2.ref&&t2.ref.dashed)g.setLineDash([3,4]);
    g.beginPath();g.moveTo(s.x,s.y);g.lineTo(t2.x,t2.y);g.stroke();
    g.setLineDash([]);
    const px=lerp(s.x,t2.x,l.ph),py=lerp(s.y,t2.y,l.ph);
    g.save();g.globalCompositeOperation='lighter';g.globalAlpha=Math.min(1,a*2.6);
    g.fillStyle='#fff';g.beginPath();g.arc(px,py,on?1.9:1.2,0,7);g.fill();g.restore();
  }
  // 花销 / 情境小星
  for(const n of nodes){
    if(n.kind==='cat')continue;
    const sc=easeOutBack(clamp(enterT-n.idx*0.05,0,1));
    if(sc<=0)continue;
    const a=dimA(n.id);if(a<=.02)continue;
    const tw=.8+.2*Math.sin(t*2.2+n.seed);
    const col=n.kind==='exp'?(hovG&&related(hovG,n.id)?n.ctxColor:'#aeb9d4'):n.ref.color;
    drawStar(n.x,n.y,Math.max(.5,n.R*sc),col,tw*a,false);
    g.save();g.globalAlpha=a;g.restore();
    label(n.ref.name,'¥'+n.amount.toLocaleString(),n.x,n.y+n.R*sc+16,a*(hovG&&!related(hovG,n.id)?.6:1),hovG===n.id);
  }
  // 主星
  for(const n of nodes){
    if(n.kind!=='cat')continue;
    const sc=easeOutBack(clamp(enterT-n.idx*0.05,0,1));
    if(sc<=0)continue;
    const a=dimA(n.id);if(a<=.02)continue;
    const R=Math.max(.5,n.R*sc), tw=.85+.15*Math.sin(t*1.8+n.seed);
    const isH=hovG===n.id;
    drawStar(n.x,n.y,R,n.ref.color,tw*a,R>13||n.center||isH);
    if(n.ref.dashed){ // 未标注：虚线 dim 环
      g.save();g.globalAlpha=a*.5;g.strokeStyle='#8b93a8';g.setLineDash([4,4]);g.lineWidth=1;
      g.beginPath();g.arc(n.x,n.y,R+5,0,7);g.stroke();g.restore();
    }
    if(n.center){ // 专属视图中央主星呼吸环
      g.save();g.globalAlpha=(.4+.25*Math.sin(t*2))*a;g.strokeStyle=n.ref.color;g.lineWidth=1.4;
      g.beginPath();g.arc(n.x,n.y,R+8+2*Math.sin(t*2),0,7);g.stroke();g.restore();
    }
    if(isH){
      g.save();g.globalAlpha=.9;g.strokeStyle='#fff';g.lineWidth=1.4;
      g.beginPath();g.arc(n.x,n.y,R+6,0,7);g.stroke();g.restore();
    }
    // 伴星
    g.save();g.globalAlpha=a*.8;
    for(const s of (n.sats||[])){
      const an=s.a0+t*s.sp+n.seed;
      g.fillStyle='#eaf2ff';
      g.beginPath();g.arc(n.x+Math.cos(an)*R*s.d,n.y+Math.sin(an)*R*s.d*.8,s.s,0,7);g.fill();
    }
    g.restore();
    label(n.ref.name,'¥'+n.amount.toLocaleString(),n.x,n.y+R+18,a,isH);
  }
  bursts=bursts.filter(p=>p.life>0);
  g.save();g.globalCompositeOperation='lighter';
  for(const p of bursts){
    p.x+=p.vx;p.y+=p.vy;p.vy+=.02;p.life-=.016;
    g.globalAlpha=Math.max(0,p.life);g.fillStyle=p.c;
    g.beginPath();g.arc(p.x,p.y,p.r*p.life+.4,0,7);g.fill();
  }
  g.restore();g.globalAlpha=1;
}

/* ---------- 星轨：日/月/年连续变焦 + 左右拖拽 ---------- */
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)}
function levelW(){const z=TL.z;const wd=1-smooth(.35,.65,z),wy=smooth(1.35,1.65,z);return{d:wd,m:1-wd-wy,y:wy}}
function domLevel(){const w=levelW();return w.d>=w.m&&w.d>=w.y?'day':(w.y>=w.m?'year':'month')}
function tlMonthColor(mi){return(CATS.find(c=>c.id===MONTHS[mi].top)||CATS[0]).color}
function drawOrbit(t){
  const r=oC.getBoundingClientRect();if(r.width<10)return;
  const w=r.width,h=r.height;
  oc.clearRect(0,0,w,h);
  const W8=levelW();
  // 地形（按主导口径）
  oc.save();
  const dl=domLevel();
  const vals=dl==='day'?DAYS.map(d=>d.total):dl==='year'?YEARS.map(y=>y.total):MONTHS.map(m=>m.total);
  const n=vals.length,mx=Math.max(...vals);
  oc.beginPath();
  for(let i=0;i<n;i++){const x=30+i/(n-1)*(w-60),y=h*.62-(vals[i]/mx)*h*.30;i?oc.lineTo(x,y):oc.moveTo(x,y)}
  oc.lineTo(w-30,h);oc.lineTo(30,h);oc.closePath();
  const tg=oc.createLinearGradient(0,0,0,h);
  tg.addColorStop(0,'rgba(110,150,255,.16)');tg.addColorStop(1,'rgba(110,150,255,0)');
  oc.fillStyle=tg;oc.fill();oc.restore();

  if(W8.m>0.01)drawOrbitMonth(w,h,t,W8.m);
  if(W8.d>0.01)drawOrbitDay(w,h,t,W8.d);
  if(W8.y>0.01)drawOrbitYear(w,h,t,W8.y);
}
function orbitBase(w,h){
  oc.save();oc.lineCap='round';
  for(const[lw,a]of[[12,.04],[5,.08],[1.6,.18]]){
    oc.strokeStyle=`rgba(140,175,235,${a})`;oc.lineWidth=lw;
    oc.beginPath();oc.moveTo(30,h*.55);
    oc.bezierCurveTo(w*.34,h*.38,w*.66,h*.70,w-30,h*.55);oc.stroke();
  }
  oc.restore();
}
/* 星轨光点（无硬边） + 节点折线 */
function tlStar(x,y,R,color,a){
  oc.save();oc.globalCompositeOperation='lighter';
  const hs=R*6;oc.globalAlpha=a*.55;oc.drawImage(glowSprite(color),x-hs/2,y-hs/2,hs,hs);
  const gr=oc.createRadialGradient(x,y,0,x,y,R);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.4,'rgba(255,255,255,.9)');
  gr.addColorStop(.62,color);gr.addColorStop(1,rgba(color,0));
  oc.globalAlpha=a*.95;oc.fillStyle=gr;oc.beginPath();oc.arc(x,y,R,0,7);oc.fill();
  oc.restore();
}
function tlPoly(pts,a){
  if(pts.length<2||a<=.02)return;
  oc.save();oc.strokeStyle=`rgba(170,195,240,${.30*a})`;oc.lineWidth=1;
  oc.beginPath();pts.forEach((p,i)=>i?oc.lineTo(p.x,p.y):oc.moveTo(p.x,p.y));oc.stroke();
  oc.restore();
}
const MONTH_GAP=64;
function monthX(w,i){
  const pad=44, cw=MONTHS.length*MONTH_GAP, vw=w-pad*2;
  return pad+i*MONTH_GAP-TL.scroll*Math.max(0,cw-vw);
}
function monthXY(w,h,i){
  const m=MONTHS[i];
  return{x:monthX(w,i),
    y:h*.50+(hash01(m.full+'y')-.5)*46+Math.sin(i*1.7)*6};
}
function drawOrbitMonth(w,h,t,al){
  orbitBase(w,h);
  const trail=[];
  for(let i=0;i<MONTHS.length;i++){const p=monthXY(w,h,i);if(p.x>-70&&p.x<w+70)trail.push(p)}
  tlPoly(trail,al);
  for(let i=0;i<MONTHS.length;i++){
    const m=MONTHS[i],p=monthXY(w,h,i);
    if(p.x<-30||p.x>w+30)continue;
    if(m.m===1){ // 年份分隔
      oc.save();oc.globalAlpha=al*.5;oc.strokeStyle='rgba(150,175,220,.35)';oc.setLineDash([3,5]);oc.lineWidth=1;
      oc.beginPath();oc.moveTo(p.x,10);oc.lineTo(p.x,h-6);oc.stroke();oc.setLineDash([]);
      oc.fillStyle='rgba(139,150,181,.85)';oc.font='10px Inter,sans-serif';oc.textAlign='center';
      oc.fillText(m.y,p.x,20);oc.restore();
    }
    const age=(MONTHS.length-1-i)/(MONTHS.length-1);
    const R=clamp(2.6+Math.sqrt(m.total)*.10,3,7)+(i===TODAY?2:0);
    const hov=S.hoverKind==='month'&&TL.sel.level==='month'&&S.hover===i;
    const foc=TL.sel.level==='month'&&TL.sel.idx===i;
    oc.save();oc.globalAlpha=al*(1-.55*age);
    oc.globalCompositeOperation='lighter';
    const hs=R*5;oc.drawImage(glowSprite(tlMonthColor(i)),p.x-hs/2,p.y-hs/2,hs,hs);
    oc.restore();
    oc.save();oc.globalAlpha=al*(hov?1:(1-.5*age));
    tlStar(p.x,p.y,R*(hov?1.25:1),tlMonthColor(i),1);
    if(i===TODAY){oc.strokeStyle=`rgba(160,240,255,${.55+.3*Math.sin(t*2.2)})`;oc.lineWidth=1.6;
      oc.beginPath();oc.arc(p.x,p.y,(R+7)*(1+.1*Math.sin(t*2.2)),0,7);oc.stroke()}
    else if(foc){oc.strokeStyle='rgba(255,255,255,.8)';oc.lineWidth=1.2;oc.beginPath();oc.arc(p.x,p.y,R+4,0,7);oc.stroke()}
    if(hov){oc.strokeStyle='#fff';oc.lineWidth=1.4;oc.beginPath();oc.arc(p.x,p.y,R+5,0,7);oc.stroke()}
    oc.restore();
    if(i%2===0||i===TODAY||foc||hov){
      oc.save();oc.globalAlpha=al*.85;oc.fillStyle=i===TODAY?'#9df3ff':'#8b96b5';
      oc.font=(i===TODAY?'700 11px':'10px')+' Inter,"PingFang SC",sans-serif';oc.textAlign='center';
      oc.fillText(i===TODAY?'✦ 今天 '+m.label:m.label,p.x,p.y+R+15);
      oc.restore();
    }
  }
}
const DAY_GAP=44;
function dayContent(w){return DAYS.length*DAY_GAP}
function dayX(w,i){
  const vw=w-80, cw=dayContent(w);
  return 40+i*DAY_GAP-TL.scroll*Math.max(0,cw-vw);
}
/* 日节点纵坐标：正弦 + 哈希抖动，不规律的起伏 */
function dayY(h,i){return h*.55+Math.sin(i*.5)*6+(hash01('dy'+i)-.5)*18}
function drawOrbitDay(w,h,t,al){
  orbitBase(w,h);
  const trail=[];
  for(let i=0;i<DAYS.length;i++){const tx=dayX(w,i);if(tx>-20&&tx<w+20)trail.push({x:tx,y:dayY(h,i)})}
  tlPoly(trail,al);
  for(let i=0;i<DAYS.length;i++){
    const x=dayX(w,i);if(x<-20||x>w+20)continue;
    const d=DAYS[i], age=(DAYS.length-1-i)/(DAYS.length-1);
    const y=dayY(h,i);
    const R=clamp(2.5+Math.sqrt(d.total)*.32,3,7.5)+(i===DAY_TODAY?2:0);
    const col=(CATS.find(c=>c.id===d.top)||CATS[0]).color;
    const hov=S.hoverKind==='day'&&TL.sel.level==='day'&&S.hover===i;
    const foc=TL.sel.level==='day'&&TL.sel.idx===i;
    oc.save();oc.globalAlpha=al*(1-.5*age);
    oc.globalCompositeOperation='lighter';
    const hs=R*5;oc.drawImage(glowSprite(col),x-hs/2,y-hs/2,hs,hs);
    oc.restore();
    oc.save();oc.globalAlpha=al*(hov?1:(1-.45*age));
    tlStar(x,y,R*(hov?1.3:1),col,1);
    if(i===DAY_TODAY){oc.strokeStyle=`rgba(160,240,255,${.5+.3*Math.sin(t*2.2)})`;oc.lineWidth=1.5;
      oc.beginPath();oc.arc(x,y,R+6,0,7);oc.stroke()}
    else if(foc){oc.strokeStyle='rgba(255,255,255,.8)';oc.lineWidth=1.2;oc.beginPath();oc.arc(x,y,R+4,0,7);oc.stroke()}
    oc.restore();
    if(i%5===0||i===DAY_TODAY||foc){
      oc.save();oc.globalAlpha=al*.8;oc.fillStyle=i===DAY_TODAY?'#9df3ff':'#7c87a3';
      oc.font='10px Inter,sans-serif';oc.textAlign='center';
      const lb=i===DAY_TODAY?'✦今天':DAYS[i].label.replace('月','/').replace('日','');
      oc.fillText(lb,x,y+R+14);oc.restore();
    }
  }
}
function yearY(h,i){return h*[.40,.60,.44][i]}
function drawOrbitYear(w,h,t,al){
  orbitBase(w,h);
  tlPoly(YEARS.map((_,i)=>({x:w*(.22+.28*i),y:yearY(h,i)})),al);
  YEARS.forEach((y,i)=>{
    const x=w*(.22+.28*i), yy=yearY(h,i);
    const R=clamp(6+Math.sqrt(y.total)*.09,9,15);
    const col=(CATS.find(c=>c.id===y.top)||CATS[0]).color;
    const hov=S.hoverKind==='year'&&TL.sel.level==='year'&&S.hover===i;
    const foc=TL.sel.level==='year'&&TL.sel.idx===i;
    oc.save();oc.globalAlpha=al;
    oc.globalCompositeOperation='lighter';
    const hs=R*5;oc.drawImage(glowSprite(col),x-hs/2,yy-hs/2,hs,hs);
    oc.restore();
    oc.save();oc.globalAlpha=al;
    tlStar(x,yy,R*(hov?1.15:1),col,1);
    if(foc){oc.strokeStyle='rgba(255,255,255,.85)';oc.lineWidth=1.4;oc.beginPath();oc.arc(x,yy,R+5,0,7);oc.stroke()}
    if(i===YEARS.length-1){oc.strokeStyle=`rgba(160,240,255,${.5+.3*Math.sin(t*2.2)})`;oc.lineWidth=1.5;
      oc.beginPath();oc.arc(x,yy,R+8,0,7);oc.stroke()}
    oc.restore();
    oc.save();oc.globalAlpha=al;oc.fillStyle='#dfe7fa';oc.font='700 12px Inter,"PingFang SC",sans-serif';oc.textAlign='center';
    oc.fillText(y.label+(i===YEARS.length-1?' · 今':''),x,yy+R+17);
    oc.font='10.5px Inter,sans-serif';oc.fillStyle='rgba(150,165,195,.85)';
    oc.fillText('¥'+Math.round(y.total*ledgerFactor()).toLocaleString(),x,yy+R+31);
    oc.restore();
  });
}
function orbitHit(x,y){
  const r=oC.getBoundingClientRect(),w=r.width,h=r.height,lv=domLevel();
  if(lv==='day'){
    let best=null,bd=1e9;
    for(let i=0;i<DAYS.length;i++){const dx=dayX(w,i)-x;if(Math.abs(dx)>30)continue;
      const yy=dayY(h,i),d=Math.hypot(dx,yy-y);if(d<16&&d<bd){best=i;bd=d}}
    return best!=null?{kind:'day',id:best}:null;
  }
  if(lv==='year'){
    for(let i=0;i<YEARS.length;i++){const px=w*(.22+.28*i),py=yearY(h,i);
      if(Math.hypot(px-x,py-y)<24)return{kind:'year',id:i}}
    return null;
  }
  for(let i=0;i<MONTHS.length;i++){const p=monthXY(w,h,i);
    if(Math.hypot(p.x-x,p.y-y)<18)return{kind:'month',id:i}}
  return null;
}

/* ---------- 时间选择 ---------- */
function applyZoomSnap(){
  const lv=domLevel();
  if(lv===TL.sel.level)return;
  if(lv==='month'){
    if(TL.sel.level==='day')TL.sel={level:'month',idx:DAYS[TL.sel.idx].monthIdx};
    else TL.sel={level:'month',idx:TL.sel.idx===0?5:(TL.sel.idx===1?17:TODAY)};
  }else if(lv==='day'){
    if(TL.sel.level==='month'){
      const mi=TL.sel.idx;let di=DAY_TODAY;
      for(let i=DAYS.length-1;i>=0;i--)if(DAYS[i].monthIdx===mi){di=i;break}
      if(!DAYS.some(d=>d.monthIdx===mi))di=DAY_TODAY;
      TL.sel={level:'day',idx:di};
    }else TL.sel={level:'day',idx:DAY_TODAY};
    TL.scroll=1;
  }else{
    if(TL.sel.level==='month')TL.sel={level:'year',idx:TL.sel.idx<12?0:(TL.sel.idx<24?1:2)};
    else TL.sel={level:'year',idx:2};
  }
  buildGraph();syncChrome();
}
function selectTime(kind,id){
  TL.sel={level:kind,idx:id};
  if(kind==='day'){const vw=oC.getBoundingClientRect().width-80,cw=dayContent(vw);
    if(cw>vw){const x=40+id*DAY_GAP-vw/2;TL.scroll=clamp(x/(cw-vw),0,1)}}
  buildGraph();syncChrome();
  burst(W/2,H-190,'#9be9ff',14);
}
function setZoom(z,quiet){
  z=clamp(z,0,2);
  const before=domLevel();
  TL.z=z;syncRail();
  const after=domLevel();
  if(before!==after){applyZoomSnap();if(!quiet)toast(after==='day'?'星轨 · 日视图（左右可拖）':after==='month'?'星轨 · 月视图':'星轨 · 年视图')}
}

/* ---------- 交互 ---------- */
const tip=$('#tooltip');
let mouse={x:.5,y:.5},dragN=null,downPos=null,downT=0;
function setHover(h){
  S.hover=h?h.id:null;S.hoverKind=h?h.kind:null;
  if(!h){tip.hidden=true;gC.style.cursor='default';document.querySelectorAll('.top-row').forEach(e=>e.classList.remove('hot'));return}
  if(h.kind==='cat'||h.kind==='exp'||h.kind==='ctx'){
    const n=byId(h.id);if(!n){tip.hidden=true;return}
    const sub=n.kind==='cat'
      ?(S.view==='detail'?'专属视图中心 · 点击空白处返回':`${n.amount.toLocaleString()} 元 · 点击进入专属星图`)
      :n.kind==='exp'?`${n.amount} 元 · ${n.ref.ctx}`:`${n.amount.toLocaleString()} 元 · 关联标签`;
    tip.innerHTML=`<b>${n.ref.name}</b><div class="tt-amt">¥${n.amount.toLocaleString()}</div><div style="color:#8b96b5">${sub}</div>`;
    tip.hidden=false;gC.style.cursor='pointer';
    const cid=n.kind==='cat'?n.id:(n.kind==='exp'?n.cat:null);
    document.querySelectorAll('.top-row').forEach(e=>e.classList.toggle('hot',e.dataset.id===cid));
  }else{
    let html='';
    if(h.kind==='day'){const d=DAYS[h.id];html=`<b>${d.label}</b><div class="tt-amt">¥${Math.round(d.total*ledgerFactor()).toLocaleString()}</div>`}
    else if(h.kind==='year'){const y=YEARS[h.id];html=`<b>${y.label}</b><div class="tt-amt">¥${Math.round(y.total*ledgerFactor()).toLocaleString()}</div>`}
    else{const m=MONTHS[h.id];html=`<b>${m.label}</b><div class="tt-amt">¥${Math.round(m.total*ledgerFactor()).toLocaleString()}</div>`}
    tip.innerHTML=html;tip.hidden=false;
  }
}
function moveTip(e){tip.style.left=Math.min(innerWidth-250,e.clientX+16)+'px';tip.style.top=(e.clientY+18)+'px'}
gC.addEventListener('pointermove',e=>{
  mouse={x:e.clientX/W,y:e.clientY/H};moveTip(e);
  if(dragN){const r=gC.getBoundingClientRect();
    dragN.x=e.clientX-r.left;dragN.y=e.clientY-r.top;dragN.vx=dragN.vy=0;dragN.pin=true;
    dragN.ax=dragN.x;dragN.ay=dragN.y;return}
  const r=gC.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  let best=null,bd=1e9;
  for(const n of nodes){const d=Math.hypot(n.x-x,n.y-y);if(d<=n.R+9&&d<bd){best=n;bd=d}}
  setHover(best?{kind:best.kind,id:best.id}:null);
});
gC.addEventListener('pointerdown',e=>{
  const r=gC.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  downPos={x:e.clientX,y:e.clientY};downT=performance.now();
  for(const n of nodes){if(Math.hypot(n.x-x,n.y-y)<=n.R+9){dragN=n;break}}
});
gC.addEventListener('pointerup',e=>{
  if(dragN){dragN.pin=false;dragN.ax=dragN.x;dragN.ay=dragN.y}
  const moved=downPos?Math.hypot(e.clientX-downPos.x,e.clientY-downPos.y):99;
  const quick=performance.now()-downT<600;
  dragN=null;
  if(moved<6&&quick){
    const r=gC.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    let best=null,bd=1e9,any=false;
    for(const n of nodes){
      const d=Math.hypot(n.x-x,n.y-y);
      if(d<=n.R+9)any=true;
      if(n.kind!=='cat')continue;
      if(d<=n.R+12&&d<bd){best=n;bd=d}
    }
    if(best&&S.view==='l1')enterDetail(best.id);
    else if(!any&&S.view==='detail')goBack(); // 下钻态点空白处返回
  }
});
gC.addEventListener('pointerleave',()=>{setHover(null);dragN=null});
gC.addEventListener('wheel',e=>{e.preventDefault();setZoom(TL.z+e.deltaY*0.0012)},{passive:false});

/* 星轨：左右拖拽看时间，点击选中 */
let oDrag=null;
oC.addEventListener('pointerdown',e=>{
  const r=oC.getBoundingClientRect();
  oDrag={x:e.clientX,y:e.clientY,sx:TL.scroll,moved:false};
  oC.setPointerCapture&&oC.setPointerCapture(e.pointerId);
});
oC.addEventListener('pointermove',e=>{
  const r=oC.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  if(oDrag){
    const dx=e.clientX-oDrag.x;
    if(Math.abs(dx)>4)oDrag.moved=true;
    if(oDrag.moved){
      const lv=domLevel();
      const pad=lv==='day'?80:88, cw=lv==='day'?dayContent(r.width):MONTHS.length*MONTH_GAP;
      if(cw>r.width-pad)TL.scroll=clamp(oDrag.sx-dx/(cw-(r.width-pad)),0,1);
    }
    return;
  }
  const hit=orbitHit(x,y);
  setHover(hit);moveTip(e);
  oC.style.cursor=hit?'pointer':'grab';
});
oC.addEventListener('pointerup',e=>{
  const was=oDrag;oDrag=null;
  if(was&&!was.moved){
    const r=oC.getBoundingClientRect(),hit=orbitHit(e.clientX-r.left,e.clientY-r.top);
    if(hit)selectTime(hit.kind,hit.id);
  }
});
oC.addEventListener('pointerleave',()=>{oDrag=null;setHover(null)});

function enterDetail(id){
  S.view='detail';S.focus=id;buildGraph();syncChrome();
  $('#btnBack').hidden=false;
  const n=byId(id);if(n)burst(n.x,n.y,n.ref.color,34);
}
function goBack(){
  if(S.view!=='detail')return;
  S.view='l1';S.focus=null;$('#btnBack').hidden=true;buildGraph();syncChrome();
}
$('#btnBack').onclick=goBack;

/* ---------- 顶栏/面板 ---------- */
function toast(msg,ms=2200){
  const t=$('#toast');t.textContent=msg;t.hidden=false;
  clearTimeout(t._h);t._h=setTimeout(()=>t.hidden=true,ms);
}
function animateNum(el,to,fmt){
  const from=el._v||0;el._v=to;const t0=performance.now();
  (function f(t){const k=clamp((t-t0)/700,0,1),e=1-Math.pow(1-k,3);
    el.textContent=fmt(lerp(from,to,e));if(k<1)requestAnimationFrame(f)})(t0);
}
function syncChrome(){
  const tot=selTotal();
  const nExp=S.view==='detail'
    ?expensesFor(S.focus,amountsForTime()[S.focus]||100).length
    :Math.max(1,Math.round(tot/(TL.sel.level==='day'?9:58)));
  $('#mtLabel').textContent=`${selLabel()} · 共 ${nExp} 笔`;
  animateNum($('#mtValue'),tot,v=>'¥'+Math.round(v).toLocaleString());
  animateNum($('#pNum'),tot,v=>'¥'+Math.round(v).toLocaleString());
  $('#pCount').textContent=`${nExp} 笔${TL.sel.level==='month'?' · 日均 ¥'+Math.round(tot/30):''}`;
  const pv=prevTotal(),d=(tot-pv)/pv*100;
  $('#pDelta').textContent=`${d>=0?'▲':'▼'} ${Math.abs(d).toFixed(1)}% vs 上期`;
  const lv=domLevel(),ln=lv==='day'?'日':lv==='month'?'月':'年';
  $('#tlTip').textContent=S.view==='detail'
    ?`正在下钻 · ${byId(S.focus)?.ref.name||''} · 花销×标签二部图（拖拽感受斥力）`
    :`星轨 · ${ln}视图${lv==='day'?'（左右拖动看时间）':'（点击星星切换时间）'}`;
  renderTop();
}
function renderTop(){
  const amts=amountsForTime(),items=[...catList()].sort((a,b)=>(amts[b.id]||0)-(amts[a.id]||0)).slice(0,5);
  const max=amts[items[0].id]||1;
  $('#topList').innerHTML=items.map(c=>`
    <div class="top-row" data-id="${c.id}">
      <span class="dot" style="background:${c.color};box-shadow:0 0 8px ${c.color}"></span>
      <span class="top-name">${c.name}</span>
      <span class="top-bar"><span class="top-fill" style="display:block;width:${Math.round((amts[c.id]||0)/max*100)}%;background:linear-gradient(90deg,${c.color}88,${c.color})"></span></span>
      <span class="top-amt">¥${(amts[c.id]||0).toLocaleString()}</span>
    </div>`).join('');
  document.querySelectorAll('.top-row').forEach(el=>{
    el.onmouseenter=()=>setHover({kind:'cat',id:el.dataset.id});
    el.onmouseleave=()=>setHover(null);
    el.onclick=()=>{if(S.view==='l1')enterDetail(el.dataset.id);else{S.focus=el.dataset.id;buildGraph();syncChrome()}};
  });
  const insCtx='✨ <b>和朋友</b> 的共享花销横跨餐饮×娱乐×旅行，是最亮的交叉线。';
  const ins={
    food:'✨ <b>和朋友</b> 的聚餐占餐饮 <b>62%</b>，娱乐多与朋友同行。',
    home:'✨ <b>居住</b> 占本期 <b>55%</b>，是星系中最亮的那颗星。',
    fun:'✨ <b>娱乐</b> 本月爆发，多为 <b>和朋友</b> 的共享花销。',
  };
  $('#insightBox').innerHTML=S.dim==='category'?(ins[MONTHS[TL.sel.level==='month'?TL.sel.idx:TODAY].top]||ins.food):insCtx;
}
function seg(id,fn){$(id).querySelectorAll('.seg').forEach(b=>b.onclick=()=>{
  $(id).querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));b.classList.add('active');fn(b.dataset.v)})}
seg('#ledgerSeg',v=>{S.ledger=v;buildGraph();syncChrome();toast(v==='life'?'账本 · 生活费':'账本 · 私人')});
seg('#dimSeg',v=>{S.dim=v;S.view='l1';S.focus=null;$('#btnBack').hidden=true;buildGraph();syncChrome();
  toast(v==='category'?'维度 · 品类（这是什么钱）':'维度 · 情境（和谁 / 什么场景）')});
$('#btnToday').onclick=()=>{TL.z=1;syncRail();TL.sel={level:'month',idx:TODAY};buildGraph();syncChrome()};

/* 粒度轨 → 星轨变焦（上=日 下=年） */
const rail=$('#rail'),handle=$('#railHandle');
function syncRail(){handle.style.top=(12+TL.z/2*76)+'%'}
let railDrag=false;
function railSet(e){const r=rail.getBoundingClientRect();
  setZoom(clamp((e.clientY-r.top)/r.height*2,0,2),true)}
rail.addEventListener('pointerdown',e=>{railDrag=true;rail.setPointerCapture(e.pointerId);railSet(e)});
rail.addEventListener('pointermove',e=>{if(railDrag)railSet(e)});
rail.addEventListener('pointerup',()=>{railDrag=false;toast(domLevel()==='day'?'星轨 · 日视图':domLevel()==='month'?'星轨 · 月视图':'星轨 · 年视图')});

/* 记账浮层（装饰） */
const mask=$('#modalMask');
function renderModalChips(){
  $('#mCats').innerHTML=CATS.map((c,i)=>`<button class="m-chip${i===0?' on':''}"><i style="background:${c.color}"></i>${c.name}</button>`).join('');
  $('#mCtx').innerHTML=CTXS.map((c,i)=>`<button class="m-chip${i===1?' on':''}">${c.name}</button>`).join('');
  document.querySelectorAll('.m-chip').forEach(b=>b.onclick=e=>{e.preventDefault();
    [...b.parentElement.children].forEach(x=>x.classList.remove('on'));b.classList.add('on')});
  document.querySelectorAll('.m-tab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.m-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active')});
}
$('#btnAdd').onclick=()=>{mask.hidden=false;renderModalChips()};
$('#modalClose').onclick=$('#modalCancel').onclick=()=>mask.hidden=true;
mask.addEventListener('click',e=>{if(e.target===mask)mask.hidden=true});
$('#modalSave').onclick=()=>{mask.hidden=true;burst(W/2,H/2-40,'#9be9ff',40);toast('已点亮一颗新星（演示暂不持久化）')};
addEventListener('keydown',e=>{if(e.key==='Escape'){mask.hidden=true;goBack()}});

/* ---------- 主循环 ---------- */
let last=performance.now();
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;tNow=now/1000;
  tick(dt);
  drawBg(tNow,dt,mouse.x,mouse.y);
  drawGraph(tNow);
  drawOrbit(tNow);
  requestAnimationFrame(frame);
}

/* 启动 */
resize();syncChrome();syncRail();
requestAnimationFrame(frame);
setTimeout(()=>toast('欢迎来到 Orbit 星账 · 拖拽星体试试'),900);
