import subprocess,xml.etree.ElementTree as ET,sys,re,json
base=['adb','-s','10.0.0.167:43417','shell']
try:
 subprocess.run(base+['uiautomator','dump','/sdcard/deep-source-window.xml'],check=True,stdout=subprocess.DEVNULL)
 root=ET.fromstring(subprocess.check_output(base+['cat','/sdcard/deep-source-window.xml']))
 nodes=[e for e in root.iter('node') if e.get('package')=='host.exp.exponent']
 if not any(e.get('text')=='Research' for e in nodes):raise SystemExit('Own research UI unavailable')
 target=sys.argv[1]
 for e in nodes:
  if e.get('text')==target or e.get('content-desc')==target:
   a,b,c,d=map(int,re.findall(r'\d+',e.get('bounds')))
   if c<=a or d<=b:continue
   subprocess.run(base+['input','tap',str((a+c)//2),str((b+d)//2)],check=True)
   print(json.dumps({'tappedExpectedControl':target}));break
 else:raise SystemExit('Expected own control absent')
finally:subprocess.run(base+['rm','-f','/sdcard/deep-source-window.xml'],stdout=subprocess.DEVNULL)
