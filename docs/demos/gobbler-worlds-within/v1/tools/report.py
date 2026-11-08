from pathlib import Path
import json,html
import re
def inline(s):
 s=html.escape(s);s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s);s=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s);s=re.sub(r'(?<![\w"=])(https://[^\s<]+)',r'<a href="\1">\1</a>',s);return s

def markdown(text):
 lines=text.splitlines();out=[];i=0
 while i<len(lines):
  line=lines[i]
  if not line.strip():i+=1;continue
  if line.startswith('!['):i+=1;continue
  if line.startswith('```'):
   kind=line[3:];i+=1;block=[]
   while i<len(lines) and not lines[i].startswith('```'):block.append(lines[i]);i+=1
   i+=1
   if kind!='mermaid':out.append('<pre><code>'+html.escape('\n'.join(block))+'</code></pre>')
   continue
  m=re.match(r'^(#{1,4}) (.*)',line)
  if m:
   level=min(len(m[1]),5);out.append(f'<h{level}>'+inline(m[2])+f'</h{level}>');i+=1;continue
  if line.startswith('|'):
   table=[]
   while i<len(lines) and lines[i].startswith('|'):
    row=[x.strip() for x in lines[i].strip('|').split('|')]
    if not all(re.fullmatch(r':?-+:?',x) for x in row):table.append(row)
    i+=1
   out.append('<div class="table"><table><thead><tr>'+''.join('<th>'+inline(x)+'</th>' for x in table[0])+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+inline(x)+'</td>' for x in row)+'</tr>' for row in table[1:])+'</tbody></table></div>');continue
  if re.match(r'^\d+\. ',line):
   block=[]
   while i<len(lines) and re.match(r'^\d+\. ',lines[i]):block.append(re.sub(r'^\d+\. ','',lines[i]));i+=1
   out.append('<ol>'+''.join('<li>'+inline(x)+'</li>' for x in block)+'</ol>');continue
  if line.startswith('- '):
   block=[]
   while i<len(lines) and lines[i].startswith('- '):block.append(lines[i][2:]);i+=1
   out.append('<ul>'+''.join('<li>'+inline(x)+'</li>' for x in block)+'</ul>');continue
  paragraph=[line];i+=1
  while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','```','- ')):paragraph.append(lines[i]);i+=1
  out.append('<p>'+inline(' '.join(paragraph))+'</p>')
 return '\n'.join(out)

ROOT=Path(__file__).resolve().parents[1]
body=markdown((ROOT/'docs/DEBRIEF.md').read_text())
audit=json.loads((ROOT/'evidence/audit.json').read_text());build=json.loads((ROOT/'evidence/build.json').read_text());candidate=json.loads((ROOT/'evidence/candidate.json').read_text())
p=ROOT/'evidence/browser.json';browser=json.loads(p.read_text()) if p.exists() else {}
current=browser.get('candidate')==candidate['candidate_sha256'];status='PASS · current candidate' if current and browser.get('passed') else 'Browser receipt pending / earlier candidate'
summary=f'''<section class="receipt"><div><small>EXECUTABLE CANDIDATE</small><code>{candidate['candidate_sha256']}</code></div><div><small>DETERMINISTIC SUITES</small><b>{len(audit['checks'])} suites · {'pass' if audit['passed'] else 'fail'}</b></div><div><small>REAL BROWSER</small><b>{status}</b></div><p>The complete observations are in <code>evidence/</code>. The current profile is a software-renderer sample, not a discrete-GPU performance certificate.</p></section>'''
svg='''<svg class="architecture" viewBox="0 0 980 390" role="img" aria-label="An intent controls resource loading and camera flight; the camera observer must acknowledge the destination before proximity control resumes. Separate witnesses feed a candidate receipt."><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#b9a16f"/></marker></defs><g fill="none" stroke="#b9a16f" stroke-width="1.4" marker-end="url(#a)"><path d="M230 75H385"/><path d="M595 75H750"/><path d="M855 112V177"/><path d="M750 214H595"/><path d="M385 214H230"/><path d="M125 177V112"/><path d="M490 251V308"/><path d="M125 251V336H385"/></g><g fill="#171d27" stroke="#475262"><rect x="20" y="38" width="210" height="74" rx="7"/><rect x="385" y="38" width="210" height="74" rx="7"/><rect x="750" y="38" width="210" height="74" rx="7"/><rect x="750" y="177" width="210" height="74" rx="7"/><rect x="385" y="177" width="210" height="74" rx="7"/><rect x="20" y="177" width="210" height="74" rx="7"/><rect x="385" y="308" width="210" height="62" rx="7"/></g><g text-anchor="middle" fill="#efe9db" font-family="system-ui,sans-serif" font-size="17"><text x="125" y="69">Navigation intent</text><text x="490" y="69">Residency controller</text><text x="855" y="69">Load witness</text><text x="855" y="207">Camera flight</text><text x="490" y="207">Arrival acknowledgement</text><text x="125" y="207">Proximity observations</text><text x="490" y="335">Bound receipt</text></g><g text-anchor="middle" fill="#a8b6c2" font-family="system-ui,sans-serif" font-size="12"><text x="125" y="91">new generation · explicit destination</text><text x="490" y="91">current + intended world protected</text><text x="855" y="91">LoadSensor.children</text><text x="855" y="229">finite pose · cancellable promise</text><text x="490" y="229">reject delayed views of the old world</text><text x="125" y="229">resume authority after acknowledgement</text><text x="490" y="355">identity · behaviour · frames · limits</text></g><g fill="#a8b6c2" font-family="ui-monospace,monospace" font-size="11"><text x="274" y="63">REQUEST</text><text x="642" y="63">READY?</text><text x="868" y="149">READY</text><text x="627" y="202">OBSERVED</text><text x="258" y="202">RELEASE LATCH</text><text x="504" y="288">WITNESSES</text></g></svg>'''
css='''*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#dbdfdf;background:#0b0e14;font:16px/1.75 system-ui,sans-serif}a{color:#d5bd85}main{max-width:1100px;margin:auto;padding:60px 55px 100px}.eyebrow{font:11px/1.5 ui-monospace,monospace;letter-spacing:.2em;color:#c0a671}.hero{border-bottom:1px solid #39414b;margin-bottom:45px;padding-bottom:38px}.hero h1{font:400 clamp(44px,6vw,78px)/1.04 Georgia,serif;color:#f2ecdf;letter-spacing:-.045em;max-width:780px;margin:22px 0}.hero p{max-width:680px;color:#aab6c1;font-size:19px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-top:35px}.stats div{padding:20px;border:1px solid #39414b;border-radius:6px;background:#111720}.stats b{display:block;color:#e4cf9d;font:36px Georgia,serif}.stats span{font:11px ui-monospace,monospace;color:#9facb9}.architecture{width:100%;height:auto;margin:20px 0;background:#0e131b;border-radius:8px}.receipt{padding:25px;background:#131d26;border-left:3px solid #c3a66d;border-radius:4px;margin:35px 0;display:grid;grid-template-columns:1fr 1fr;gap:20px}.receipt div:first-child{grid-column:span 2}.receipt small{display:block;letter-spacing:.12em;color:#8fa8b9;font:10px ui-monospace,monospace;margin-bottom:8px}.receipt code{overflow-wrap:anywhere;font-size:11px}.receipt p{grid-column:span 2;margin:0;font-size:12px;color:#aab8c3}article>h1{display:none}h2{font:400 34px/1.2 Georgia,serif;color:#e9d6b0;margin:60px 0 22px;padding-top:20px;border-top:1px solid #343d48}h3{color:#dbca9f}p{max-width:90ch}strong{color:#f1e3c5}table{width:100%;border-collapse:collapse;margin:25px 0;font-size:12px;line-height:1.6}th{text-align:left;color:#e0c694;font-size:11px;background:#17212b}td,th{padding:13px 14px;border:1px solid #303b47;vertical-align:top}tr:nth-child(even){background:#101720}code{background:#18212c;color:#c7dbe3;border-radius:3px;padding:2px 5px;font-size:.86em}pre{background:#111821;border:1px solid #303b47;border-radius:5px;padding:20px;overflow:auto}pre code{background:none}li{margin:12px 0;padding-left:4px}article ul:last-child{font-size:13px}footer{overflow-wrap:anywhere;margin-top:60px;border-top:1px solid #39414b;padding-top:25px;font:11px/1.8 ui-monospace,monospace;color:#8497a7}@media(max-width:700px){main{padding:30px 20px}.stats{grid-template-columns:1fr 1fr}table{display:block;overflow:auto}.receipt{display:block}.receipt div{margin-bottom:20px}}@media print{body{background:white;color:#222;font-size:10pt}main{padding:0;max-width:none}.hero h1,h2,strong{color:#302b25}.hero p,p{color:#333}table{font-size:8pt}td,th{border-color:#bbb}h2{page-break-after:avoid}tr{break-inside:avoid}a{color:#333}.receipt,.stats div{background:#eee;color:#222}.architecture{background:#111}footer{color:#555}}'''
html_doc=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gobbler — the cabinet and the contract</title><style>{css}</style><main><header class="hero"><div class="eyebrow">X3D LOOM / FIELD NOTES / NOVEMBER 2026</div><h1>The cabinet<br>and the contract.</h1><p>Refining an impossible museum—and turning its surprises into useful, reproducible knowledge.</p><div class="stats"><div><b>439</b><span>HOST SHAPES PRESERVED</span></div><div><b>50,058</b><span>PANTHEON SPLATS RETAINED</span></div><div><b>2</b><span>RESIDENT WORLD GROUPS</span></div><div><b>6</b><span>BAKED ROUGHNESS LEVELS</span></div></div></header>{summary}{svg}<article>{body}</article><footer>Gobbler / Cabinet of Worlds · Private local demonstration · Candidate {candidate['candidate_sha256']}<br>Receipts are scoped observations. Proposed gates require calibration before global promotion.</footer></main></html>'''
(ROOT/'docs/DEBRIEF.html').write_text(html_doc)
print('Rendered HTML report',len(html_doc),'characters; browser status:',status)
