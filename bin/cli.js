#!/usr/bin/env node

const { ChromeAutomationServer } = require('../src/ChromeAutomationServer');

async function main() {
  const server = new ChromeAutomationServer();
  await server.run();
}

main().catch(console.error);