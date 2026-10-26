{
  description = "Standalone Go file sharing server";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ];
    in {
      packages = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.buildGoModule.override { go = pkgs.go_1_27; } {
            pname = "file-share";
            version = "0.1.0";
            src = nixpkgs.lib.fileset.toSource {
              root = ./.;
              fileset = nixpkgs.lib.fileset.unions [
                ./go.mod ./go.sum ./index.html
                ./LICENSE ./THIRD_PARTY_NOTICES.md ./licenses
                (nixpkgs.lib.fileset.fileFilter (file: file.hasExt "go") ./.)
              ];
            };
            vendorHash = "sha256-9E8IJRJWJZcQTZReRtGIO0d+eIbPGUwjqPten/473J8=";
            env.CGO_ENABLED = "0";
            postInstall = ''
              mkdir -p "$out/share/doc/file-share"
              cp -r LICENSE THIRD_PARTY_NOTICES.md licenses "$out/share/doc/file-share/"
            '';
            meta.license = pkgs.lib.licenses.mit;
            meta.mainProgram = "file-share";
          };
        });

      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.go_1_27 pkgs.gcc pkgs.git ];
            GOTOOLCHAIN = "local";
          };
        });

      nixosModules.default = import ./nix/module.nix { inherit self; };

      checks = forAllSystems (system: {
        build = self.packages.${system}.default;
        service = import ./nix/tests/service.nix {
          inherit self;
          pkgs = nixpkgs.legacyPackages.${system};
        };
      });
    };
}
