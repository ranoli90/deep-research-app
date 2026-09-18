import sys,io,json,resource,re
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
from pypdf import PdfReader
raw=sys.stdin.buffer.read(1500001)
r=PdfReader(io.BytesIO(raw),strict=True)
needle=json.load(open("/reference.json"))["expected"]
results=[]
for mode in ['plain','layout']:
 pages=[]
 for i,p in enumerate(r.pages):
  t=re.sub(r'\s+',' ',p.extract_text(extraction_mode=mode))
  if needle in t:pages.append(i+1)
 results.append(dict(mode=mode,decisiveNegationPages=pages,totalPages=len(r.pages)))
print(json.dumps(results))
