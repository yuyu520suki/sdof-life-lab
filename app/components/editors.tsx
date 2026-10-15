"use client";
import type { WorkspaceData, Person, ActionRequest, ProtectedEvent, Expense, DayEntry, TemplateBlock, TimeWindow } from "@/lib/domain";
import { addDays, formatMinute, parseMinute, todayInShanghai, weekday } from "@/lib/time";
import { Editor, type Field } from "./ui";

export type UpdateData = (change:(data:WorkspaceData)=>void)=>boolean;
export type EditorTarget = {kind:"person";value?:Person}|{kind:"action";value?:ActionRequest}|{kind:"event";value?:ProtectedEvent}|{kind:"expense";value?:Expense;sourceId?:string}|{kind:"day";date:string}|{kind:"settings"}|{kind:"template";weekday:1|2|3|4|5|6|7}|{kind:"window";weekday:1|2|3|4|5|6|7}|{kind:"block";weekday:1|2|3|4|5|6|7;index?:number};
export const blockLabels = {research:"科研",course:"课程",sleep:"睡眠",rest:"休息",meeting:"会议",other:"其他"};
export const actionLabels = {reply:"回复",greet:"问候",invite:"邀约",coordinate:"协调",other:"其他"};
export const statusLabels = {confirmed:"已确认",pending:"待确认",cancelled:"已取消"};
const uuid=()=>crypto.randomUUID();
const str=(form:FormData,key:string)=>String(form.get(key)??"").trim();
const num=(form:FormData,key:string)=>Number(str(form,key));
const optional=(form:FormData,key:string)=>str(form,key)===""?null:num(form,key);
const cents=(form:FormData,key:string)=>Math.round(num(form,key)*100);
function time(form:FormData,key:string){const parsed=parseMinute(str(form,key));if(parsed===null)throw new Error("时间无效，请填写 HH:mm。");return parsed;}
function parseWindows(text:string):TimeWindow[]{if(!text.trim())return [];return text.split(/\n|，|,/).filter(x=>x.trim()).map(line=>{const match=line.trim().match(/^(\d{2}:\d{2})\s*[-—~～]\s*(\d{2}:\d{2})$/);if(!match)throw new Error("时间窗口请按 09:00-12:00 填写，每行一个。");const start=parseMinute(match[1]),end=parseMinute(match[2]);if(start===null||end===null||start>=end)throw new Error("结束时间必须晚于开始时间，跨午夜请拆成两段。");return {start,end};});}
function actionWindows(text:string){if(!text.trim())return [];return text.split(/\n/).filter(x=>x.trim()).map(line=>{const m=line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}\s*[-—~～]\s*\d{2}:\d{2})$/);if(!m)throw new Error("日期窗口请按 2026-10-15 09:00-12:00 填写，每行一个。");return {date:m[1],...parseWindows(m[2])[0]};});}
const windowString=(windows:TimeWindow[])=>windows.map(w=>`${formatMinute(w.start)}-${formatMinute(w.end)}`).join("\n");
const kindOptions=Object.entries(blockLabels).map(([value,label])=>({value,label}));

export default function DataEditor({target,data,update,onClose,onError}:{target:EditorTarget;data:WorkspaceData;update:UpdateData;onClose:()=>void;onError:(message:string)=>void}){
 const people=[{value:"",label:"不关联对象"},...data.people.map(p=>({value:p.id,label:`${p.name}${p.status==="paused"?" · 已暂停":""}`}))];
 let title="",subtitle="",fields:Field[]=[],save:(form:FormData)=>boolean;
 if(target.kind==="person"){
  const p=target.value;title=p?"编辑匿名对象":"添加匿名对象";subtitle="使用代称即可。只记录你自己的感受与实际发生的事。";
  fields=[{name:"name",label:"代称",required:true,value:p?.name,placeholder:"例如：A / 朋友甲"},{name:"status",label:"状态",value:p?.status??"active",options:[{value:"active",label:"正常安排"},{value:"paused",label:"暂停安排"}]},{name:"note",label:"我的备注",type:"textarea",value:p?.note,placeholder:"例如：我更喜欢周末见面"}];
  save=f=>update(d=>{const item:Person={id:p?.id??uuid(),name:str(f,"name"),status:str(f,"status") as Person["status"],note:str(f,"note")};d.people=p?d.people.map(x=>x.id===p.id?item:x):[...d.people,item];});
 }else if(target.kind==="action"){
  const a=target.value;title=a?"编辑待办":"添加可安排的待办";subtitle="这是一项你愿意做的事。尚未确认的邀约会保留为候选。";
  fields=[{name:"title",label:"待办内容",required:true,value:a?.title,placeholder:"例如：整理组会材料"},{name:"kind",label:"类型",value:a?.kind??"other",options:Object.entries(actionLabels).map(([value,label])=>({value,label}))},{name:"personId",label:"关联对象",value:a?.personId??"",options:people},{name:"priority",label:"优先级",value:a?.priority??2,options:[{value:"3",label:"高"},{value:"2",label:"中"},{value:"1",label:"低"}]},{name:"durationMin",label:"耗时（分钟）",type:"number",required:true,min:1,max:1440,value:a?.durationMin??30},{name:"cost",label:"预计费用（元）",type:"number",min:0,max:10000000,step:.01,required:true,value:(a?.costCents??0)/100},{name:"status",label:"状态",value:a?.status??"open",options:[{value:"open",label:"等待安排"},{value:"done",label:"已经完成"},{value:"cancelled",label:"已取消"}]},{name:"windows",label:"允许的日期与时间",type:"textarea",value:a?.windows.map(w=>`${w.date} ${formatMinute(w.start)}-${formatMinute(w.end)}`).join("\n"),placeholder:`${addDays(todayInShanghai(),1)} 09:00-18:00`,hint:"每行一个日期窗口；留空表示使用七日内的可用窗口。"}];
  save=f=>{const windows=actionWindows(str(f,"windows"));return update(d=>{const item:ActionRequest={id:a?.id??uuid(),title:str(f,"title"),kind:str(f,"kind") as ActionRequest["kind"],personId:str(f,"personId")||null,priority:num(f,"priority") as 1|2|3,durationMin:num(f,"durationMin"),costCents:cents(f,"cost"),status:str(f,"status") as ActionRequest["status"],windows};d.actions=a?d.actions.map(x=>x.id===a.id?item:x):[...d.actions,item];});};
 }else if(target.kind==="event"){
  const e=target.value;title=e?"编辑固定事项":"添加固定事项";subtitle="已确认的承诺和固定安排会锁定；待确认事项单独提示，取消后不再占用。";
  fields=[{name:"title",label:"事项名称",required:true,value:e?.title},{name:"date",label:"日期",type:"date",required:true,value:e?.date??todayInShanghai()},{name:"kind",label:"类型",value:e?.kind??"meeting",options:kindOptions},{name:"personId",label:"关联对象",value:e?.personId??"",options:people},{name:"start",label:"开始时间",type:"text",required:true,value:formatMinute(e?.start??540),placeholder:"09:00"},{name:"end",label:"结束时间",type:"text",required:true,value:formatMinute(e?.end??600),placeholder:"10:00（跨午夜请拆分）"},{name:"confirmation",label:"确认状态",value:e?.confirmation??"pending",options:Object.entries(statusLabels).map(([value,label])=>({value,label}))},{name:"cost",label:"预计费用（元）",type:"number",min:0,step:.01,required:true,value:(e?.costCents??0)/100}];
  save=f=>{const start=time(f,"start"),end=time(f,"end");return update(d=>{const item:ProtectedEvent={id:e?.id??uuid(),date:str(f,"date"),title:str(f,"title"),kind:str(f,"kind") as ProtectedEvent["kind"],personId:str(f,"personId")||null,start,end,confirmation:str(f,"confirmation") as ProtectedEvent["confirmation"],costCents:cents(f,"cost")};d.events=e?d.events.map(x=>x.id===e.id?item:x):[...d.events,item];});};
 }else if(target.kind==="expense"){
  const e=target.value;title=e?"编辑实际支出":"记一笔实际支出";subtitle="关联相应待办或事项后，实际支出会替代预计费用，避免重复计费。";
  const sources=[{value:"",label:"独立支出（不关联）"},...data.actions.map(a=>({value:a.id,label:`待办 · ${a.title}`})),...data.events.map(e=>({value:e.id,label:`事项 · ${e.title}`}))];
  fields=[{name:"date",label:"支出日期",type:"date",required:true,value:e?.date??todayInShanghai()},{name:"cost",label:"实际金额（元）",type:"number",required:true,min:0,step:.01,value:e?e.cents/100:""},{name:"sourceId",label:"关联待办 / 事项",value:e?.sourceId??target.sourceId??"",options:sources},{name:"note",label:"备注",type:"textarea",value:e?.note,placeholder:"例如：交通费与餐费"}];
  save=f=>update(d=>{const item:Expense={id:e?.id??uuid(),date:str(f,"date"),cents:cents(f,"cost"),sourceId:str(f,"sourceId")||null,note:str(f,"note")};d.expenses=e?d.expenses.map(x=>x.id===e.id?item:x):[...d.expenses,item];});
 }else if(target.kind==="day"){
  const old=data.days.find(d=>d.date===target.date);title=`${target.date} · 每日记录`;subtitle="未知的事实请保留“未记录”，不会被统计为“没有互动”。";
  fields=[{name:"energy",label:"今日精力（0–10）",type:"number",min:0,max:10,value:old?.energy??"",hint:"留空表示尚未记录，不代入平均值。"},{name:"windowMode",label:"当天可用窗口",value:old?.availableWindows===null?"unknown":old?.availableWindows===undefined?"inherit":"override",options:[{value:"inherit",label:"复制周模板窗口"},{value:"override",label:"自定义当天窗口"},{value:"unknown",label:"未知，暂不排程"}]},{name:"windows",label:"覆盖时间窗口",type:"textarea",value:old?.availableWindows?windowString(old.availableWindows):"",placeholder:"09:00-12:00\n14:00-18:00",hint:"仅自定义模式生效；留空表示全天不可安排。复制模式保存为当天快照。"},{name:"note",label:"当天备注",type:"textarea",value:old?.note}];
  data.people.forEach(p=>{const fact=old?.facts.find(f=>f.personId===p.id);fields.push({name:`contact:${p.id}`,label:`${p.name} · 实际互动`,value:fact?.contact??"",options:[{value:"",label:"未记录 / 未知"},{value:"none",label:"明确没有互动"},{value:"inbound",label:"对方主动联系"},{value:"outbound",label:"我主动联系"},{value:"both",label:"双方都有主动联系"}]},{name:`interest:${p.id}`,label:`${p.name} · 我的意愿（0–5）`,type:"number",min:0,max:5,value:fact?.myInterest??""},{name:`comfort:${p.id}`,label:`${p.name} · 我的舒适度（0–5）`,type:"number",min:0,max:5,value:fact?.myComfort??""},{name:`note:${p.id}`,label:`${p.name} · 事实与感受备注`,type:"textarea",value:fact?.note??""});});
  save=f=>{const mode=str(f,"windowMode");const windows=mode==="unknown"?null:mode==="inherit"?(data.settings.weeklyTemplate.find(t=>t.weekday===weekday(target.date))?.windows.map(w=>({...w}))??null):parseWindows(str(f,"windows"));return update(d=>{const item:DayEntry={date:target.date,energy:optional(f,"energy"),availableWindows:windows,note:str(f,"note"),facts:d.people.map(p=>({personId:p.id,contact:(str(f,`contact:${p.id}`)||null) as DayEntry["facts"][number]["contact"],myInterest:optional(f,`interest:${p.id}`),myComfort:optional(f,`comfort:${p.id}`),note:str(f,`note:${p.id}`)}))};d.days=d.days.filter(x=>x.date!==target.date).concat(item).sort((a,b)=>a.date.localeCompare(b.date));});};
 }else if(target.kind==="settings"){
  title="设置每天的底线";subtitle="底线是约束，不是绩效目标。填写适合你的最低值。";
  fields=[{name:"research",label:"每天科研底线（分钟）",type:"number",required:true,min:0,max:1440,value:data.settings.researchMinPerDay??"",hint:"明确填 0 可取消该底线。"},{name:"rest",label:"每天休息底线（分钟）",type:"number",required:true,min:0,max:1440,value:data.settings.restMinPerDay??"",hint:"按周模板与已确认休息安排核算。"},{name:"budget",label:"每周预算（元）",type:"number",required:true,min:0,max:10000000,step:.01,value:data.settings.weeklyBudgetCents===null?"":data.settings.weeklyBudgetCents/100,hint:"预算按自然周核算，包含实际及预计费用。"}];
  save=f=>update(d=>{d.settings.researchMinPerDay=num(f,"research");d.settings.restMinPerDay=num(f,"rest");d.settings.weeklyBudgetCents=cents(f,"budget");});
 }else if(target.kind==="template"||target.kind==="window"){
  const template=data.settings.weeklyTemplate.find(t=>t.weekday===target.weekday);title=`星期${"一二三四五六日"[target.weekday-1]} · 可用时间`;subtitle="这些窗口可用于安排候选行动，固定事项会另行扣除。";
  fields=[{name:"windows",label:"可用时间窗口",type:"textarea",value:template?windowString(template.windows):"",placeholder:"09:00-12:00\n14:00-18:00",hint:"每行一个，结束可写 24:00。留空代表这一天没有可用时间。"}];
  save=f=>{const windows=parseWindows(str(f,"windows"));return update(d=>{const t=d.settings.weeklyTemplate.find(t=>t.weekday===target.weekday);if(t)t.windows=windows;else d.settings.weeklyTemplate.push({weekday:target.weekday,windows,blocks:[]});});};
 }else{
  const b=target.index===undefined?undefined:data.settings.weeklyTemplate.find(t=>t.weekday===target.weekday)?.blocks[target.index];title=b?"编辑每周固定时间块":"添加每周固定时间块";subtitle="模板时间块将用于每周相同星期，跨午夜请分别填在两天。";
  fields=[{name:"title",label:"时间块名称",required:true,value:b?.title,placeholder:"例如：专注科研"},{name:"kind",label:"类型",value:b?.kind??"research",options:kindOptions},{name:"start",label:"开始时间",required:true,value:formatMinute(b?.start??540),placeholder:"09:00"},{name:"end",label:"结束时间",required:true,value:formatMinute(b?.end??660),placeholder:"11:00"}];
  save=f=>{const start=time(f,"start"),end=time(f,"end");return update(d=>{let t=d.settings.weeklyTemplate.find(t=>t.weekday===target.weekday);if(!t){t={weekday:target.weekday,windows:[],blocks:[]};d.settings.weeklyTemplate.push(t);}const block:TemplateBlock={title:str(f,"title"),kind:str(f,"kind") as TemplateBlock["kind"],start,end};if(target.index===undefined)t.blocks.push(block);else t.blocks[target.index]=block;});};
 }
 return <Editor title={title} subtitle={subtitle} fields={fields} onClose={onClose} onSave={form=>{try{if(save(form))onClose();}catch(error){onError(error instanceof Error?error.message:"请检查输入");}}}/>;
}




