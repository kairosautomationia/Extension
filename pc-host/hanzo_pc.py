"""
Hanzo PC: componente local que deja a la extensión Hanzo manejar apps de escritorio en Windows.

Chrome lo arranca por "native messaging" (mensajes JSON con 4 bytes de longitud por stdin/stdout)
solo cuando la extensión Hanzo lo pide. No abre puertos ni se conecta a internet.

Seguridad:
- Solo ve y toca las ventanas de las apps de config.json ("apps"). Las demás ni se listan.
- Solo lee o escribe archivos dentro de las carpetas de config.json ("folders").
- Los campos de contraseña nunca se leen ni se escriben.
- Cada acción queda en hanzo_pc.log, junto a este archivo.
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

VERSION = "0.1.0"
HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
_LOG_DIR = Path(os.environ.get("LOCALAPPDATA") or HERE) / "HanzoPC"
LOG_PATH = _LOG_DIR / "hanzo_pc.log"

MAX_ELEMENTS = 80  # elementos que se le muestran al modelo por paso
MAX_VISIT = 600  # nodos de la interfaz que se recorren como máximo (Excel puede tener miles)
MAX_DEPTH = 14

INTERACTIVE = {
    "Button", "Edit", "MenuItem", "ListItem", "TreeItem", "Hyperlink", "CheckBox", "RadioButton",
    "ComboBox", "TabItem", "Document", "DataItem", "SplitButton",
}
RISKY_WORDS = ("eliminar", "borrar", "delete", "enviar", "send", "pagar", "pay", "comprar", "transferir",
               "quitar", "remove", "formatear", "desinstalar", "uninstall", "no guardar", "don't save")


# ---------------------------------------------------------------- configuración

def default_config() -> dict:
    home = Path(os.environ.get("USERPROFILE") or Path.home())
    folders = [str(home / "Documents"), str(home / "Desktop"), str(home / "Downloads")]
    for var in ("OneDriveCommercial", "OneDrive"):
        v = os.environ.get(var)
        if v and v not in folders:
            folders.append(v)
    return {
        "apps": {
            "bloc de notas": {"run": "notepad.exe", "exe": ["notepad.exe"]},
            "excel": {"run": "excel.exe", "exe": ["excel.exe"]},
            "word": {"run": "winword.exe", "exe": ["winword.exe"]},
            "paint": {"run": "mspaint.exe", "exe": ["mspaint.exe"]},
        },
        "folders": folders,
    }


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        cfg = default_config()
        try:
            CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass
        return cfg
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default_config()
    base = default_config()
    cfg.setdefault("apps", base["apps"])
    cfg.setdefault("folders", base["folders"])
    return cfg


def log(event: str, data: dict | None = None) -> None:
    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"t": datetime.now().isoformat(timespec="seconds"), "e": event, **(data or {})}, ensure_ascii=False) + "\n")
        if LOG_PATH.stat().st_size > 2_000_000:  # rota el registro para que no crezca sin límite
            LOG_PATH.replace(LOG_PATH.with_suffix(".old.log"))
    except OSError:
        pass


# ---------------------------------------------------------------- archivos (Excel)

def allowed_path(cfg: dict, p: str) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(p))).resolve()
    for root in cfg["folders"]:
        try:
            path.relative_to(Path(os.path.expandvars(root)).resolve())
            return path
        except ValueError:
            continue
    raise PermissionError("Esa carpeta no está permitida. Agrégala en config.json (\"folders\") si quieres usarla.")


def find_files(cfg: dict, name: str) -> list[str]:
    name = name.lower().strip()
    out: list[str] = []
    if not name:
        return out
    for root in cfg["folders"]:
        base = Path(os.path.expandvars(root))
        if not base.is_dir():
            continue
        start_depth = len(base.parts)
        for dirpath, dirnames, filenames in os.walk(base):
            if len(Path(dirpath).parts) - start_depth >= 4:
                dirnames[:] = []
            dirnames[:] = [d for d in dirnames if not d.startswith((".", "$")) and d not in ("node_modules", "AppData")]
            for fn in filenames:
                if name in fn.lower():
                    out.append(str(Path(dirpath) / fn))
                    if len(out) >= 15:
                        return out
    return out


def excel_read(cfg: dict, path: str, sheet: str | None = None, max_rows: int = 30) -> dict:
    from openpyxl import load_workbook

    p = allowed_path(cfg, path)
    wb = load_workbook(p, read_only=True, data_only=True)
    try:
        ws = wb[sheet] if sheet and sheet in wb.sheetnames else wb.worksheets[0]
        rows = []
        for r in ws.iter_rows(max_row=max_rows, values_only=True):
            cells = ["" if v is None else str(v) for v in r]
            while cells and cells[-1] == "":
                cells.pop()
            rows.append(cells)
        return {"sheets": wb.sheetnames, "sheet": ws.title, "rows": rows, "total_rows": ws.max_row}
    finally:
        wb.close()


def excel_write(cfg: dict, path: str, cell: str, text: str, sheet: str | None = None) -> dict:
    from openpyxl import Workbook, load_workbook

    p = allowed_path(cfg, path)
    if p.suffix.lower() not in (".xlsx", ".xlsm"):
        raise ValueError("Solo puedo escribir archivos .xlsx o .xlsm.")
    if p.exists():
        wb = load_workbook(p, keep_vba=p.suffix.lower() == ".xlsm")
    else:
        wb = Workbook()
    ws = wb[sheet] if sheet and sheet in wb.sheetnames else (wb.create_sheet(sheet) if sheet else wb.worksheets[0])
    value: object = text
    t = text.strip()
    try:
        if t and t.replace(".", "", 1).lstrip("-").isdigit():
            value = float(t) if "." in t else int(t)
    except ValueError:
        value = text
    ws[cell.upper()] = value
    try:
        wb.save(p)
    except PermissionError:
        raise PermissionError("El archivo está abierto en Excel. Ciérralo o escribe en la ventana de Excel.")
    return {"saved": str(p), "sheet": ws.title, "cell": cell.upper()}


# ---------------------------------------------------------------- ventanas (Windows)

def send_keys_escape(text: str) -> str:
    return "".join("{" + c + "}" if c in "+^%~(){}[]" else c for c in text)


KEY_NAMES = {
    "enter": "{ENTER}", "tab": "{TAB}", "esc": "{ESC}", "escape": "{ESC}", "up": "{UP}", "down": "{DOWN}",
    "left": "{LEFT}", "right": "{RIGHT}", "pageup": "{PGUP}", "pagedown": "{PGDN}", "home": "{HOME}", "end": "{END}",
    "delete": "{DEL}", "supr": "{DEL}", "backspace": "{BACKSPACE}", "space": " ",
    **{f"f{i}": f"{{F{i}}}" for i in range(1, 13)},
}
MODS = {"ctrl": "^", "control": "^", "alt": "%", "shift": "+"}


def to_send_keys(combo: str) -> str:
    parts = [p.strip().lower() for p in combo.replace(" ", "").split("+") if p.strip()]
    if not parts:
        raise ValueError("Tecla vacía.")
    *mods, key = parts
    prefix = ""
    for m in mods:
        if m not in MODS:
            raise ValueError(f"Modificador no válido: {m}")
        prefix += MODS[m]
    if key in KEY_NAMES:
        k = KEY_NAMES[key]
    elif len(key) == 1 and key.isalnum():
        k = key
    else:
        raise ValueError(f"Tecla no válida: {key}")
    return prefix + k


class WinBackend:
    """Maneja ventanas reales con pywinauto (UI Automation)."""

    def __init__(self, cfg: dict):
        from pywinauto import Desktop  # noqa: F401  (falla aquí si no está instalado)

        self.cfg = cfg
        self.current = None  # ventana de trabajo
        self.els: dict[int, object] = {}
        self.wins: dict[int, object] = {}

    # -- utilidades
    def _exe(self, w) -> str:
        try:
            import psutil

            return psutil.Process(w.process_id()).name().lower()
        except Exception:
            return ""

    def _allowed_exes(self) -> set[str]:
        return {e.lower() for a in self.cfg["apps"].values() for e in a.get("exe", [])}

    def _windows(self) -> list:
        from pywinauto import Desktop

        allowed = self._allowed_exes()
        out = []
        for w in Desktop(backend="uia").windows(visible_only=True):
            try:
                if w.window_text().strip() and self._exe(w) in allowed:
                    out.append(w)
            except Exception:
                continue
        return out

    def _alive(self, w) -> bool:
        try:
            return w is not None and w.is_visible()
        except Exception:
            return False

    def _pick_current(self):
        if self._alive(self.current):
            return self.current
        wins = self._windows()
        self.current = wins[0] if wins else None  # la de más arriba (orden Z)
        return self.current

    @staticmethod
    def _is_password(e) -> bool:
        try:
            return bool(e.element_info.element.CurrentIsPassword)
        except Exception:
            return False

    # -- operaciones
    def snapshot(self) -> dict:
        wins = self._windows()
        self.wins = {i + 1: w for i, w in enumerate(wins[:15])}
        cur = self._pick_current()
        self.els = {}
        els = []
        if cur is not None:
            queue = [(cur, 0)]
            visited = 0
            while queue and visited < MAX_VISIT and len(els) < MAX_ELEMENTS:
                node, depth = queue.pop(0)
                visited += 1
                try:
                    info = node.element_info
                    ctype = info.control_type or ""
                    if node is not cur and ctype in INTERACTIVE and node.is_visible() and node.is_enabled():
                        r = node.rectangle()
                        if r.width() > 0 and r.height() > 0:
                            label = (info.name or "").strip()[:80]
                            pwd = ctype == "Edit" and self._is_password(node)
                            value = ""
                            if ctype in ("Edit", "ComboBox", "Document") and not pwd:
                                try:
                                    value = str(node.get_value() or "")
                                except Exception:
                                    try:
                                        value = node.window_text() or ""
                                    except Exception:
                                        value = ""
                            if label or value or ctype in ("Edit", "Document"):
                                eid = len(els)
                                self.els[eid] = node
                                low = label.lower()
                                risk = "blocked" if pwd else ("high" if any(w in low for w in RISKY_WORDS) else "normal")
                                els.append({"id": eid, "kind": ctype, "label": label,
                                            "value": value[:200] if value else None, "risk": risk})
                    if depth < MAX_DEPTH:
                        queue.extend((c, depth + 1) for c in node.children())
                except Exception:
                    continue
        return {
            "window": {"title": cur.window_text()[:120], "app": self._exe(cur)} if cur is not None else None,
            "windows": [{"id": i, "title": w.window_text()[:80], "app": self._exe(w)} for i, w in self.wins.items()],
            "els": els,
        }

    def open(self, app: str) -> dict:
        key = app.lower().strip()
        apps = self.cfg["apps"]
        if key not in apps:
            raise PermissionError(f"«{app}» no está en la lista de apps permitidas (config.json).")
        before = {w.handle for w in self._windows()}
        cmd = apps[key]["run"]
        try:
            os.startfile(cmd)  # type: ignore[attr-defined]
        except OSError:
            subprocess.Popen(cmd, shell=False)
        exes = {e.lower() for e in apps[key].get("exe", [])}
        for _ in range(40):  # hasta 10 s esperando la ventana
            time.sleep(0.25)
            for w in self._windows():
                if w.handle not in before and self._exe(w) in exes:
                    self.current = w
                    w.set_focus()
                    return {"title": w.window_text()[:120]}
        # La app ya estaba abierta (algunas reutilizan la ventana): se usa la suya
        for w in self._windows():
            if self._exe(w) in exes:
                self.current = w
                w.set_focus()
                return {"title": w.window_text()[:120]}
        raise RuntimeError("Abrí la app, pero no apareció su ventana.")

    def focus(self, wid: int) -> dict:
        w = self.wins.get(wid)
        if w is None or not self._alive(w):
            raise ValueError("Esa ventana ya no existe.")
        self.current = w
        w.set_focus()
        return {"title": w.window_text()[:120]}

    def _el(self, eid: int):
        e = self.els.get(eid)
        if e is None:
            raise ValueError("Ese elemento no existe; vuelve a mirar la ventana.")
        if self._is_password(e):
            raise PermissionError("Es un campo de contraseña: debes llenarlo tú.")
        return e

    def click(self, eid: int) -> dict:
        e = self._el(eid)
        if self.current is not None:
            self.current.set_focus()
        try:
            e.click_input()  # mueve el mouse de verdad: la persona ve qué se toca
        except Exception:
            e.invoke()
        return {}

    def type(self, eid: int, text: str) -> dict:
        e = self._el(eid)
        if self.current is not None:
            self.current.set_focus()
        try:
            e.set_edit_text(text)
        except Exception:
            e.click_input()
            e.type_keys("^a{BACKSPACE}" + send_keys_escape(text), with_spaces=True, with_newlines=True, pause=0.01)
        return {}

    def key(self, combo: str) -> dict:
        from pywinauto.keyboard import send_keys

        if self.current is None:
            raise RuntimeError("No hay ventana de trabajo.")
        self.current.set_focus()
        send_keys(to_send_keys(combo))
        return {}


class FakeBackend:
    """Ventanas simuladas, para probar fuera de Windows (HANZO_PC_FAKE=1)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.open_apps: list[dict] = []
        self.current: dict | None = None

    def snapshot(self) -> dict:
        cur = self.current
        els = []
        if cur:
            els = [
                {"id": 0, "kind": "Document", "label": "Editor de texto", "value": cur["text"] or None, "risk": "normal"},
                {"id": 1, "kind": "MenuItem", "label": "Archivo", "value": None, "risk": "normal"},
                {"id": 2, "kind": "Button", "label": "Eliminar todo", "value": None, "risk": "high"},
                {"id": 3, "kind": "Edit", "label": "Contraseña", "value": None, "risk": "blocked"},
            ]
        return {
            "window": {"title": cur["title"], "app": cur["app"]} if cur else None,
            "windows": [{"id": i + 1, "title": w["title"], "app": w["app"]} for i, w in enumerate(self.open_apps)],
            "els": els,
        }

    def open(self, app: str) -> dict:
        key = app.lower().strip()
        if key not in self.cfg["apps"]:
            raise PermissionError(f"«{app}» no está en la lista de apps permitidas (config.json).")
        w = {"title": f"Sin título: {key}", "app": self.cfg["apps"][key]["exe"][0], "text": "", "keys": []}
        self.open_apps.append(w)
        self.current = w
        return {"title": w["title"]}

    def focus(self, wid: int) -> dict:
        if not 1 <= wid <= len(self.open_apps):
            raise ValueError("Esa ventana ya no existe.")
        self.current = self.open_apps[wid - 1]
        return {"title": self.current["title"]}

    def click(self, eid: int) -> dict:
        if not self.current or eid not in (0, 1, 2, 3):
            raise ValueError("Ese elemento no existe; vuelve a mirar la ventana.")
        if eid == 3:
            raise PermissionError("Es un campo de contraseña: debes llenarlo tú.")
        if eid == 2:
            self.current["text"] = ""
        return {}

    def type(self, eid: int, text: str) -> dict:
        if not self.current or eid != 0:
            raise ValueError("Ese elemento no existe; vuelve a mirar la ventana.")
        self.current["text"] = text
        return {}

    def key(self, combo: str) -> dict:
        to_send_keys(combo)
        if not self.current:
            raise RuntimeError("No hay ventana de trabajo.")
        self.current["keys"].append(combo)
        if combo.lower() == "ctrl+s":
            self.current["title"] = "guardado.txt"
        return {}


# ---------------------------------------------------------------- protocolo

def read_msg() -> dict | None:
    raw = _IN.read(4)
    if len(raw) < 4:
        return None
    (n,) = struct.unpack("<I", raw)
    if n > 1_000_000:
        return None
    data = _IN.read(n)
    return json.loads(data.decode("utf-8"))


_OUT = sys.stdout.buffer  # canal del protocolo (Chrome)
_IN = sys.stdin.buffer


def write_msg(obj: dict) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    if len(data) > 900_000:
        data = json.dumps({"id": obj.get("id"), "ok": False, "error": "Respuesta demasiado grande."}).encode("utf-8")
    _OUT.write(struct.pack("<I", len(data)) + data)
    _OUT.flush()


def handle(backend, cfg: dict, msg: dict) -> dict:
    op = msg.get("op")
    if op == "ping":
        return {"version": VERSION, "apps": sorted(cfg["apps"].keys()), "folders": cfg["folders"]}
    if op == "snapshot":
        return backend.snapshot()
    if op == "open":
        return backend.open(str(msg.get("app", "")))
    if op == "focus":
        return backend.focus(int(msg.get("window", -1)))
    if op == "click":
        return backend.click(int(msg.get("el", -1)))
    if op == "type":
        return backend.type(int(msg.get("el", -1)), str(msg.get("text", ""))[:2000])
    if op == "key":
        return backend.key(str(msg.get("keys", "")))
    if op == "find_file":
        return {"files": find_files(cfg, str(msg.get("name", "")))}
    if op == "excel_read":
        return excel_read(cfg, str(msg.get("path", "")), msg.get("sheet"))
    if op == "excel_write":
        return excel_write(cfg, str(msg.get("path", "")), str(msg.get("cell", "A1")), str(msg.get("text", "")), msg.get("sheet"))
    raise ValueError(f"Operación desconocida: {op}")


def main() -> None:
    if sys.platform == "win32":
        import msvcrt

        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    # Cualquier print de una librería (pywinauto, comtypes) va a stderr y no corrompe los mensajes a Chrome
    sys.stdout = sys.stderr
    cfg = load_config()
    backend_error = None
    backend = None
    try:
        backend = FakeBackend(cfg) if os.environ.get("HANZO_PC_FAKE") == "1" else WinBackend(cfg)
    except Exception as e:  # pywinauto no instalado, o no es Windows
        backend_error = f"No pude iniciar el control de ventanas: {e}. Vuelve a ejecutar instalar.bat."
    log("inicio", {"version": VERSION, "error": backend_error})
    while True:
        try:
            msg = read_msg()
        except Exception:
            break
        if msg is None:
            break  # Chrome cerró la conexión (p. ej. el usuario pulsó Detener)
        mid = msg.get("id")
        try:
            if backend is None and msg.get("op") != "ping":
                raise RuntimeError(backend_error or "Sin control de ventanas.")
            result = handle(backend, cfg, msg)
            if msg.get("op") == "ping" and backend_error:
                result["error"] = backend_error
            write_msg({"id": mid, "ok": True, **result})
            if msg.get("op") not in ("snapshot", "ping"):
                log(str(msg.get("op")), {k: v for k, v in msg.items() if k not in ("id", "op")})
        except Exception as e:
            write_msg({"id": mid, "ok": False, "error": str(e) or e.__class__.__name__})
            log("error", {"op": msg.get("op"), "error": str(e)})


# ---------------------------------------------------------------- utilidades del instalador

def find_extension_ids(dist: str | None = None) -> list[str]:
    """IDs de la extensión Hanzo cargada en Chrome o Edge (perfiles del usuario de Windows)."""
    local = os.environ.get("LOCALAPPDATA", "")
    roots = [Path(local) / "Google" / "Chrome" / "User Data", Path(local) / "Microsoft" / "Edge" / "User Data"]
    want = os.path.normcase(os.path.normpath(dist)) if dist else None
    ids: list[str] = []
    for root in roots:
        if not root.is_dir():
            continue
        for prof in root.iterdir():
            for fn in ("Secure Preferences", "Preferences"):
                f = prof / fn
                if not f.is_file():
                    continue
                try:
                    data = json.loads(f.read_text(encoding="utf-8", errors="replace"))
                except (OSError, ValueError):
                    continue
                settings = (data.get("extensions") or {}).get("settings") or {}
                for ext_id, info in settings.items():
                    path = (info or {}).get("path") if isinstance(info, dict) else None
                    if not path or ext_id in ids:
                        continue
                    if not os.path.isabs(path):
                        continue  # extensiones de la tienda: ruta relativa, no son Hanzo sin empaquetar
                    same = want and os.path.normcase(os.path.normpath(path)) == want
                    name_ok = False
                    try:
                        name_ok = json.loads((Path(path) / "manifest.json").read_text(encoding="utf-8")).get("name") == "Hanzo"
                    except (OSError, ValueError):
                        pass
                    if same or name_ok:
                        ids.append(ext_id)
    return ids


def warmup() -> None:
    """La primera vez pywinauto genera código de Windows (puede tardar); se hace al instalar, no al usar /pc."""
    from pywinauto import Desktop

    Desktop(backend="uia").windows()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--find-ids":
        print("\n".join(find_extension_ids(sys.argv[2] if len(sys.argv) > 2 else None)))
    elif len(sys.argv) > 1 and sys.argv[1] == "--warmup":
        warmup()
        print("ok")
    else:
        main()
