import sys,json,resource,time,unicodedata,re
resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2))
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
raw=sys.stdin.buffer.read(1500001);started=time.monotonic()
import pypdfium2 as pdfium
needle=json.load(open("/reference.json"))["expected"]
doc=pdfium.PdfDocument(raw);matches=[]
for i in range(len(doc)):
 p=doc[i];t=p.get_textpage();text=unicodedata.normalize('NFKC',t.get_text_range())
 if needle in re.sub(r'\s+',' ',text):matches.append(i+1)
 t.close();p.close()
print(json.dumps(dict(engine='pypdfium2-5.13.0',pages=len(doc),matches=matches,wallMs=round((time.monotonic()-started)*1000),peakRssKb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)))
doc.close()
