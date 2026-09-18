import subprocess,xml.etree.ElementTree as ET,sys,re
subprocess.run(['adb','shell','uiautomator','dump','/sdcard/deep-window.xml'],check=True,stdout=subprocess.DEVNULL)
raw=subprocess.check_output(['adb','shell','cat','/sdcard/deep-window.xml'])
root=ET.fromstring(raw)
for e in root.iter('node'):
 if e.get('text')==sys.argv[1] or e.get('content-desc')==sys.argv[1]:
  a,b,c,d=map(int,re.findall(r'\d+',e.get('bounds')))
  subprocess.run(['adb','shell','input','tap',str((a+c)//2),str((b+d)//2)],check=True)
  print('Tapped:',sys.argv[1]);break
else: raise SystemExit('Requested label not present')
