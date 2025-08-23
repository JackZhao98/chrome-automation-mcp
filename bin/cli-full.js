#!/usr/bin/env node

const { ChromeAutomationServer } = require("../src/ChromeAutomationServer");

async function main() {
  console.error("[MCP] Starting Browser Automation Server in FULL mode");
  console.error("[MCP] All tools available");

  const server = new ChromeAutomationServer();
  await server.run();
}

main().catch(console.error);
