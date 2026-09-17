import sys,io,json,resource,time,unicodedata,re
resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2))
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
raw=sys.stdin.buffer.read(1500001);started=time.monotonic()
from docling_parse.pdf_parser import DoclingPdfParser,ContentConfig,ContentLevel,DecodeConfig
parser=DoclingPdfParser(loglevel='fatal')
doc=parser.load(io.BytesIO(raw),decode_config=DecodeConfig(do_sanitization=True,keep_glyphs=False),content_config=ContentConfig(char_cells_content_level=ContentLevel.SKIP,word_cells_content_level=ContentLevel.SKIP,line_cells_content_level=ContentLevel.COMPUTE_AND_MATERIALIZE,shapes_content_level=ContentLevel.SKIP,bitmaps_content_level=ContentLevel.SKIP))
needle=json.load(open("/reference.json"))["expected"]
matches=[];count=0
for i,p in doc.iterate_pages():
 count+=1
 cells=sorted(p.textline_cells,key=lambda c:(-c.rect.to_bounding_box().t,c.rect.to_bounding_box().l))
 text=unicodedata.normalize('NFKC',' '.join(c.text for c in cells))
 # Retain line-break hyphens; no generic word joins or semantic correction.
 if needle in re.sub(r'\s+',' ',text):matches.append(i)
print(json.dumps(dict(engine='docling-parse-line-7.20.0',pages=count,matches=matches,wallMs=round((time.monotonic()-started)*1000),peakRssKb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)))
