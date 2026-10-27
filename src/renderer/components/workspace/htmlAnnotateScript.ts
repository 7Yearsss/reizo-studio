/**
 * Runs inside the preview iframe (sandboxed, opaque origin) in annotate mode. It only highlights and reports the
 * clicked element to the parent, tagged with a per-mount token; the parent checks the token and the sender window.
 * Form fields report no text or value. Author scripts are blocked by the page's CSP (only this script has the nonce).
 */
export function htmlAnnotateScript(token: string): string {
  return `(function(){
var T=${JSON.stringify(token)};
var box=document.createElement('div');
box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:3px;display:none';
document.documentElement.appendChild(box);
document.documentElement.style.cursor='crosshair';
function esc(v){return window.CSS&&CSS.escape?CSS.escape(v):String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}
function selector(el){
  var parts=[];
  for(var n=0;el&&el.nodeType===1&&n<6;n++){
    var tag=el.tagName.toLowerCase();
    if(el.id){parts.unshift('#'+esc(el.id));break;}
    var tid=el.getAttribute('data-testid');
    if(tid){parts.unshift('[data-testid="'+tid.replace(/"/g,'')+'"]');break;}
    var i=1,s=el;while((s=s.previousElementSibling)){if(s.tagName===el.tagName)i++;}
    parts.unshift(tag+':nth-of-type('+i+')');
    if(tag==='body')break;
    el=el.parentElement;
  }
  return parts.join(' > ');
}
function pick(e){var el=e.target;return el&&el.nodeType===1&&el!==document.documentElement&&el!==box?el:null;}
document.addEventListener('mousemove',function(e){
  var el=pick(e);if(!el){box.style.display='none';return;}
  var r=el.getBoundingClientRect();
  box.style.cssText+=';display:block;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';
},true);
document.addEventListener('click',function(e){
  var el=pick(e);if(!el)return;
  e.preventDefault();e.stopPropagation();
  var field=/^(input|textarea|select)$/i.test(el.tagName);
  var open=el.cloneNode(false);
  if(field){open.removeAttribute('value');}
  var html=open.outerHTML||'';
  parent.postMessage({reizoAnnotate:T,selector:selector(el),tag:el.tagName.toLowerCase(),text:field?'':(el.innerText||el.textContent||'').slice(0,300),html:html.slice(0,400)},'*');
},true);
['submit','keydown'].forEach(function(t){document.addEventListener(t,function(e){e.preventDefault();},true);});
})();`;
}
