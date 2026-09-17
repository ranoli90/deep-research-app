import sys,io,json,resource,time,unicodedata,re
resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
resource.setrlimit(resource.RLIMIT_CPU,(40,40))
raw=sys.stdin.buffer.read(1500001);started=time.monotonic()
from docling.datamodel.base_models import InputFormat,DocumentStream
from docling.datamodel.pipeline_options import NativePdfPipelineOptions
from docling.document_converter import DocumentConverter,PdfFormatOption
from docling.pipeline.native_pdf_pipeline import NativePdfPipeline
options=NativePdfPipelineOptions(document_timeout=30)
converter=DocumentConverter(allowed_formats=[InputFormat.PDF],format_options={InputFormat.PDF:PdfFormatOption(pipeline_cls=NativePdfPipeline,pipeline_options=options)})
result=converter.convert(DocumentStream(name='input.pdf',stream=io.BytesIO(raw)))
needle=json.load(open("/reference.json"))["expected"]
texts={}
for item,_ in result.document.iterate_items():
 if hasattr(item,'text'):
  for loc in item.prov:texts.setdefault(loc.page_no,[]).append(item.text)
matches=[p for p,items in texts.items() if needle in re.sub(r'\s+',' ',unicodedata.normalize('NFKC',' '.join(items)))]
print(json.dumps(dict(engine='docling-native-2.128.0',status=str(result.status),pages=len(texts),matches=matches,wallMs=round((time.monotonic()-started)*1000),peakRssKb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,tables=len(result.document.tables),modelAssets=[])))
