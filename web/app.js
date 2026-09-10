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

/* ---- 真实数据接线（OrbitData）---- */
const API=(typeof window!=='undefined'?window:globalThis).OrbitAPI;
const Data=(typeof window!=='undefined'?window:globalThis).OrbitData;
/* 渲染用数组（id:'t'+tag_id 字符串，金额查表用数字 tagId） */
let CATS=[], CTXS=[];
let MONTHS=[];
let TODAY=0;
const DAYS=[]; // 本任务只做月视图，日序列留空即不画
const YEARS=[]; // 年视图留空
const DAY_TODAY=0;
const tagAmountMap={category:{},context:{}};
/* 副 tag 索引：父主 tag id → 该主 tag 下的副 tag 数组（记一笔多选的数据源） */
let SUBS={};
const toRenderTag=t=>({id:'t'+t.id,name:t.name,color:t.color,is_unnamed:t.is_unnamed,tagId:t.id});
function refreshTagArrays(){
  if(!Data)return;
  CATS=(Data.cats||[]).map(toRenderTag);
  CTXS=(Data.ctxs||[]).map(toRenderTag);
  SUBS={};
  for(const tree of Object.values(Data.dims||{})){
    for(const root of (tree.roots||[]))SUBS[root.id]=(root.children||[]).map(toRenderTag);
  }
}
function refreshAmounts(){
  if(!Data)return;
  tagAmountMap.category={...(Data.monthAmountsByDim.category||{})};
  tagAmountMap.context={...(Data.monthAmountsByDim.context||{})};
}
function refreshMonths(){
  if(!Data)return;
  MONTHS=(Data.months||[]).map(m=>({label:m.label,full:m.full,total:m.total,y:m.y,m:m.m,topColor:m.topColor||''}));
  TODAY=Math.max(0,MONTHS.length-1);
}

/* ---------- 状态 ---------- */
const S={dim:'category',ledgerId:null,view:'l1',focus:null,hover:null,hoverKind:null};
const TL={z:1,scroll:1,sel:{level:'month',idx:0}};
const catList=()=>S.dim==='category'?CATS:CTXS;

/* 当前维度各 tag 金额（渲染id → 元），只含金额>0 */
function amountsForTime(){
  const key=S.dim==='category'?'category':'context';
  const out={};
  for(const t of (key==='category'?CATS:CTXS)){
    const yuan=tagAmountMap[key][t.tagId]||0;
    if(yuan>0)out[t.id]=yuan;
  }
  return out;
}
function selTotal(){
  return (Data&&typeof Data.monthTotal==='number')?Data.monthTotal:0;
}
function selLabel(){
  if(Data&&Data._currentMonthY&&Data._currentMonthM)return Data._currentMonthY+'年'+Data._currentMonthM+'月';
  const m=MONTHS[TL.sel.idx];
  return m?m.full:'';
}
function prevTotal(){
  if(Data&&typeof Data.prevMonthTotal==='number'&&Data.prevMonthTotal>0)return Data.prevMonthTotal;
  return selTotal()*0.9;
}
/* ---------- L3 下钻数据 ----------
   下钻（分类内「花销 × 细分」二部图）需要「当月经该主 tag 的全部花销」，
   进下钻前拉一次缓存于此，避免在渲染帧里发请求。 */
let detailExpenses=[];   // 当月该分类的 expense 列表（含 tags 明细）
let detailTag=null;      // 当前下钻的主 tag

/**
 * 汇总某主 tag 下各副 tag 的金额/笔数。
 * 浮层的「细分分布」与下钻二部图共用这一份口径，避免两处算法漂移。
 * 注：一笔可挂多个副 tag，金额会分别计入各细分，故各项之和可能大于总额。
 */
function summarizeSubs(mine,parentTagId){
  const dist=new Map();
  for(const e of mine){
    for(const t of e.tags){
      if(t.role!=='secondary'||t.parent_tag_id!==parentTagId)continue;
      const cur=dist.get(t.tag_id)||{tagId:t.tag_id,name:t.name,color:tagColor(t.tag_id),is_unnamed:!!t.is_unnamed,amount:0,count:0};
      cur.amount+=e.amount_cents;
      cur.count++;
      dist.set(t.tag_id,cur);
    }
  }
  return [...dist.values()].sort((a,b)=>b.amount-a.amount);
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
/* L1 锚点：金额驱动自动摆位（北斗弧线），任意品类数量都好看 */
let nodes=[],links=[],poly=[],enterT=9;
const tagR=a=>Math.min(24,5.5+Math.sqrt(a)*0.55);
const expR=a=>2.4+Math.sqrt(a)*0.12;
const ctxR=()=>9;

function buildGraph(){
  nodes=[];links=[];poly=[];enterT=0;S.hover=null;S.hoverKind=null;if(typeof tip!=='undefined'&&tip)tip.hidden=true;
  const amts=amountsForTime(),items=catList();
  const X0=gx0(),X1=gx1(),Y0=gy0(),Y1=gy1();
  const P=(nx,ny)=>({x:X0+nx*(X1-X0),y:Y0+ny*(Y1-Y0)});
  if(S.view==='l1'){
    // 金额降序，沿北斗弧线均匀排布；无支出时显示小星
    const sorted=[...items].sort((a,b)=>((amts[b.id]||0)-(amts[a.id]||0)));
    const n=sorted.length;
    sorted.forEach((c,i)=>{
      const amt=amts[c.id]||0;
      const R=amt>0?tagR(amt):6;
      // x 均布，y 正弦起伏；金额最大者靠视觉中心偏上
      let nx,ny;
      if(n===1){nx=.5;ny=.45}
      else{
        nx=0.14+0.72*(i/(n-1));
        ny=0.5+0.32*Math.sin(i*1.2+0.6);
        if(i===0){nx=.5;ny=.34}
        nx=clamp(nx,0.08,0.92);ny=clamp(ny,0.1,0.9);
      }
      const p=P(nx,ny);
      const va=hash01(c.id+'v')*6.28;
      nodes.push({kind:'cat',id:c.id,ref:c,amount:amt,R,tr:R,
        x:p.x+(hash01(c.id)-.5)*60,y:p.y+(hash01(c.id+'y')-.5)*44,
        vx:Math.cos(va)*.5,vy:Math.sin(va)*.5,ax:p.x,ay:p.y,k:0.0011,
        seed:hash01(c.id)*7,idx:i,
        sats:[0,1].map(k=>({a0:hash01(c.id+k)*6.28,d:2.1+hash01(c.id+'d'+k)*.9,s:.8+hash01(c.id+'s'+k),sp:(.3+hash01(c.id+'v'+k)*.4)*(k?1:-1)}))});
    });
    // 消费轨迹折线：按金额降序连成北斗式折线
    poly=[...nodes].sort((a,b)=>b.amount-a.amount).map(n=>n.id);
    for(let i=0;i<poly.length-1;i++)links.push({s:poly[i],t:poly[i+1],w:.9,ph:Math.random(),sp:.25});
  }else{
    /* ---- L3 下钻：分类内「花销 × 细分」二部图 ----
       中心 = 该主 tag；外环 = 它的副 tag（大小 ∝ 细分金额）；
       内环 = 当月经该主 tag 的花销（大小 ∝ 金额）；连线 = 花销↔其所属细分。
       花销角度取其各细分角度的圆周均值 ⇒ 同一细分的花销聚成一个扇区、连线短且不糊。 */
    if(!detailTag){S.view='l1';return}
    const cx0=P(.5,.5).x, cy0=P(.5,.5).y;
    const span=Math.min(X1-X0,Y1-Y0);
    const subs=summarizeSubs(detailExpenses,detailTag.tagId);
    const totalCents=detailExpenses.reduce((s,e)=>s+e.amount_cents,0);

    // 中心：分类主星
    const fR=Math.max(15,tagR(totalCents/100)*1.2);
    nodes.push({kind:'cat',id:detailTag.id,ref:detailTag,tagId:detailTag.tagId,
      amount:totalCents/100,R:fR,tr:fR,
      x:cx0,y:cy0,vx:0,vy:0,ax:cx0,ay:cy0,k:0.004,seed:1.3,idx:0,center:true,sats:[]});

    // 外环：细分节点（按金额降序均布，从正上方起）
    const R2=span*0.44;
    const angOf=new Map();
    subs.forEach((s,i)=>angOf.set(s.tagId,(subs.length?i/subs.length:0)*6.28-Math.PI/2));
    subs.forEach((s,i)=>{
      const a=angOf.get(s.tagId);
      const R=Math.max(7,Math.min(19,5.5+Math.sqrt(s.amount/100)*0.5));
      const ax=cx0+Math.cos(a)*R2, ay=cy0+Math.sin(a)*R2*0.86;
      nodes.push({kind:'sub',id:'s'+s.tagId,tagId:s.tagId,ref:s,amount:s.amount/100,R,tr:R,
        x:ax+(hash01('s'+s.tagId)-.5)*26, y:ay+(hash01('sy'+s.tagId)-.5)*20,
        vx:0,vy:0,ax,ay,k:0.0018,seed:i*2.1+3,idx:30+i,sats:[]});
      links.push({s:'s'+s.tagId,t:detailTag.id,w:1.1,ph:Math.random(),sp:.4});
    });

    // 内环：花销节点
    const R1=span*0.24;
    const slot={};
    detailExpenses.forEach((e,i)=>{
      const subIds=e.tags.filter(t=>t.role==='secondary'&&t.parent_tag_id===detailTag.tagId).map(t=>t.tag_id);
      let a;
      let sx=0,sy=0;
      for(const id of subIds){const ang=angOf.get(id);if(ang===undefined)continue;sx+=Math.cos(ang);sy+=Math.sin(ang)}
      a=(Math.abs(sx)>1e-6||Math.abs(sy)>1e-6)?Math.atan2(sy,sx):(detailExpenses.length?(i/detailExpenses.length)*6.28:0);
      const key=Math.round(a*20);
      slot[key]=(slot[key]||0)+1;
      const rr=R1*(1+0.14*(slot[key]-1));   // 同扇区的多笔向外错开，避免叠死
      const yuan=e.amount_cents/100;
      const ax=cx0+Math.cos(a)*rr, ay=cy0+Math.sin(a)*rr*0.88;
      const er=expR(yuan);
      nodes.push({kind:'exp',id:'e'+e.id,ref:e,cat:detailTag.id,subIds,amount:yuan,R:er,tr:er,
        x:ax,y:ay,vx:0,vy:0,ax,ay,k:0.0026,seed:i*1.7+1,idx:60+i,ctxColor:'#cdd8f2'});
      for(const id of subIds){
        if(angOf.has(id))links.push({s:'e'+e.id,t:'s'+id,w:0.85,ph:Math.random(),sp:.35});
      }
    });
  }
}
const byId=id=>nodes.find(n=>n.id===id);
function related(a,b){
  if(!a||!b||a===b)return true;
  const A=byId(a),B=byId(b);if(!A||!B)return false;
  const exp=A.kind==='exp'?A:(B.kind==='exp'?B:null);
  if(exp){
    const other=A.kind==='exp'?B:A;
    if(other.kind==='sub')return (exp.subIds||[]).includes(other.tagId);
    return true;   // 花销与中心分类节点天然相关
  }
  if(A.kind==='sub'&&B.kind==='sub')return false;   // 细分之间无直接关系，互相变暗
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
const fMass=n=>n.center?4:(n.kind==='sub'?2:1);
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
    const c1=s.kind==='exp'?'#cdd8f2':s.ref.color;
    const c2=t2.kind==='exp'?'#cdd8f2':t2.ref.color;
    const gr=g.createLinearGradient(s.x,s.y,t2.x,t2.y);
    gr.addColorStop(0,rgba(c1.startsWith('#')?c1:'#9fb4d8',a));
    gr.addColorStop(1,rgba(c2.startsWith('#')?c2:'#9fb4d8',a));
    g.strokeStyle=gr;g.lineWidth=on?1.8:1.1;
    // 与占位 tag（未分类）相连的线用虚线，视觉上区分"真实归属"与"兜底"
    if((s.ref&&s.ref.is_unnamed)||(t2.ref&&t2.ref.is_unnamed))g.setLineDash([3,4]);
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
    // 花销节点密集，标签只在 hover 相关时出现；细分节点始终显示（它是这张图的骨架）
    const isExp=n.kind==='exp';
    const lbText=isExp?((n.ref.note||n.ref.date||'').slice(0,7)||'一笔'):n.ref.name;
    if(!isExp||(hovG&&related(hovG,n.id))){
      label(lbText,'¥'+n.amount.toLocaleString(),n.x,n.y+n.R*sc+16,a*(hovG&&!related(hovG,n.id)?.6:1),hovG===n.id);
    }
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
    if(n.ref.is_unnamed){ // 占位 tag（未分类）：虚线 dim 环（需求基线 D-05 的"视觉弱化"）
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
function domLevel(){ return 'month'; } // 本版只支持月视图
function tlMonthColor(mi){
  const m=MONTHS[mi];
  if(m&&m.topColor)return m.topColor;
  const all=[...CATS,...CTXS];
  if(all.length)return all[mi%all.length].color;
  return '#9be9ff';
}
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
    const col=(((CATS.find(c=>c.id===d.top)||CATS[0])||CTXS[0])||{color:'#9be9ff'}).color;
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
    const col=((CATS.find(c=>c.id===y.top)||CATS[0])||{color:'#9be9ff'}).color;
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
    oc.fillText('¥'+Math.round(y.total).toLocaleString(),x,yy+R+31);
    oc.restore();
  });
}
function orbitHit(x,y){
  const r=oC.getBoundingClientRect(),w=r.width,h=r.height;
  // 本版只支持月视图
  for(let i=0;i<MONTHS.length;i++){const p=monthXY(w,h,i);
    if(Math.hypot(p.x-x,p.y-y)<18)return{kind:'month',id:i}}
  return null;
}

/* ---------- 时间选择（本版只支持月视图） ---------- */
function applyZoomSnap(){
  // 任何非 month 选择都弹回 month
  if(TL.sel.level!=='month'){TL.sel={level:'month',idx:TODAY}}
  TL.z=1;syncRail&&syncRail();
  buildGraph();syncChrome();
}
async function selectTime(kind,id){
  if(kind!=='month'){toast('即将支持');return}
  if(!MONTHS[id])return;
  TL.sel={level:'month',idx:id};
  try{
    await Data.selectMonth({year:MONTHS[id].y,month:MONTHS[id].m});
    refreshMonths();refreshAmounts();
    // selectMonth 可能补列导致下标漂移，按年月重新定位
    const ni=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
    if(ni>=0)TL.sel.idx=ni;
    TODAY=Math.max(0,MONTHS.length-1);
  }catch(e){toast('切换月份失败：'+(e.message||e))}
  // 下钻视图里切月：按新月份重拉该分类的花销，避免图上是上月数据
  if(S.view==='detail'&&detailTag){
    const {from,to}=Data.monthRange;
    try{
      const {items=[]}=await OrbitAPI.listExpenses(Data.ledgerId,{from,to});
      detailExpenses=items.filter(e=>e.tags.some(t=>t.role==='primary'&&t.tag_id===detailTag.tagId));
    }catch(e){detailExpenses=[]}
  }
  buildGraph();syncChrome();
  burst(W/2,H-190,'#9be9ff',14);
}
function setZoom(z,quiet){
  z=clamp(z,0,2);
  const before=domLevel();
  TL.z=z;syncRail();
  const after=levelW();
  // 若试图进入日/年（z 偏离 1），立即弹回月视图
  const wantDay=1-(after.d||0), wantYear=after.y||0;
  if(z<0.65||z>1.35){
    TL.z=1;syncRail();
    if(!quiet)toast('即将支持');
    if(before!=='month'||TL.sel.level!=='month'){TL.sel={level:'month',idx:TODAY};buildGraph();syncChrome()}
    return;
  }
  if(before!==domLevel()){applyZoomSnap();if(!quiet)toast('星轨 · 月视图')}
}

/* ---------- 交互 ---------- */
const tip=$('#tooltip');
let mouse={x:.5,y:.5},dragN=null,downPos=null,downT=0;
function setHover(h){
  S.hover=h?h.id:null;S.hoverKind=h?h.kind:null;
  if(!h){tip.hidden=true;gC.style.cursor='default';document.querySelectorAll('.top-row').forEach(e=>e.classList.remove('hot'));return}
  if(h.kind==='cat'||h.kind==='exp'||h.kind==='sub'){
    const n=byId(h.id);if(!n){tip.hidden=true;return}
    const title=n.kind==='exp'?(n.ref.note||'一笔花销'):n.ref.name;
    let sub;
    if(n.kind==='cat'){
      sub=S.view==='detail'?`本类合计 · ${detailExpenses.length} 笔`:'本月合计';
    }else if(n.kind==='exp'){
      const p=(n.ref.tags||[]).filter(t=>t.role==='primary').map(t=>t.name).join(' / ');
      sub=n.ref.date+(p?' · '+p:'');
    }else{
      sub=`${n.ref.count} 笔`;
    }
    tip.innerHTML=`<b>${title}</b><div class="tt-amt">¥${Number(n.amount||0).toLocaleString()}</div><div style="color:#8b96b5">${sub}</div>`;
    tip.hidden=false;gC.style.cursor='default';
    const cid=n.kind==='cat'?n.id:(n.kind==='exp'?n.cat:null);
    document.querySelectorAll('.top-row').forEach(e=>e.classList.toggle('hot',e.dataset.id===cid));
  }else{
    let html='';
    const m=MONTHS[h.id];
    if(m)html=`<b>${m.full||m.label}</b><div class="tt-amt">¥${Math.round(m.total).toLocaleString()}</div>`;
    else html='<b>暂无数据</b>';
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
    let best=null,bd=1e9;
    for(const n of nodes){
      const d=Math.hypot(n.x-x,n.y-y);
      if(d<=n.R+9&&d<bd){best=n;bd=d}
    }
    if(!best){
      if(S.view==='detail')goBack();               // 点空白 → 回主视图
    }else if(S.view==='l1'){
      if(best.kind==='cat')enterDetail(best.id);   // L1 主星 → L3 下钻
    }else{
      // L3 下钻内：花销→编辑该笔；细分→该细分明细；中心→本类明细/管理
      if(best.kind==='exp')openExpenseEditor(best.ref);
      else if(best.kind==='sub')openExpenseList({tagId:best.tagId,name:best.ref.name});
      else if(best.kind==='cat')openExpenseList(best.ref);
    }
  }
});
gC.addEventListener('pointerleave',()=>{setHover(null);dragN=null});
gC.addEventListener('wheel',e=>{e.preventDefault();toast('即将支持')},{passive:false});

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

/**
 * 进入 L3 下钻 ——《需求基线》§4：点击 L1 节点展开该分类内部「花销 × 标签」二部图；
 * §9 路线图更明确写着它「替换花销列表」。
 * 先拉当月经该主 tag 的花销再切视图：渲染帧里不发请求。
 */
async function enterDetail(id){
  const tag=(CATS.concat(CTXS)).find(c=>c.id===id);
  if(!tag)return;
  const {from,to}=Data.monthRange;
  try{
    const {items=[]}=await OrbitAPI.listExpenses(Data.ledgerId,{from,to});
    detailExpenses=items.filter(e=>e.tags.some(t=>t.role==='primary'&&t.tag_id===tag.tagId));
  }catch(e){
    detailExpenses=[];
    toast('加载花销失败：'+(e.message||e));
  }
  detailTag=tag;
  S.view='detail';S.focus=id;
  $('#btnBack').hidden=false;
  buildGraph();syncChrome();
  toast('下钻 · '+tag.name+'（'+detailExpenses.length+' 笔）');
}
function goBack(){
  if(S.view!=='detail')return;
  S.view='l1';S.focus=null;detailExpenses=[];detailTag=null;
  $('#btnBack').hidden=true;buildGraph();syncChrome();
}
$('#btnBack').onclick=goBack;

/* ===== 花销明细浮层（删花销 / 删 tag） ===== */
const expMask=$('#expMask');
let expCtx=null; // {tagId, dimKey, name}
/** 打开花销明细浮层：某 tag（主 tag 或它的副 tag）在当月的逐笔花销 + 编辑/删除 */
async function openExpenseList(tag){
  const isMain=CATS.some(c=>c.tagId===tag.tagId)||CTXS.some(c=>c.tagId===tag.tagId);
  let dimKey=S.dim;
  if(CATS.some(c=>c.tagId===tag.tagId))dimKey='category';
  else if(CTXS.some(c=>c.tagId===tag.tagId))dimKey='context';
  else{
    // 副 tag：从其所属维度树定位维度
    for(const [key,tree] of Object.entries(Data.dims||{})){
      if((tree.all||[]).some(t=>t.id===tag.tagId)){dimKey=key;break}
    }
  }
  expCtx={tagId:tag.tagId, dimKey, name:tag.name, isSub:!isMain};
  $('#expTitle').textContent=(isMain?(dimKey==='category'?'品类 · ':'情境 · '):'细分 · ')+tag.name;
  $('#expDelTag').textContent='删除「'+tag.name+'」';
  $('#expDist').hidden=true;   // 分布区等数据回来再决定显示
  expMask.hidden=false;
  await refreshExpList();
}
/** 拉当前月该 tag 的 expense（primary 匹配）+ 该 tag 副标（其它维被标注的 tag 也在 primary 或 secondary 中出现时如何处理？只列 primary=该tag 的）*/
/* 副 tag 颜色（取自本地副 tag 索引）
   注：副 tag 索引以主 tag id 为键，故需逐组查找 */
function tagColor(tagId){
  for(const arr of Object.values(SUBS)){
    const hit=arr.find(s=>s.tagId===tagId);
    if(hit)return hit.color;
  }
  return '#7a8299';
}
/* L3：分类内「花销 × 标签」汇总（《需求基线》§4 L3）——
   把本月该主 tag 的花销按副 tag 聚合，看这一类钱具体花在哪。
   一笔可挂多个副 tag，金额会分别计入各细分，故占比之和可能 >100%（有提示）。 */
function renderSubDistribution(mine){
  const wrap=$('#expDist'),rowsBox=$('#expDistRows'),tip=$('#expDistTip');
  // 副 tag 自身没有下级细分；无数据也不显示
  if(!expCtx||expCtx.isSub||!mine.length){wrap.hidden=true;rowsBox.innerHTML='';return}
  const total=mine.reduce((s,e)=>s+e.amount_cents,0);
  const list=summarizeSubs(mine,expCtx.tagId);   // 与下钻二部图共用同一份汇聚口径
  if(!list.length){wrap.hidden=true;rowsBox.innerHTML='';return}
  wrap.hidden=false;
  rowsBox.innerHTML=list.map(d=>{
    const pct=total?Math.round(d.amount/total*100):0;
    return `<div class="d-row${d.is_unnamed?' unnamed':''}">
      <span class="d-name">${d.name}</span>
      <div class="d-bar"><i style="width:${Math.max(2,pct)}%;background:${d.color}"></i></div>
      <span class="d-amt">¥${(d.amount/100).toLocaleString()}</span>
      <span class="d-cnt">${d.count}笔</span>
      <span class="d-pct">${pct}%</span>
    </div>`;
  }).join('');
  const sumPct=list.reduce((s,d)=>s+(total?d.amount/total*100:0),0);
  tip.hidden=sumPct<=101;
}
async function refreshExpList(){
  const box=$('#expList');
  if(!expCtx)return;
  const {from,to}=Data.monthRange;
  $('#expSub').textContent=(from&&to)?(from.slice(0,7).replace('-','年')+'月 · '+expCtx.name):expCtx.name;
  box.innerHTML='<div class="e-empty">加载中…</div>';
  try{
    const {items=[]}=await OrbitAPI.listExpenses(Data.ledgerId,{from,to});
    // 匹配：该 tag 作为 primary（category 维按 primary；context 同）——也包含副 tag 提及？只列 primary
    // 主 tag 匹配 primary；副 tag 匹配 secondary
    const mine=items.filter(e=>e.tags.some(t=>t.tag_id===expCtx.tagId&&t.role===(expCtx.isSub?'secondary':'primary')));
    renderSubDistribution(mine);   // L3：细分分布（无副 tag 数据或本身是副 tag 时自动隐藏）
    if(!mine.length){
      box.innerHTML='<div class="e-empty">本月该'+(expCtx.isSub?'细分':(expCtx.dimKey==='category'?'品类':'情境'))+'暂无花销</div>';
      return;
    }
    box.innerHTML=mine.map(e=>{
      const d=e.date.slice(5).replace('-','/');
      const amt=(e.amount_cents/100);
      const ctxTag=e.tags.find(t=>t.role==='primary'&&t.dim_key!=='category')?.name;
      return `<div class="e-row" data-id="${e.id}" data-json="${encodeURIComponent(JSON.stringify(e))}">
        <span class="e-date">${d}</span>
        <span class="e-note">${(e.note||'')}${ctxTag?' · '+ctxTag:''}</span>
        <span class="e-amt">¥${amt.toLocaleString()}</span>
        <button class="e-edit" title="编辑这笔">✎</button>
        <button class="e-del" title="删除这笔">✕</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.e-row').forEach(row=>{
      row.querySelector('.e-edit').onclick=(ev)=>{
        ev.stopPropagation();
        const raw=decodeURIComponent(row.dataset.json);
        const exp=JSON.parse(raw);
        openExpenseEditor(exp);
      };
      row.querySelector('.e-del').onclick=async (ev)=>{
        ev.stopPropagation();
        const eid=Number(row.dataset.id);
        const amtText=row.querySelector('.e-amt').textContent;
        if(!confirm('删除这笔花销 '+amtText+' ？'))return;
        try{
          await OrbitAPI.deleteExpense(Data.ledgerId,eid);
          await Data.afterChange();refreshMonths();refreshAmounts();
          buildGraph();syncChrome();
          await refreshExpList();
          toast('已删除一笔');
        }catch(err){toast('删除失败：'+(err.message||err))}
      };
    });
  }catch(err){
    box.innerHTML='<div class="e-empty">加载失败：'+(err.message||err)+'</div>';
  }
}
$('#expClose').onclick=()=>expMask.hidden=true;
$('#expDone').onclick=()=>expMask.hidden=true;
expMask.addEventListener('click',e=>{if(e.target===expMask)expMask.hidden=true});
// 删除整个 tag（后端保护：被引用则 409 提示先删花销；「未分类」占位锁定）
$('#expDelTag').onclick=async ()=>{
  if(!expCtx)return;
  if(!confirm('删除 tag「'+expCtx.name+'」？\n（若仍有花销使用会被拒绝，需先删除或转移）'))return;
  try{
    await OrbitAPI.deleteTag(Data.ledgerId,expCtx.tagId);
    expMask.hidden=true;
    await Data.selectLedger(Data.ledgerId); // 重拉维度/统计
    refreshTagArrays();refreshMonths();refreshAmounts();
    buildGraph();syncChrome();
    toast('tag 已删除');
  }catch(err){
    toast('删除失败：'+(err.message||err)+'（请先删除使用它的花销）');
  }
};
// 重命名 tag
$('#expRenameTag').onclick=()=>{
  if(!expCtx)return;
  openNameBox({kind:'tag',mode:'rename',dimKey:expCtx.dimKey,targetId:expCtx.tagId,currentName:expCtx.name});
  expMask.hidden=false; // 保持明细在命名浮层后仍可回看
};
/* 明细浮层改色：展开色板后点色即改（color=null 表示清除覆盖色，回到按名哈希） */
let expColorBusy=false;
function syncExpSwatches(){
  renderSwatches($('#expSwatches'),null,c=>applyTagColor(c));
}
async function applyTagColor(color){
  if(!expCtx||expColorBusy)return;
  expColorBusy=true;
  try{
    await OrbitAPI.updateTag(Data.ledgerId,expCtx.tagId,{color});
    await Data.selectLedger(Data.ledgerId);   // 重拉维度（含新颜色）
    refreshTagArrays();refreshAmounts();
    buildGraph();syncChrome();
    if(!mask.hidden)renderModalChips();       // 记一笔浮层开着则同步
    if(!expMask.hidden)await refreshExpList();
    toast(color?'已改色':'已恢复自动取色');
  }catch(e){
    toast('改色失败：'+(e.message||e));
  }finally{
    expColorBusy=false;
  }
}
$('#expRecolorTag').onclick=()=>{
  const box=$('#expColors');
  box.hidden=!box.hidden;
  if(!box.hidden)syncExpSwatches();
};
$('#expColorDefault').onclick=()=>applyTagColor(null);
$('#expCustom').onchange=e=>applyTagColor(e.target.value);

/* ---------- 标签管理浮层（排序 / 重命名）----------
   排序作用于 tags.position：影响记一笔的候选排列、星图节点顺序、下拉顺序。
   层级 = 「维度 + 父 tag」：排主 tag 时 parentTagId 传 null，排副 tag 时传其父 id。 */
const tagMask=$('#tagMask');
let tagMgrDim='category';
function openTagMgr(){
  tagMgrDim=(S.dim==='context')?'context':'category';
  tagMask.hidden=false;
  syncTagMgrDim();
  renderTagMgr();
}
function syncTagMgrDim(){
  $('#tagDimSeg').querySelectorAll('.seg').forEach(b=>b.classList.toggle('active',b.dataset.v===tagMgrDim));
}
/** 在当前管理维度里按 id 找 tag（parentId 为 null 时在根层找） */
function findMgrTag(parentId,tagId){
  const tree=(Data.dims||{})[tagMgrDim];
  if(!tree)return null;
  if(parentId==null)return tree.roots.find(t=>t.id===tagId)||null;
  const parent=tree.roots.find(t=>t.id===parentId);
  return parent?((parent.children||[]).find(t=>t.id===tagId)||null):null;
}
function renderTagMgr(){
  const box=$('#tagList');
  const tree=(Data.dims||{})[tagMgrDim];
  if(!tree||!tree.roots.length){box.innerHTML='<div class="e-empty">该账本暂无此维度的标签</div>';return}
  const row=(t,parentId,index,total,isSub)=>
    `<div class="t-row${isSub?' t-sub':''}${t.is_unnamed?' t-unnamed':''}" data-id="${t.id}" data-parent="${parentId==null?'':parentId}">
      <span class="t-dot" style="background:${t.color}"></span>
      <span class="t-name">${t.name}</span>
      ${isSub?'':'<span class="t-badge">主</span>'}
      <button class="t-mv" data-dir="-1"${index===0?' disabled':''} title="上移">↑</button>
      <button class="t-mv" data-dir="1"${index===total-1?' disabled':''} title="下移">↓</button>
      <button class="t-edit" title="重命名">✎</button>
    </div>`;
  let html='';
  tree.roots.forEach((r,i)=>{
    html+=row(r,null,i,tree.roots.length,false);
    (r.children||[]).forEach((c,ci)=>html+=row(c,r.id,ci,r.children.length,true));
  });
  box.innerHTML=html;
  box.querySelectorAll('.t-row').forEach(el=>{
    const id=Number(el.dataset.id);
    const parentId=el.dataset.parent?Number(el.dataset.parent):null;
    el.querySelectorAll('.t-mv').forEach(b=>b.onclick=()=>moveTag(parentId,id,Number(b.dataset.dir)));
    el.querySelector('.t-edit').onclick=()=>{
      const t=findMgrTag(parentId,id);
      if(!t)return;
      tagMask.hidden=true;   // 让位给命名浮层（nameMask 层级更高，先收起更清爽）
      openNameBox({kind:'tag',mode:'rename',dimKey:tagMgrDim,targetId:t.id,currentName:t.name,parentTagId:parentId});
    };
  });
}
/** 同层级内上/下移一位：整组全量重写提交（后端要求覆盖该层全部 id） */
async function moveTag(parentId,tagId,dir){
  const tree=(Data.dims||{})[tagMgrDim];
  if(!tree)return;
  const list=parentId==null?tree.roots.slice():((tree.roots.find(r=>r.id===parentId)?.children)||[]).slice();
  const ids=list.map(t=>t.id);
  const i=ids.indexOf(tagId),j=i+dir;
  if(i<0||j<0||j>=ids.length)return;
  [ids[i],ids[j]]=[ids[j],ids[i]];
  try{
    await Data.reorderTags(tagMgrDim,ids,parentId);
    refreshTagArrays();refreshAmounts();
    buildGraph();syncChrome();
    renderTagMgr();
    if(!mask.hidden)renderModalChips();   // 记一笔浮层开着则同步候选顺序
    toast('顺序已更新');
  }catch(e){
    toast('排序失败：'+(e.message||e));
  }
}
$('#tagDimSeg').querySelectorAll('.seg').forEach(b=>b.onclick=()=>{
  tagMgrDim=b.dataset.v;syncTagMgrDim();renderTagMgr();
});
$('#tagClose').onclick=$('#tagDone').onclick=()=>tagMask.hidden=true;
tagMask.addEventListener('click',e=>{if(e.target===tagMask)tagMask.hidden=true});


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
  // 笔数：Data.days 为有支出的天数，笔数保守估算；总额必须真实
  let nExp=1;
  try{
    if(Data&&Data.days&&Data.days.length)nExp=Math.max(Data.days.length,1);
    else nExp=Math.max(1,Math.round(tot/58));
  }catch(e){nExp=Math.max(1,Math.round(tot/58))}
  $('#mtLabel').textContent=`${selLabel()} · 共 ${nExp} 笔`;
  animateNum($('#mtValue'),tot,v=>'¥'+Math.round(v).toLocaleString());
  animateNum($('#pNum'),tot,v=>'¥'+Math.round(v).toLocaleString());
  $('#pCount').textContent=`${nExp} 笔 · 日均 ¥${Math.round(tot/30)}`;
  const pv=prevTotal(),d=pv>0?(tot-pv)/pv*100:0;
  $('#pDelta').textContent=`${d>=0?'▲':'▼'} ${Math.abs(d).toFixed(1)}% vs 上期`;
  $('#tlTip').textContent='星轨 · 月视图（点击星星切换月份）';
  // 底部操作提示随视图切换（下钻视图的可用操作与 L1 不同）
  const hintEl=document.querySelector('.hint');
  if(hintEl){
    hintEl.textContent=(S.view==='detail')
      ?'点花销星编辑该笔 · 点细分星看明细 · 点中心星看本类 · 点空白或「← 主视图」返回'
      :'拖拽星体 · 悬停看关联 · 点击星星下钻 · 滚轮缩放星轨 · 星轨可左右拖';
  }
  renderTop();
}
function renderTop(){
  const amts=amountsForTime(),items=[...catList()].sort((a,b)=>(amts[b.id]||0)-(amts[a.id]||0)).slice(0,5);
  if(!items.length){
    $('#topList').innerHTML='<div style="color:#8b96b5;font-size:12px">本月暂无支出</div>';
    $('#insightBox').innerHTML='✨ 本月暂无支出，快去点亮第一颗星。';
    return;
  }
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
    el.onclick=()=>{const tag=(CATS.concat(CTXS)).find(c=>c.id===el.dataset.id);if(tag)openExpenseList(tag)};
  });
  const topName=items[0]?items[0].name:'—';
  $('#insightBox').innerHTML=`✨ 本月 <b>${topName}</b> 是最大支出星系`;
}
function seg(id,fn){$(id).querySelectorAll('.seg').forEach(b=>b.onclick=()=>{
  $(id).querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));b.classList.add('active');fn(b.dataset.v)})}

/** 切换账本（下拉项 / 新建后共用）：重拉数据并整链刷新 */
async function switchLedger(id){
  if(String(id)===String(S.ledgerId)&&Data.cats.length)return;
  S.ledgerId=id;
  try{
    await Data.selectLedger(id);
    refreshTagArrays();refreshMonths();refreshAmounts();
    TODAY=Math.max(0,MONTHS.length-1);
    const ni=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
    TL.sel={level:'month',idx:ni>=0?ni:TODAY};TL.scroll=1;
  }catch(e){toast('切换账本失败：'+(e.message||e))}
  renderLedgerDD();
  buildGraph();syncChrome();
  const cur=(Data.ledgers||[]).find(l=>String(l.id)===String(S.ledgerId));
  toast('账本 · '+(cur?cur.name:''));
}

/** 渲染账本下拉菜单 + 按钮当前名 */
function renderLedgerDD(){
  const btn=$('#ledgerBtn'),menu=$('#ledgerMenu');
  if(!btn||!menu||!Data||!Data.ledgers)return;
  const cur=(Data.ledgers||[]).find(l=>String(l.id)===String(S.ledgerId));
  btn.innerHTML=`<span class="led-name">${cur?cur.name:'选择账本'}</span> ▾`;
  // 每账本取稳定色点（名称哈希）
  const dotColor=n=>{const p=['#5ad7ff','#b48cff','#ff9f6b','#6fe3a8','#ff7a9e','#ffd166','#6b9dff','#f06292'];let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))>>>0;return p[h%p.length]};
  menu.innerHTML=Data.ledgers.map(l=>`
    <button class="dd-item${String(l.id)===String(S.ledgerId)?' active':''}" data-id="${l.id}">
      <span class="dd-dot" style="color:${dotColor(l.name)};background:${dotColor(l.name)}"></span>
      <span class="dd-name">${l.name}</span>
      ${String(l.id)===String(S.ledgerId)?'<span class="dd-check">✦</span>':''}
    </button>`).join('')+`
    <div class="dd-sep"></div>
    <button class="dd-new" id="ddNewLedger">＋ 新建账本</button>
    <button class="dd-rename" id="ddRenameLedger">✎ 重命名当前账本</button>
    <button class="dd-rename" id="ddManageTags">⚙ 标签管理</button>
    <button class="dd-danger" id="ddDelLedger">🗑 删除当前账本</button>`;
  menu.querySelectorAll('.dd-item').forEach(b=>b.onclick=async ()=>{
    const id=isNaN(Number(b.dataset.id))?b.dataset.id:Number(b.dataset.id);
    menu.hidden=true;
    await switchLedger(id);
  });
  const nb=menu.querySelector('#ddNewLedger');
  if(nb)nb.onclick=()=>{menu.hidden=true;openNameBox({kind:'ledger'})};
  const rb=menu.querySelector('#ddRenameLedger');
  if(rb)rb.onclick=()=>{
    if(!cur)return;
    menu.hidden=true;
    openNameBox({kind:'ledger',mode:'rename',targetId:cur.id,currentName:cur.name});
  };
  const mt=menu.querySelector('#ddManageTags');
  if(mt)mt.onclick=()=>{menu.hidden=true;openTagMgr()};
  const db=menu.querySelector('#ddDelLedger');
  if(db)db.onclick=async ()=>{
    const name=cur?cur.name:'';
    menu.hidden=true;
    if(!cur)return;
    if(!confirm(`删除账本「${name}」？\n其中全部花销、标签、维度将被永久删除，无法撤销。`))return;
    try{
      await OrbitAPI.deleteLedger(cur.id);
      // 从本地列表移除；若删空则新建默认账本，否则切到第一个
      Data.ledgers=Data.ledgers.filter(l=>String(l.id)!==String(cur.id));
      if(!Data.ledgers.length){
        const nl=await OrbitAPI.createLedger('我的账本');
        Data.ledgers=[nl];
      }
      await switchLedger(Data.ledgers[0].id);
      renderLedgerDD();
      toast('账本「'+name+'」已删除');
    }catch(err){toast('删除失败：'+(err.message||err))}
  };
}

// 下拉开关：点按钮展开，点外部/Esc 收起
$('#ledgerBtn').onclick=(e)=>{e.stopPropagation();const m=$('#ledgerMenu');m.hidden=!m.hidden;if(!m.hidden)renderLedgerDD()};
document.addEventListener('click',()=>{const m=$('#ledgerMenu');if(m)m.hidden=true});
addEventListener('keydown',e=>{if(e.key==='Escape'){const m=$('#ledgerMenu');if(m)m.hidden=true}});

seg('#dimSeg',v=>{
  S.dim=v;
  // 切维度必然离开下钻（下钻是针对某个具体分类的）
  if(S.view==='detail'){S.view='l1';S.focus=null;detailExpenses=[];detailTag=null}
  $('#btnBack').hidden=true;
  refreshAmounts();buildGraph();syncChrome();
  toast(v==='category'?'维度 · 品类（这是什么钱）':'维度 · 情境（和谁 / 什么场景）')});
$('#btnToday').onclick=async ()=>{
  try{
    await Data.gotoToday();
    refreshMonths();refreshAmounts();
    TODAY=Math.max(0,MONTHS.length-1);
    const ni=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
    TL.sel={level:'month',idx:ni>=0?ni:TODAY};
  }catch(e){toast('回到今天失败：'+(e.message||e))}
  TL.z=1;syncRail();buildGraph();syncChrome();
};

/* 粒度轨已隐藏（本版只支持月视图）：保留函数防崩 */
const rail=$('#rail'),handle=$('#railHandle');
function syncRail(){if(!handle)return;handle.style.top=(12+TL.z/2*76)+'%'}
let railDrag=false;
function railSet(e){toast('即将支持')}
if(rail){
rail.addEventListener('pointerdown',e=>{railDrag=true;rail.setPointerCapture(e.pointerId);railSet(e)});
rail.addEventListener('pointermove',e=>{if(railDrag)railSet(e)});
rail.addEventListener('pointerup',()=>{railDrag=false;toast('即将支持')});
}

/* 记账浮层（真实提交：POST → 重拉 → 图谱刷新） */
const mask=$('#modalMask');

/* ---- 命名浮层（账本/tag 的新建与重命名共用）---- */
const nameMask=$('#nameMask');
let nameAction=null; // {kind:'ledger'|'tag', dimKey?, mode:'create'|'rename', targetId?, currentName?, parentTagId?, parentName?}

/* ---- 标签取色（新建 / 重命名 / 明细改色共用一块色板）----
   与 data.js 的 hashColor 色板同源；选「自动」= 不传 color → 后端存 null → 按名哈希取色。 */
const TAG_PALETTE=['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#f43f5e'];
let pickingColor=null; // 命名浮层当前选中的色（null = 自动）
function renderSwatches(box,current,onPick){
  box.innerHTML=TAG_PALETTE.map(c=>`<button class="nc-dot${current===c?' on':''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
  box.querySelectorAll('.nc-dot').forEach(b=>b.onclick=()=>onPick(b.dataset.c));
}
function syncNameSwatches(){
  renderSwatches($('#ncSwatches'),pickingColor,c=>{pickingColor=c;syncNameSwatches()});
}
$('#ncDefault').onclick=()=>{pickingColor=null;syncNameSwatches()};
$('#ncCustom').oninput=e=>{pickingColor=e.target.value;syncNameSwatches()};

function nameBoxTitle(a){
  if(a.mode==='rename')return '重命名'+(a.kind==='ledger'?'账本':'tag');
  if(a.kind==='ledger')return '新建账本';
  return a.parentTagId?('在「'+(a.parentName||'')+'」下新建细分'):(a.dimKey==='category'?'新建品类 tag':'新建情境 tag');
}
function openNameBox(action){
  nameAction=action;
  $('#nameTitle').textContent=nameBoxTitle(action);
  $('#nameInput').value=action.currentName||'';
  $('#nameInput').placeholder=action.kind==='ledger'?'账本名…':'tag 名…';
  // 取色区只对 tag 有意义；账本没有颜色
  const isTag=action.kind==='tag';
  $('#nameColors').hidden=!isTag;
  if(isTag){pickingColor=null;syncNameSwatches()}
  nameMask.hidden=false;
  setTimeout(()=>{const el=$('#nameInput');el.focus();el.select()},60);
}
function closeNameBox(){nameMask.hidden=true;nameAction=null}
$('#nameClose').onclick=closeNameBox;
$('#nameCancel').onclick=closeNameBox;
nameMask.addEventListener('click',e=>{if(e.target===nameMask)closeNameBox()});
$('#nameOk').onclick=async ()=>{
  const raw=($('#nameInput').value||'').trim();
  if(!raw){toast('名称不能为空');return}
  const act=nameAction; closeNameBox();
  try{
    const isRename=act.mode==='rename';
    if(act.kind==='ledger'){
      if(isRename){
        await OrbitAPI.renameLedger(act.targetId,raw);
        const hit=Data.ledgers.find(l=>String(l.id)===String(act.targetId));
        if(hit)hit.name=raw;
        renderLedgerDD();buildGraph();syncChrome();
        toast('账本已重命名为「'+raw+'」');
      }else{
        await Data.createLedger(raw);           // 建后自动选中（含默认维度）
        S.ledgerId=Data.ledgerId;
        refreshTagArrays();refreshMonths();refreshAmounts();
        TODAY=Math.max(0,MONTHS.length-1);
        const ni=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
        TL.sel={level:'month',idx:ni>=0?ni:TODAY};
        renderLedgerDD();
        buildGraph();syncChrome();
        toast('账本 · '+raw+' 已创建');
      }
    }else{ // tag
      if(isRename){
        const patch={name:raw};
        if(pickingColor)patch.color=pickingColor;   // 没主动选色 → 不动原色
        await OrbitAPI.updateTag(Data.ledgerId,act.targetId,patch);
        await Data.selectLedger(Data.ledgerId); // 重拉维度
        refreshTagArrays();refreshAmounts();
        if(!mask.hidden)renderModalChips();
        buildGraph();syncChrome();
        // 若花销明细浮层开着且正是该 tag，同步标题
        if(!expMask.hidden&&expCtx&&String(expCtx.tagId)===String(act.targetId)){
          expCtx.name=raw;
          $('#expTitle').textContent=(expCtx.dimKey==='category'?'品类 · ':'情境 · ')+raw;
          $('#expDelTag').textContent='删除「'+raw+'」';
        }
        toast('tag 已重命名为「'+raw+'」');
      }else{
        // 当前账本内建 tag；带 parentTagId 时建为该主 tag 下的副 tag（已重拉维度）
        const fresh=await Data.createTag(act.dimKey,raw,pickingColor,act.parentTagId||null);
        refreshTagArrays();refreshAmounts();
        // 若记一笔浮层正开着：主 tag 建成即选中它；副 tag 建成即勾上它
        if(!mask.hidden){
          const st=modalSel[act.dimKey];
          if(act.parentTagId){
            if(st.primary===act.parentTagId)st.subs.add(fresh.id);
          }else{
            st.primary=fresh.id;
            st.subs.clear();   // 换了主 tag，原副 tag 不再属于本笔
          }
          renderModalChips();
        }
        toast('tag · '+raw+' 已创建');
      }
    }
  }catch(e){
    toast('操作失败：'+(e.message||e));
  }
};
$('#btnAddLedger').onclick=()=>openNameBox({kind:'ledger'});
$('#btnAddCat').onclick=()=>openNameBox({kind:'tag',dimKey:'category'});
$('#btnAddCtx').onclick=()=>openNameBox({kind:'tag',dimKey:'context'});

let modalIsIncome=false; // 浮层类型：false=支出，true=收入
// 解析浮层账本 select：默认当前账本，被改则用其值（按 id 或名称匹配）
function resolveModalLedgerId(){
  const sel=document.querySelector('.m-row select');
  const raw=sel?String(sel.value||'').trim():'';
  if(raw&&Data&&Data.ledgers){
    const hit=Data.ledgers.find(l=>String(l.id)===raw||l.name===raw);
    if(hit)return hit.id;
  }
  return S.ledgerId;
}
// 打开浮层时同步账本下拉（value 用真实 id，选中当前账本）
function syncModalLedgerOptions(){
  const sel=document.querySelector('.m-row select');
  if(!sel||!Data||!Data.ledgers||!Data.ledgers.length)return;
  sel.innerHTML=Data.ledgers.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  sel.value=String(S.ledgerId);
  if(!sel.value)sel.selectedIndex=0;
}
/* 记一笔浮层的选择状态（单一真相源：渲染与提交都读它，不靠 DOM class 反推） */
let modalSel={category:{primary:null,subs:new Set()},context:{primary:null,subs:new Set()}};
function resetModalSel(){
  modalSel={category:{primary:null,subs:new Set()},context:{primary:null,subs:new Set()}};
}
/* 主 tag：点击选中，再点一次取消（= 不选 → 后端落「未分类」）；换主 tag 会清空该维副 tag */
function bindPrimaryChips(sel,dimKey){
  document.querySelectorAll(sel+' .m-chip').forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const id=Number(b.dataset.tagId),st=modalSel[dimKey];
    st.primary=(st.primary===id)?null:id;
    st.subs.clear();          // 主 tag 变了，原副 tag 不再属于本笔
    renderModalChips();
  });
}
/* 副 tag：仅选中主 tag 后出现，多选。占位「未分类」不进候选（不选即等于它），
   但编辑时若本笔确实挂着占位则保留显示，避免一编辑就丢。 */
function renderSubRow(dimKey){
  const isCat=dimKey==='category';
  const wrap=isCat?$('#mCatsSub'):$('#mCtxSub');
  const label=isCat?$('#mCatsSubLabel'):$('#mCtxSubLabel');
  const box=isCat?$('#mCatsSubChips'):$('#mCtxSubChips');
  const addBtn=isCat?$('#mCatsSubAdd'):$('#mCtxSubAdd');
  const st=modalSel[dimKey];
  if(st.primary==null){wrap.hidden=true;box.innerHTML='';return}
  const parent=(isCat?CATS:CTXS).find(c=>c.tagId===st.primary);
  const subs=(SUBS[st.primary]||[]).filter(s=>!s.is_unnamed||st.subs.has(s.tagId));
  wrap.hidden=false;
  label.textContent='「'+(parent?parent.name:'')+'」的细分';
  box.innerHTML=subs.length
    ?subs.map(s=>`<button class="m-chip m-chip-sub${st.subs.has(s.tagId)?' on':''}" data-tag-id="${s.tagId}"><i style="background:${s.color}"></i>${s.name}</button>`).join('')
    :'<span class="m-sub-empty">暂无细分，可新建</span>';
  box.querySelectorAll('.m-chip').forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const id=Number(b.dataset.tagId);
    if(st.subs.has(id))st.subs.delete(id);else st.subs.add(id);
    renderSubRow(dimKey);
  });
  addBtn.onclick=()=>openNameBox({kind:'tag',dimKey,parentTagId:st.primary,parentName:parent?parent.name:''});
}
function renderModalChips(){
  // 收入时品类候选只留名字含「收入」的 tag
  const catList0=modalIsIncome?CATS.filter(c=>c.name.includes('收入')):CATS;
  if(!catList0.length){
    $('#mCats').innerHTML='<div style="color:#8b96b5;font-size:12px">暂无收入类目，可先新建「收入·…」；不选则记为「未分类」</div>';
  }else{
    $('#mCats').innerHTML=catList0.map(c=>`<button class="m-chip${modalSel.category.primary===c.tagId?' on':''}" data-tag-id="${c.tagId}"><i style="background:${c.color}"></i>${c.name}</button>`).join('');
  }
  $('#mCtx').innerHTML=CTXS.map(c=>`<button class="m-chip${modalSel.context.primary===c.tagId?' on':''}" data-tag-id="${c.tagId}"><i style="background:${c.color}"></i>${c.name}</button>`).join('');
  bindPrimaryChips('#mCats','category');
  bindPrimaryChips('#mCtx','context');
  renderSubRow('category');
  renderSubRow('context');
  document.querySelectorAll('.m-tab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.m-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    // 收入 tab 联动品类重渲染
    modalIsIncome=b.textContent.trim()==='收入';
    // 切类型后原品类若不在新候选里，清掉（连同其副 tag），避免提交出语义不符的品类
    const list=modalIsIncome?CATS.filter(c=>c.name.includes('收入')):CATS;
    if(!list.some(c=>c.tagId===modalSel.category.primary)){
      modalSel.category.primary=null;modalSel.category.subs.clear();
    }
    renderModalChips();
  });
}
let editingExpense=null; // 编辑中的花销（含 amount_cents/date/note/tags 原始数据；选中态见 modalSel）
/** 打开编辑模式（从花销明细行进入） */
function openExpenseEditor(exp){
  editingExpense=exp;
  const tags=exp.tags||[];
  const isIncome=exp.type==='income';
  // 主 tag：占位「未分类」视为"没选"（is_unnamed）—— 保存时回落到同一占位，不产生额外语义
  const catP=tags.find(t=>t.role==='primary'&&t.dim_key==='category');
  const ctxP=tags.find(t=>t.role==='primary'&&t.dim_key==='context');
  resetModalSel();
  modalSel.category.primary=(catP&&!catP.is_unnamed)?catP.tag_id:null;
  modalSel.context.primary=(ctxP&&!ctxP.is_unnamed)?ctxP.tag_id:null;
  // 副 tag：按所属维度回填；占位不回填（保存时会自动补回）
  for(const t of tags){
    if(t.role!=='secondary'||t.is_unnamed)continue;
    if(t.dim_key==='category')modalSel.category.subs.add(t.tag_id);
    else if(t.dim_key==='context')modalSel.context.subs.add(t.tag_id);
  }
  // 类型 tab
  document.querySelectorAll('.m-tab').forEach(x=>x.classList.toggle('active',x.textContent.trim()===(isIncome?'收入':'支出')));
  modalIsIncome=isIncome;
  $('#modalMode').textContent='编辑';
  $('#mAmount').value=(exp.amount_cents/100).toFixed(0);
  const di=document.querySelector('.m-row input[type=date]');if(di)di.value=exp.date;
  const rm=document.querySelector('.m-remark');if(rm)rm.value=exp.note||'';
  // 账本 select 锁定为该笔所属账本（不支持跨账本迁移）
  syncModalLedgerOptions();
  const sel=document.querySelector('.m-row select');
  if(sel){sel.value=String(exp.ledger_id);sel.disabled=true}
  renderModalChips();
  mask.hidden=false;
}
$('#btnAdd').onclick=()=>{
  mask.hidden=false;
  editingExpense=null;
  $('#modalMode').textContent='记一笔';
  // 打开时回到当前账本的真实 tags 与默认类型；不预选任何 tag（不选=「未分类」）
  modalIsIncome=false;
  document.querySelectorAll('.m-tab').forEach(x=>x.classList.toggle('active',x.textContent.trim()==='支出'));
  syncModalLedgerOptions();
  const sel=document.querySelector('.m-row select');if(sel)sel.disabled=false;
  const di=document.querySelector('.m-row input[type=date]');
  if(di){di.value=new Date().toISOString().slice(0,10)}
  const rm=document.querySelector('.m-remark');if(rm)rm.value='';
  $('#mAmount').value='88';
  resetModalSel();
  renderModalChips();
};
$('#modalClose').onclick=$('#modalCancel').onclick=()=>mask.hidden=true;
mask.addEventListener('click',e=>{if(e.target===mask)mask.hidden=true});
$('#modalSave').onclick=async ()=>{
  const isIncome=document.querySelector('.m-tab.active')?.textContent.trim()==='收入';
  // 金额：元 → 分
  const yuan=parseFloat($('#mAmount').value);
  if(!isFinite(yuan)||yuan<=0){toast('请输入有效金额');return}
  const amountCents=Math.round(yuan*100);
  // 类型/日期
  const type=isIncome?'income':'expense';
  const dateInput=document.querySelector('.m-row input[type=date]');
  const date=dateInput?dateInput.value:'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast('日期无效');return}
  // 账本：默认当前账本，浮层 select 被改则用其值
  const ledgerId=resolveModalLedgerId();
  // 主 tag：不选也能提交 —— 缺省的维度由后端落到「未分类」占位
  const primary={};
  if(modalSel.category.primary!=null)primary.category=modalSel.category.primary;
  if(modalSel.context.primary!=null)primary.context=modalSel.context.primary;
  // 副 tag：两维选中的合并传（后端按 parent 校验归属；没选的维度会自动补「未分类」）
  const tags=[...modalSel.category.subs,...modalSel.context.subs];
  // 备注
  const note=document.querySelector('.m-remark')?.value.trim()||undefined;
  const payload={type,amountCents,date,note,primary,tags};
  try{
    if(editingExpense){
      // 编辑：PUT 全量替换（保持原 ledger_id）
      await OrbitAPI.updateExpense(editingExpense.ledger_id,editingExpense.id,payload);
      const savedDate=payload.date;
      mask.hidden=true;editingExpense=null;
      // 刷新并跳转（若日期改了月份则跳到新月份）
      await Data.afterChange();refreshMonths();refreshAmounts();
      if(savedDate&&/^\d{4}-\d{2}-\d{2}$/.test(savedDate)){
        const cy=Number(savedDate.slice(0,4)),cm=Number(savedDate.slice(5,7));
        if(!(Data._currentMonthY===cy&&Data._currentMonthM===cm)){
          await Data.selectMonth({year:cy,month:cm});
          refreshMonths();refreshAmounts();
        }
      }
      const mi=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
      if(mi>=0)TL.sel={level:'month',idx:mi};
      TODAY=Math.max(0,MONTHS.length-1);
      buildGraph();syncChrome();
      if(!expMask.hidden)await refreshExpList();
      toast('已保存修改 · ¥'+yuan.toLocaleString());
      return;
    }
    const created=await OrbitAPI.addExpense(ledgerId,payload);
    mask.hidden=true;
    // 若记到别的账本：先切账本再刷新；否则重拉当前月统计与月序列
    if(String(ledgerId)!==String(Data.ledgerId)){
      S.ledgerId=ledgerId;
      await Data.selectLedger(ledgerId);
      refreshTagArrays();refreshMonths();refreshAmounts();
      renderLedgerDD();
    }else{
      await Data.afterChange();
      refreshMonths();refreshAmounts();
    }
    // 若刚记的月份不在当前显示月，跳到该月（按 created.date 的 YYYY-MM）
    if(created&&created.date&&/^\d{4}-\d{2}-\d{2}$/.test(created.date)){
      const cy=Number(created.date.slice(0,4)),cm=Number(created.date.slice(5,7));
      if(!(Data._currentMonthY===cy&&Data._currentMonthM===cm)){
        await Data.selectMonth({year:cy,month:cm});
        refreshMonths();refreshAmounts();
      }
    }
    // 同步星轨选中到该月并重建图谱
    const mi=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
    if(mi>=0)TL.sel={level:'month',idx:mi};
    TODAY=Math.max(0,MONTHS.length-1);
    buildGraph();syncChrome();
    burst(W/2,H-190,'#9be9ff',30);
    toast('已记一笔 · ¥'+yuan.toLocaleString());
  }catch(e){
    toast('记账失败：'+(e.message||e));
  }
};
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

/* 启动（真实数据） */
async function boot(){
  resize();
  try{
    await Data.init();
  }catch(e){
    toast('数据加载失败：'+(e.message||e)+'（确认 server 已启动）');
    requestAnimationFrame(frame);
    return;
  }
  S.ledgerId=Data.ledgerId;
  refreshTagArrays();refreshMonths();refreshAmounts();
  const last=Data.months[Data.months.length-1];
  if(last){
    try{await Data.selectMonth({year:last.y,month:last.m});}catch(e){}
    refreshMonths();refreshAmounts();
  }
  TODAY=Math.max(0,MONTHS.length-1);
  const ni=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
  TL.sel={level:'month',idx:ni>=0?ni:TODAY};
  TL.z=1;TL.scroll=1;
  renderLedgerDD();
  buildGraph();syncChrome();syncRail&&syncRail();
  requestAnimationFrame(frame);
  toast('欢迎来到 Orbit 星账 · 真实数据已加载');
}
boot();
