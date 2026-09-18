"""Authorized physical phone synthetic controls. Own app nodes only; no OS picker inventory."""
import subprocess, sys, re, json, shlex, xml.etree.ElementTree as ET
SERIAL = "10.0.0.167:43417"
def adb(*args):
    return subprocess.check_output(["adb", "-s", SERIAL, *args])
if adb("shell", "getprop", "ro.product.model").strip() != b"25098RA98G":
    raise SystemExit("Unexpected device")
mode = sys.argv[1]
if mode == "text":
    text = sys.argv[2]
    if not re.fullmatch(r"[A-Za-z0-9 .,?_-]+", text):
        raise SystemExit("Only bounded synthetic input allowed")
    adb("shell", "input", "text", shlex.quote(text.replace(" ", "%s")))
    print("Entered synthetic text")
elif mode == "key":
    if sys.argv[2] not in ["BACK", "HOME", "ENTER", "TAB"]: raise SystemExit("Unsupported key")
    adb("shell", "input", "keyevent", "KEYCODE_" + sys.argv[2])
elif mode == "swipe":
    coords = [str(int(v)) for v in sys.argv[2:6]]
    if len(coords) != 4 or any(not 0 <= int(v) <= 3000 for v in coords): raise SystemExit("Invalid bounds")
    adb("shell", "input", "swipe", *coords, "350")
else:
    path = "/sdcard/deep-v6-physical-window.xml"
    try:
        adb("shell", "uiautomator", "dump", path)
        root = ET.fromstring(adb("shell", "cat", path))
        allowed = {"host.exp.exponent"}
        nodes = [e for e in root.iter("node") if e.get("package") in allowed]
        if mode == "inspect":
            print(json.dumps([{k: e.get(k) for k in ["text", "content-desc", "class", "bounds", "clickable"]} for e in nodes if e.get("text") or e.get("content-desc") or e.get("class") == "android.widget.EditText"], indent=2))
        elif mode == "tap":
            target = sys.argv[2]
            matches = [e for e in nodes if e.get("text") == target or e.get("content-desc") == target]
            if not matches: raise SystemExit("Expected control absent: " + target)
            a,b,c,d = map(int, re.findall(r"\d+", matches[0].get("bounds")))
            if c <= a or d <= b: raise SystemExit("Expected control is offscreen; scroll before tapping: " + target)
            adb("shell", "input", "tap", str((a+c)//2), str((b+d)//2))
            print("Tapped expected label: " + target)
        else: raise SystemExit("Unknown control mode")
    finally:
        adb("shell", "rm", "-f", path)
