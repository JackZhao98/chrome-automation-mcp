// Main entry point for the MCP Browser Automation package
const { BrowserAutomationServer } = require('./src/BrowserAutomationServer');
const { toolDefinitions } = require('./src/tools');
const { toolHandlers } = require('./src/handlers');

// Export main components for programmatic use
module.exports = {
  BrowserAutomationServer,
  toolDefinitions,
  toolHandlers,
  
  // Export a convenience function to create and start the server
  createServer: () => new BrowserAutomationServer(),
  
  // Export a function to run the server in CLI mode
  runCLI: () => {
    const server = new BrowserAutomationServer();
    return server.run();
  }
};
