import { HttpsProxyAgent } from "https-proxy-agent";
import OpenAI, { ClientOptions } from "openai";
import fs from "node:fs/promises";
import readline from "node:readline";
import {
  getConfigFile,
  DEFAULT_CONFIG,
  HOME_DIR,
  PLUGINS_DIR,
} from "../constants";

export function getOpenAICommonOptions(): ClientOptions {
  const options: ClientOptions = {};
  if (process.env.PROXY_URL) {
    options.httpAgent = new HttpsProxyAgent(process.env.PROXY_URL);
  } else if (process.env.HTTPS_PROXY) {
    options.httpAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
  }
  return options;
}

const ensureDir = async (dir_path: string) => {
  try {
    await fs.access(dir_path);
  } catch {
    await fs.mkdir(dir_path, { recursive: true });
  }
};

export const initDir = async () => {
  await ensureDir(HOME_DIR);
  await ensureDir(PLUGINS_DIR);
};

const createReadline = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = createReadline();
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const confirm = async (query: string): Promise<boolean> => {
  const answer = await question(query);
  return answer.toLowerCase() !== "n";
};

export const readConfigFile = async (customConfigPath?: string) => {
  const configFile = getConfigFile(customConfigPath);
  let existingConfig = {};
  
  // Try to read existing config file
  try {
    const configContent = await fs.readFile(configFile, "utf-8");
    existingConfig = JSON.parse(configContent);
  } catch {
    // Config file doesn't exist, start with empty object
  }

  // Merge with defaults
  let config = Object.assign({}, DEFAULT_CONFIG, existingConfig);
  
  // Check for missing required values, prioritizing environment variables
  const requiredFields = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"];
  let needsUpdate = false;
  
  for (const field of requiredFields) {
    // First check environment variables
    if (process.env[field]) {
      config[field] = process.env[field];
    }
    // If still missing, prompt user
    else if (!config[field]) {
      config[field] = await question(`Enter ${field}: `);
      needsUpdate = true;
    }
  }
  
  // Only write to config file if we added new values
  if (needsUpdate) {
    await writeConfigFile(config, customConfigPath);
  }
  
  return config;
};

export const writeConfigFile = async (config: any, customConfigPath?: string) => {
  const configFile = getConfigFile(customConfigPath);
  // Ensure the parent directory exists
  const dirPath = require("path").dirname(configFile);
  await ensureDir(dirPath);
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
};

export const initConfig = async (customConfigPath?: string) => {
  const config = await readConfigFile(customConfigPath);
  Object.assign(process.env, config);
  return config;
};

export const createClient = (options: ClientOptions) => {
  const client = new OpenAI({
    ...options,
    ...getOpenAICommonOptions(),
  });
  return client;
};

export const printConfig = (config: any, customConfigPath?: string) => {
  const configFile = getConfigFile(customConfigPath);
  console.log("📋 Configuration loaded:");
  console.log(`   Config file: ${configFile}`);
  console.log(`   OPENAI_API_KEY: ${config.OPENAI_API_KEY ? '***' + config.OPENAI_API_KEY.slice(-4) : 'Not set'}`);
  console.log(`   OPENAI_BASE_URL: ${config.OPENAI_BASE_URL || 'Not set'}`);
  console.log(`   OPENAI_MODEL: ${config.OPENAI_MODEL || 'Not set'}`);
  
  if (config.Providers && Array.isArray(config.Providers)) {
    console.log(`   Providers: ${config.Providers.length} configured`);
    config.Providers.forEach((provider: any, index: number) => {
      console.log(`     ${index + 1}. ${provider.name} (${provider.models?.length || 0} models)`);
    });
  }
  
  if (config.Router) {
    console.log("   Router configuration:");
    if (config.Router.background) console.log(`     Background: ${config.Router.background}`);
    if (config.Router.think) console.log(`     Think: ${config.Router.think}`);
    if (config.Router.longContext) console.log(`     Long Context: ${config.Router.longContext}`);
  }
  console.log("");
};
