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
/** 收入类目：产品约定用同一套 tag 体系加「收入·」前缀（需求基线 §5.3）。
    星图里它们走独立的绿色圆环样式，不混进支出品类的弧线。 */
let INCOMES=[];
const isIncomeTag=t=>String(t.name||'').startsWith('收入');
let MONTHS=[];
let TODAY=0;
let DAYS=[];    // 日档：当前时间窗所在月的逐日序列（数据来自 Data.days）
let YEARS=[];   // 年档：由 MONTHS 按年聚合
let DAY_TODAY=0; // 日档里的"今天"下标
const tagAmountMap={category:{},context:{}};
/* 副 tag 索引：父主 tag id → 该主 tag 下的副 tag 数组（记一笔多选的数据源） */
let SUBS={};
const toRenderTag=t=>({id:'t'+t.id,name:t.name,color:t.color,is_unnamed:t.is_unnamed,tagId:t.id});
function refreshTagArrays(){
  if(!Data)return;
  const cats=(Data.cats||[]).map(toRenderTag);
  CATS=cats.filter(t=>!isIncomeTag(t));      // 支出品类：走北斗弧线
  INCOMES=cats.filter(t=>isIncomeTag(t)).map(t=>({...t,color:'#6fe3a8'}));   // 收入统一绿色（基线 §5.3）
  CTXS=(Data.ctxs||[]).map(toRenderTag);
  SUBS={};
  for(const tree of Object.values(Data.dims||{})){
    for(const root of (tree.roots||[]))SUBS[root.id]=(root.children||[]).map(toRenderTag);
  }
}
/** 把当前窗口的收入金额贴到收入类目上（金额来自 Data.incomeRows） */
function refreshIncomes(){
  if(!Data||!INCOMES.length)return;
  const amt={};
  for(const r of (Data.incomeRows||[]))amt[r.tagId]=r.amount;
  INCOMES=INCOMES.map(t=>({...t,amount:amt[t.tagId]||0}));
}
function refreshAmounts(){
  if(!Data)return;
  tagAmountMap.category={...(Data.monthAmountsByDim.category||{})};
  tagAmountMap.context={...(Data.monthAmountsByDim.context||{})};
  refreshIncomes();  // 收入金额（依赖 refreshTagArrays 已建好的 INCOMES 列表）
  refreshDays();   // 日序列同属"当前窗口统计"，一并搬进渲染层（各调用点无需再单独刷新）
}
function refreshMonths(){
  if(!Data)return;
  MONTHS=(Data.months||[]).map(m=>({label:m.label,full:m.full,total:m.total,y:m.y,m:m.m,topColor:m.topColor||''}));
  TODAY=Math.max(0,MONTHS.length-1);
  // 年档：按年聚合（星轨年视图的数据源）
  const byY=new Map();
  for(const m of MONTHS){
    const cur=byY.get(m.y)||{label:m.y+'年',y:m.y,total:0,topColor:''};
    cur.total+=m.total;
    if(!cur.topColor&&m.topColor)cur.topColor=m.topColor;
    byY.set(m.y,cur);
  }
  YEARS=[...byY.values()].sort((a,b)=>a.y-b.y).map(v=>({...v,color:v.topColor||'#9be9ff'}));
}
/** 日档：取当前时间窗所在月的逐日序列（Data.days 由 _loadWindow 填充） */
function refreshDays(){
  if(!Data)return;
  DAYS=(Data.days||[]).map(d=>({label:d.label,date:d.date,y:d.y,m:d.m,day:d.d,total:d.total,
    topName:d.topName,color:d.topColor||'#9be9ff'}));
  const t=new Date().toISOString().slice(0,10);
  const i=DAYS.findIndex(d=>d.date===t);
  DAY_TODAY=i>=0?i:Math.max(0,DAYS.length-1);
}

/* 画布视角：x/y = 平移（屏幕像素），z = 缩放倍数。
   布局不再把节点硬塞进视口 —— 内容可以超出窗口，靠平移/缩放查看。 */
const CAM={x:0,y:0,z:1};

/* ---------- 状态 ---------- */
const S={dim:'category',ledgerId:null,view:'l1',focus:null,hover:null,hoverKind:null};
const TL={z:1,pan:0,view:{from:0,to:1},sel:{level:'month',idx:0}};
// z = 连续变焦（0=日 / 1=月 / 2=年）；view = 当前视口时间区间（天序号）；
// pan = 手动平移量（天），由左右拖动产生，切换选中项时归零
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
  const w=Data&&Data._window;
  if(w){
    if(w.kind==='day')return w.date.replace(/-/g,'/');
    if(w.kind==='year')return w.year+'年';
  }
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
    const L=158*p.life, hyp=Math.hypot(p.vx,p.vy)||1;
    const ux=-p.vx/hyp, uy=-p.vy/hyp;   // 尾方向（与运动方向相反）
    // 多段渐隐拖尾：逐段变细变淡，比单段线性渐变更有「流星」的颗粒感
    bg.save();bg.lineCap='round';
    const SEG=7;
    for(let k=0;k<SEG;k++){
      const t0=k/SEG, t1=(k+1)/SEG;
      const a0=(1-t0)*(1-t0)*.85*p.life;
      if(a0<=.01)continue;
      bg.strokeStyle=`rgba(${200+Math.round(55*(1-t0))},${220+Math.round(35*(1-t0))},255,${a0})`;
      bg.lineWidth=1.9*(1-t0*.72);
      bg.beginPath();
      bg.moveTo(p.x+ux*L*t0,p.y+uy*L*t0);
      bg.lineTo(p.x+ux*L*t1,p.y+uy*L*t1);
      bg.stroke();
    }
    // 头部亮点（光晕而非硬圆）
    bg.globalCompositeOperation='lighter';
    const hg=bg.createRadialGradient(p.x,p.y,0,p.x,p.y,7);
    hg.addColorStop(0,`rgba(255,255,255,${.95*p.life})`);
    hg.addColorStop(1,'rgba(160,210,255,0)');
    bg.fillStyle=hg;bg.beginPath();bg.arc(p.x,p.y,7,0,7);bg.fill();
    bg.restore();
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
    // 收入节点：底部独立一排，绿色圆环 + 向上箭头（需求基线 §5.3：
    // 「收入为独立样式节点，不混入花销节点」）。只显示本期有收入的类目。
    const inc=INCOMES.filter(c=>c.amount>0);
    inc.forEach((c,i)=>{
      const nx=inc.length===1?0.5:(0.18+0.64*(i/(inc.length-1)));
      const p=P(nx,0.95);
      const R=Math.max(7,Math.min(16,tagR(c.amount)*0.8));
      nodes.push({kind:'inc',id:c.id,ref:c,amount:c.amount,R,tr:R,
        x:p.x,y:p.y+(hash01(c.id)-.5)*10,vx:0,vy:0,ax:p.x,ay:p.y,k:0.0016,
        seed:hash01(c.id)*5,idx:i,sats:[]});
    });

    // 消费轨迹折线：按金额降序连成北斗式折线
    poly=[...nodes].filter(n=>n.kind==='cat').sort((a,b)=>b.amount-a.amount).map(n=>n.id);
    for(let i=0;i<poly.length-1;i++)links.push({id:poly[i]+'>'+poly[i+1],s:poly[i],t:poly[i+1],w:.9,ph:Math.random(),sp:.25});
  }else{
    /* ---- L3 下钻：分类内「花销 × 细分」二部图 ----
       图的**两侧只有两种节点**：外环 = 该分类的副 tag（细分），内环 = 当月经该分类的花销。
       刻意**不画主 tag 本身** —— 已经在它的下钻视图里了，再画一个中心主星属于冗余；
       即便某个副 tag 与主 tag 同名，它这里也只是副 tag 的身份。
       边 = 花销 ↔ 其所属细分；被多笔共享的细分用虚线（共享线），独占的用实线。 */
    if(!detailTag){S.view='l1';return}
    const ctr=P(.5,.5), cx0=ctr.x, cy0=ctr.y;
    const span=Math.min(X1-X0,Y1-Y0);
    const subs=summarizeSubs(detailExpenses,detailTag.tagId);
    const subById=new Map(subs.map(s=>[s.tagId,s]));   // 取 count 判断共享线

    // 外环：细分节点（按金额降序均布，从正上方起）
    // 环半径随节点数放大：每个细分在环上至少留出弧长；装不下就超出视口，
    // 靠拖动画布查看 —— 不再压缩间距硬塞进窗口。
    const R2=Math.max(span*0.42, subs.length*3.2);
    const angOf=new Map();
    subs.forEach((s,i)=>angOf.set(s.tagId,(subs.length?i/subs.length:0)*6.28-Math.PI/2));
    subs.forEach((s,i)=>{
      const a=angOf.get(s.tagId);
      const R=Math.max(7,Math.min(19,5.5+Math.sqrt(s.amount/100)*0.5));
      const ax=cx0+Math.cos(a)*R2, ay=cy0+Math.sin(a)*R2*0.86;
      nodes.push({kind:'sub',id:'s'+s.tagId,tagId:s.tagId,ref:s,amount:s.amount/100,R,tr:R,
        x:ax+(hash01('s'+s.tagId)-.5)*26, y:ay+(hash01('sy'+s.tagId)-.5)*20,
        vx:0,vy:0,ax,ay,k:0.0018,seed:i*2.1+3,idx:i,sats:[]});
    });

    // 内环：花销节点。先算每笔的目标角度（其所属细分角度的**圆周均值**），
    // 再在同一扇区内均匀散开 —— 否则同细分的多笔会叠成一条射线。
    // 内环半径同样随账单数放大（每笔在环上至少 ~12px 弧长）
    const R1=Math.max(span*0.24, detailExpenses.length*1.91);
    const rows=detailExpenses.map((e,i)=>{
      const subIds=e.tags.filter(t=>t.role==='secondary'&&t.parent_tag_id===detailTag.tagId).map(t=>t.tag_id);
      let sx=0,sy=0;
      for(const id of subIds){const ang=angOf.get(id);if(ang===undefined)continue;sx+=Math.cos(ang);sy+=Math.sin(ang)}
      const aimed=(Math.abs(sx)>1e-6||Math.abs(sy)>1e-6);
      const a=aimed?Math.atan2(sy,sx):(detailExpenses.length?(i/detailExpenses.length)*6.28:0);
      return {e,i,subIds,a};
    });
    const buckets=new Map();
    rows.forEach(r=>{const k=r.a.toFixed(3);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r)});
    buckets.forEach(list=>{
      const spread=Math.min(0.95,0.18*list.length);   // 扇区宽度随笔数增长（上限 ~54°）
      list.forEach((r,j)=>{r.angle=r.a+(list.length>1?(j/(list.length-1)-0.5)*spread:0)});
    });
    rows.forEach(({e,i,subIds,angle})=>{
      const yuan=e.amount_cents/100;
      const ax=cx0+Math.cos(angle)*R1, ay=cy0+Math.sin(angle)*R1*0.88;
      const er=expR(yuan);
      nodes.push({kind:'exp',id:'e'+e.id,ref:e,cat:detailTag.id,subIds,amount:yuan,R:er,tr:er,
        x:ax,y:ay,vx:0,vy:0,ax,ay,k:0.0026,seed:i*1.7+1,idx:subs.length+i*0.25,ctxColor:'#cdd8f2'});
      // 边一：账单 ↔ 其所属细分 —— **全部实线**（这是归属关系）
      for(const id of subIds){
        if(!subById.has(id))continue;
        links.push({id:'e'+e.id+'>s'+id,s:'e'+e.id,t:'s'+id,w:1.0,ph:Math.random(),sp:.35});
      }
    });

    // 边二：副 tag ↔ 副 tag 的**共享线（虚线）**——
    // 一笔账单同时挂了两个细分，这两个细分就被这笔账单"共享"。
    // 这是《需求基线》L2「共享线（多对多投影）」的直接落地：
    // hover 共享线时，两端细分与共享它的账单一起高亮。
    const pairMap=new Map();   // 'a:b' → {a,b,exps[]}
    for(const {e,subIds} of rows){
      const ids=[...new Set(subIds)].filter(id=>subById.has(id)).sort((x,y)=>x-y);
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
        const key=ids[i]+':'+ids[j];
        if(!pairMap.has(key))pairMap.set(key,{a:ids[i],b:ids[j],exps:[]});
        pairMap.get(key).exps.push(e.id);
      }
    }
    for(const {a,b,exps} of pairMap.values()){
      // 被共享的笔数越多，线越显眼（w 1.0~3.0）—— 一眼看出哪对细分最常一起出现
      const k=Math.min(1,(exps.length||1)/8);
      links.push({
        id:'share:'+a+':'+b,s:'s'+a,t:'s'+b,shared:true,a,b,exps,
        w:1+k*2,ph:Math.random(),sp:.2,   // 只作视觉连接，不参与物理（见 tickDetail）
      });
    }
  }
  computeHot();   // 图重建后按当前 hover 重算：节点 id 已变，旧集合会失效
}
const byId=id=>nodes.find(n=>n.id===id);
/* ---------- hover 高亮集合 ----------
   用「集合」而不是两两判定：两两判定会把"邻居的邻居"也判成相关，高亮范围会发散。
   规则：
   - hover 节点 N：N 本身 + 与 N **直接相连**的节点，以及它们之间的连线
   - hover 普通线 L：L 的两端节点 + L 本身
   - hover 共享线 S：S 本身 + 两端细分 + 共享它的账单 + 那些账单的归属线
     （即"共享线相连的节点 + 共享的账单节点 + 这些账单的连线"）
   共享线彼此孤立：hover 一条共享线不会点亮别的共享线。
   集合为 null 表示当前无 hover（一切正常显示）。 */
let hotNodes=null, hotLinks=null;
const linkKey=l=>l.id||(l.s+'|'+l.t);
function computeHot(){
  hotNodes=null;hotLinks=null;
  if(!S.hover)return;
  hotNodes=new Set();hotLinks=new Set();
  const n=byId(S.hover);
  if(n){
    hotNodes.add(n.id);
    for(const l of links){
      if(l.s===n.id||l.t===n.id){
        hotLinks.add(linkKey(l));
        hotNodes.add(l.s===n.id?l.t:l.s);
      }
    }
    return;
  }
  const l=links.find(x=>linkKey(x)===S.hover);
  if(!l)return;
  hotLinks.add(linkKey(l));
  hotNodes.add(l.s);hotNodes.add(l.t);
  if(!l.shared)return;
  const exps=new Set(l.exps||[]);
  for(const l2 of links){
    if(l2.shared)continue;                        // 其它共享线不亮
    const expId=l2.s.startsWith('e')?l2.s:l2.t;   // 归属线的账单端
    if(!exps.has(Number(expId.slice(1))))continue;
    hotLinks.add(linkKey(l2));
    hotNodes.add(l2.s);hotNodes.add(l2.t);
  }
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
    // 世界边界远大于视口：节点不再被强行约束在窗口内，
    // 超出视口的部分拖动画面即可看到（只保留一个防无限飘的兜底范围）
    const m=20+n.tr, WL=-W, WR=W*2, WT=-H, WB=H*2;
    if(n.x<WL+m){n.x=WL+m;n.vx=Math.abs(n.vx)*.85}
    if(n.x>WR-m){n.x=WR-m;n.vx=-Math.abs(n.vx)*.85}
    if(n.y<WT+m){n.y=WT+m;n.vy=Math.abs(n.vy)*.85}
    if(n.y>WB-m){n.y=WB-m;n.vy=-Math.abs(n.vy)*.85}
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
  const f=60*dt;
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
  // 连线弹簧（共享线不参与：它只表达"两个细分被同一笔共享"，若参与会拽乱外环均布）
  for(const l of links){
    if(l.shared)continue;
    const s=byId(l.s),t=byId(l.t);if(!s||!t)continue;
    const rest=l.rest||130;
    const dx=t.x-s.x,dy=t.y-s.y,d=Math.hypot(dx,dy)||1;
    const F=(d-rest)*0.022*f, ux=dx/d, uy=dy/d;
    if(!s.pin){s.vx+=ux*F/fMass(s);s.vy+=uy*F/fMass(s)}
    if(!t.pin){t.vx-=ux*F/fMass(t);t.vy-=uy*F/fMass(t)}
  }
  // 锚点系留 + 微扰（活着） + 阻尼 + 积分
  // 注：下钻图**不用质心引力** —— 细分节点已不连中心，引力会把它们拽离外环糊到中间。
  // 锚定让 buildGraph 算好的扇区布局稳定，斥力与弹簧只做有机微调（L1 同款思路）。
  for(const n of nodes){
    n.vx+=(n.ax-n.x)*n.k*60*dt;n.vy+=(n.ay-n.y)*n.k*60*dt;
    n.vx+=(hash01(n.id+((tNow*0.9)|0))-.5)*.03;n.vy+=(hash01(n.id+'y'+((tNow*0.9)|0))-.5)*.03;
    n.vx*=.86;n.vy*=.86;
    const sp=Math.hypot(n.vx,n.vy),mx=3;
    if(sp>mx){n.vx*=mx/sp;n.vy*=mx/sp}
    if(!n.pin){n.x+=n.vx*60*dt;n.y+=n.vy*60*dt}
    // 世界边界放宽（同上：下钻图节点多，允许超出视口，靠平移查看）
    const m=14+n.tr, WL=-W, WR=W*2, WT=-H, WB=H*2;
    if(n.x<WL+m)n.vx+=(WL+m-n.x)*.02*f;
    if(n.x>WR-m)n.vx-=(n.x-(WR-m))*.02*f;
    if(n.y<WT+m)n.vy+=(WT+m-n.y)*.02*f;
    if(n.y>WB-m)n.vy-=(n.y-(WB-m))*.02*f;
  }
}

/* ---------- 星星绘制（无硬边） ---------- */
let bursts=[];
function burst(x,y,color,n=26){
  for(let i=0;i<n;i++){const a=Math.random()*6.28,v=1+Math.random()*3.4;
    bursts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-1,r:1+Math.random()*2.2,c:Math.random()<.3?'#ffffff':color,life:.8+Math.random()*.6})}
}
/** 收入星：**四角尖星（内凹）**，与支出的圆润星体形成形状对比。
    两者都是「星」，只是长的形状不同 —— 比绿圈加箭头更贴合「星账」的意象，
    也更容易一眼分辨「这颗是进账」。 */
function drawIncomeStar(x,y,R,color,tw){
  g.save();g.globalCompositeOperation='lighter';
  const hs=R*4.8;
  g.globalAlpha=.5*tw;g.drawImage(glowSprite(color),x-hs/2,y-hs/2,hs,hs);
  const k=R*.26;                                   // 内凹控制点：越小越尖
  const gr=g.createRadialGradient(x,y,0,x,y,R);
  gr.addColorStop(0,'rgba(255,255,255,1)');
  gr.addColorStop(.42,'rgba(255,255,255,.92)');
  gr.addColorStop(.6,color);
  gr.addColorStop(1,rgba(color,0));
  g.globalAlpha=.96*tw;g.fillStyle=gr;
  g.beginPath();
  g.moveTo(x,y-R);                                 // 上尖
  g.quadraticCurveTo(x+k,y-k,x+R,y);               // 右上（内凹）
  g.quadraticCurveTo(x+k,y+k,x,y+R);               // 右下（内凹）
  g.quadraticCurveTo(x-k,y+k,x-R,y);               // 左下（内凹）
  g.quadraticCurveTo(x-k,y-k,x,y-R);               // 左上（内凹）
  g.closePath();g.fill();
  g.restore();
}
function drawStar(x,y,R,color,tw,spiky){
  g.save();g.globalCompositeOperation='lighter';
  // 大星带呼吸（光晕半径 + 强度微脉动）；小星不呼吸 —— 整屏同频闪会晕
  // 相位随坐标偏移，避免所有大星同频
  const breathe=R>13?(1+.055*Math.sin(tNow*1.6+x*.01+y*.013)):1;
  const hs=R*(R>15?4.6:6.2)*breathe;
  g.globalAlpha=.6*tw*breathe;g.drawImage(glowSprite(color),x-hs/2,y-hs/2,hs,hs);
  g.globalAlpha=.95;
  const gr=g.createRadialGradient(x,y,0,x,y,R);
  gr.addColorStop(0,'rgba(255,255,255,1)');
  gr.addColorStop(.32,'rgba(255,255,255,.95)');
  gr.addColorStop(.55,color);
  gr.addColorStop(1,rgba(color,0)); // 透明收边，无轮廓
  g.fillStyle=gr;g.beginPath();g.arc(x,y,R,0,7);g.fill();
  if(spiky){
    // 4 主芒 + 4 次芒：长度随星体分层；芒身色散（根部偏白、末端接节点色）
    const L1=R*2.7, L2=R*1.55;
    g.lineCap='round';
    for(let k=0;k<8;k++){
      const long=(k%2===0);
      const an=k*Math.PI/4+.4, L=long?L1:L2;
      const x2=x+Math.cos(an)*L, y2=y+Math.sin(an)*L;
      const lg=g.createLinearGradient(x,y,x2,y2);
      lg.addColorStop(0,`rgba(255,255,255,${(long?.40:.24)*tw*breathe})`);
      lg.addColorStop(.5,`rgba(255,255,255,${(long?.15:.09)*tw})`);
      lg.addColorStop(1,rgba(color,0));
      g.strokeStyle=lg;g.lineWidth=long?1.35:.8;
      g.beginPath();g.moveTo(x+Math.cos(an)*R*.3,y+Math.sin(an)*R*.3);g.lineTo(x2,y2);g.stroke();
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
  const dimA=id=>!hotNodes?1:(hotNodes.has(id)?1:.13);
  const esc=clamp(enterT,0,1.4);
  // 画布视角：图谱元素都在世界坐标里绘制，统一应用平移 + 缩放
  g.save();g.translate(CAM.x,CAM.y);g.scale(CAM.z,CAM.z);

  // 星座连线 / 二部图边
  for(const l of links){
    const s=byId(l.s),t2=byId(l.t);if(!s||!t2)continue;
    const on=!!hotLinks&&hotLinks.has(linkKey(l));
    // 线宽与透明度都随 w：归属线固定 1.0；共享线 1.0~3.0（被共享越多越显眼）
    const base=l.w||1;
    let a=0.16+Math.max(0,base-1)*0.09;
    if(hotNodes)a=on?.78:.05;
    a*=clamp(enterT,0,1);
    if(a<=.01)continue;
    const c1=s.kind==='exp'?'#cdd8f2':s.ref.color;
    const c2=t2.kind==='exp'?'#cdd8f2':t2.ref.color;
    const gr=g.createLinearGradient(s.x,s.y,t2.x,t2.y);
    gr.addColorStop(0,rgba(c1.startsWith('#')?c1:'#9fb4d8',a));
    gr.addColorStop(1,rgba(c2.startsWith('#')?c2:'#9fb4d8',a));
    g.strokeStyle=gr;g.lineWidth=on?2.6:(0.9+Math.max(0,base-1)*0.75);
    // 共享线（被同一笔账单同时挂上的两个细分）用虚线
    if(l.shared)g.setLineDash([3,5]);
    g.beginPath();g.moveTo(s.x,s.y);g.lineTo(t2.x,t2.y);g.stroke();
    g.setLineDash([]);
    const px=lerp(s.x,t2.x,l.ph),py=lerp(s.y,t2.y,l.ph);
    g.save();g.globalCompositeOperation='lighter';g.globalAlpha=Math.min(1,a*2.6);
    g.fillStyle='#fff';g.beginPath();g.arc(px,py,on?1.9:1.2,0,7);g.fill();g.restore();
  }
  // 花销 / 细分小星
  for(const n of nodes){
    if(n.kind==='cat')continue;
    const sc=easeOutBack(clamp(enterT-n.idx*0.05,0,1));
    if(sc<=0)continue;
    const hot=!hotNodes||hotNodes.has(n.id);
    const a=dimA(n.id);if(a<=.02)continue;
    const tw=.8+.2*Math.sin(t*2.2+n.seed);
    const col=n.kind==='exp'?(hot?n.ctxColor:'#aeb9d4'):n.ref.color;
    if(n.kind==='inc'){
      drawIncomeStar(n.x,n.y,Math.max(.5,n.R*sc),col,tw*a);   // 收入：四角尖星
    }else{
      // 细分节点是「标签」身份，给星芒；花销节点保持素净（数量多，加芒会糊）
      drawStar(n.x,n.y,Math.max(.5,n.R*sc),col,tw*a,n.kind==='sub');
    }
    g.save();g.globalAlpha=a;g.restore();
    // 账单节点数量多，默认不挂标签（几十笔会糊成一片）：只有被 hover 关联到时才显示日期与金额。
    // 细分节点是这张图的骨架，名字始终显示。
    const isExp=n.kind==='exp';
    const showLb=isExp?(!!hotNodes&&hotNodes.has(n.id)):true;
    if(showLb){
      const lbText=isExp?((n.ref.date||'').slice(5)||'一笔'):n.ref.name;
      label(lbText,'¥'+n.amount.toLocaleString(),n.x,n.y+n.R*sc+16,a*(hot?1:.6),hovG===n.id);
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
  g.restore();   // 结束画布平移：爆裂粒子走屏幕坐标，不随相机移动

  bursts=bursts.filter(p=>p.life>0);
  g.save();g.globalCompositeOperation='lighter';
  for(const p of bursts){
    p.x+=p.vx;p.y+=p.vy;p.vy+=.02;p.life-=.016;
    g.globalAlpha=Math.max(0,p.life);g.fillStyle=p.c;
    g.beginPath();g.arc(p.x,p.y,p.r*p.life+.4,0,7);g.fill();
  }
  g.restore();g.globalAlpha=1;
}

/* ---------- 星轨：日/月/年三档吸附切换 + 统一时间轴 + 左右拖拽 ---------- */
/** 当前主导档位：**只取三档之一，不做中间态混合**。
    变焦量 z 连续累积只用于滚轮手感与手柄位置，渲染永远落在某一档上 ——
    因此不会出现「日/月/年两套节点叠在一起」的中间画面。
    拖动过程若停在两档之间，也只会落在更近的那一档（相当于弹回/顺势进入）。 */
function domLevel(){
  return ['day','month','year'][Math.round(clamp(TL.z,0,2))];
}
const LV_NAME={day:'日',month:'月',year:'年'};
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
  const dl=domLevel();
  // 地形（按当前档位的口径）
  oc.save();
  const vals=dl==='day'?DAYS.map(d=>d.total):dl==='year'?YEARS.map(y=>y.total):MONTHS.map(m=>m.total);
  const n=vals.length,mx=Math.max(1,...vals);   // mx 兜底 1：空窗口时避免除零
  if(n>1){
    oc.beginPath();
    for(let i=0;i<n;i++){const x=30+i/(n-1)*(w-60),y=h*.62-(vals[i]/mx)*h*.30;i?oc.lineTo(x,y):oc.moveTo(x,y)}
    oc.lineTo(w-30,h);oc.lineTo(30,h);oc.closePath();
    const tg=oc.createLinearGradient(0,0,0,h);
    tg.addColorStop(0,'rgba(110,150,255,.16)');tg.addColorStop(1,'rgba(110,150,255,0)');
    oc.fillStyle=tg;oc.fill();
  }
  oc.restore();

  // **只画当前档位**（不做中间态混合）：两套节点叠在一起很难看，
  // 切换的「顺」由节点入场动画提供，而不是让新旧两套并存。
  if(dl==='day')drawOrbitDay(w,h,t,1);
  else if(dl==='year')drawOrbitYear(w,h,t,1);
  else drawOrbitMonth(w,h,t,1);
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
/* ---------- 星轨统一时间轴 ----------
   三档（日/月/年）**共用一条连续时间轴**：节点的 x = 它代表的时间点在当前视口里的位置。
   变焦只改变视口跨度（日档≈1 个月、月档≈1 年、年档=全部），于是放大/缩小看到的是
   「同一条星轨的局部放大」，而不是三套互不相干的数据 ——
   在年视图选中 2025 再滚到月视图，看到的就是 2025 那一段的十二个月；
   继续放大到日档，看到的就是某个选中的月里每一天。反向缩小同理。 */
const DAY_MS=86400000;
const pad2=n=>String(n).padStart(2,'0');
/** 'YYYY-MM-DD' → 天序号（UTC，避免时区偏移） */
function dayNum(ymd){
  const [y,m,d]=ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y,m-1,d)/DAY_MS);
}
/** 数据覆盖的完整时间范围（按最早/最晚月取整到月边界） */
function timelineFull(){
  if(!MONTHS.length){
    const t=dayNum(new Date().toISOString().slice(0,10));
    return {from:t-15,to:t+15};
  }
  const f=MONTHS[0],l=MONTHS[MONTHS.length-1];
  const lastDay=new Date(Date.UTC(l.y,l.m,0)).getUTCDate();
  return {from:dayNum(`${f.y}-${pad2(f.m)}-01`),to:dayNum(`${l.y}-${pad2(l.m)}-${pad2(lastDay)}`)};
}
/** 视口 = 中心（天）+ 像素/天比例。
    比例按**连续**变焦量在三档之间插值 ⇒ 拖动时视口是平滑缩放的（跟手），
    而渲染始终只画「最近的那一档」节点，所以不会出现两套节点叠在一起。
    节点间距由比例决定（月档 64px/月、日档 44px/天），不为塞进视口而压缩。 */
const PX_PER_MONTH=64, PX_PER_DAY=44, DAYS_PER_MONTH=30.44;
function viewOf(w){
  const full=timelineFull(), all=Math.max(1,full.to-full.from);
  const PAD=44, vw=Math.max(1,w-PAD*2);
  const z=clamp(TL.z,0,2);
  const pDay=PX_PER_DAY, pMonth=PX_PER_MONTH/DAYS_PER_MONTH, pYear=vw/all;
  const p=z<=1 ? lerp(pDay,pMonth,z) : lerp(pMonth,pYear,z-1);
  const half=vw/2/Math.max(.0001,p);      // 视口半径（天）
  const maxPan=Math.max(0,all/2-half);
  const c=anchorCenter()+clamp(TL.pan||0,-maxPan,maxPan);
  return {c,p,vw,PAD,half};
}
/** 天序号 → 星轨像素 x */
function xOfDay(d,w){
  const v=viewOf(w);
  return v.PAD + v.vw/2 + (d-v.c)*v.p;
}
/** 视口锚点＝选中节点在**上一级周期**的中心：
    日档→该月中心；月档→该年中心（年中即 7/1）；年档→整体中心。 */
function anchorCenter(){
  const full=timelineFull();
  const lv=domLevel();
  if(lv==='day'){
    const d=DAYS[TL.sel.idx];
    if(d)return dayNum(`${d.y}-${pad2(d.m)}-15`);
  }else if(lv==='month'){
    const m=MONTHS[TL.sel.idx];
    if(m)return dayNum(`${m.y}-07-01`);
  }
  return (full.from+full.to)/2;
}
/** 当前选中节点代表的时间中心（天）—— 跨档衔接时用来找「覆盖它的新节点」 */
function selCenterDay(){
  const {level,idx}=TL.sel;
  if(level==='day'&&DAYS[idx])return dayNum(DAYS[idx].date);
  if(level==='month'&&MONTHS[idx])return dayNum(`${MONTHS[idx].y}-${pad2(MONTHS[idx].m)}-15`);
  if(level==='year'&&YEARS[idx])return dayNum(`${YEARS[idx].y}-07-01`);
  const full=timelineFull();
  return (full.from+full.to)/2;
}
const monthMidDay=m=>dayNum(`${m.y}-${pad2(m.m)}-15`);
function monthX(w,i){ return xOfDay(monthMidDay(MONTHS[i]),w) }
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
    if(i===TODAY){
      // 双层呼吸环：内外相位错开，比单环同相呼吸更自然
      const b1=Math.sin(t*1.8), b2=Math.sin(t*1.8+1.15);
      oc.strokeStyle=`rgba(160,240,255,${.50+.28*b1})`;oc.lineWidth=1.6;
      oc.beginPath();oc.arc(p.x,p.y,(R+7)*(1+.10*b1),0,7);oc.stroke();
      oc.strokeStyle=`rgba(120,200,255,${.24+.16*b2})`;oc.lineWidth=1;
      oc.beginPath();oc.arc(p.x,p.y,(R+13)*(1+.07*b2),0,7);oc.stroke();
    }
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
/* 日节点：x 同样取自统一时间轴 —— 放大到日档时，视口只覆盖一个月，
   于是画出来的正好是「当前这一段」里的每一天 */
function dayX(w,i){ return xOfDay(dayNum(DAYS[i].date),w) }
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
    const col=d.color||'#9be9ff';
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
function yearY(h,i){return h*[.40,.60,.44][i%3]}
function drawOrbitYear(w,h,t,al){
  orbitBase(w,h);
  const yearX=(i)=>xOfDay(dayNum(`${YEARS[i].y}-07-01`),w);   // 同样走统一时间轴
  tlPoly(YEARS.map((_,i)=>({x:yearX(i),y:yearY(h,i)})),al);
  YEARS.forEach((y,i)=>{
    const x=yearX(i), yy=yearY(h,i);
    const R=clamp(6+Math.sqrt(y.total)*.09,9,15);
    const col=y.color||'#9be9ff';
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
  const near=(px,py,rad=18)=>Math.hypot(px-x,py-y)<rad;
  const lv=domLevel();
  if(lv==='day'){
    for(let i=0;i<DAYS.length;i++)if(near(dayX(w,i),dayY(h,i)))return{kind:'day',id:i};
  }else if(lv==='year'){
    for(let i=0;i<YEARS.length;i++)if(near(xOfDay(dayNum(`${YEARS[i].y}-07-01`),w),yearY(h,i),20))return{kind:'year',id:i};
  }else{
    for(let i=0;i<MONTHS.length;i++){const p=monthXY(w,h,i);if(near(p.x,p.y))return{kind:'month',id:i}}
  }
  return null;
}

/* ---------- 时间选择：日/月/年三档联动 ----------
   四路联动（竖滑块 / 滚轮 / 星轨点击 / 回到今天）都写同一个状态：
   TL.z（连续变焦量）与 TL.sel（当前选中的档位与下标）；数据窗口由 syncWindowToSel 落地。 */

/** 把选中项落到数据层的时间窗，并刷新全链（图谱/洞察/星轨） */
async function syncWindowToSel(){
  const {level,idx}=TL.sel;
  try{
    if(level==='day'&&DAYS[idx])await Data.selectDay(DAYS[idx].date);
    else if(level==='year'&&YEARS[idx])await Data.selectYear(YEARS[idx].y);
    else if(level==='month'&&MONTHS[idx])await Data.selectMonth({year:MONTHS[idx].y,month:MONTHS[idx].m});
  }catch(e){toast('切换时间窗失败：'+(e.message||e))}
  refreshDays();refreshMonths();refreshAmounts();
  relockSel();                       // 刷新后索引可能漂移（月档可能补列）
  if(S.view==='detail'&&detailTag)await reloadDetailExpenses();
  buildGraph();syncChrome();
}
/** 刷新后把 TL.sel.idx 对齐到 Data._window 实际指向的那一格 */
function relockSel(){
  const w=Data&&Data._window;if(!w)return;
  if(w.kind==='day'){
    const i=DAYS.findIndex(d=>d.date===w.date);
    if(i>=0)TL.sel={level:'day',idx:i};
  }else if(w.kind==='year'){
    const i=YEARS.findIndex(y=>y.y===w.year);
    if(i>=0)TL.sel={level:'year',idx:i};
  }else if(w.year&&w.month){
    const i=MONTHS.findIndex(m=>m.y===w.year&&m.m===w.month);
    if(i>=0)TL.sel={level:'month',idx:i};
  }
}
/** 下钻视图里重拉当前时间窗的花销（切月/切日后图不能停在旧数据） */
async function reloadDetailExpenses(){
  if(!detailTag)return;
  const {from,to}=Data.monthRange;
  try{
    const {items=[]}=await OrbitAPI.listExpenses(Data.ledgerId,{from,to});
    detailExpenses=items.filter(e=>e.tags.some(t=>t.role==='primary'&&t.tag_id===detailTag.tagId));
  }catch(e){detailExpenses=[]}
}
/** 跨档时：在新档位里找「覆盖当前选中时间」的那个节点（语义缩放的衔接）
    注意必须在改写 TL.sel **之前**调用 —— 它读的是旧档位的选中时间 */
function idxForLevel(lv){
  const c=selCenterDay();
  const nearest=(arr,dayOf)=>{
    if(!arr.length)return 0;
    let best=0,bd=Infinity;
    arr.forEach((it,i)=>{const dd=Math.abs(dayOf(it)-c);if(dd<bd){bd=dd;best=i}});
    return best;
  };
  if(lv==='day')return nearest(DAYS,d=>dayNum(d.date));
  if(lv==='month')return nearest(MONTHS,m=>dayNum(`${m.y}-${pad2(m.m)}-15`));
  return nearest(YEARS,y=>dayNum(`${y.y}-07-01`));
}
/** 档位切换后对齐选中项（按时间包含关系），并让视口跟过去 */
let winTimer=null;
function scheduleWindowSync(){
  if(winTimer)clearTimeout(winTimer);
  winTimer=setTimeout(()=>{winTimer=null;syncWindowToSel()},120);
}
/** 已经落到数据层的档位（避免连续拖动时反复触发同一档的切换） */
let appliedLevel='month';
/** 变焦量变化后调用：只有**主导档位真的变了**才对齐选中项、换数据、让节点重新入场 */
function applyLevelChange(quiet){
  const lv=domLevel();
  if(lv===appliedLevel)return;
  appliedLevel=lv;
  const idx=idxForLevel(lv);          // 先算（读旧选中时间），再落新档位
  TL.sel={level:lv,idx};
  TL.pan=0;
  resetView();                        // 换档位＝换内容，视角归位
  scheduleWindowSync();
  if(!quiet)toast('星轨 · '+LV_NAME[lv]+'视图');
}
/** 松手/停止滚动后：把变焦量平滑吸附到最近的档位（不停在中间） */
let zoomAnim=null;
function snapZoom(){
  const to=clamp(Math.round(TL.z),0,2);
  if(Math.abs(to-TL.z)<0.001){TL.z=to;return}
  zoomAnim={from:TL.z,to,t0:performance.now(),dur:190};
}
/** 每帧推进吸附动画（smoothstep 缓动） */
function tickZoomAnim(now){
  if(!zoomAnim)return;
  const k=clamp((now-zoomAnim.t0)/zoomAnim.dur,0,1);
  const e=k*k*(3-2*k);
  TL.z=zoomAnim.from+(zoomAnim.to-zoomAnim.from)*e;
  syncRail();
  applyLevelChange(true);
  if(k>=1){TL.z=zoomAnim.to;zoomAnim=null;syncRail()}
}
async function selectTime(kind,id){
  if(kind==='day'){
    if(!DAYS[id])return;
    TL.sel={level:'day',idx:id};TL.pan=0;
    await syncWindowToSel();
    burst(W/2,H-190,'#9be9ff',10);
    return;
  }
  if(kind==='year'){
    if(!YEARS[id])return;
    TL.sel={level:'year',idx:id};TL.pan=0;
    await syncWindowToSel();
    burst(W/2,H-190,'#9be9ff',18);
    return;
  }
  if(kind!=='month'||!MONTHS[id])return;
  TL.sel={level:'month',idx:id};TL.pan=0;
  await syncWindowToSel();
  burst(W/2,H-190,'#9be9ff',14);
}
/** 直接落到某一档（初始化 / 点节点 / 回到今天等场合），不带吸附动画 */
function setZoom(z,quiet){
  zoomAnim=null;
  TL.z=clamp(Math.round(z),0,2);
  syncRail();
  applyLevelChange(quiet);
}
/** 滚轮：**连续**累积（跟手不平移档），停止滚动 220ms 后吸附到最近档 */
let wheelTimer=null;
function wheelZoom(dy){
  zoomAnim=null;
  TL.z=clamp(TL.z+(dy>0?0.34:-0.34),0,2);   // 约三格滚轮跨一档
  syncRail();
  applyLevelChange(true);
  clearTimeout(wheelTimer);
  wheelTimer=setTimeout(snapZoom,220);
}

/* ---------- 交互 ---------- */
const tip=$('#tooltip');
let mouse={x:.5,y:.5},dragN=null,panDrag=null,downPos=null,downT=0;
/** 点到线段的距离（共享线 hover 命中判定用） */
function distToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,L2=dx*dx+dy*dy;
  let t=L2?((px-x1)*dx+(py-y1)*dy)/L2:0;
  t=clamp(t,0,1);
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
/** 命中连线（节点优先命中；线的阈值取小一些，避免密图里频繁误触） */
function pickLink(x,y){
  let best=null,bd=6;
  for(const l of links){
    const s=byId(l.s),t=byId(l.t);if(!s||!t)continue;
    const d=distToSeg(x,y,s.x,s.y,t.x,t.y);
    if(d<bd){best=l;bd=d}
  }
  return best;
}
function setHover(h){
  S.hover=h?h.id:null;S.hoverKind=h?h.kind:null;
  computeHot();
  if(!h){tip.hidden=true;gC.style.cursor='default';document.querySelectorAll('.top-row').forEach(e=>e.classList.remove('hot'));return}
  if(h.kind==='link'){
    const l=links.find(x=>linkKey(x)===h.id);
    if(!l){tip.hidden=true;return}
    const A=byId(l.s),B=byId(l.t);
    // 归属线的一端是**账单节点**（花销对象没有 name），所以只取 tag 那一端的名字；
    // 共享线两端都是细分，才显示「A ↔ B」
    const tagEnd=(A&&A.kind!=='exp')?A:((B&&B.kind!=='exp')?B:null);
    tip.innerHTML=l.shared
      ?`<b>共享线</b><div style="color:#8b96b5">${A?A.ref.name:''} ↔ ${B?B.ref.name:''}</div><div style="color:#8b96b5">${(l.exps||[]).length} 笔共享</div>`
      :`<b>${tagEnd?tagEnd.ref.name:'一笔花销'}</b>`;
    tip.hidden=false;gC.style.cursor='pointer';
    document.querySelectorAll('.top-row').forEach(e=>e.classList.remove('hot'));
    return;
  }
  if(h.kind==='cat'||h.kind==='exp'||h.kind==='sub'||h.kind==='inc'){
    const n=byId(h.id);if(!n){tip.hidden=true;return}
    const title=n.kind==='exp'?(n.ref.note||'一笔花销'):n.ref.name;
    let sub;
    if(n.kind==='cat'){
      sub=S.view==='detail'?`本类合计 · ${detailExpenses.length} 笔`:'本月合计';
    }else if(n.kind==='exp'){
      const p=(n.ref.tags||[]).filter(t=>t.role==='primary').map(t=>t.name).join(' / ');
      sub=n.ref.date+(p?' · '+p:'');
    }else if(n.kind==='inc'){
      sub='收入类目';
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
/** 视角归位：任何「换内容/换视图」的场合都调用，避免上一处的平移缩放被带过来 */
function resetView(){
  CAM.x=0;CAM.y=0;CAM.z=1;
  const rng=$('#zoomRange'),val=$('#zoomVal');
  if(rng)rng.value='1';
  if(val)val.textContent='100%';
}
/** 缩放：以视口中心为锚点，中心处的世界点保持不动（不会"跑偏"） */
function setScale(nz){
  nz=clamp(nz,0.4,2.6);
  if(Math.abs(nz-CAM.z)<0.001)return;
  const cx=W/2, cy=H/2;
  const wx=(cx-CAM.x)/CAM.z, wy=(cy-CAM.y)/CAM.z;   // 中心对应的世界点
  CAM.z=nz;
  CAM.x=cx-wx*CAM.z;
  CAM.y=cy-wy*CAM.z;
  const rng=$('#zoomRange'),val=$('#zoomVal');
  if(rng)rng.value=String(nz);
  if(val)val.textContent=Math.round(nz*100)+'%';
}
(function bindZoomBar(){
  const rng=$('#zoomRange'),zin=$('#zoomIn'),zout=$('#zoomOut');
  if(rng)rng.addEventListener('input',()=>setScale(Number(rng.value)));
  if(zin)zin.onclick=()=>setScale(CAM.z*1.22);
  if(zout)zout.onclick=()=>setScale(CAM.z/1.22);
})();

/** 屏幕坐标 → 世界坐标。画布可平移与缩放，所有命中判定都必须先换算 */
function worldPos(e){
  const r=gC.getBoundingClientRect();
  return {x:(e.clientX-r.left-CAM.x)/CAM.z, y:(e.clientY-r.top-CAM.y)/CAM.z};
}
gC.addEventListener('pointermove',e=>{
  mouse={x:e.clientX/W,y:e.clientY/H};moveTip(e);
  if(dragN){const p=worldPos(e);
    dragN.x=p.x;dragN.y=p.y;dragN.vx=dragN.vy=0;dragN.pin=true;
    dragN.ax=dragN.x;dragN.ay=dragN.y;return}
  if(panDrag){                                   // 拖动画布（平移视角）
    CAM.x=panDrag.cx+(e.clientX-panDrag.sx);
    CAM.y=panDrag.cy+(e.clientY-panDrag.sy);
    if(Math.hypot(e.clientX-panDrag.sx,e.clientY-panDrag.sy)>4)panDrag.moved=true;
    return;
  }
  const p=worldPos(e);
  let best=null,bd=1e9;
  for(const n of nodes){const d=Math.hypot(n.x-p.x,n.y-p.y);if(d<=n.R+9&&d<bd){best=n;bd=d}}
  if(best){
    setHover({kind:best.kind,id:best.id});
  }else{
    const l=pickLink(p.x,p.y);   // 没命中节点时，再看是否压在某条连线上
    setHover(l?{kind:'link',id:linkKey(l)}:null);
  }
});
gC.addEventListener('pointerdown',e=>{
  const p=worldPos(e);
  downPos={x:e.clientX,y:e.clientY};downT=performance.now();
  for(const n of nodes){if(Math.hypot(n.x-p.x,n.y-p.y)<=n.R+9){dragN=n;break}}
  if(!dragN){                                    // 空白处按下 → 准备拖画布
    panDrag={sx:e.clientX,sy:e.clientY,cx:CAM.x,cy:CAM.y,moved:false};
    gC.style.cursor='grabbing';
  }
});
gC.addEventListener('pointerup',e=>{
  if(dragN){dragN.pin=false;dragN.ax=dragN.x;dragN.ay=dragN.y}
  const moved=downPos?Math.hypot(e.clientX-downPos.x,e.clientY-downPos.y):99;
  const quick=performance.now()-downT<600;
  dragN=null;
  const panned=panDrag&&panDrag.moved;
  panDrag=null;gC.style.cursor='default';
  if(moved<6&&quick&&!panned){
    const p=worldPos(e);
    let best=null,bd=1e9;
    for(const n of nodes){
      const d=Math.hypot(n.x-p.x,n.y-p.y);
      if(d<=n.R+9&&d<bd){best=n;bd=d}
    }
    if(!best){
      if(S.view==='detail')goBack();               // 点空白 → 回主视图
    }else if(S.view==='l1'){
      // L1：支出品类与收入类目都能下钻（结构完全一致，差别只在节点样式）
      if(best.kind==='cat'||best.kind==='inc')enterDetail(best.id);
    }else{
      // L3 下钻内：花销→编辑该笔；细分→该细分明细；类目→本类明细
      if(best.kind==='exp')openExpenseEditor(best.ref);
      else if(best.kind==='sub')openExpenseList({tagId:best.tagId,name:best.ref.name});
      else if(best.kind==='cat'||best.kind==='inc')openExpenseList(best.ref);
    }
  }
});
gC.addEventListener('pointerleave',()=>{setHover(null);dragN=null;panDrag=null;gC.style.cursor='default'});
// 滚轮缩放星轨粒度（需求基线 §5.4「四路联动」之一：滚轮 / 竖滑块 / 星轨点击 / 回到今天）
gC.addEventListener('wheel',e=>{e.preventDefault();wheelZoom(e.deltaY)},{passive:false});

/* 星轨：左右拖拽看时间，点击选中 */
let oDrag=null;
oC.addEventListener('pointerdown',e=>{
  oDrag={x:e.clientX,y:e.clientY,pan:TL.pan,moved:false};
  oC.setPointerCapture&&oC.setPointerCapture(e.pointerId);
});
oC.addEventListener('pointermove',e=>{
  const r=oC.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  if(oDrag){
    const dx=e.clientX-oDrag.x;
    if(Math.abs(dx)>4)oDrag.moved=true;
    if(oDrag.moved){
      // 左右拖动 = 沿统一时间轴平移视口：像素位移 ÷ 当前档位的「像素/天」＝ 天数。
      // 平移量在 viewOf 内部按数据范围 clamp，不会拖到无数据的地方。
      const p=viewOf(r.width).p;
      TL.pan=(oDrag.pan||0)-dx/p;
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
  const tag=CATS.concat(CTXS,INCOMES).find(c=>c.id===id);   // 收入类目也能下钻
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
  resetView();   // 换视图：视角归位，平移状态不跨视图沿用
  // 分类上下文放在返回按钮上（画布中央刻意不画主 tag，避免冗余节点）
  const tot=detailExpenses.reduce((s,e)=>s+e.amount_cents,0);
  $('#btnBack').textContent='← '+tag.name+(detailExpenses.length?(' · ¥'+(tot/100).toLocaleString()):'');
  $('#btnBack').hidden=false;
  buildGraph();syncChrome();
  toast('下钻 · '+tag.name+'（'+detailExpenses.length+' 笔）');
}
function goBack(){
  if(S.view!=='detail')return;
  S.view='l1';S.focus=null;detailExpenses=[];detailTag=null;
  resetView();
  $('#btnBack').textContent='← 主视图';
  $('#btnBack').hidden=true;buildGraph();syncChrome();
}
$('#btnBack').onclick=goBack;

/* ===== 花销明细浮层（删花销 / 删 tag） ===== */
const expMask=$('#expMask');
let expCtx=null; // {tagId, dimKey, name}
/** 打开花销明细浮层：某 tag（主 tag 或它的副 tag）在当月的逐笔花销 + 编辑/删除 */
async function openExpenseList(tag){
  // 收入类目也按「主 tag」处理（它不在 CATS 里，因为 CATS 只留支出品类）
  const isMain=CATS.some(c=>c.tagId===tag.tagId)||CTXS.some(c=>c.tagId===tag.tagId)
             ||INCOMES.some(c=>c.tagId===tag.tagId);
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
  const w=Data&&Data._window;
  const lv=(w&&w.kind)||'month';
  // 笔数：Data.days 为有支出的天数，笔数保守估算；总额必须真实
  let nExp=1;
  try{
    if(Data&&Data.days&&Data.days.length)nExp=Math.max(Data.days.length,1);
    else nExp=Math.max(1,Math.round(tot/58));
  }catch(e){nExp=Math.max(1,Math.round(tot/58))}
  $('#mtLabel').textContent=`${selLabel()} · 共 ${nExp} 笔`;
  animateNum($('#mtValue'),tot,v=>'¥'+Math.round(v).toLocaleString());
  animateNum($('#pNum'),tot,v=>'¥'+Math.round(v).toLocaleString());
  // 日均按当前窗口天数算（日档 1 天、年档 365 天、其余按 30 天）
  const span=lv==='day'?1:(lv==='year'?365:30);
  $('#pCount').textContent=`${nExp} 笔 · 日均 ¥${Math.round(tot/span)}`;
  const pv=prevTotal(),d=pv>0?(tot-pv)/pv*100:0;
  $('#pDelta').textContent=(lv==='year')
    ?'年度合计'                                        // 年环比需跨年全量，暂不显示
    :`${d>=0?'▲':'▼'} ${Math.abs(d).toFixed(1)}% vs ${lv==='day'?'前一日':'上期'}`;
  $('#tlTip').textContent='星轨 · '+LV_NAME[domLevel()]+'视图（点击星星切换'+(lv==='day'?'日期':lv==='year'?'年份':'月份')+'，滚轮或右轨缩放）';
  // 底部操作提示随视图切换（下钻视图的可用操作与 L1 不同）
  const hintEl=document.querySelector('.hint');
  if(hintEl){
    hintEl.textContent=(S.view==='detail')
      ?'拖空白平移画面 · 点花销星编辑该笔 · 点细分星看明细 · 轻点空白返回主视图'
      :'拖拽星体 · 拖空白平移画面 · 悬停看关联 · 点击星星下钻 · 滚轮缩放星轨';
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
    // 换账本后回到月档：新账本的时间跨度/数据都变了，沿用旧档位容易与选中项对不上
    TL.z=1;TL.pan=0;appliedLevel='month';
    resetView();
    TL.sel={level:'month',idx:ni>=0?ni:TODAY};
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
  if(S.view==='detail'){S.view='l1';S.focus=null;detailExpenses=[];detailTag=null;resetView()}
  $('#btnBack').textContent='← 主视图';
  $('#btnBack').hidden=true;
  refreshAmounts();buildGraph();syncChrome();
  toast(v==='category'?'维度 · 品类（这是什么钱）':'维度 · 情境（和谁 / 什么场景）')});
/** 「回到今天」按当前档位落地：日→今天那天 / 月→最新月 / 年→最新年 */
$('#btnToday').onclick=async ()=>{
  const lv=domLevel();
  if(lv==='day'){
    const t=new Date().toISOString().slice(0,10);
    const i=DAYS.findIndex(d=>d.date===t);
    TL.sel={level:'day',idx:i>=0?i:DAY_TODAY};
  }else if(lv==='year'){
    TL.sel={level:'year',idx:Math.max(0,YEARS.length-1)};
  }else{
    TL.sel={level:'month',idx:TODAY};
  }
  TL.pan=0;
  await syncWindowToSel();
  toast('回到今天');
};

/* ---------- 右侧刻度轨：拖动连续跟手，松手吸附到最近档 ---------- */
const rail=$('#rail'),handle=$('#railHandle');
function syncRail(){
  if(!handle||!rail)return;
  const r=rail.getBoundingClientRect();
  const h=r.height||1;
  handle.style.top=clamp(6+TL.z/2*(h-12),4,h-4)+'px';   // 跟手：变焦量连续，手柄就连续
}
let railDrag=false;
function railSet(e){
  if(!rail)return;
  const r=rail.getBoundingClientRect();
  const t=clamp((e.clientY-r.top)/Math.max(1,r.height),0,1);
  zoomAnim=null;
  TL.z=t*2;                       // 连续跟手（不在这里 round）
  syncRail();
  applyLevelChange(true);         // 跨档时才真正换数据（静默）
}
if(rail){
  rail.addEventListener('pointerdown',e=>{railDrag=true;rail.setPointerCapture(e.pointerId);railSet(e)});
  rail.addEventListener('pointermove',e=>{if(railDrag)railSet(e)});
  rail.addEventListener('pointerup',()=>{
    if(!railDrag)return;
    railDrag=false;
    snapZoom();     // 松手吸附到最近档：不停在中间
  });
}
// 刻度轨与星轨上也能滚轮缩放（与图谱区一致）
for(const el of [$('#railWrap'),$('#orbit')]){
  if(el)el.addEventListener('wheel',e=>{e.preventDefault();wheelZoom(e.deltaY)},{passive:false});
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
  tickZoomAnim(now);   // 吸附动画（松手后把变焦量平滑收进最近档）
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
    refreshDays();refreshMonths();refreshAmounts();
  }
  TODAY=Math.max(0,MONTHS.length-1);
  const ni=MONTHS.findIndex(m=>m.y===Data._currentMonthY&&m.m===Data._currentMonthM);
  TL.sel={level:'month',idx:ni>=0?ni:TODAY};
  TL.z=1;TL.pan=0;   // 默认月档（需求基线 §5.4：启动默认月视图）
  renderLedgerDD();
  buildGraph();syncChrome();syncRail&&syncRail();
  requestAnimationFrame(frame);
  toast('欢迎来到 Orbit 星账 · 真实数据已加载');
}
boot();
