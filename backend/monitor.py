import psutil
import time
import json
import os
import threading
import logging
from datetime import datetime, timezone, timedelta

class SystemObserver:
    def __init__(self):
        self.is_running = False
        self._lock = threading.RLock()
        
        # State
        self.activity_state = {
            "status": "idle", # idle, active
            "type": None,     # gaming, coding
            "name": None,     # Process/App name
            "start_time": None,
            "last_seen": None,
        }
        
        # History (for transition narratives: "Just closed game")
        self.last_session = {
            "type": None,
            "name": None,
            "duration_minutes": 0,
            "end_time": None
        }

        self.memory_pressure = False
        self.cpu_load = 0.0
        
        # Config
        self.PROCESS_DEFINITIONS = self._load_process_config()
        self.MEMORY_THRESHOLD = 80.0
        self.CHECK_INTERVAL = 5 # More frequent checks for accurate state transitions
        self.COOLDOWN_MINUTES = 30 # For narrative relevance

        # Cache
        self.last_check_time = 0
        self.cached_status = {}

    def _load_process_config(self) -> dict:
        """
        Load process definitions from games.json.
        Fallback to hardcoded defaults if file missing/invalid.
        """
        defaults = {
            "Antigravity.exe": {"name": "Antigravity", "type": "coding"},
            "ZenlessZoneZero.exe": {"name": "绝区零", "type": "gaming"},
            "Wuthering Waves.exe": {"name": "鸣潮", "type": "gaming"},
        }
        
        config_path = "games.json"
        if not os.path.exists(config_path):
            # Try absolute path relative to this file
            base_dir = os.path.dirname(os.path.abspath(__file__))
            config_path = os.path.join(base_dir, "games.json")
            
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    definitions = {}
                    if "apps" in data and isinstance(data["apps"], list):
                        for app in data["apps"]:
                            key = app.get("exe")
                            if key:
                                definitions[key] = {
                                    "name": app.get("name", key),
                                    "type": app.get("type", "unknown")
                                }
                        print(f"[SystemObserver] Loaded {len(definitions)} apps from {config_path}")
                        return definitions
            except Exception as e:
                print(f"[SystemObserver] Failed to load config: {e}")
        
        return defaults

    def start(self):
        self.is_running = True
        self._update_telemetry()

    def capture_snapshot(self) -> dict:
        """
        Active capture triggered by Signal.
        Returns the current telemetry snapshot for injection.
        """
        self._update_telemetry()
        with self._lock:
            return self.cached_status

    def _update_telemetry(self):
        with self._lock:
            now_ts = time.time()
            now = datetime.now()
            self.last_check_time = now_ts
            
            # 1. Resource Check
            mem = psutil.virtual_memory()
            self.memory_pressure = mem.percent > self.MEMORY_THRESHOLD
            self.cpu_load = psutil.cpu_percent(interval=0.1)

            # 2. Process Check
            # 2. Process Check with Priority
            # Priority: Gaming (100) > Coding (50) > Others (10)
            priority_map = {"gaming": 100, "coding": 50, "browsing": 10}
            candidates = []

            try:
                # We interpret process_iter once to avoid overhead, but filtering tracked names
                for proc in psutil.process_iter(['name']):
                    try:
                        p_name = proc.info['name']
                        if p_name in self.PROCESS_DEFINITIONS:
                            data = self.PROCESS_DEFINITIONS[p_name]
                            prio = priority_map.get(data["type"], 0)
                            # Store create_time for accurate duration
                            candidates.append((prio, data, proc.create_time()))
                    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                        pass
            except Exception as e:
                pass

            if candidates:
                # Pick highest priority
                candidates.sort(key=lambda x: x[0], reverse=True)
                found_activity = candidates[0][1]
                found_start_time = datetime.fromtimestamp(candidates[0][2], tz=timezone.utc) # Keep as aware UTC

            # 3. State Machine Transition
            
            if found_activity:
                # State: ACTIVE
                if self.activity_state["status"] != "active":
                    # New Session Started
                    self.activity_state["status"] = "active"
                    # Use actual process start time if available, else now
                    self.activity_state["start_time"] = found_start_time if found_start_time else now
                
                # Check if we switched apps?
                # If same status but different start time (e.g. restarted game), update it.
                # Simplify: just overwrite start_time if found
                # But wait, self.activity_state["start_time"] should be consistent.
                # If we switch from VSCode to Game, start_time changes.
                if self.activity_state["name"] != found_activity["name"]:
                     self.activity_state["start_time"] = found_start_time

                # Update current activity details
                self.activity_state["type"] = found_activity["type"]
                self.activity_state["name"] = found_activity["name"]
                self.activity_state["last_seen"] = now
                
            else:
                # IDLE / JUST CLOSED
                if self.activity_state["status"] == "active":
                    # Session Just Ended -> Move to History
                    duration_min = int((now - self.activity_state["start_time"]).total_seconds() / 60) if self.activity_state["start_time"] else 0
                    
                    self.last_session = {
                        "type": self.activity_state["type"],
                        "name": self.activity_state["name"],
                        "duration_minutes": duration_min,
                        "end_time": now
                    }
                    
                    # Reset Current State
                    self.activity_state["status"] = "idle"
                    self.activity_state["type"] = None
                    self.activity_state["name"] = None
                    self.activity_state["start_time"] = None
                    self.activity_state["last_seen"] = None

            # 4. Check History Relevance (Expires after X mins)
            if self.last_session["end_time"]:
                minutes_since_end = (now - self.last_session["end_time"]).total_seconds() / 60
                if minutes_since_end > self.COOLDOWN_MINUTES:
                     self.last_session = {
                        "type": None,
                        "name": None,
                        "duration_minutes": 0,
                        "end_time": None
                    }

            # 5. Build Output Payload
            self.cached_status = {
                "resources": {
                    "memory_pressure": self.memory_pressure,
                    "cpu_load": self.cpu_load
                },
                "activity": {
                    "type": self.activity_state["type"],
                    "name": self.activity_state["name"],
                    "status": self.activity_state["status"],
                    # Calculate live duration if active
                    "duration_minutes": int((now.timestamp() - self.activity_state["start_time"].timestamp()) / 60) 
                                        if self.activity_state["status"] == "active" and self.activity_state["start_time"] 
                                        else 0
                },
                "last_session": {
                    "type": self.last_session["type"],
                    "name": self.last_session["name"],
                    "duration_minutes": self.last_session["duration_minutes"],
                    "minutes_ago": int((now.timestamp() - self.last_session["end_time"].timestamp()) / 60) if self.last_session["end_time"] else 0
                }
            }
