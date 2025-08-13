#!/usr/bin/env node

// Set lite mode environment variable before importing modules
process.env.MCP_LITE_MODE = 'true';

const { ChromeAutomationServer } = require("../src/ChromeAutomationServer");

async function main() {
  console.error("[MCP] Starting Browser Automation Server in LITE mode");
  console.error("[MCP] Available tools: launch_browser, close_browser, run_script, set_storage");
  
  const server = new ChromeAutomationServer();
  await server.run();
}

main().catch(console.error);