import subprocess,xml.etree.ElementTree as ET,re,json
base=['adb','-s','10.0.0.167:43417','shell'];path='/sdcard/deep-physical-picker.xml'
try:
 subprocess.run(base+['uiautomator','dump',path],check=True,stdout=subprocess.DEVNULL)
 root=ET.fromstring(subprocess.check_output(base+['cat',path]));name='deep-v6-physical-control.pdf'
 matches=[n for n in root.iter('node') if n.get('package') in ['com.google.android.documentsui','com.android.documentsui'] and n.get('text')==name]
 if not matches:raise SystemExit('Synthetic file not currently visible; no OS inventory retained')
 a,b,c,d=map(int,re.findall(r'\d+',matches[0].get('bounds')))
 subprocess.run(base+['input','tap',str((a+c)//2),str((b+d)//2)],check=True)
 print(json.dumps({'selectedSyntheticFile':name}))
finally:subprocess.run(base+['rm','-f',path],stdout=subprocess.DEVNULL)
