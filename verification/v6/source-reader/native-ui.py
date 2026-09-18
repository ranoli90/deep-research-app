"""Native control helper: never print or persist unrelated OS picker/app contents."""
import subprocess,xml.etree.ElementTree as ET,sys,re,json
subprocess.run(['adb','shell','uiautomator','dump','/sdcard/deep-source-window.xml'],check=True,stdout=subprocess.DEVNULL)
raw=subprocess.check_output(['adb','shell','cat','/sdcard/deep-source-window.xml'])
root=ET.fromstring(raw)
mode=sys.argv[1]
if mode=='inspect':
 rows=[{'text':e.get('text'),'label':e.get('content-desc'),'bounds':e.get('bounds')} for e in root.iter('node') if e.get('package')=='host.exp.exponent' and (e.get('text') or e.get('content-desc'))]
 print(json.dumps(rows,ensure_ascii=False,indent=2))
elif mode=='tap':
 target=sys.argv[2]
 for e in root.iter('node'):
  if e.get('text')==target or e.get('content-desc')==target:
   a,b,c,d=map(int,re.findall(r'\d+',e.get('bounds')))
   subprocess.run(['adb','shell','input','tap',str((a+c)//2),str((b+d)//2)],check=True)
   print('Tapped expected label:',target);break
 else: raise SystemExit('Expected control absent')
subprocess.run(['adb','shell','rm','-f','/sdcard/deep-source-window.xml'],check=True)
