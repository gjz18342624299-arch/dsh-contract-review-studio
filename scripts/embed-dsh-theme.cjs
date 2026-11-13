// Keep the directly served HTML self-contained; no new host route or restart is needed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function transform(html){
 const css=fs.readFileSync(path.join(root,'public/real-files/dsh-theme.css'),'utf8');
 const js=fs.readFileSync(path.join(root,'public/real-files/dsh-theme.js'),'utf8');
 html=html.replace(/<style id="dsh-business-theme">[\s\S]*?<\/style>\s*/g,'').replace(/<script id="dsh-business-adapter">[\s\S]*?<\/script>\s*/g,'');
 html=html.replace('<body>','<body class="business-app">');
 html=html.replace('</head>','<style id="dsh-business-theme">'+css+'</style>\n</head>');
 html=html.replace('</body>','<script id="dsh-business-adapter">'+js+'</script>\n</body>');
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/\bsrc=/.test(m[1]))new vm.Script(m[2]);
 return html;
}
module.exports={transform};
if(require.main===module){const file=path.join(root,'public/index.html');fs.writeFileSync(file,transform(fs.readFileSync(file,'utf8')));console.log('Embedded current DSH theme and adapter; application scripts compile.');}
