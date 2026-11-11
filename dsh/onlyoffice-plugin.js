import {pluginRelayPage} from './onlyoffice-relay.js';
import {readFileSync} from 'node:fs';
export const pluginSDK=readFileSync(new URL('../public/real-files/onlyoffice-plugins.js',import.meta.url),'utf8');
export const officePluginGuid='asc.{B2211DCF-C3E4-4EF0-A61D-01D5C3030061}';
export function pluginConfig(root,channel,parentOrigin,key){
 const query=new URLSearchParams({channel,parentOrigin,key});
 return {name:'合同审查联动',guid:officePluginGuid,baseUrl:root+'/',variations:[{description:'定位原文与应用审查建议',url:'index.html?'+query+'&runtime=1',icons:[],isSystem:true,isVisual:false,isViewer:false,EditorsSupport:['word'],initDataType:'none',initData:'',buttons:[]}]};
}
export const pluginPage=editor=>pluginRelayPage(editor,officePluginGuid);
export const pluginRuntimePage=()=>`<!doctype html><meta charset="utf-8"><script>${pluginSDK}</script><script>${pluginScript}</script>`;
export const pluginScript=String.raw`
(function(){
 'use strict';
 document.documentElement.setAttribute('data-dsh-plugin','loaded');
 var params=new URLSearchParams(location.search),channel=params.get('channel'),relayOrigin=params.get('relayOrigin'),origin=relayOrigin||params.get('parentOrigin'),key=params.get('key');
 if(!/^[a-f0-9]{48}$/.test(channel||'')||!origin||!key){document.documentElement.setAttribute('data-dsh-plugin','invalid-parameters');return;}
 if(relayOrigin){try{var relayURL=new URL(relayOrigin);if(!['http:','https:'].includes(relayURL.protocol)||relayURL.origin!==new URL(location.href).origin||relayURL.href!==relayURL.origin+'/')return;}catch{return;}}
 document.documentElement.setAttribute('data-dsh-plugin','configured');
 var host=relayOrigin?window.parent:window.parent.parent,busy=false,readyPulse=null;
 function send(message){host.postMessage(Object.assign({source:'dsh-onlyoffice-plugin',channel:channel,key:key},message),origin==='dsh-desktop://harness'?'*':origin)}
 function comparableHTML(value){return typeof value==='string'?value.replace(/ class="docData;[^"]*"/g,''):JSON.stringify(value);}
 var undoRecord=null;
 function finishRequest(request,result){
   if(request.__beforeHTML&&result&&result.ok&&['replace','formatBold','append','replaceSelection','insertSelection'].indexOf(request.action)>=0){
     Asc.plugin.executeMethod('GetFileHTML',[],function(after){
       undoRecord={id:request.id,before:request.__beforeHTML,after:after};
       result.operation=result.operation||{};result.operation.nativeUndoId=request.id;
       busy=false;send({type:'result',id:request.id,result:result});
     });return;
   }
   busy=false;send({type:'result',id:request.id,result:result||{ok:false,error:'编辑器没有返回操作结果'}});
 }
 function command(request){
   if(request.action==='undo'){
     var saved=undoRecord;
     if(!saved||request.operation?.nativeUndoId!==saved.id){finishRequest(request,{ok:false,error:'只能撤销最近一次工作台修改；旧记录请使用 Word 审阅，未执行反向替换。'});return;}
     Asc.plugin.executeMethod('GetFileHTML',[],function(current){
       if(comparableHTML(current)!==comparableHTML(saved.after)){finishRequest(request,{ok:false,error:'修改后正文或格式已有变化，未撤销其他操作；请使用 Word 撤销。'});return;}
       Asc.plugin.executeMethod('Undo',[],function(){Asc.plugin.executeMethod('GetFileHTML',[],function(restored){
         undoRecord=null;
         finishRequest(request,comparableHTML(restored)===comparableHTML(saved.before)?{ok:true,restored:true}:{ok:false,error:'撤销后未通过原状态核对，请在编辑器中检查；未执行反向替换。'});
       });});
     });return;
   }
   if(['replace','formatBold','append','replaceSelection','insertSelection'].indexOf(request.action)>=0&&!request.__captured){
     request.__captured=true;Asc.plugin.executeMethod('GetFileHTML',[],function(before){request.__beforeHTML=before;command(request);});return;
   }

   if(request.action==='download'){Asc.plugin.executeMethod('GetFileToDownload',['docx'],function(url){busy=false;send({type:'result',id:request.id,result:typeof url==='string'&&url?{ok:true,url:url}:{ok:false,error:'编辑器没有返回当前Word文件'}})});return;}

   Asc.scope.dshRequest=request;
   Asc.plugin.callCommand(function(){
     try{
       var input=Asc.scope.dshRequest,doc=Api.GetDocument();
       if(input.action==='read')return {ok:true,text:doc.GetText()};
       function appendLines(text){
         return text.trim().split(/\r\n|\r|\n/).filter(function(line){return line.trim();});
       }
       function isAppendParagraph(element,line){
         return element&&element.GetClassType()==='paragraph'&&element.GetText().replace(/\r?\n$/,'')===line;
       }
       if(input.action==='append'){
         var addition=typeof input.text==='string'?input.text.trim():'';
         if(!addition||addition.length>20000)return {ok:false,error:'补充条款为空或过长。'};
         var lines=appendLines(addition),start=doc.GetElementsCount();
         var paragraphs=lines.map(function(line){
           var paragraph=Api.CreateParagraph();
           paragraph.AddText(line);
           return paragraph;
         });
         doc.SetTrackRevisions(true);
         if(!paragraphs.every(function(paragraph){return doc.Push(paragraph);}))return {ok:false,error:'未能确认补充条款已写入，请核对文末。'};
         var bookmarks=[];
         if(/^[a-f0-9]{32}$/.test(input.operationId||'')&&doc.GetElementsCount()===start+lines.length){
           for(var lineIndex=0;lineIndex<lines.length;lineIndex++){
             var appended=doc.GetElement(start+lineIndex);
             var name='DSHA_'+input.operationId+'_'+lineIndex;
             if(!isAppendParagraph(appended,lines[lineIndex]))break;
             var matches=appended.Search(lines[lineIndex],true);
             if(matches.length!==1||matches[0].GetText()!==lines[lineIndex]||!matches[0].AddBookmark(name))break;
             bookmarks.push(name);
           }
         }
         return {ok:true,text:addition,operation:{text:addition,bookmarks:bookmarks.length===lines.length?bookmarks:[]}};
       }
       if(input.action==='undoAppend'){
         var operation=input.operation;
         var added=typeof operation?.text==='string'?appendLines(operation.text):[];
         var marks=operation?.bookmarks,elements=doc.GetContent(),first=-1,merged=false;
         var unavailable={ok:false,error:'补充条款已变动或无法确认位置，请在 Word 审阅中撤回。'};
         if(!added.length)return unavailable;
         if(Array.isArray(marks)&&marks.length){
           if(marks.length!==added.length)return unavailable;
           for(var markIndex=0;markIndex<marks.length;markIndex++){
             if(!/^DSHA_[a-f0-9]{32}_\d+$/.test(marks[markIndex]))return unavailable;
             var markedRange=doc.GetBookmarkRange(marks[markIndex]);
             var markedParagraphs=markedRange&&markedRange.GetAllParagraphs();
             if(!markedParagraphs||markedParagraphs.length!==1||markedRange.GetText()!==added[markIndex])return unavailable;
             var markedId=markedParagraphs[0].GetInternalId();
             var elementIndex=elements.findIndex(function(element){return typeof element.GetInternalId==='function'&&element.GetInternalId()===markedId;});
             if(markIndex===0)first=elementIndex;
             if(elementIndex!==first+markIndex||!isAppendParagraph(elements[elementIndex],added[markIndex]))return unavailable;
           }
         }else{
           // Older cards did not store bookmarks. Require the unchanged addition
           // to be the only matching paragraph sequence and still at the end.
           var last=elements.length;
           while(last>0&&isAppendParagraph(elements[last-1],''))last--;
           first=last-added.length;
           if(first<0||!added.slice(1).every(function(line,index){return isAppendParagraph(elements[first+index+1],line);}))return unavailable;
           if(!isAppendParagraph(elements[first],added[0])){
             // Earlier editor versions could attach the first added line to the
             // previous paragraph. Verify that paragraph against the review snapshot.
             var previous=operation.previousParagraph;
             if(typeof previous!=='string'||!previous.trim()||!isAppendParagraph(elements[first],previous+added[0]))return unavailable;
             var mergedMatches=doc.Search(added[0],true);
             if(mergedMatches.length!==1||mergedMatches[0].GetText()!==added[0])return unavailable;
             merged=true;
           }
           if(elements.slice(0,first).some(function(element,index){
             return isAppendParagraph(element,added[0])&&added.every(function(line,offset){return isAppendParagraph(elements[index+offset],line);});
           }))return unavailable;
         }
         var removeStart=first+(merged?1:0);
         if(removeStart<1)return unavailable;
         if(merged){
           var tracking=doc.IsTrackRevisions();
           try{
             if(tracking)doc.SetTrackRevisions(false);
             if(!doc.SearchAndReplace({searchString:added[0],replaceString:'',matchCase:true})||
               !isAppendParagraph(doc.GetElement(first),operation.previousParagraph))return unavailable;
           }finally{
             if(tracking)doc.SetTrackRevisions(true);
           }
         }
         for(var removeIndex=first+added.length-1;removeIndex>=removeStart;removeIndex--){
           if(!doc.RemoveElement(removeIndex))return {ok:false,error:'编辑器未完成撤回，请核对 Word。'};
         }
         if(doc.GetElementsCount()!==elements.length-(first+added.length-removeStart))return {ok:false,error:'编辑器未确认撤回，请核对 Word。'};
         return {ok:true};
       }
       if(input.action==='acceptAll'){doc.SetTrackRevisions(false);doc.AcceptAllRevisionChanges();return {ok:true};}
       if(input.action==='undo'){
         var saved=input.operation,mark=doc.GetBookmarkRange(saved.bookmark);
         if(!mark||mark.GetText()!==saved.after)return {ok:false,error:'本条文字已被继续编辑，不能自动还原；请使用编辑器审阅。'};
         var hits=doc.Search(saved.after,true);
         if(hits.length!==1)return {ok:false,error:'修改后的文字出现多次，不能安全自动还原。'};
         doc.SetTrackRevisions(true);
         if(!doc.SearchAndReplace({searchString:saved.after,replaceString:saved.before,matchCase:true}))return {ok:false,error:'还原未成功，请在编辑器中核对。'};
         return {ok:true,text:saved.before};
       }
       function rangeText(range){
         return range.GetText({Numbering:false,Math:true});
       }
       function exactMatches(text,ordered){
         if(!ordered)return doc.Search(text,true).filter(function(hit){return hit&&rangeText(hit)===text;});
         // The document search map is keyed by internal paragraph ID. Traversing
         // paragraphs first keeps the occurrence order stable after edits.
         var matches=[];
         doc.GetAllParagraphs().forEach(function(paragraph){
           var hits=paragraph.Search(text,true).filter(function(hit){return hit&&rangeText(hit)===text;});
           hits.sort(function(left,right){return left.GetStartPos()-right.GetStartPos();});
           matches=matches.concat(hits);
         });
         return matches;
       }
       function whitespaceMatch(text){
         var whitespace=/[\s\u200B]/,needle=text.replace(/[\s\u200B]/g,'');
         if(!needle)return {};
         var candidate=null,paragraphs=doc.GetAllParagraphs();
         for(var index=0;index<paragraphs.length;index++){
           var paragraph=paragraphs[index],raw=paragraph.GetText({Numbering:false,Math:true}),compact='',offsets=[];
           for(var offset=0;offset<raw.length;offset++){
             if(whitespace.test(raw.charAt(offset)))continue;
             compact+=raw.charAt(offset);
             offsets.push(offset);
           }
           var found=compact.indexOf(needle);
           if(found<0)continue;
           if(candidate||compact.indexOf(needle,found+1)>=0)return {ambiguous:true};
           candidate={paragraph:paragraph,start:offsets[found],end:offsets[found+needle.length-1]+1,raw:raw};
         }
         if(!candidate)return {};
         var quote=candidate.raw.slice(candidate.start,candidate.end);
         var ranges=candidate.paragraph.Search(quote,true).filter(function(hit){return hit&&rangeText(hit)===quote;});
         if(ranges.length===1)return {range:ranges[0],quote:quote};
         // Search can skip tabs and soft breaks in a text run. Read back the
         // calculated range before trusting offsets from the paragraph text.
         var range=candidate.paragraph.GetRange(candidate.start,candidate.end);
         return range&&rangeText(range)===quote?{range:range,quote:quote}:{};
       }
       function selectionState(){
         var range=doc.GetRangeBySelect(),text=range&&rangeText(range);
         if(typeof text!=='string'||!text.trim())return null;
         var paragraphs=range.GetAllParagraphs();
         if(!paragraphs||paragraphs.length!==1)return null;
         var paragraphId=typeof paragraphs[0].GetInternalId==='function'?paragraphs[0].GetInternalId():'';
         var start=range.GetStartPos(),end=range.GetEndPos(),source=doc.GetText(),hash=2166136261;
         for(var i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
         return {range:range,text:text,source:source,stamp:source.length+':'+(hash>>>0)+':'+paragraphId+':'+start+':'+end};
       }
       function centerSelection(){
         // Select() establishes the anchor but ONLYOFFICE 9.4 does not promise
         // to scroll an already visible selection. Use the current editor's
         // viewport when these native capabilities are present. Never cross
         // the editor frame or change the document to highlight a location.
         try{
           var nativeDoc=doc.Document,drawing=nativeDoc&&nativeDoc.DrawingDocument;
           var control=drawing&&drawing.m_oWordControl,canvas=control&&control.m_oEditor&&control.m_oEditor.HtmlElement;
           var scroll=control&&control.m_oScrollVerApi;
           if(!nativeDoc||typeof nativeDoc.GetSelectionBounds!=='function'||!drawing||typeof drawing.ConvertCoordsToCursor!=='function'||!canvas||!scroll||typeof scroll.scrollByY!=='function')return {supported:false};
           if(typeof nativeDoc.Document_UpdateSelectionState==='function')nativeDoc.Document_UpdateSelectionState();
           var bounds=nativeDoc.GetSelectionBounds();
           if(!bounds||!bounds.Start||!bounds.End)return {supported:false};
           var height=canvas.getBoundingClientRect().height;
           var first=drawing.ConvertCoordsToCursor(bounds.Start.X,bounds.Start.Y,bounds.Start.Page);
           var last=drawing.ConvertCoordsToCursor(bounds.End.X,bounds.End.Y+bounds.End.H,bounds.End.Page);
           if(!height||first.Error||last.Error||!Number.isFinite(first.Y)||!Number.isFinite(last.Y))return {supported:false};
           var span=Math.max(0,Math.min(last.Y-first.Y,height*0.6));
           var delta=first.Y+span/2-height/2;
           if(Math.abs(delta)>2)scroll.scrollByY(delta);
           var after=drawing.ConvertCoordsToCursor(bounds.Start.X,bounds.Start.Y,bounds.Start.Page);
           return {supported:true,centered:Math.abs(after.Y+span/2-height/2)<8,page:bounds.Start.Page+1};
         }catch(error){return {supported:false};}
       }
       function writeSelection(selection,replacement,insert){
         if(typeof replacement!=='string'||!replacement.trim()||replacement.length>20000||/[\r\n\t]/.test(replacement))return {ok:false,error:'请输入单段修改文字，不能包含换行或制表符。'};
         if(!insert&&replacement===selection.text)return {ok:false,error:'修改后的文字与原文相同'};
         var previousMatches=insert?[]:exactMatches(replacement,false);
         doc.SetTrackRevisions(true);
         var changed=insert?selection.range.AddText(replacement,'after'):Api.ReplaceTextSmart([replacement],'\t','\r');
         if(!changed||doc.GetText()===selection.source)return {ok:false,error:'编辑器未能确认写入，请先在 Word 中核对，避免重复修改。'};
         var bookmark=null;
         if(!insert&&!previousMatches.length){
           var updated=exactMatches(replacement,false);
           if(updated.length===1&&typeof input.operationId==='string'&&/^[a-zA-Z0-9_]+$/.test(input.operationId)){
             var name='DSH_'+input.operationId;
             if(updated[0].AddBookmark(name)){bookmark=name;updated[0].Select();}
           }
         }
         return {ok:true,text:replacement,operation:{before:insert?'':selection.text,after:replacement,bookmark:bookmark},verified:!!bookmark};
       }
       if(input.action==='selection'||input.action==='replaceSelection'||input.action==='insertSelection'){
         var selection=selectionState();
         if(!selection)return {ok:false,error:'请先在 Word 中选中一段可编辑的原文，再确认操作。'};
         if(input.action==='selection')return {ok:true,text:selection.text,anchorStamp:selection.stamp};
         if(input.expectedSelection!==selection.text||input.anchorStamp!==selection.stamp)return {ok:false,error:'选区或正文已变化，请重新确认位置；未写入。'};
         return writeSelection(selection,input.text,input.action==='insertSelection');
       }
       var indexed=input.occurrenceIndex!==undefined;
       if(indexed&&(!Number.isInteger(input.occurrenceIndex)||input.occurrenceIndex<0))return {ok:false,error:'原文位置编号无效。'};
       var ordered=indexed||input.action==='count';
       var candidates=input.candidates||[],range=null,quote='',ambiguous=false,count=0;
       for(var i=0;i<candidates.length;i++){
         var text=candidates[i];if(typeof text!=='string'||!text.trim())continue;
         var results=exactMatches(text,ordered);
         if(ordered&&results.length){
           quote=text;count=results.length;
           if(input.action==='count')return {ok:true,quote:quote,count:count};
           range=results[input.occurrenceIndex];
           if(!range)return {ok:false,error:'该处原文已不存在，请重新定位。',count:count};
           break;
         }
         if(results.length>1)ambiguous=true;
         if(results.length===1){range=results[0];quote=text;count=1;break;}
       }
       if(!range&&!ambiguous){
         for(var j=0;j<candidates.length;j++){
           var candidateText=candidates[j];
           if(typeof candidateText!=='string'||!candidateText.trim())continue;
           var match=whitespaceMatch(candidateText);
           if(match.ambiguous){ambiguous=true;continue;}
           if(!match.range)continue;
           if(input.action==='count')return {ok:true,quote:match.quote,count:1};
           if(indexed&&input.occurrenceIndex!==0)return {ok:false,error:'该处原文已不存在，请重新定位。',count:1};
           range=match.range;quote=match.quote;count=1;
           break;
         }
       }
       if(input.action==='count')return {ok:true,quote:'',count:0};
       if(!range)return {ok:false,error:ambiguous?'原文出现多处，请在编辑器中确认对应条款。':'卡片引用的是审查时的正文，当前 Word 中未找到对应文字。请核对当前版本或重新审查。'};
       range.Select();
       var located=selectionState();
       if(!located||located.text!==quote)return {ok:false,error:'未能确认原文选区，请在编辑器中核对对应条款。'};
       if(input.action==='formatBold'){
         if(indexed&&(input.expectedCount!==count||input.anchorStamp!==located.stamp))return {ok:false,error:'原文已变化，请重新定位'};
         doc.SetTrackRevisions(true);if(!range.SetBold(true))return {ok:false,error:'加粗未完成'};return {ok:true,text:quote,formatted:true};
       }
       if(indexed){
         if(input.action==='locate')return {ok:true,quote:quote,count:count,occurrenceIndex:input.occurrenceIndex,anchorStamp:located.stamp,viewport:centerSelection()};
         if(input.action!=='replace')return {ok:false,error:'不支持的文档操作'};
         if(input.expectedCount!==count||input.anchorStamp!==located.stamp)return {ok:false,error:'原文或位置已变化，请重新定位后确认；未写入。',count:count};
         var written=writeSelection(located,input.text,false);
         if(written.ok)written.remainingCount=exactMatches(quote,true).length;
         return written;
       }
       if(input.action==='locate')return {ok:true,quote:quote,count:count,viewport:centerSelection()};
       if(input.action!=='replace')return {ok:false,error:'不支持的文档操作'};
       var replacement=input.text;
       // Keep the existing bookmark-based undo for exact, unique matches. A
       // normalized match uses the checked selection and never global search.
       if(candidates.indexOf(quote)<0||/[\r\n\t]/.test(quote)||doc.Search(quote,true).length!==1)
         return writeSelection(located,replacement,false);
       if(typeof replacement!=='string'||!replacement.trim()||replacement.length>20000||/[\r\n\t]/.test(replacement))
         return {ok:false,error:'请输入单段修改文字，不能包含换行或制表符。'};
       if(replacement===quote)return {ok:false,error:'修改后的文字与原文相同'};
       doc.SetTrackRevisions(true);
       if(!doc.SearchAndReplace({searchString:quote,replaceString:replacement,matchCase:true}))
         return {ok:false,error:'编辑器未执行替换，请核对原文。'};
       var updated=exactMatches(replacement,false),bookmark=null;
       if(updated.length===1&&/^[a-zA-Z0-9_]+$/.test(input.operationId||'')){
         var name='DSH_'+input.operationId;
         if(updated[0].AddBookmark(name)){bookmark=name;updated[0].Select();}
       }
       return {ok:true,text:replacement,operation:{before:quote,after:replacement,bookmark:bookmark},verified:!!bookmark};
     }catch(error){return {ok:false,error:'文档操作失败：'+String(error.message||error)}}
   },false,!['read','count','locate','selection'].includes(request.action),function(result){finishRequest(request,result)});
 }
 Asc.plugin.init=function(){
   document.documentElement.setAttribute('data-dsh-plugin','ready');
   window.addEventListener('message',function(event){
     var data=event.data;
     if(event.source!==host||(event.origin!==origin&&!(origin==='dsh-desktop://harness'&&event.origin==='null'))||!data||data.source!=='dsh-onlyoffice-host'||data.channel!==channel||data.key!==key)return;
     if(data.type==='ping'){if(readyPulse){clearInterval(readyPulse);readyPulse=null;}send({type:'ready'});return;}
     if(data.type!=='command'||typeof data.id!=='string')return;if(readyPulse){clearInterval(readyPulse);readyPulse=null;}
     if(busy){send({type:'result',id:data.id,result:{ok:false,error:'上一项文档操作尚未完成'}});return;}
     busy=true;command(data);
   });
   send({type:'ready'});
   if(typeof setInterval==='function')readyPulse=setInterval(function(){send({type:'ready'})},2000);
 };
 Asc.plugin.button=function(){};
 document.documentElement.setAttribute('data-dsh-plugin','waiting-init');
})();
`;
