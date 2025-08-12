#!/usr/bin/env node

const { ChromeAutomationServer } = require('../src/ChromeAutomationServer');

const server = new ChromeAutomationServer();
server.run().catch(console.error);