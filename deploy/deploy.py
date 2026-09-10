"""
One-command deploy to a Linux host over SSH.

    .venv\\Scripts\\python deploy\\deploy.py --host 192.168.201.222 --user root
    (password is asked for, or pass --password / --key path)

Copies the project (without .venv, sprites, test files) to /opt/sketch_aquarium and runs
deploy/install.sh there, which installs packages, builds the venv, generates the sheets
and (re)starts the service.
"""
import argparse
import getpass
import os
import posixpath
import stat
import sys

import paramiko

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REMOTE = "/opt/sketch_aquarium"
SKIP_DIRS = {".venv", "sprites", "test_scans", "inbox", "__pycache__", ".git", "edge"}
SKIP_FILES = {"species_preview.png"}


def walk_local():
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn in SKIP_FILES or fn.endswith((".pyc", ".bat")) and fn != "requirements.txt":
                if fn.endswith(".bat"):
                    continue
            rel = os.path.relpath(os.path.join(dp, fn), ROOT).replace("\\", "/")
            yield os.path.join(dp, fn), rel


def sftp_mkdirs(sftp, path):
    parts = path.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


def run(ssh, cmd, echo=True):
    _, out, err = ssh.exec_command(cmd, get_pty=True)
    text = out.read().decode(errors="replace")
    code = out.channel.recv_exit_status()
    if echo:
        print(text.rstrip())
    return code, text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--user", default="root")
    ap.add_argument("--password")
    ap.add_argument("--key", help="private key file")
    ap.add_argument("--port", type=int, default=22)
    ap.add_argument("--no-install", action="store_true", help="copy files only")
    a = ap.parse_args()

    pw = a.password
    if not pw and not a.key:
        pw = getpass.getpass(f"{a.user}@{a.host} password: ")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(a.host, port=a.port, username=a.user, password=pw, key_filename=a.key, timeout=20)
    sftp = ssh.open_sftp()

    print(f"== copying to {a.user}@{a.host}:{REMOTE}")
    n = 0
    for local, rel in walk_local():
        remote = posixpath.join(REMOTE, rel)
        sftp_mkdirs(sftp, posixpath.dirname(remote))
        sftp.put(local, remote)
        if rel.endswith(".sh"):
            sftp.chmod(remote, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
        n += 1
    print(f"   {n} files")
    sftp.close()

    if not a.no_install:
        print("== installing (this takes a few minutes the first time)")
        code, _ = run(ssh, f"sed -i 's/\\r$//' {REMOTE}/deploy/install.sh {REMOTE}/deploy/env && bash {REMOTE}/deploy/install.sh")
        if code != 0:
            print("install.sh failed with code", code)
            sys.exit(code)
    ssh.close()
    print("== done")


if __name__ == "__main__":
    main()
