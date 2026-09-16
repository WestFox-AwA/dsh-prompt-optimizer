```python
import json, os, sys, shutil, subprocess

cwd = os.getcwd()
cfg = os.path.join(cwd, "config.json")

print("=== 阶段一 环境确认 ===")
print("PWD:", cwd)
print("LISTING:")
for n in sorted(os.listdir(cwd)):
    print("   ", n)

if os.path.exists(cfg):
    print("config.json EXISTS, raw bytes:")
    print(repr(open(cfg, "rb").read()))
    print("STOP: 已存在 config.json，按约定不覆盖，等待确认。")
    sys.exit(2)

py = sys.executable
print("python (sys.executable):", py)
print("which python3 :", shutil.which("python3"))
print("which jq      :", shutil.which("jq"))
print("json module   : OK (built-in)")

# ---------------- 阶段二 写入 v1 ----------------
print("\n=== 阶段二 写入 v1 ===")
v1 = b'{"name":"demo","retries":3}\n'
with open(cfg, "wb") as f:
    f.write(v1)
print("wrote", cfg)
print("--- self-check: raw content ---")
print(open(cfg, "rb").read().decode("utf-8"), end="")

# ---------------- 阶段三 验证 v1 ----------------
print("=== 阶段三 验证 v1 ===")
cmd1 = (
    "import json,sys;"
    "d=json.load(open(r'%s',encoding='utf-8'),object_pairs_hook=list);"
    "print(d);"
    "assert [k for k,_ in d]==['name','retries'], 'key order';\"
    "assert d[0][1]=='demo' and isinstance(d[0][1],str);\"
    "assert d[1][1]==3 and isinstance(d[1][1],int) and not isinstance(d[1][1],bool);\"
    "print('V1 OK')" % cfg
)
r1 = subprocess.run([py, "-c", cmd1], capture_output=True, text=True)
print("cmd:", "python -c <inline verify v1>")
print("rc:", r1.returncode)
print("out:", r1.stdout.strip())
print("err:", r1.stderr.strip())
if r1.returncode != 0:
    sys.exit(3)

# ---------------- 阶段四 升级 v2 ----------------
print("\n=== 阶段四 升级 v2 ===")
raw = open(cfg, "rb").read()
assert