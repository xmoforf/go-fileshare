{ self }:
{ config, lib, pkgs, utils, ... }:
let
  cfg = config.services.file-share;
  absolutePath = lib.types.strMatching "/[^\n\r]+";
in {
  options.services.file-share = {
    enable = lib.mkEnableOption "single-owner read-only file sharing";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "self.packages.\${pkgs.stdenv.hostPlatform.system}.default";
      description = "File-share package to run.";
    };
    root = lib.mkOption {
      type = absolutePath;
      default = "/srv/file-share";
      description = "Existing served directory, readable by file-share. Keep credentials, state and backups outside it; /home is hidden.";
    };
    authFile = lib.mkOption {
      type = absolutePath;
      default = "/etc/file-share/auth.json";
      description = "Runtime JSON credentials path (string, not a Nix path). Provision outside the Nix store, owned by root:file-share with mode 0640.";
    };
    listen = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1:8080";
      description = "HTTP listen address behind a separately configured HTTPS proxy. Use an unprivileged port; no firewall port is opened.";
    };
    origin = lib.mkOption {
      type = lib.types.str;
      example = "https://files.example.com";
      description = "Required exact external HTTPS origin, without path or trailing slash. Validated by the application on startup.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [ {
      assertion = !(lib.hasPrefix "/nix/store/" cfg.authFile);
      message = "services.file-share.authFile must be provisioned at runtime, not stored in the Nix store.";
    } ];
    users.groups.file-share = {};
    users.users.file-share = {
      isSystemUser = true;
      group = "file-share";
    };
    systemd.services.file-share = {
      description = "Read-only file sharing";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        Type = "simple";
        User = "file-share";
        Group = "file-share";
        ExecStart = utils.escapeSystemdExecArgs [
          (lib.getExe cfg.package)
          "-listen" cfg.listen "-root" cfg.root
          "-database" "/var/lib/file-share/shares.db"
          "-auth" cfg.authFile "-origin" cfg.origin
        ];
        Restart = "on-failure";
        RestartSec = 5;
        TimeoutStopSec = 45;
        UMask = "0077";
        StateDirectory = "file-share";
        StateDirectoryMode = "0700";
        ProtectSystem = "strict";
        ProtectHome = true;
        # Path directives expand % specifiers but not environment variables.
        ReadOnlyPaths = map (p: builtins.toJSON (lib.replaceStrings [ "%" ] [ "%%" ] p)) [ cfg.root cfg.authFile ];
        PrivateTmp = true;
        PrivateDevices = true;
        NoNewPrivileges = true;
        CapabilityBoundingSet = "";
        RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
        # Retain the tested sandbox; any additional syscall filtering needs separate validation.
        LockPersonality = true;
      };
    };
  };
}
