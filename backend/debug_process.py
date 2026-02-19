
import psutil
import time

print("Scanning for 'Zen' processes...")
found = False
for proc in psutil.process_iter(['pid', 'name', 'exe']):
    try:
        if 'Zen' in proc.info['name'] or 'Zen' in (proc.info['exe'] or ''):
            print(f"FOUND: PID={proc.info['pid']} Name={proc.info['name']} Exe={proc.info['exe']}")
            found = True
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        pass

if not found:
    print("No 'Zen' process found using psutil.")
else:
    print("Scan complete.")
