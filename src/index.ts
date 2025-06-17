import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { getOpenAICommonOptions, initConfig, initDir, printConfig } from "./utils";
import { createServer } from "./server";
import { formatRequest } from "./middlewares/formatRequest";
import { rewriteBody } from "./middlewares/rewriteBody";
import { router } from "./middlewares/router";
import OpenAI from "openai";
import { streamOpenAIResponse } from "./utils/stream";
import {
  cleanupPidFile,
  isServiceRunning,
  savePid,
} from "./utils/processCheck";
import { LRUCache } from "lru-cache";
import { log } from "./utils/log";

async function initializeClaudeConfig() {
  const homeDir = process.env.HOME;
  const configPath = `${homeDir}/.claude.json`;
  if (!existsSync(configPath)) {
    const userID = Array.from(
      { length: 64 },
      () => Math.random().toString(16)[2]
    ).join("");
    const configContent = {
      numStartups: 184,
      autoUpdaterStatus: "enabled",
      userID,
      hasCompletedOnboarding: true,
      lastOnboardingVersion: "1.0.17",
      projects: {},
    };
    await writeFile(configPath, JSON.stringify(configContent, null, 2));
  }
}

interface RunOptions {
  port?: number;
  config?: string;
}

interface ModelProvider {
  name: string;
  api_base_url: string;
  api_key: string;
  models: string[];
}

/**
 * Starts the Claude Code Router service
 * 
 * Initialize and starts a local server that routes AI model requests
 * to configured model providers. It handles:
 * 
 * - Checking if the service is already running
 * - Initializing configuration files and directories
 * - Setting up model providers from config
 * - Creating an HTTP server with appropriate middleware
 * - Managing process lifecycle (PID tracking, signal handling)
 * 
 * The server acts as a proxy for AI model requests, routing them to the appropriate
 * provider based on configuration rules.
 * 
 * @param {RunOptions} options - Configuration options
 * @param {number} [options.port=3456] - Port to run the service on
 * @param {string} [options.config] - Path to custom config file
 * @returns {Promise<void>}
 */
async function run(options: RunOptions = {}) {
  // Check if service is already running
  if (isServiceRunning()) {
    console.log("✅ Service is already running in the background.");
    return;
  }

  await initializeClaudeConfig();
  await initDir();

  // Get router config, taking into account env vars and the --config option
  const config = await initConfig(options.config);
  printConfig(config, options.config);

  const Providers = new Map<string, ModelProvider>();
  const providerCache = new LRUCache<string, OpenAI>({
    max: 10,
    ttl: 2 * 60 * 60 * 1000,
  });

  function getProviderInstance(providerName: string): OpenAI {
    const provider: ModelProvider | undefined = Providers.get(providerName);
    if (provider === undefined) {
      throw new Error(`Provider ${providerName} not found`);
    }
    let openai = providerCache.get(provider.name);
    if (!openai) {
      openai = new OpenAI({
        baseURL: provider.api_base_url,
        apiKey: provider.api_key,
        ...getOpenAICommonOptions(),
      });
      providerCache.set(provider.name, openai);
    }
    return openai;
  }

  // if the config has a "Providers" section
  if (Array.isArray(config.Providers)) {
    config.Providers.forEach((provider) => {
      try {
        Providers.set(provider.name, provider);
      } catch (error) {
        console.error("Failed to parse model provider:", error);
      }
    });
  }

  if (config.OPENAI_API_KEY && config.OPENAI_BASE_URL && config.OPENAI_MODEL) {
    const defaultProvider = {
      name: "default",
      api_base_url: config.OPENAI_BASE_URL,
      api_key: config.OPENAI_API_KEY,
      models: [config.OPENAI_MODEL],
    };
    Providers.set("default", defaultProvider);
  } else if (Providers.size > 0) {
    const defaultProvider = Providers.values().next().value!;
    Providers.set("default", defaultProvider);
  }
  const port = options.port || 3456;

  // Save the PID of the background process
  savePid(process.pid);

  // Handle SIGINT (Ctrl+C) to clean up PID file
  process.on("SIGINT", () => {
    console.log("Received SIGINT, cleaning up...");
    cleanupPidFile();
    process.exit(0);
  });

  // Handle SIGTERM to clean up PID file
  process.on("SIGTERM", () => {
    cleanupPidFile();
    process.exit(0);
  });

  // Use port from environment variable if set (for background process)
  const servicePort = process.env.SERVICE_PORT
    ? parseInt(process.env.SERVICE_PORT)
    : port;

  const server = await createServer(servicePort);

  // add middleware function (request hook) that passes our router config
  server.useMiddleware((req, res, next) => {
    console.log("Middleware triggered for request:", req.body.model);
    req.config = config;
    next();
  });
  server.useMiddleware(rewriteBody);
  if (
    config.Router?.background &&
    config.Router?.think &&
    config?.Router?.longContext
  ) {
    // Only use router if the model for each request type is present in config
    // => see middlewares/router.ts for request routing to different models
    server.useMiddleware(router);
  } else {
    // if not, use the default model for all requests
    server.useMiddleware((req, res, next) => {
      req.provider = "default";
      req.body.model = config.OPENAI_MODEL;
      next();
    });
  }
  server.useMiddleware(formatRequest);

  server.app.post("/v1/messages", async (req, res) => {
    try {
      const provider = getProviderInstance(req.provider || "default");
      const completion: any = await provider.chat.completions.create(req.body);
      await streamOpenAIResponse(res, completion, req.body.model, req.body);
    } catch (e) {
      console.error("Error in OpenAI API call:", e);
    }
  });
  server.start();
  console.log(`🚀 Claude Code Router is running on port ${servicePort}`);
}

export { run };
// run();
