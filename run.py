import os
import sys
import subprocess
import signal

root_dir = os.path.dirname(os.path.abspath(__file__))
dev_js = os.path.join(root_dir, "scripts", "dev.js")

# Forward to node dev.js if node is available, else run via Python subprocesses
try:
    cmd = ["node", dev_js] + sys.argv[1:]
    proc = subprocess.run(cmd)
    sys.exit(proc.returncode)
except FileNotFoundError:
    pass

# Fallback in pure Python if Node is not found
backend_dir = os.path.join(root_dir, "backend")
frontend_dir = os.path.join(root_dir, "frontend")

python_candidates = [
    os.path.join(backend_dir, ".venv", "Scripts", "python.exe"),
    os.path.join(root_dir, ".venv", "Scripts", "python.exe"),
    sys.executable,
]
python_exe = next((p for p in python_candidates if os.path.exists(p)), sys.executable)

backend_proc = subprocess.Popen(
    [python_exe, "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
    cwd=backend_dir,
    env={**os.environ, "PYTHONPATH": backend_dir}
)

npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
frontend_proc = subprocess.Popen(
    [npm_cmd, "run", "dev"],
    cwd=frontend_dir,
    shell=True
)

print("\n🚀 Finsk Backend and Frontend are running!")
print("📍 Backend:  http://127.0.0.1:8000")
print("📍 Frontend: http://localhost:3000")
print("Press Ctrl+C to terminate both servers.\n")

def shutdown(signum, frame):
    print("\nStopping services...")
    if sys.platform == "win32":
        subprocess.run(f"taskkill /pid {backend_proc.pid} /T /F", shell=True)
        subprocess.run(f"taskkill /pid {frontend_proc.pid} /T /F", shell=True)
    else:
        backend_proc.terminate()
        frontend_proc.terminate()
    sys.exit(0)

signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

backend_proc.wait()
frontend_proc.wait()

