import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const name = `dum-e-ssh-test-${randomUUID().slice(0, 8)}`;
const directory = mkdtempSync(join(tmpdir(), "dum-e-ssh-test-"));
const key = join(directory, "identity");
const sshPassword = "dum-e SSH test '$` ; space";
const knownHosts = join(directory, "known_hosts");
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::22",
    "--env",
    "POSTGRES_PASSWORD=dum-e-local-test-only",
    "postgres:17-alpine",
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
      ready = true;
      break;
    } catch {
      await setTimeout(200);
    }
  }
  if (!ready) throw Error("Isolated PostgreSQL did not become ready");
  docker("exec", name, "apk", "add", "--no-cache", "openssh-server");
  docker("exec", name, "ssh-keygen", "-A");
  docker("exec", name, "mkdir", "-p", "/root/.ssh");
  docker("cp", `${key}.pub`, `${name}:/root/.ssh/authorized_keys`);
  docker("exec", name, "chown", "-R", "root:root", "/root/.ssh");
  docker("exec", name, "chmod", "700", "/root/.ssh");
  docker("exec", name, "chmod", "600", "/root/.ssh/authorized_keys");
  execFileSync("docker", ["exec", "-i", name, "chpasswd"], {
    input: `root:${sshPassword}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
  docker(
    "exec",
    name,
    "/usr/sbin/sshd",
    "-o",
    "PermitRootLogin=yes",
    "-o",
    "PasswordAuthentication=yes",
    "-o",
    "AllowTcpForwarding=yes",
  );
  const port = docker("port", name, "22/tcp").split(":").at(-1);
  const hostKey = docker(
    "exec",
    name,
    "cat",
    "/etc/ssh/ssh_host_ed25519_key.pub",
  );
  writeFileSync(knownHosts, `[127.0.0.1]:${port} ${hostKey}\n`, {
    mode: 0o600,
  });
  // Keep fixture trust and credentials separate from the user's SSH configuration.
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "ssh_real_postgres",
      "--",
      "--ignored",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DUM_E_TEST_SSH_PORT: port,
        DUM_E_TEST_SSH_PASSWORD: sshPassword,
        DUM_E_TEST_SSH_KEY: key,
        DUM_E_TEST_SSH_KNOWN_HOSTS: knownHosts,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error("SSH integration test failed:", error.message);
  process.exitCode = 1;
} finally {
  try {
    docker("stop", name);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
