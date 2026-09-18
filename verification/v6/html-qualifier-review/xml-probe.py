import json
from pathlib import Path
import trafilatura
from lxml import etree
root=Path(__file__).parent
out=[]
for case in ['list','prose','table']:
 xml=trafilatura.extract((root/(case+'.html')).read_text(),output_format='xml',include_tables=False,include_links=True,include_formatting=True)
 tree=etree.fromstring(xml.encode())
 out.append({'case':case,'matchingElements':[etree.tostring(e,encoding='unicode') for e in tree.xpath('./main/*') if 'Distributed writes' in ''.join(e.itertext()) or 'Supported for all plans' in ''.join(e.itertext())]})
print(json.dumps(out,indent=2))
