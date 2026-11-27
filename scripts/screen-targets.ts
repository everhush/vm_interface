/** Find a unique exact visible OCR label in real screenshot coordinates. */
import {execFileSync} from "node:child_process";
import {openSync,readSync,closeSync} from "node:fs";
import assert from "node:assert/strict";
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
export function parseTarget(tsv:string,label:string,width:number,height:number){
 const expected=norm(label);assert(expected&&width>=1&&width<=1920&&height>=1&&height<=1200,"Unsupported label or screenshot dimensions");
 const [header,...lines]=tsv.trimEnd().split(/\r?\n/),names=header.split("\t");
 assert(["level","page_num","block_num","par_num","line_num","left","top","width","height","conf","text"].every(x=>names.includes(x)),"Invalid OCR TSV");
 const groups=new Map<string,Record<string,string>[]>();
 for(const line of lines){const fields=line.split("\t"),row=Object.fromEntries(names.map((n,i)=>[n,fields[i]??""]));if(row.level!=="5"||!row.text.trim())continue;const key=[row.page_num,row.block_num,row.par_num,row.line_num].join(":");const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
 const matches:[number,number][]=[];
 for(const rows of groups.values()){
  if(norm(rows.map(r=>r.text).join(" "))!==expected||rows.some(r=>!Number.isFinite(Number(r.conf))||Number(r.conf)<55))continue;
  const left=Math.min(...rows.map(r=>Number(r.left))),top=Math.min(...rows.map(r=>Number(r.top))),right=Math.max(...rows.map(r=>Number(r.left)+Number(r.width))),bottom=Math.max(...rows.map(r=>Number(r.top)+Number(r.height)));
  assert([left,top,right,bottom].every(Number.isInteger)&&0<=left&&left<right&&right<=width&&0<=top&&top<bottom&&bottom<=height,"OCR target outside display");
  matches.push([Math.floor((left+right)/2),Math.floor((top+bottom)/2)]);
 }
 return matches.length===1?matches[0]:null;
}
export function locateLabel(path:string,label:string){
 const fd=openSync(path,"r"),head=Buffer.alloc(24);try{assert(readSync(fd,head,0,24,0)===24,"Invalid screenshot");}finally{closeSync(fd);}
 assert(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&head.subarray(12,16).toString()==="IHDR","Invalid screenshot");
 const tsv=execFileSync("tesseract",[path,"stdout","--psm","11","tsv"],{encoding:"utf8",timeout:15000,stdio:["ignore","pipe","ignore"]});
 return parseTarget(tsv,label,head.readUInt32BE(16),head.readUInt32BE(20));
}
