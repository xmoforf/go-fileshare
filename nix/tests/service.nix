{ pkgs, self }:
pkgs.testers.runNixOSTest {
  name = "file-share-service";
  nodes.machine = { ... }: {
    imports = [ self.nixosModules.default ];
    services.file-share = {
      enable = true;
      root = "/srv/shared files%";
      authFile = "/etc/owner/auth.json";
      listen = "127.0.0.1:8091";
      origin = "https://files.test";
    };
    environment.systemPackages = [ pkgs.curl pkgs.python3 pkgs.util-linux ];
    systemd.services.file-share-fixture = {
      before = [ "file-share.service" ];
      requiredBy = [ "file-share.service" ];
      serviceConfig.Type = "oneshot";
      script = ''
        install -d -m 0750 -o root -g file-share '/srv/shared files%' /etc/owner
        printf 'synthetic content\n' > '/srv/shared files%/hello.txt'
        chmod 0666 '/srv/shared files%/hello.txt'
        hash=$(printf 'nixos-test-password' | ${self.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/file-share -hash-password)
        printf '{"username":"owner","password_hash":"%s"}\n' "$hash" > /etc/owner/auth.json
        chown root:file-share /etc/owner/auth.json
        chmod 0640 /etc/owner/auth.json
      '';
      serviceConfig.RemainAfterExit = true;
    };
  };
  testScript = ''
    import json
    import shlex

    start_all()
    machine.wait_for_unit("file-share.service")
    machine.wait_until_succeeds("curl -fsS http://127.0.0.1:8091/healthz")
    machine.succeed("ss -ltn | grep '127.0.0.1:8091'")
    machine.fail("curl -fsS http://127.0.0.1:8080/healthz")
    pid = machine.succeed("systemctl show -p MainPID --value file-share").strip()
    uid = machine.succeed("id -u file-share").strip()
    assert uid != "0"
    assert machine.succeed(f"ps -o uid= -p {pid}").strip() == uid
    assert machine.succeed("stat -c '%U:%G:%a' /var/lib/file-share").strip() == "file-share:file-share:700"
    assert machine.succeed("stat -c '%U:%G:%a' /etc/owner/auth.json").strip() == "root:file-share:640"
    machine.fail("runuser -u nobody -- cat /etc/owner/auth.json")
    machine.fail("runuser -u nobody -- cat /var/lib/file-share/shares.db")
    for path in ["/srv/shared files%/hello.txt", "/etc/owner/auth.json"]:
        command = "echo forbidden >> " + shlex.quote(path)
        status, output = machine.execute(f"nsenter -t {pid} -m -- sh -c {shlex.quote(command)} 2>&1")
        assert status != 0 and "Read-only file system" in output
    assert machine.succeed("systemctl show -p NoNewPrivileges --value file-share").strip() == "yes"

    def api(path, method="GET", body=None, cookie="", expected=200):
        args = ["curl", "-sS", "-o", "/tmp/response", "-w", "%{http_code}", "-X", method,
                "-H", "Origin: https://files.test", "-H", "X-Requested-With: file-share",
                "-D", "/tmp/headers"]
        if body is not None:
            args += ["-H", "Content-Type: application/json", "--data", json.dumps(body)]
        if cookie:
            args += ["-H", "Cookie: " + cookie]
        args += ["http://127.0.0.1:8091" + path]
        assert machine.succeed(shlex.join(args)).strip() == str(expected)
        return machine.succeed("cat /tmp/response")

    def login():
        api("/api/login", "POST", {"username": "owner", "password": "nixos-test-password"})
        headers = machine.succeed("cat /tmp/headers")
        return next(line.split(":", 1)[1].strip().split(";", 1)[0]
                    for line in headers.splitlines() if line.lower().startswith("set-cookie:"))

    api("/api/list", expected=401)
    cookie = login()
    assert "hello.txt" in api("/api/list", cookie=cookie)
    share = json.loads(api("/api/shares", "POST", {"path": "hello.txt", "seconds": 3600}, cookie, 201))
    link = "/s/" + share["token"]
    assert api(link) == "synthetic content\n"
    machine.succeed("systemctl restart file-share")
    machine.wait_until_succeeds("curl -fsS http://127.0.0.1:8091/healthz")
    api("/api/list", cookie=cookie, expected=401)
    assert api(link) == "synthetic content\n"
    cookie = login()
    api("/api/shares?token=" + share["token"], "DELETE", cookie=cookie, expected=204)
    machine.succeed("systemctl restart file-share")
    machine.wait_until_succeeds("curl -fsS http://127.0.0.1:8091/healthz")
    api(link, expected=404)
    machine.succeed("systemctl stop file-share")
    assert machine.succeed("systemctl show -p Result --value file-share").strip() == "success"
    machine.succeed("mv /etc/owner/auth.json /etc/owner/auth.saved")
    machine.execute("systemctl start file-share")
    machine.wait_until_succeeds("journalctl -u file-share --no-pager | grep -E 'cannot read owner credentials|Failed to set up mount namespacing'")
    machine.fail("curl -fsS http://127.0.0.1:8091/healthz")
    machine.succeed("systemctl stop file-share")
  '';
}
