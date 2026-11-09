/* Reads spreadsheet text only. No formulas, macros or external links are executed. */
importScripts('./xlsx.full.min.js');
self.onmessage=event=>{
 try{
  const {bytes,extension}=event.data;
  let input=bytes,type='array';
  if(extension==='csv'){try{input=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{input=new TextDecoder('gb18030').decode(bytes);}type='string';}
  const book=XLSX.read(input,{type,raw:extension==='csv',cellFormula:true,cellText:true,sheetRows:2001});
  if(book.SheetNames.length>20)throw Error('Excel超过20个工作表，请拆分后上传');
  const sections=[],warnings=[];let total=0;
  for(const name of book.SheetNames){const sheet=book.Sheets[name];if(!sheet?.['!ref'])continue;
   const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
   if(range.e.r-range.s.r>=2000||range.e.c>=100)throw Error('工作表“'+name+'”超过2000行或100列，请缩小范围后上传');
   const hidden=book.Workbook?.Sheets?.find(s=>s.name===name)?.Hidden;
   const rows=[];
   for(let r=range.s.r;r<=range.e.r;r++){const cells=[];for(let c=range.s.c;c<=range.e.c;c++){const address=XLSX.utils.encode_cell({r,c}),cell=sheet[address];if(!cell)continue;if(++total>20000)throw Error('Excel非空单元格超过20000个，请拆分后上传');let value=cell.w??(cell.v===undefined?'':String(cell.v));
     if(cell.f){if(cell.v===undefined){value='[公式 '+cell.f+'；无已保存结果]';warnings.push('部分公式没有已保存计算结果，请先用Excel计算并保存后再上传');}else warnings.push('公式读取文件中已保存的结果，未重新计算');}
     if(String(value).trim())cells.push(address+'='+String(value));
    }if(cells.length)rows.push(cells.join(' | '));}
   if(rows.length)sections.push({label:'工作表 '+name+(hidden?'（隐藏表）':''),text:rows.join('\n'),sheet:name,merges:(sheet['!merges']||[]).map(m=>XLSX.utils.encode_range(m))});
  }
  const text=sections.map(s=>'【'+s.label+'】\n'+(s.merges.length?'合并单元格：'+s.merges.join('、')+'\n':'')+s.text).join('\n\n');
  if(!text.trim())throw Error('表格没有可读取的单元格文字');
  if(text.length>20000)throw Error('表格提取内容超过20000字，请拆分或保留需要审查的工作表后上传');
  self.postMessage({text,sections,warnings:[...new Set(warnings)],sheets:sections.length});
 }catch(e){self.postMessage({error:e.message||'Excel读取失败，请检查文件是否加密或损坏'});}
};
