```python
import json, os, sys, shutil, subprocess, tempfile

CFG = os.path.join(os.getcwd(), "config.json")
V1 = b'{"name":"demo","retries":3}\n'
V2 = b'{"name":"demo","retries":3,"enabled":true,"version":2}\n'
DONE_LINE = 'DONE: config.json upgraded to v2 {"name":"demo","retries":3,"enabled":true,"version":2}'

def raw(path):
    with open(path, "rb") as f:
        return f.read()

print("=== 阶段一 环境确认 ===")
print("PWD:", os.getcwd())
print("LISTING:")
for n in sorted(os.listdir(os.getcwd())):
    print("    " + n)

if os.path.exists(CFG):
    print("config.json ALREADY EXISTS -> 按约定不覆盖，停止等待确认。")
    print("RAW BYTES:", repr(raw(CFG)))
    print("RAW TEXT:")
    print(raw(CFG).decode("utf-8", "replace"), end="")
    sys.exit(2)

print("config.json 不存在，可安全创建。")
py = sys.executable
print("python interpreter :", py)
print("which python3      :", shutil.which("python3"))
print("which jq           :", shutil.which("jq"))
print("json module        : built-in, OK")
print("=> JSON 工具: python3 (内置 json), 未安装任何依赖")

# 校验脚本（通过 python3 -c 等价方式：写临时脚本再执行，避免引号转义问题）
verify_src = (
    "import json,sys\n"
    "p=sys.argv[1]\n"
    "pairs=json.load(open(p,encoding='utf-8'),object_pairs_hook=list)\n"
    "keys=[k for k,_ in pairs]\n"
    "vals=[v for _,v in pairs]\n"
    "print('parsed keys :',keys)\n"
    "print('parsed vals :',vals)\n"
    "assert keys==sys.argv[2].split(','), 'key order mismatch: %r' % keys\n"
    "assert len(pairs)==len(sys.argv[2].split(',')), 'count mismatch'\n"
    "assert vals[0]=='demo' and isinstance(vals[0],str), 'name'\n"
    "assert vals[1]==3 and isinstance(vals[1],int) and not isinstance(vals[1],bool), 'retries'\n"
    "if len(vals)>2:\n"
    "    assert vals[2] is True, 'enabled'\n"
    "    assert vals[3]==2 and isinstance(vals[3],int) and not isinstance(vals[3],bool), 'version'\n"
    "print('JSON VALID, types/values/order OK')\n"
)
vs = os.path.join(tempfile.gettempdir(), "verify_config_v011.py")
with open(vs, "w", encoding="utf-8") as f:
    f.write(verify_src)

def run_verify(expected_keys):
    cmdline = [py, vs, CFG, expected_keys]
    r = subprocess.run(cmdline, capture_output=True, text=True)
    print("verify cmd : python %s %s %s" % (vs, CFG, expected_keys))
    print("verify rc  :", r.returncode)
    if r.stdout.strip():
        print("verify out :\n" + r.stdout.rstrip())
    if r.stderr.strip():
        print("verify err :\n" + r.stderr.rstrip())
    return r.returncode == 0

# ---------------- 阶段二 写入 v1 ----------------
print("\n=== 阶段二 写入 v1 ===")
with open(CFG, "wb") as f:
    f.write(V1)
print("已写入:", CFG)
print("--- 自检: 原样内容 ---")
sys.stdout.write(raw(CFG).decode("utf-8"))
print("--- bytes:", len(raw(CFG)), "---")

# ---------------- 阶段三 验证 v1 ----------------
print("\n=== 阶段三 验证 v1 ===")
ok1 = run_verify("name,retries")
if not ok1:
    sys.exit(3)

# ---------------- 阶段四 升级 v2（增量） ----------------
print("\n=== 阶段四 升级 v2（增量修改） ===")
orig = raw(CFG)
assert orig == V1, "v1 内容被意外改动"
body = orig.decode("utf-8").rstrip("\n")
assert body.endswith("}"), body
new_body = body[:-1] + ',"enabled":true,"version":2}'
assert new_body[: len('{"name":"demo","retries":3')] == body[:-1], "前缀未保持"
with open(CFG, "wb") as f:
    f.write(new_body.encode("utf-8") + b"\n")
print("已升级写入:", CFG)
print("---