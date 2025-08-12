// Main entry point for the MCP Browser Automation package
const { ChromeAutomationServer } = require('./src/ChromeAutomationServer');
const { toolDefinitions } = require('./src/tools');
const { toolHandlers } = require('./src/handlers');

// Export main components for programmatic use
module.exports = {
  ChromeAutomationServer,
  toolDefinitions,
  toolHandlers,
  
  // Export a convenience function to create and start the server
  createServer: () => new ChromeAutomationServer(),
  
  // Export a function to run the server in CLI mode
  runCLI: () => {
    const server = new ChromeAutomationServer();
    return server.run();
  }
};
