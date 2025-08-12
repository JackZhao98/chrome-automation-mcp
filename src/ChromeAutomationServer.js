const { toolDefinitions } = require('./tools');
const { toolHandlers } = require('./handlers');

class ChromeAutomationServer {
  constructor() {
    this.server = null;
    this.Server = null;
    this.StdioServerTransport = null;
    this.CallToolRequestSchema = null;
    this.ListToolsRequestSchema = null;
    
    this.browser = null;
    this.page = null;
    this.debugPort = 9222;
    this.chromeProcess = null;
  }

  async initialize() {
    // Dynamic imports for ESM modules
    const sdkServer = await import("@modelcontextprotocol/sdk/server/index.js");
    const sdkStdio = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const sdkTypes = await import("@modelcontextprotocol/sdk/types.js");
    
    this.Server = sdkServer.Server;
    this.StdioServerTransport = sdkStdio.StdioServerTransport;
    this.CallToolRequestSchema = sdkTypes.CallToolRequestSchema;
    this.ListToolsRequestSchema = sdkTypes.ListToolsRequestSchema;
    
    this.server = new this.Server(
      {
        name: "browser-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
  }

  async cleanup() {
    console.error("[MCP] Cleaning up...");

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        console.error("[MCP] Error closing browser:", e);
      }
    }

    if (this.chromeProcess) {
      try {
        this.chromeProcess.kill();
      } catch (e) {
        console.error("[MCP] Error killing Chrome process:", e);
      }
    }

    process.exit(0);
  }

  setupToolHandlers() {
    this.server.setRequestHandler(this.ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }));

    this.server.setRequestHandler(this.CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const handler = toolHandlers[name];
        if (!handler) {
          throw new Error(`Unknown tool: ${name}`);
        }

        return await handler.call(this, args || {});
      } catch (error) {
        console.error(`[MCP] Error in ${name}:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async run() {
    await this.initialize();
    const transport = new this.StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] Browser Automation Server running on stdio");
  }
}

module.exports = { ChromeAutomationServer };