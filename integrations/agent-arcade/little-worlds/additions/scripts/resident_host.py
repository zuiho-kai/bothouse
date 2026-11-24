"""Launch the owner's installed Bothouse and publish authorized residents to their world."""
import os
from pathlib import Path
import queue
import re
import runpy
import socket
import subprocess
import threading
import time
import tomllib
from urllib.parse import urlsplit
import webbrowser

# Reuse the publisher's identity, auth filtering, snapshot and HTTP contracts.
publisher = runpy.run_path(str(Path(__file__).with_name("publish-residents.py")))


preview = runpy.run_path(str(Path(__file__).with_name("resident_preview.py")))


class HostError(Exception):
    """A status safe to show to the owner."""


def default_config(home, env):
    override = env.get("BOTHOUSE_DATA_DIR")
    if override:
        directory = home / override[2:] if override.startswith("~/") else (home if override == "~" else Path(override))
    else:
        directory = home / ".bothouse"
        legacy = home / ".cc-connect"
        if not directory.exists() and legacy.is_dir():
            directory = legacy
    return directory / "config.toml"


def installed_exe(home, env):
    dirs = [home / ".local" / "bin"]
    dirs.extend(Path(p) for p in env.get("PATH", "").split(os.pathsep) if p and Path(p).is_absolute())
    return next((p / "bothouse.exe" for p in dirs if (p / "bothouse.exe").is_file()), None)


def world_origin(value):
    value = value.strip()
    try:
        if any(c.isspace() or ord(c) < 32 or c in "\\%?#" for c in value):
            raise ValueError()
        parts = urlsplit(value)
        if parts.path == "/resident-settings":
            value = parts._replace(path="").geturl()
        base = publisher["origin"](value)
        if base.username is not None or base.password is not None or base.port == 0:
            raise ValueError()
        return base.scheme + "://" + base.netloc
    except ValueError:
        raise HostError("请输入世界的 HTTPS 地址。本机世界也可使用回环 HTTP 地址。") from None


def management_port(config):
    try:
        with config.open("rb") as stream:
            mgmt = tomllib.load(stream)["management"]
        port = mgmt.get("port") or 9820
        if not mgmt.get("enabled") or not mgmt.get("token") or type(port) is not int or not 1 <= port <= 65535:
            raise ValueError()
        return port
    except (OSError, ValueError, KeyError, TypeError):
        raise HostError("请选择已有 Bothouse 的 config.toml，并在 Bothouse 中启用有凭据的管理接口。") from None


def hidden_process(args):
    env = os.environ.copy()
    for name in ("LITTLE_WORLDS_PUBLISHER_TOKEN", "LITTLE_WORLDS_FRIENDS_COOKIE"):
        env.pop(name, None)
    return subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, env=env, shell=False,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def open_instance(config, executable, spawn=hidden_process):
    port = management_port(config)
    process = None
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=5):
                break
        except ConnectionRefusedError:
            if process is None:
                if not executable:
                    raise HostError("管理端未启动。请先打开自己的 Bothouse，或选择已安装的 bothouse.exe。") from None
                try:
                    process = spawn([str(executable), "--headless", "--config", str(config)])
                except OSError:
                    raise HostError("无法启动所选 Bothouse 程序。") from None
            if process.poll() is not None:
                raise HostError("Bothouse 启动后退出了。请在 Bothouse 中核对配置。")
            time.sleep(0.4)
    else:
        raise HostError("Bothouse 尚未就绪，请稍后重新读取。")
    try:
        return publisher["project_snapshot"](config, set())
    except Exception:
        raise HostError("未能读取可展示的角色。请检查实例身份、管理接口及其访问权限。") from None


def update(config, instance, base, code, stopped):
    if stopped.is_set():
        return
    if base.geturl() == preview["ORIGIN"]:
        revision = preview["release_id"]()
        if revision and not preview["check_running"](revision):
            raise HostError("本机预览未运行，请先打开本机星球。")
    try:
        return publisher["publish"](config, set(), None, base, code,
                                    expected_instance=instance, stopped=stopped)
    except publisher["HTTPStatusError"] as exc:
        if exc.status in (401, 403):
            raise HostError("世界连接已失效。请在本世界的居民设置中重新连接。") from None
        if exc.status == 409:
            raise HostError("这个实例已有星球连接。请使用原连接码，或先解除旧连接。") from None
        raise


def main():
    import tkinter as tk
    from tkinter import filedialog, ttk

    root = tk.Tk()
    root.title("小星球 · 房主的 Bothouse 居民")
    root.minsize(540, 420)
    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)
    panel = ttk.Frame(root, padding=16)
    panel.grid(sticky="nsew")
    panel.columnconfigure(0, weight=1)
    panel.rowconfigure(6, weight=1)

    cfg = tk.StringVar(value=str(default_config(Path.home(), os.environ)))
    exe = installed_exe(Path.home(), os.environ)
    local_ready = bool(preview["release_id"]())
    world = tk.StringVar(value=preview["ORIGIN"] if local_ready else "")
    code = tk.StringVar()
    status = tk.StringVar(value="在自己的专用 Bothouse 主机上，读取想展示给星球来访者的角色。")
    events = queue.Queue()
    snapshot, loading, stop_event = {}, False, None

    def choose():
        path = filedialog.askopenfilename(title="选择 Bothouse 配置", filetypes=[("Bothouse 配置", "*.toml")])
        if path:
            cfg.set(path)
            snapshot.clear()
            box.configure(state="normal")
            box.delete(0, "end")
            box.configure(state="disabled")
            status.set("请重新读取所选实例。")
            controls()

    def read():
        nonlocal loading
        if loading or stop_event:
            return
        loading = True
        path = Path(cfg.get()).resolve()
        box.configure(state="normal")
        box.delete(0, "end")
        box.configure(state="disabled")
        snapshot.clear()
        status.set("正在连接本机 Bothouse…")
        controls()

        def work():
            try:
                events.put(("directory", open_instance(path, exe)))
            except HostError as exc:
                events.put(("read_error", str(exc)))
            except Exception:
                events.put(("read_error", "未能连接本机 Bothouse。请检查实例后再试。"))
        threading.Thread(target=work, daemon=True).start()

    def choose_exe():
        nonlocal exe
        path = filedialog.askopenfilename(title="选择已安装的 Bothouse", filetypes=[("Bothouse", "bothouse.exe")])
        if path and Path(path).name.lower() == "bothouse.exe":
            exe = Path(path)
            read()

    def open_local(path):
        nonlocal loading
        if loading or stop_event:
            return
        if world.get() != preview["ORIGIN"]:
            world.set(preview["ORIGIN"])
        loading = True
        controls()
        status.set("正在打开本机测试世界…")
        def work():
            try:
                events.put(("local", preview["ensure_running"]() + path))
            except Exception:
                events.put(("read_error", "未能打开已安装的本机预览。请检查版本、端口及运行环境。"))
        threading.Thread(target=work, daemon=True).start()

    def settings():
        try:
            origin = world_origin(world.get())
            if local_ready and origin == preview["ORIGIN"]:
                open_local("/resident-settings")
                return
            address = origin + "/resident-settings"
            if not webbrowser.open(address):
                status.set("请在已登录世界的浏览器中打开 " + address)
        except HostError as exc:
            status.set(str(exc))

    def stop():
        if stop_event:
            stop_event.set()
            status.set("正在停止发布，等待当前请求结束…")
            controls()

    def start():
        nonlocal stop_event
        if stop_event or loading:
            return
        try:
            base = publisher["origin"](world_origin(world.get()))
        except HostError as exc:
            status.set(str(exc))
            return
        secret = code.get().strip()
        if not re.fullmatch("[0-9a-f]{64}", secret):
            status.set("请粘贴这个世界的完整连接码。")
            return
        stopped = stop_event = threading.Event()
        path, instance = Path(cfg.get()).resolve(), snapshot["instance"]
        status.set("正在向所选世界发布居民状态…")
        controls()

        def publish():
            try:
                while not stopped.is_set():
                    try:
                        updated = update(path, instance, base, secret, stopped)
                        if updated is not None:
                            events.put(("updated", updated))
                    except (OSError, ValueError, KeyError):
                        events.put(("retry", "状态暂未更新，6 秒后重试。可检查网络或停止发布。"))
                    if stopped.wait(6):
                        break
                events.put(("done", "发布已停止。若要立即移除居民，请在本世界的居民设置中解除连接。"))
            except HostError as exc:
                events.put(("done", str(exc)))
            except Exception:
                events.put(("done", "更新未获确认，发布已停止。请核对本机实例、世界连接码和网络，再重试。"))
        threading.Thread(target=publish, daemon=True).start()

    ttk.Label(panel, text="本机 Bothouse 配置").grid(row=0, sticky="w")
    ttk.Entry(panel, textvariable=cfg, state="readonly").grid(row=1, columnspan=2, sticky="ew")
    buttons = ttk.Frame(panel)
    buttons.grid(row=2, columnspan=2, sticky="w", pady=(4, 10))
    read_btn = ttk.Button(buttons, text="启动或读取 Bothouse", command=read)
    cfg_btn = ttk.Button(buttons, text="选择配置", command=choose)
    exe_btn = ttk.Button(buttons, text="选择程序", command=choose_exe)
    for button in (read_btn, cfg_btn, exe_btn):
        button.pack(side="left", padx=2)
    ttk.Label(panel, text="小星球地址").grid(row=3, sticky="w")
    local = ttk.Button(panel, text="打开本机星球", command=lambda: open_local("/")) if local_ready else None
    if local:
        local.grid(row=3, column=1, padx=(6, 0))
    world_entry = ttk.Entry(panel, textvariable=world)
    world_entry.grid(row=4, sticky="ew")
    bind = ttk.Button(panel, text="打开本世界的居民设置", command=settings)
    bind.grid(row=4, column=1, padx=(6, 0))
    ttk.Label(panel, text="当前可展示的居民 · 发布时自动跟随新增、改名与移除").grid(row=5, sticky="w", pady=(8, 2))
    box = tk.Listbox(panel, exportselection=False, height=6, takefocus=False, disabledforeground="SystemWindowText")
    box.grid(row=6, columnspan=2, sticky="nsew")
    ttk.Label(panel, text="粘贴居民设置生成的连接码").grid(row=7, sticky="w", pady=(8, 0))
    secret_entry = ttk.Entry(panel, textvariable=code, show="•")
    secret_entry.grid(row=8, columnspan=2, sticky="ew")
    world.trace_add("write", lambda *_: code.set(""))
    footer = ttk.Frame(panel)
    footer.grid(row=9, columnspan=2, sticky="w", pady=6)
    send = ttk.Button(footer, text="发布全部获准居民", command=start)
    halt = ttk.Button(footer, text="停止发布", command=stop)
    send.pack(side="left")
    halt.pack(side="left", padx=4)
    ttk.Label(panel, textvariable=status, wraplength=500).grid(row=10, columnspan=2, sticky="w")

    def controls():
        busy = loading or stop_event is not None
        for widget in (read_btn, cfg_btn, exe_btn, world_entry, bind, secret_entry):
            widget.configure(state="disabled" if busy else "normal")
        if local:
            local.configure(state="disabled" if busy else "normal")
        send.configure(state="normal" if snapshot and not busy else "disabled")
        halt.configure(state="normal" if stop_event and not stop_event.is_set() else "disabled")

    def watch():
        nonlocal snapshot, loading, stop_event
        while True:
            try:
                kind, value = events.get_nowait()
            except queue.Empty:
                break
            if kind in ("directory", "read_error", "local"):
                loading = False
                controls()
            if kind == "directory" or (kind == "updated" and stop_event and not stop_event.is_set()):
                snapshot = value
                box.configure(state="normal")
                box.delete(0, "end")
                for role in snapshot["residents"]:
                    box.insert("end", role["displayName"])
                box.configure(state="disabled")
                n = box.size()
                if kind == "updated":
                    status.set(f"世界已收到 {n} 位居民的状态。关闭此窗口会停止更新。")
                else:
                    status.set(f"已读取 {n} 位可展示的角色。" if n else "当前没有可展示的角色。可开始发布，新增获准角色后将自动加入。")
            elif kind == "local":
                if webbrowser.open(value):
                    status.set("初次使用请先进入本机星球，再打开居民设置连接自己的 Bothouse。")
                else:
                    status.set("请在浏览器中打开 " + value)
            elif kind == "done":
                stop_event = None
                status.set(value)
            elif kind == "read_error" or (kind == "retry" and not stop_event.is_set()):
                status.set(value)
            controls()
        root.after(150, watch)

    def close():
        if stop_event:
            stop_event.set()
        code.set("")
        root.destroy()
    root.protocol("WM_DELETE_WINDOW", close)
    controls()
    watch()
    root.mainloop()


if __name__ == "__main__":
    main()
