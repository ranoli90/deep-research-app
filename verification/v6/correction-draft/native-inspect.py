import subprocess,xml.etree.ElementTree as ET,json
base=['adb','-s','10.0.0.167:43417','shell']
try:
 subprocess.run(base+['uiautomator','dump','/sdcard/deep-protected-window.xml'],check=True,stdout=subprocess.DEVNULL)
 root=ET.fromstring(subprocess.check_output(base+['cat','/sdcard/deep-protected-window.xml']))
 rows=[{'text':n.get('text'),'label':n.get('content-desc'),'bounds':n.get('bounds'),'class':n.get('class'),'checked':n.get('checked')} for n in root.iter('node') if n.get('package')=='host.exp.exponent']
 if not any(n['text']=='Research' for n in rows):print(json.dumps({'currentDeepUI':False}))
 else:print(json.dumps({'currentDeepUI':True,'rows':[n for n in rows if n['text'] or n['label']]},indent=2))
finally:subprocess.run(base+['rm','-f','/sdcard/deep-protected-window.xml'],stdout=subprocess.DEVNULL)
