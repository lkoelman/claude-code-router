#!/usr/bin/env node
import { run } from "./index";
import { closeService } from "./utils/close";
import { showStatus } from "./utils/status";
import { executeCodeCommand } from "./utils/codeCommand";
import { cleanupPidFile, isServiceRunning } from "./utils/processCheck";
import { version } from "../package.json";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const command = args[0];
  const options: { config?: string; port?: number } = {};
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' && i + 1 < args.length) {
      options.config = args[i + 1];
      i++; // Skip next argument as it's the config path
    } else if (args[i] === '--port' && i + 1 < args.length) {
      options.port = parseInt(args[i + 1]);
      i++; // Skip next argument as it's the port number
    }
  }
  
  return { command, options };
};

const { command, options } = parseArgs();

const HELP_TEXT = `
Usage: claude-code [command] [options]

Commands:
  start         Start service 
  stop          Stop service
  status        Show service status
  code          Execute code command
  -v, version   Show version information
  -h, help      Show help information

Options:
  --config      Specify custom config file path
  --port        Specify port for service

Example:
  claude-code start
  claude-code start --config /path/to/config.json
  claude-code code "Write a Hello World"
`;

async function waitForService(
  timeout = 10000,
  initialDelay = 1000
): Promise<boolean> {
  // Wait for an initial period to let the service initialize
  await new Promise((resolve) => setTimeout(resolve, initialDelay));

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (isServiceRunning()) {
      // Wait for an additional short period to ensure service is fully ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

import { spawn } from "child_process";
import { PID_FILE, REFERENCE_COUNT_FILE } from "./constants";
import { existsSync, readFileSync } from "fs";

async function main() {
  switch (command) {
    case "start":
      run(options);
      break;
    case "stop":
      try {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8"));
        process.kill(pid);
        cleanupPidFile();
        if (existsSync(REFERENCE_COUNT_FILE)) {
          try {
            require("fs").unlinkSync(REFERENCE_COUNT_FILE);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        console.log(
          "claude code router service has been successfully stopped."
        );
      } catch (e) {
        console.log(
          "Failed to stop the service. It may have already been stopped."
        );
        cleanupPidFile();
      }
      break;
    case "status":
      showStatus();
      break;
    case "code":
      if (!isServiceRunning()) {
        console.log("Service not running, starting service...");
        spawn("ccr", ["start"], {
          detached: true,
          stdio: "ignore",
        }).unref();
        if (await waitForService()) {
          executeCodeCommand(process.argv.slice(3));
        } else {
          console.error(
            "Service startup timeout, please manually run claude-code start to start the service"
          );
          process.exit(1);
        }
      } else {
        executeCodeCommand(process.argv.slice(3));
      }
      break;
    case "-v":
    case "version":
      console.log(`claude-code version: ${version}`);
      break;
    case "-h":
    case "help":
      console.log(HELP_TEXT);
      break;
    default:
      console.log(HELP_TEXT);
      process.exit(1);
  }
}

main().catch(console.error);
