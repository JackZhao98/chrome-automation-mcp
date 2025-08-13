const { toolDefinitions } = require("./tools");
const { toolHandlers } = require("./handlers");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
    
    // Session管理
    this.sessionId = this.generateSessionId();
    this.sessionDir = path.join(os.tmpdir(), `chrome-debug-mcp-${this.sessionId}`);
    this.sessionRegistryFile = path.join(os.tmpdir(), "mcp-browser-sessions.json");
    
    console.error(`[MCP] Session ID: ${this.sessionId}`);
  }

  generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  getAvailablePort(basePort = 9222) {
    // 基于session ID生成端口号，避免冲突
    const sessionHash = this.sessionId.split('-')[1];
    const offset = parseInt(sessionHash.substring(0, 2), 36) % 100;
    return basePort + offset;
  }

  registerSession() {
    try {
      let sessions = {};
      if (fs.existsSync(this.sessionRegistryFile)) {
        sessions = JSON.parse(fs.readFileSync(this.sessionRegistryFile, 'utf8'));
      }
      
      sessions[this.sessionId] = {
        pid: process.pid,
        debugPort: this.debugPort,
        sessionDir: this.sessionDir,
        createdAt: new Date().toISOString(),
        chromeProcessPid: this.chromeProcess ? this.chromeProcess.pid : null
      };
      
      fs.writeFileSync(this.sessionRegistryFile, JSON.stringify(sessions, null, 2));
      console.error(`[MCP] Session registered: ${this.sessionId}`);
    } catch (error) {
      console.error("[MCP] Failed to register session:", error);
    }
  }

  unregisterSession() {
    try {
      if (fs.existsSync(this.sessionRegistryFile)) {
        const sessions = JSON.parse(fs.readFileSync(this.sessionRegistryFile, 'utf8'));
        delete sessions[this.sessionId];
        fs.writeFileSync(this.sessionRegistryFile, JSON.stringify(sessions, null, 2));
        console.error(`[MCP] Session unregistered: ${this.sessionId}`);
      }
    } catch (error) {
      console.error("[MCP] Failed to unregister session:", error);
    }
  }

  cleanupSessionDir() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        console.error(`[MCP] Session directory cleaned: ${this.sessionDir}`);
      }
    } catch (error) {
      console.error("[MCP] Failed to cleanup session directory:", error);
    }
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
    console.error(`[MCP] Cleaning up session ${this.sessionId}...`);

    // 优雅关闭浏览器
    if (this.browser) {
      try {
        await this.browser.close();
        console.error("[MCP] Browser closed gracefully");
      } catch (e) {
        console.error("[MCP] Error closing browser:", e);
      }
    }

    // 如果浏览器关闭失败，再kill进程
    if (this.chromeProcess && !this.chromeProcess.killed) {
      try {
        // 先尝试优雅终止
        this.chromeProcess.kill('SIGTERM');
        
        // 等待2秒，如果还没退出则强制kill
        setTimeout(() => {
          if (!this.chromeProcess.killed) {
            this.chromeProcess.kill('SIGKILL');
            console.error("[MCP] Chrome process force killed");
          }
        }, 2000);
        
        console.error("[MCP] Chrome process terminated");
      } catch (e) {
        console.error("[MCP] Error killing Chrome process:", e);
      }
    }

    // 清理session记录和目录
    this.unregisterSession();
    this.cleanupSessionDir();

    process.exit(0);
  }

  setupToolHandlers() {
    this.server.setRequestHandler(this.ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }));

    this.server.setRequestHandler(
      this.CallToolRequestSchema,
      async (request) => {
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
      }
    );
  }

  async run() {
    await this.initialize();
    const transport = new this.StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] Browser Automation Server running on stdio");
  }
}

module.exports = { ChromeAutomationServer };
