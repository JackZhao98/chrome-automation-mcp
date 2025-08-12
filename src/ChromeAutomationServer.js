const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { toolDefinitions } = require('./tools');
const { toolHandlers } = require('./handlers');

class ChromeAutomationServer {
  constructor() {
    this.server = new Server(
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

    this.browser = null;
    this.page = null;
    this.debugPort = 9222;
    this.chromeProcess = null;

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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] Browser Automation Server running on stdio");
  }
}

module.exports = { ChromeAutomationServer };