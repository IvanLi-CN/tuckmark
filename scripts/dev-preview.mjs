#!/usr/bin/env node

import { spawn } from "node:child_process";

const serverPort = process.env.TUCKMARK_SERVER_PORT ?? "5210";
const webPort = process.env.TUCKMARK_WEB_PORT ?? "5173";
const apiOrigin = process.env.TUCKMARK_API_ORIGIN ?? `http://127.0.0.1:${serverPort}`;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const children = [];

function startChild(name, args, env) {
  const child = spawn(pnpmCommand, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[${name}] exited via ${signal}`);
    } else if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
}

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 1000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`Tuckmark preview`);
console.log(`- web:    http://127.0.0.1:${webPort}/`);
console.log(`- server: http://127.0.0.1:${serverPort}/health`);
console.log(`- proxy:  ${apiOrigin}`);

startChild("server", ["--filter", "@tuckmark/server", "dev"], {
  PORT: serverPort
});

startChild("web", ["--filter", "@tuckmark/web", "dev", "--", "--host", "127.0.0.1", "--port", webPort], {
  TUCKMARK_API_ORIGIN: apiOrigin,
  TUCKMARK_SERVER_PORT: serverPort,
  TUCKMARK_WEB_PORT: webPort
});
