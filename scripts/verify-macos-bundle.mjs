import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);
const app = fileURLToPath(
  new URL(
    "../src-tauri/target/release/bundle/macos/Dum-E.app",
    import.meta.url,
  ),
);
// Check the complete bundle, not only the Mach-O executable or DMG checksum.
// Ad-hoc signing passes integrity checks but does not establish Gatekeeper trust.
execFileSync(
  "codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", app],
  { stdio: "inherit" },
);
console.log(
  "App bundle signature is valid. Public distribution still requires Developer ID signing and notarization.",
);
