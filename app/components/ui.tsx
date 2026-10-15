"use client";

import { useEffect, useRef } from "react";
import { X, Plus, ArrowUpRight } from "lucide-react";

export type Field = {
  name: string; label: string; type?: string; value?: string | number | boolean;
  required?: boolean; min?: number; max?: number; step?: number; hint?: string;
  options?: { value: string; label: string }[]; placeholder?: string;
};

export function Dialog({title,subtitle,children,onClose}: {title:string; subtitle?:string; children:React.ReactNode; onClose:()=>void}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    function key(e: KeyboardEvent) { if(e.key === "Escape") onClose(); if(e.key === "Tab") {const nodes=ref.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]'); if(!nodes?.length)return; const first=nodes[0],last=nodes[nodes.length-1]; if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}} }
    document.addEventListener("keydown",key); const scroll=document.body.style.overflow; document.body.style.overflow="hidden";
    return () => {document.removeEventListener("keydown",key); document.body.style.overflow=scroll; before?.focus();};
  },[onClose]);
  return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="dialog-head"><div><p className="eyebrow">PERSONAL WORKSPACE</p><h2>{title}</h2>{subtitle&&<p className="muted">{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>{children}</div></div>;
}

export function Editor({title,subtitle,fields,onSave,onClose,children}: {title:string;subtitle?:string;fields:Field[];onSave:(form:FormData)=>void;onClose:()=>void;children?:React.ReactNode}) {
  return <Dialog title={title} subtitle={subtitle} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSave(new FormData(e.currentTarget));}}><div className="form-grid">{fields.map(f=><label className={`field ${f.type==="textarea"?"full":""}`} key={f.name}><span>{f.label}{f.required&&<i> *</i>}</span>{f.options?<select name={f.name} defaultValue={String(f.value??"")} required={f.required}>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==="textarea"?<textarea name={f.name} defaultValue={String(f.value??"")} placeholder={f.placeholder} required={f.required} maxLength={2000}/>:f.type==="checkbox"?<input type="checkbox" name={f.name} defaultChecked={Boolean(f.value)}/>:<input type={f.type??"text"} name={f.name} defaultValue={String(f.value??"")} required={f.required} min={f.min} max={f.max} step={f.step} placeholder={f.placeholder} maxLength={f.type==="text"||!f.type?200:undefined}/>} {f.hint&&<small>{f.hint}</small>}</label>)}</div>{children}<div className="dialog-footer"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button" type="submit">保存到工作区 <ArrowUpRight size={15}/></button></div></form></Dialog>;
}

export function Empty({title,text,onAction,label="添加第一条"}: {title:string;text:string;onAction?:()=>void;label?:string}) {
  return <div className="empty-state"><div className="empty-mark">＋</div><h3>{title}</h3><p>{text}</p>{onAction&&<button className="button secondary small" onClick={onAction}><Plus size={14}/>{label}</button>}</div>;
}

export function SectionHead({kicker,title,description,action}: {kicker?:string;title:string;description?:string;action?:React.ReactNode}) {
 return <div className="section-head"><div>{kicker&&<p className="eyebrow">{kicker}</p>}<h2>{title}</h2>{description&&<p className="muted">{description}</p>}</div>{action}</div>;
}

export function Pill({children,tone="neutral"}:{children:React.ReactNode;tone?:"neutral"|"green"|"orange"|"red"}){return <span className={`pill ${tone}`}>{children}</span>;}

export function money(value:number){return new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY",maximumFractionDigits:0}).format(value);}
export function hours(minutes:number){return `${Number((minutes/60).toFixed(1))} 小时`;}
