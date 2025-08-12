#!/usr/bin/env node

const { BrowserAutomationServer } = require('../src/BrowserAutomationServer');

const server = new BrowserAutomationServer();
server.run().catch(console.error);