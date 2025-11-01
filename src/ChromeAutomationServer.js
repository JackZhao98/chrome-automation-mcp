const { toolDefinitions } = require("./tools");
const { toolHandlers, TabManager } = require("./handlers");
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

    // Tab管理器 - 每个session独立管理自己的Tab
    this.tabManager = new TabManager();
    // 根据平台选择临时目录
    const platform = os.platform();
    let baseDir;

    if (platform === 'darwin') {
      // macOS 使用固定的 /tmp 路径
      baseDir = '/tmp/chrome-browser-automation-sessions';
    } else {
      // Windows 和其他系统使用系统临时目录
      const tmpDir = os.tmpdir();
      baseDir = path.join(tmpDir, 'chrome-browser-automation-sessions');
    }

    // 确保baseDir目录存在
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
      console.error(`[MCP] Created base directory: ${baseDir}`);
    }

    // 固定session文件夹命名规则：session-{timestamp}-{random}
    this.sessionDir = path.join(baseDir, `session-${this.sessionId}`);
    this.sessionRegistryFile = path.join(baseDir, "sessions-registry.json");

    console.error(`[MCP] Session ID: ${this.sessionId}`);
  }

  generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  getAvailablePort(basePort = 9222) {
    // 基于session ID生成端口号，避免冲突
    const sessionHash = this.sessionId.split("-")[1];
    const offset = parseInt(sessionHash.substring(0, 2), 36) % 100;
    return basePort + offset;
  }

  registerSession() {
    try {
      let sessions = {};
      if (fs.existsSync(this.sessionRegistryFile)) {
        sessions = JSON.parse(
          fs.readFileSync(this.sessionRegistryFile, "utf8")
        );
      }

      sessions[this.sessionId] = {
        pid: process.pid,
        debugPort: this.debugPort,
        sessionDir: this.sessionDir,
        createdAt: new Date().toISOString(),
        chromeProcessPid: this.chromeProcess ? this.chromeProcess.pid : null,
      };

      fs.writeFileSync(
        this.sessionRegistryFile,
        JSON.stringify(sessions, null, 2)
      );
      console.error(`[MCP] Session registered: ${this.sessionId}`);
    } catch (error) {
      console.error("[MCP] Failed to register session:", error);
    }
  }

  unregisterSession() {
    try {
      if (fs.existsSync(this.sessionRegistryFile)) {
        const sessions = JSON.parse(
          fs.readFileSync(this.sessionRegistryFile, "utf8")
        );
        delete sessions[this.sessionId];
        fs.writeFileSync(
          this.sessionRegistryFile,
          JSON.stringify(sessions, null, 2)
        );
        console.error(`[MCP] Session unregistered: ${this.sessionId}`);
      }
    } catch (error) {
      console.error("[MCP] Failed to unregister session:", error);
    }
  }

  cleanupSessionDir() {
    try {
      console.error(`[MCP] Attempting to cleanup session directory: ${this.sessionDir}`);
      if (fs.existsSync(this.sessionDir)) {
        console.error(`[MCP] Directory exists, removing: ${this.sessionDir}`);
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        console.error(`[MCP] Session directory cleaned: ${this.sessionDir}`);
      } else {
        console.error(`[MCP] Session directory does not exist: ${this.sessionDir}`);
      }
    } catch (error) {
      console.error("[MCP] Failed to cleanup session directory:", error);
      console.error("[MCP] Error details:", error.message);
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
    
    // Enhanced signal monitoring for external factor detection
    process.on("SIGINT", () => {
      const signalTime = new Date().toISOString();
      console.error(`[CLOSE-EXTERNAL] Received SIGINT signal at ${signalTime}, but ignoring to prevent interference with running scripts...`);
      console.error(`[CLOSE-EXTERNAL] Signal source: External termination attempt (Ctrl+C or similar)`);
      // Don't cleanup immediately - let running scripts finish
    });
    process.on("SIGTERM", () => {
      const signalTime = new Date().toISOString();
      console.error(`[CLOSE-EXTERNAL] Received SIGTERM signal at ${signalTime}, but ignoring to prevent interference with running scripts...`);
      console.error(`[CLOSE-EXTERNAL] Signal source: External termination request (system shutdown, kill command, etc.)`);
      // Don't cleanup immediately - let running scripts finish
    });
    
    // Monitor for unexpected exits
    process.on('exit', (code) => {
      const exitTime = new Date().toISOString();
      console.error(`[CLOSE-EXTERNAL] Process exiting with code ${code} at ${exitTime}`);
    });
    
    process.on('uncaughtException', (error) => {
      const errorTime = new Date().toISOString();
      console.error(`[CLOSE-EXTERNAL] Uncaught exception at ${errorTime}: ${error.message}`);
      console.error(`[CLOSE-EXTERNAL] This may indicate external interference or system issues`);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      const errorTime = new Date().toISOString();
      console.error(`[CLOSE-EXTERNAL] Unhandled rejection at ${errorTime}:`, reason);
      console.error(`[CLOSE-EXTERNAL] This may indicate external interference or system issues`);
    });
  }

  async cleanup() {
    const cleanupStartTime = new Date().toISOString();
    const callStack = new Error().stack;
    
    console.error(`[CLOSE-CLEANUP] Server cleanup initiated at ${cleanupStartTime} for session ${this.sessionId}`);
    console.error(`[CLOSE-CLEANUP] Cleanup trigger call stack: ${callStack.split('\n')[2]?.trim()}`);

    // 优雅关闭浏览器
    if (this.browser) {
      try {
        // Log browser state before closing
        try {
          const contexts = this.browser.contexts();
          console.error(`[CLOSE-CLEANUP] Browser has ${contexts.length} context(s) before cleanup`);
          const browserVersion = await this.browser.version();
          console.error(`[CLOSE-CLEANUP] Browser version: ${browserVersion}`);
        } catch (stateError) {
          console.error(`[CLOSE-CLEANUP] Could not get browser state: ${stateError.message}`);
        }

        const browserCloseStart = new Date().toISOString();
        await this.browser.close();
        const browserCloseEnd = new Date().toISOString();
        console.error(`[CLOSE-CLEANUP] Browser closed gracefully from ${browserCloseStart} to ${browserCloseEnd}`);
      } catch (e) {
        console.error(`[CLOSE-CLEANUP] Error closing browser: ${e.message}`);
        console.error(`[CLOSE-CLEANUP] Browser close started at: ${cleanupStartTime}`);
      }
    } else {
      console.error(`[CLOSE-CLEANUP] No browser instance to close at ${cleanupStartTime}`);
    }

    // 如果浏览器关闭失败，再kill进程
    if (this.chromeProcess && !this.chromeProcess.killed) {
      try {
        const processPid = this.chromeProcess.pid;
        console.error(`[CLOSE-CLEANUP] Attempting to terminate Chrome process PID: ${processPid}`);
        
        // 先尝试优雅终止
        const sigTermTime = new Date().toISOString();
        this.chromeProcess.kill("SIGTERM");
        console.error(`[CLOSE-CLEANUP] Sent SIGTERM to Chrome process ${processPid} at ${sigTermTime}`);

        // 等待2秒，如果还没退出则强制kill
        setTimeout(() => {
          if (!this.chromeProcess.killed) {
            const sigKillTime = new Date().toISOString();
            this.chromeProcess.kill("SIGKILL");
            console.error(`[CLOSE-CLEANUP] Chrome process ${processPid} force killed at ${sigKillTime}`);
          } else {
            console.error(`[CLOSE-CLEANUP] Chrome process ${processPid} terminated gracefully`);
          }
        }, 2000);

        console.error(`[CLOSE-CLEANUP] Chrome process termination initiated for PID: ${processPid}`);
      } catch (e) {
        console.error(`[CLOSE-CLEANUP] Error killing Chrome process: ${e.message}`);
      }
    } else {
      const processStatus = this.chromeProcess ? 'already killed' : 'not exists';
      console.error(`[CLOSE-CLEANUP] No Chrome process to kill (${processStatus})`);
    }

    // 清理TabManager
    if (this.tabManager) {
      try {
        this.tabManager.clear();
        console.error(`[CLOSE-CLEANUP] TabManager cleared`);
      } catch (tabError) {
        console.error(`[CLOSE-CLEANUP] Error clearing TabManager: ${tabError.message}`);
      }
    }

    // 清理session记录和目录
    const sessionCleanupTime = new Date().toISOString();
    console.error(`[CLOSE-CLEANUP] Starting session cleanup at ${sessionCleanupTime}`);

    this.unregisterSession();
    this.cleanupSessionDir();
    
    const finalCleanupTime = new Date().toISOString();
    console.error(`[CLOSE-CLEANUP] All cleanup operations completed at ${finalCleanupTime}`);
    console.error(`[CLOSE-CLEANUP] Session ${this.sessionId} cleanup finished, process will exit`);

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
