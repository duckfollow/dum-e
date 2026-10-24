import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
const name = `dum-e-test-${randomUUID().slice(0, 8)}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_PASSWORD=dum-e-local-test-only",
    "postgres:17-alpine",
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      docker("exec", name, "pg_isready", "-U", "postgres");
      ready = true;
      break;
    } catch {
      await setTimeout(200);
    }
  }
  if (!ready) throw Error("Isolated PostgreSQL did not become ready");
  docker(
    "exec",
    name,
    "psql",
    "-U",
    "postgres",
    "-c",
    "CREATE TABLE dum_e_test_items (id integer PRIMARY KEY, name text); INSERT INTO dum_e_test_items VALUES (1, 'read-only fixture');",
  );
  const port = docker("port", name, "5432/tcp").split(":").at(-1);
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "postgres_real_connection_types_and_readonly",
      "--",
      "--ignored",
    ],
    { stdio: "inherit", env: { ...process.env, DUM_E_TEST_PG_PORT: port } },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error("PostgreSQL integration test failed:", error.message);
  process.exitCode = 1;
} finally {
  try {
    docker("stop", name);
  } catch {}
}
