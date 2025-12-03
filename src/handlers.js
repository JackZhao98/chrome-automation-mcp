const { chromium } = require("playwright");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

// ========== Browser Language Configuration ==========
// Change these two constants to set browser language
// Format: 'language-COUNTRY' (e.g., 'en-US', 'zh-CN', 'ja-JP')
// Note: Restart MCP server after changing these values
const BROWSER_LOCALE = "en-US";
const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

// Other language examples (uncomment to use):
// Japanese:
// const BROWSER_LOCALE = "ja-JP";
// const ACCEPT_LANGUAGE = "ja-JP,ja;q=0.9,en;q=0.8";

// Chinese (Simplified):
// const BROWSER_LOCALE = "zh-CN";
// const ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8";
// ====================================================

// 获取跨平台的会话基础目录
function getSessionBaseDir() {
  const platform = os.platform();

  // macOS 使用固定的 /tmp 路径
  if (platform === "darwin") {
    return "/tmp/chrome-browser-automation-sessions";
  }

  // Windows 和其他系统使用系统临时目录
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, "chrome-browser-automation-sessions");
}

// 获取会话注册表文件路径
function getSessionRegistryFile() {
  return path.join(getSessionBaseDir(), "sessions-registry.json");
}

// Tab 管理器类
class TabManager {
  constructor() {
    this.tabRegistry = new Map(); // page -> { tabId, createdAt, url }
  }

  // 注册 Tab，使用 Playwright 内部的 _guid 作为 tabId
  registerTab(page) {
    if (!this.tabRegistry.has(page)) {
      const tabId =
        page._guid ||
        `tab-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      this.tabRegistry.set(page, {
        tabId,
        createdAt: Date.now(),
        initialUrl: page.url(),
      });
      console.error(`[TabManager] Registered tab: ${tabId}`);
      return tabId;
    }
    return this.tabRegistry.get(page).tabId;
  }

  // 获取 Tab 信息
  getTabInfo(page) {
    return this.tabRegistry.get(page);
  }

  // 注销 Tab
  unregisterTab(page) {
    const info = this.tabRegistry.get(page);
    if (info) {
      console.error(`[TabManager] Unregistered tab: ${info.tabId}`);
      this.tabRegistry.delete(page);
    }
  }

  // 按 tabId 查找 page
  findByTabId(tabId) {
    for (let [page, info] of this.tabRegistry.entries()) {
      if (info.tabId === tabId) {
        return page;
      }
    }
    return null;
  }

  // 清理所有 Tab
  clear() {
    console.error(
      `[TabManager] Clearing ${this.tabRegistry.size} registered tabs`
    );
    this.tabRegistry.clear();
  }

  // 清理已关闭的 Tab（根据当前活跃的 pages 列表）
  cleanup(currentPages) {
    for (let [page, info] of this.tabRegistry.entries()) {
      if (!currentPages.includes(page)) {
        console.error(`[TabManager] Cleaning up closed tab: ${info.tabId}`);
        this.tabRegistry.delete(page);
      }
    }
  }
}

// 智能浏览器关闭监控器
async function startSmartBrowserCloser(
  outputFilePath,
  logFilePath,
  sessionId,
  browserRef,
  sessionRegistryFile,
  startTimestamp
) {
  const monitorStartTime = new Date().toISOString();
  const maxWaitTime = 5 * 60 * 1000; // 5分钟超时
  const checkInterval = 10 * 1000; // 每10秒检查一次

  await fs.appendFile(
    logFilePath,
    `[${monitorStartTime}] [SMART-CLOSE] Starting intelligent browser closer monitor\n`
  );
  await fs.appendFile(
    logFilePath,
    `[${monitorStartTime}] [SMART-CLOSE] Waiting for valid output file: ${outputFilePath}\n`
  );
  await fs.appendFile(
    logFilePath,
    `[${monitorStartTime}] [SMART-CLOSE] Max wait time: ${maxWaitTime / 1000}s, Check interval: ${checkInterval / 1000}s\n`
  );

  let elapsedTime = 0;
  let outputFileFound = false;

  const monitor = setInterval(async () => {
    try {
      elapsedTime += checkInterval;
      const checkTime = new Date().toISOString();

      // 检查output文件是否存在且有效
      if (require("fs").existsSync(outputFilePath)) {
        try {
          const outputContent = await fs.readFile(outputFilePath, "utf8");
          const outputData = JSON.parse(outputContent);

          // 验证文件内容有效性
          if (outputData && outputData.status && outputData.endTime) {
            outputFileFound = true;
            await fs.appendFile(
              logFilePath,
              `[${checkTime}] [SMART-CLOSE] Valid output file detected after ${elapsedTime / 1000}s\n`
            );
            await fs.appendFile(
              logFilePath,
              `[${checkTime}] [SMART-CLOSE] Output status: ${outputData.status}\n`
            );

            clearInterval(monitor);
            await performSmartBrowserClose(
              logFilePath,
              sessionId,
              browserRef,
              sessionRegistryFile,
              startTimestamp,
              "output_file_generated"
            );
            return;
          }
        } catch (parseError) {
          await fs.appendFile(
            logFilePath,
            `[${checkTime}] [SMART-CLOSE] Output file exists but invalid: ${parseError.message}\n`
          );
        }
      }

      // 检查是否超时
      if (elapsedTime >= maxWaitTime) {
        await fs.appendFile(
          logFilePath,
          `[${checkTime}] [SMART-CLOSE] Timeout reached (${maxWaitTime / 1000}s), forcing browser closure\n`
        );
        clearInterval(monitor);
        await performSmartBrowserClose(
          logFilePath,
          sessionId,
          browserRef,
          sessionRegistryFile,
          startTimestamp,
          "timeout_reached"
        );
        return;
      }

      // 定期状态报告
      if (elapsedTime % 30000 === 0) {
        // 每30秒报告一次
        await fs.appendFile(
          logFilePath,
          `[${checkTime}] [SMART-CLOSE] Still waiting... Elapsed: ${elapsedTime / 1000}s/${maxWaitTime / 1000}s\n`
        );
      }
    } catch (error) {
      const errorTime = new Date().toISOString();
      await fs.appendFile(
        logFilePath,
        `[${errorTime}] [SMART-CLOSE] Monitor error: ${error.message}\n`
      );
    }
  }, checkInterval);
}

// 执行智能浏览器关闭
async function performSmartBrowserClose(
  logFilePath,
  sessionId,
  browserRef,
  sessionRegistryFile,
  startTimestamp,
  reason
) {
  const closeStartTime = new Date().toISOString();
  const scriptDuration = Date.now() - startTimestamp;

  await fs.appendFile(
    logFilePath,
    `\n[${closeStartTime}] === SMART BROWSER CLOSE ===\n`
  );
  await fs.appendFile(
    logFilePath,
    `[${closeStartTime}] [SMART-CLOSE] Reason: ${reason}\n`
  );
  await fs.appendFile(
    logFilePath,
    `[${closeStartTime}] [SMART-CLOSE] Session: ${sessionId}\n`
  );
  await fs.appendFile(
    logFilePath,
    `[${closeStartTime}] [SMART-CLOSE] Total runtime: ${scriptDuration}ms\n`
  );

  let browserClosed = false;

  try {
    if (browserRef) {
      // 检查浏览器状态
      try {
        const contexts = browserRef.contexts();
        await fs.appendFile(
          logFilePath,
          `[${closeStartTime}] [SMART-CLOSE] Browser has ${contexts.length} context(s) before close\n`
        );
      } catch (stateError) {
        await fs.appendFile(
          logFilePath,
          `[${closeStartTime}] [SMART-CLOSE] Browser state check failed: ${stateError.message}\n`
        );
      }

      // 关闭浏览器
      await browserRef.close();
      await fs.appendFile(
        logFilePath,
        `[${new Date().toISOString()}] [SMART-CLOSE] Browser connection closed\n`
      );

      // 终止Chrome进程
      const sessionRegistryPath =
        sessionRegistryFile || getSessionRegistryFile();
      if (sessionId && require("fs").existsSync(sessionRegistryPath)) {
        const sessions = JSON.parse(
          require("fs").readFileSync(sessionRegistryPath, "utf8")
        );
        if (sessions[sessionId] && sessions[sessionId].chromeProcessPid) {
          const chromePid = sessions[sessionId].chromeProcessPid;

          try {
            process.kill(chromePid, "SIGTERM");
            await fs.appendFile(
              logFilePath,
              `[${new Date().toISOString()}] [SMART-CLOSE] Sent SIGTERM to Chrome PID: ${chromePid}\n`
            );

            // 等待1秒后检查是否需要SIGKILL
            setTimeout(() => {
              try {
                process.kill(chromePid, 0); // 检查进程是否还存在
                process.kill(chromePid, "SIGKILL");
                console.error(
                  `[SMART-CLOSE] Force killed Chrome process ${chromePid}`
                );
              } catch (e) {
                // 进程已经死了，正常
              }
            }, 1000);

            browserClosed = true;
          } catch (killError) {
            await fs.appendFile(
              logFilePath,
              `[${new Date().toISOString()}] [SMART-CLOSE] Error killing Chrome process: ${killError.message}\n`
            );
          }
        }
      }
    }
  } catch (error) {
    await fs.appendFile(
      logFilePath,
      `[${new Date().toISOString()}] [SMART-CLOSE] Error during browser close: ${error.message}\n`
    );
  }

  const closeEndTime = new Date().toISOString();
  await fs.appendFile(
    logFilePath,
    `[${closeEndTime}] [SMART-CLOSE] Browser closure completed. Success: ${browserClosed}\n`
  );
  await fs.appendFile(
    logFilePath,
    `[${closeEndTime}] === END SMART CLOSE ===\n`
  );
}

const execAsync = promisify(exec);

// 辅助函数：根据sessionId获取浏览器连接
async function getBrowserBySessionId(sessionId) {
  const sessionRegistryFile = getSessionRegistryFile();

  if (!require("fs").existsSync(sessionRegistryFile)) {
    throw new Error(`No sessions registry found`);
  }

  const sessions = JSON.parse(
    require("fs").readFileSync(sessionRegistryFile, "utf8")
  );
  const sessionInfo = sessions[sessionId];

  if (!sessionInfo) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // 检查进程是否还活跃
  try {
    process.kill(sessionInfo.pid, 0);
  } catch (e) {
    throw new Error(`Session ${sessionId} is no longer active`);
  }

  // 连接到该session的调试端口，增加重试机制
  const { chromium } = require("playwright");
  let browser, page;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.error(
        `[MCP] Connecting to session ${sessionId} (attempt ${attempt}/3)`
      );

      browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${sessionInfo.debugPort}`
      );

      // Add connection event handlers
      browser.on("disconnected", () => {
        console.error(`[MCP] Session ${sessionId} browser connection lost`);
      });

      const context = browser.contexts()[0];
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();

      // Test connection stability
      await page.evaluate(() => document.readyState);

      console.error(`[MCP] Successfully connected to session ${sessionId}`);
      break;
    } catch (error) {
      lastError = error;
      console.error(
        `[MCP] Session ${sessionId} connection attempt ${attempt} failed:`,
        error.message
      );

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  if (!browser || !page) {
    throw new Error(
      `Failed to connect to session ${sessionId} after 3 attempts: ${lastError?.message}`
    );
  }

  return { browser, page, sessionInfo };
}

/**
 * Get Chrome executable path based on platform
 */
function getChromePath() {
  const platform = os.platform();
  return platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "google-chrome";
}

/**
 * Build Chrome launch arguments
 */
function buildChromeArgs(debugPort, userDataDir) {
  return [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-startup-window",
    "--disable-default-apps",
    "--disable-background-mode",
    "--no-first-run",
    "--no-default-browser-check",
    `--disable-features=TranslateUI`,
    `--disable-ipc-flooding-protection`,
    `--lang=${BROWSER_LOCALE}`,
    `--accept-lang=${ACCEPT_LANGUAGE}`,
    "--disable-translate",
    `--force-lang=${BROWSER_LOCALE}`,
  ];
}

const toolHandlers = {
  launch_browser: async function (args) {
    const { debugPort } = args;

    // 获取平台信息
    const platform = os.platform();

    // 生成sessionId和目录
    const timestamp = Date.now();
    const randomCode = Math.random().toString(36).substring(2, 8);
    const sessionId = `${timestamp}-${randomCode}`;
    const tempUserDataDir = path.join(
      getSessionBaseDir(),
      `session-${sessionId}`
    );

    // 设置注册表文件路径
    const sessionRegistryFile = getSessionRegistryFile();

    // 确保基础目录存在
    const baseDir = getSessionBaseDir();
    try {
      if (!require("fs").existsSync(baseDir)) {
        require("fs").mkdirSync(baseDir, { recursive: true });
        console.error(`[MCP] Created base directory: ${baseDir}`);
      }
    } catch (error) {
      console.error(`[MCP] Failed to create base directory: ${error.message}`);
      throw new Error(`Cannot create base directory: ${baseDir}`);
    }

    // 确保会话子目录存在
    try {
      if (!require("fs").existsSync(tempUserDataDir)) {
        require("fs").mkdirSync(tempUserDataDir, { recursive: true });
        console.error(`[MCP] Created session subdirectory: ${tempUserDataDir}`);
      } else {
        console.error(
          `[MCP] Session subdirectory already exists: ${tempUserDataDir}`
        );
      }
    } catch (error) {
      console.error(
        `[MCP] Failed to create session subdirectory: ${error.message}`
      );
      throw new Error(`Cannot create session subdirectory: ${tempUserDataDir}`);
    }

    // 生成端口号（基于timestamp避免冲突）
    const basePort = 9222;
    const portOffset = timestamp % 1000; // 使用timestamp的最后3位作为偏移
    var actualDebugPort = debugPort || basePort + portOffset;

    // 启动前自动清理无效的旧session
    try {
      console.error("[MCP] Cleaning up inactive sessions before launch...");
      if (require("fs").existsSync(sessionRegistryFile)) {
        const sessions = JSON.parse(
          require("fs").readFileSync(sessionRegistryFile, "utf8")
        );
        const activeSessions = {};
        let cleanedCount = 0;

        for (const [oldSessionId, sessionInfo] of Object.entries(sessions)) {
          let isActive = false;

          try {
            // 快速检查进程和端口
            process.kill(sessionInfo.pid, 0);
            if (sessionInfo.chromeProcessPid) {
              process.kill(sessionInfo.chromeProcessPid, 0);
            }
            isActive = true;
          } catch (e) {
            // Session无效，清理目录
            try {
              if (
                sessionInfo.sessionDir &&
                require("fs").existsSync(sessionInfo.sessionDir)
              ) {
                require("fs").rmSync(sessionInfo.sessionDir, {
                  recursive: true,
                  force: true,
                });
                console.error(
                  `[MCP] Auto-cleaned inactive session: ${oldSessionId}`
                );
                cleanedCount++;
              }
            } catch (cleanupError) {
              console.error(
                `[MCP] Failed to auto-cleanup session ${oldSessionId}:`,
                cleanupError.message
              );
            }
          }

          if (isActive) {
            activeSessions[oldSessionId] = sessionInfo;
          }
        }

        if (cleanedCount > 0) {
          require("fs").writeFileSync(
            sessionRegistryFile,
            JSON.stringify(activeSessions, null, 2)
          );
          console.error(`[MCP] Auto-cleaned ${cleanedCount} inactive sessions`);
        }
      }
    } catch (error) {
      console.error("[MCP] Auto-cleanup warning:", error.message);
    }

    console.error(`[MCP] Platform: ${platform}`);
    console.error(`[MCP] Using temp user data dir: ${tempUserDataDir}`);
    console.error(
      `[MCP] Directory exists: ${require("fs").existsSync(tempUserDataDir)}`
    );
    console.error(`[MCP] Using debug port: ${actualDebugPort}`);

    console.error(`[MCP] Launching browser with args:`, {
      debugPort: actualDebugPort,
      userDataDir: tempUserDataDir,
    });

    // 强制清理可能冲突的端口进程
    // 检查并清理端口占用
    try {
      const { exec } = require("child_process");
      const checkCmd =
        platform === "darwin"
          ? `lsof -ti:${actualDebugPort}`
          : platform === "win32"
            ? `netstat -ano | findstr :${actualDebugPort}`
            : `lsof -ti:${actualDebugPort}`;

      await new Promise((resolve) => {
        exec(checkCmd, (error, stdout) => {
          if (stdout && stdout.trim()) {
            const pids = stdout
              .trim()
              .split("\n")
              .filter((pid) => pid.trim());
            console.error(
              `[MCP] Port ${actualDebugPort} is occupied by processes: ${pids.join(
                ", "
              )}`
            );

            // 强制kill占用该端口的进程
            const conflictTime = new Date().toISOString();
            console.error(
              `[CLOSE-CONFLICT] Port conflict detected at ${conflictTime} - killing ${pids.length} process(es) on port ${actualDebugPort}`
            );

            pids.forEach((pid) => {
              try {
                console.error(
                  `[CLOSE-CONFLICT] Attempting to terminate conflicting process PID: ${pid.trim()}`
                );

                // 先尝试SIGTERM
                const sigTermTime = new Date().toISOString();
                process.kill(parseInt(pid.trim()), "SIGTERM");
                console.error(
                  `[CLOSE-CONFLICT] Sent SIGTERM to process ${pid} on port ${actualDebugPort} at ${sigTermTime}`
                );

                // 如果SIGTERM不够，等待一秒后强制SIGKILL
                setTimeout(() => {
                  try {
                    const sigKillTime = new Date().toISOString();
                    process.kill(parseInt(pid.trim()), "SIGKILL");
                    console.error(
                      `[CLOSE-CONFLICT] Force killed process ${pid} on port ${actualDebugPort} at ${sigKillTime}`
                    );
                  } catch (e) {
                    console.error(
                      `[CLOSE-CONFLICT] Process ${pid} already dead during SIGKILL`
                    );
                  }
                }, 1000);
              } catch (e) {
                console.error(
                  `[CLOSE-CONFLICT] Failed to terminate process ${pid}: ${e.message}`
                );
              }
            });

            // 等待进程完全终止
            setTimeout(resolve, 2000);
          } else {
            console.error(`[MCP] Port ${actualDebugPort} is available`);
            resolve();
          }
        });
      });
    } catch (e) {
      // Port check failed, continue anyway
      console.error("[MCP] Port check failed:", e.message);
    }

    // Launch Chrome with debugging port
    const chromePath = getChromePath();
    const chromeArgs = buildChromeArgs(actualDebugPort, tempUserDataDir);

    // Browser always runs in visible mode

    console.error(`[MCP] Starting Chrome:`, chromePath, chromeArgs);

    this.chromeProcess = spawn(chromePath, chromeArgs, {
      detached: false,
      stdio: "ignore",
    });

    this.debugPort = actualDebugPort;

    // Wait for Chrome to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Connect with Playwright (with retry logic and connection stability)
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.error(
          `[MCP] Connection attempt ${attempt}/3 to port ${actualDebugPort}`
        );

        this.browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${actualDebugPort}`
        );

        // Add connection stability checks
        this.browser.on("disconnected", () => {
          console.error(
            "[MCP] Browser connection lost - attempting to maintain session info"
          );
        });

        const context = this.browser.contexts()[0];
        const pages = context.pages();
        this.page = pages.length > 0 ? pages[0] : await context.newPage();

        // Verify connection is stable by testing a simple operation
        await this.page.evaluate(() => document.readyState);

        console.error(`[MCP] Browser launched and connected successfully`);

        // 保存session信息到实例
        this.sessionId = sessionId;
        this.sessionRegistryFile = sessionRegistryFile;

        // 写入session注册表
        try {
          // 确保基础目录存在
          const baseDir = path.dirname(sessionRegistryFile);
          if (!require("fs").existsSync(baseDir)) {
            require("fs").mkdirSync(baseDir, { recursive: true });
          }

          // 读取现有的session注册表
          let sessions = {};
          if (require("fs").existsSync(sessionRegistryFile)) {
            sessions = JSON.parse(
              require("fs").readFileSync(sessionRegistryFile, "utf8")
            );
          }

          // 添加当前session
          sessions[sessionId] = {
            pid: process.pid,
            debugPort: actualDebugPort,
            sessionDir: tempUserDataDir,
            createdAt: new Date().toISOString(),
            chromeProcessPid: this.chromeProcess.pid,
          };

          // 写回注册表
          require("fs").writeFileSync(
            sessionRegistryFile,
            JSON.stringify(sessions, null, 2)
          );
          console.error(`[MCP] Session registered: ${sessionId}`);
        } catch (error) {
          console.error(`[MCP] Failed to register session:`, error.message);
        }

        const launchMessage = `Browser launched successfully on port ${actualDebugPort} (Session: ${sessionId})`;

        return {
          content: [
            {
              type: "text",
              text: launchMessage,
            },
          ],
        };
      } catch (error) {
        lastError = error;
        console.error(
          `[MCP] Connection attempt ${attempt} failed:`,
          error.message
        );

        if (attempt < 3) {
          // 如果不是最后一次尝试，尝试换端口
          const newPort = this.getAvailablePort(actualDebugPort + attempt * 10);
          console.error(`[MCP] Retrying with port ${newPort}`);

          // 终止之前的Chrome进程
          if (this.chromeProcess && !this.chromeProcess.killed) {
            const restartTime = new Date().toISOString();
            const oldPid = this.chromeProcess.pid;
            console.error(
              `[CLOSE-RESTART] Terminating previous Chrome process PID: ${oldPid} at ${restartTime} (retry attempt ${attempt})`
            );

            this.chromeProcess.kill("SIGTERM");
            console.error(
              `[CLOSE-RESTART] Sent SIGTERM to previous Chrome process ${oldPid}`
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));

            console.error(
              `[CLOSE-RESTART] Previous Chrome process cleanup completed, proceeding with new launch`
            );
          } else {
            console.error(
              `[CLOSE-RESTART] No previous Chrome process to clean up (retry attempt ${attempt})`
            );
          }

          // 用新端口重新启动Chrome
          actualDebugPort = newPort;
          this.debugPort = actualDebugPort;

          const chromeArgs = buildChromeArgs(actualDebugPort, tempUserDataDir);
          const chromePath = getChromePath();

          this.chromeProcess = spawn(chromePath, chromeArgs, {
            detached: false,
            stdio: "ignore",
          });

          // 等待Chrome启动
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    // 所有尝试都失败了
    console.error("[MCP] All connection attempts failed");
    throw new Error(
      `Failed to connect to browser after 3 attempts. Last error: ${lastError.message}`
    );
  },

  connect_browser: async function (args) {
    const { sessionId, debugPort = 9222 } = args;

    if (sessionId && sessionId !== "default") {
      console.error("[MCP] Connecting to browser by session ID:", sessionId);
      try {
        const { browser, page, sessionInfo } =
          await getBrowserBySessionId(sessionId);
        this.browser = browser;
        this.page = page;
        this.debugPort = sessionInfo.debugPort;
        this.sessionId = sessionId;

        console.error("[MCP] Connected successfully to session:", sessionId);

        return {
          content: [
            {
              type: "text",
              text: `Connected to browser session ${sessionId} on port ${sessionInfo.debugPort}`,
            },
          ],
        };
      } catch (error) {
        console.error("[MCP] Connection to session failed:", error);
        throw new Error(
          `Failed to connect to session ${sessionId}: ${error.message}`
        );
      }
    } else {
      console.error("[MCP] Connecting to browser on port:", debugPort);

      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.error(
            `[MCP] Connection attempt ${attempt}/3 to port ${debugPort}`
          );

          this.browser = await chromium.connectOverCDP(
            `http://127.0.0.1:${debugPort}`
          );

          // Add connection event handlers
          this.browser.on("disconnected", () => {
            console.error("[MCP] Browser connection lost on port", debugPort);
          });

          const context = this.browser.contexts()[0];
          const pages = context.pages();
          this.page = pages.length > 0 ? pages[0] : await context.newPage();
          this.debugPort = debugPort;

          // Test connection stability
          await this.page.evaluate(() => document.readyState);

          console.error("[MCP] Connected successfully");

          return {
            content: [
              {
                type: "text",
                text: `Connected to browser on port ${debugPort}`,
              },
            ],
          };
        } catch (error) {
          lastError = error;
          console.error(
            `[MCP] Connection attempt ${attempt} failed:`,
            error.message
          );

          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      console.error("[MCP] All connection attempts failed");
      throw new Error(
        `Failed to connect to browser on port ${debugPort} after 3 attempts: ${lastError.message}`
      );
    }
  },

  navigate_to: async function (args) {
    const { url, sessionId, waitUntil = "load" } = args;

    // Validate required parameters
    if (!url) {
      const errorMsg =
        "navigate_to: Missing required parameter 'url'. Please provide a valid URL to navigate to.";
      console.error(`[MCP] ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      const errorMsg = `navigate_to: Invalid URL format: "${url}". Error: ${e.message}. Please provide a valid URL (e.g., "https://example.com").`;
      console.error(`[MCP] ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Validate waitUntil parameter
    const validWaitUntil = ["load", "domcontentloaded", "networkidle"];
    if (waitUntil && !validWaitUntil.includes(waitUntil)) {
      const errorMsg = `navigate_to: Invalid waitUntil value: "${waitUntil}". Valid options are: ${validWaitUntil.join(", ")}.`;
      console.error(`[MCP] ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    let page = this.page;
    let currentSessionId = this.sessionId || "default";

    console.error(`[MCP] navigate_to: Starting navigation to "${url}"`);
    console.error(
      `[MCP] navigate_to: Parameters - sessionId: ${sessionId || "default"}, waitUntil: ${waitUntil}`
    );

    // 如果指定了sessionId且不是default，使用指定的session
    if (sessionId && sessionId !== "default") {
      console.error(
        `[MCP] navigate_to: Attempting to get browser session: ${sessionId}`
      );
      try {
        const sessionData = await getBrowserBySessionId(sessionId);
        if (!sessionData || !sessionData.page) {
          const errorMsg = `navigate_to: Failed to get page for session "${sessionId}". Session may not exist or browser may be closed. Available sessions: ${this.sessionId || "none"}.`;
          console.error(`[MCP] ERROR: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        page = sessionData.page;
        currentSessionId = sessionId;
        console.error(
          `[MCP] navigate_to: Successfully retrieved page for session: ${sessionId}`
        );
      } catch (error) {
        const errorMsg = `navigate_to: Error getting browser session "${sessionId}": ${error.message}. Make sure the browser is launched and the session ID is correct.`;
        console.error(`[MCP] ERROR: ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    if (!page) {
      const errorMsg = `navigate_to: No browser page available. Current session: ${currentSessionId}. Please launch or connect to browser first using launch_browser or connect_browser.`;
      console.error(`[MCP] ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.error(
      `[MCP] navigate_to: Navigating to "${url}" (Session: ${currentSessionId}, waitUntil: ${waitUntil})`
    );

    try {
      const startTime = Date.now();
      await page.goto(url, {
        waitUntil,
        timeout: 30000, // 30 second timeout
      });
      const duration = Date.now() - startTime;
      console.error(
        `[MCP] navigate_to: Successfully navigated to "${url}" in ${duration}ms`
      );

      return {
        content: [
          {
            type: "text",
            text: `Navigated to ${url}${
              currentSessionId !== "default"
                ? ` (Session: ${currentSessionId})`
                : ""
            }`,
          },
        ],
      };
    } catch (error) {
      const errorType = error.name || "UnknownError";
      const errorMessage = error.message || "Unknown error occurred";

      let detailedErrorMsg = `navigate_to: Failed to navigate to "${url}". `;

      if (error.message && error.message.includes("Timeout")) {
        let suggestion = "";
        if (waitUntil === "networkidle") {
          suggestion = `Try using "load" instead of "networkidle" - many modern pages have continuous network activity (WebSocket, polling, analytics) that prevents networkidle from being reached. `;
        } else if (waitUntil === "load") {
          suggestion = `The page may be loading very slowly. You can try "domcontentloaded" for faster navigation (though it may miss some resources), or increase the timeout if the page genuinely needs more time. `;
        } else {
          suggestion = `The page may be loading slowly. Try "load" for a more reliable wait condition. `;
        }
        detailedErrorMsg += `Navigation timeout after 30 seconds (waitUntil: ${waitUntil}). ${suggestion}`;
      } else if (error.message && error.message.includes("net::ERR")) {
        detailedErrorMsg += `Network error: ${errorMessage}. Check your internet connection or verify the URL is accessible. `;
      } else if (error.message && error.message.includes("Navigation failed")) {
        detailedErrorMsg += `Navigation failed: ${errorMessage}. The page may have redirected or encountered an error. `;
      } else {
        detailedErrorMsg += `Error type: ${errorType}, Message: ${errorMessage}. `;
      }

      detailedErrorMsg += `Session: ${currentSessionId}.`;

      console.error(`[MCP] ERROR: ${detailedErrorMsg}`);
      console.error(`[MCP] ERROR: Full error stack:`, error.stack);

      throw new Error(detailedErrorMsg);
    }
  },

  click: async function (args) {
    const {
      selector,
      sessionId,
      clickByText = false,
      timeout = 5000,
      force = false,
      index = 0,
    } = args;

    let page = this.page;

    // 如果指定了sessionId且不是default，使用指定的session
    if (sessionId && sessionId !== "default") {
      const { page: sessionPage } = await getBrowserBySessionId(sessionId);
      page = sessionPage;
    }

    if (!page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error(
      "[MCP] Clicking:",
      selector,
      clickByText ? "(by text)" : "(by selector)",
      sessionId ? `(Session: ${sessionId})` : ""
    );

    try {
      if (clickByText) {
        // Click element containing text
        const elements = await page.getByText(selector).all();
        if (elements.length > 0) {
          console.error(
            `[MCP] Found ${elements.length} elements with text "${selector}", clicking index ${index}`
          );
          await elements[index].click({ timeout, force });
        } else {
          throw new Error(
            `No elements found with text: ${selector}. Try scrolling down using the 'scroll' tool to find more content, or use a more specific selector.`
          );
        }
      } else {
        // Try to find all matching elements and click the visible one
        let elements = await page.$$(selector);

        if (elements.length === 0) {
          // Try scrolling down to find the element
          console.error(
            "[MCP] Element not found, trying to scroll down to find it"
          );
          await page.evaluate(() => {
            window.scrollBy(0, 500);
          });
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for scroll

          // Try again after scrolling
          const elementsAfterScroll = await page.$$(selector);
          if (elementsAfterScroll.length === 0) {
            throw new Error(
              `No elements found for selector: ${selector}. Tried scrolling down but element still not found. The element might be further down the page - use the 'scroll' tool to scroll more, or check if the selector is correct.`
            );
          }
          elements = elementsAfterScroll;
        }

        console.error(
          `[MCP] Found ${elements.length} elements for selector "${selector}"`
        );

        // Try to click the first visible element
        let clicked = false;
        for (let i = 0; i < Math.min(elements.length, 10); i++) {
          try {
            const isVisible = await elements[i].isVisible();
            if (isVisible) {
              console.error(`[MCP] Clicking visible element at index ${i}`);
              await elements[i].click({ timeout: 1000, force });
              clicked = true;
              break;
            }
          } catch (e) {
            // Try next element
            continue;
          }
        }

        if (!clicked) {
          // If no visible element found, try force clicking the specified index
          console.error(
            `[MCP] No visible element found, force clicking element at index ${index}`
          );
          await elements[Math.min(index, elements.length - 1)].click({
            force: true,
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Clicked on ${selector}`,
          },
        ],
      };
    } catch (error) {
      // If all else fails, try using locator with more specific options
      try {
        console.error("[MCP] Trying alternative click method with locator");
        await page
          .locator(selector)
          .first()
          .click({ force: true, timeout: 2000 });

        return {
          content: [
            {
              type: "text",
              text: `Clicked on ${selector} (forced)`,
            },
          ],
        };
      } catch (innerError) {
        throw new Error(
          `Failed to click ${selector}: ${error.message}. The element might not be visible or might be below the current view. Try using the 'scroll' tool to bring the element into view, use a more specific selector, or set force:true to force the click.`
        );
      }
    }
  },

  type_text: async function (args) {
    const { selector, text, sessionId, clear = true, delay = 50 } = args;

    let page = this.page;

    // 如果指定了sessionId且不是default，使用指定的session
    if (sessionId && sessionId !== "default") {
      const { page: sessionPage } = await getBrowserBySessionId(sessionId);
      page = sessionPage;
    }

    if (!page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error(
      "[MCP] Typing into:",
      selector,
      sessionId ? `(Session: ${sessionId})` : ""
    );

    const element = await page.$(selector);
    if (!element) {
      throw new Error(
        `Input element not found: ${selector}. The element might be below the current view. Try using the 'scroll' tool to scroll down and find the input field.`
      );
    }

    if (clear) {
      await element.click();
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
    }

    await element.type(text, { delay });

    return {
      content: [
        {
          type: "text",
          text: `Typed "${text}" into ${selector}`,
        },
      ],
    };
  },

  read_text: async function (args = {}) {
    const { selector, sessionId, all = false } = args;

    let page = this.page;

    // 如果指定了sessionId且不是default，使用指定的session
    if (sessionId && sessionId !== "default") {
      const { page: sessionPage } = await getBrowserBySessionId(sessionId);
      page = sessionPage;
    }

    if (!page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error(
      "[MCP] Reading text from:",
      selector || "entire page",
      sessionId ? `(Session: ${sessionId})` : ""
    );

    let text;

    if (!selector) {
      // Read entire page text
      text = await page.evaluate(() => document.body.innerText);
    } else if (all) {
      // Read all matching elements
      const texts = await page.$eval(selector, (elements) =>
        elements.map((el) => el.innerText || el.textContent)
      );
      text = texts.join("\n---\n");
    } else {
      // Read single element
      const element = await page.$(selector);
      if (!element) {
        throw new Error(
          `Element not found: ${selector}. The element might be below the current view. Try using the 'scroll' tool to scroll down and find the element.`
        );
      }
      text = await element.evaluate((el) => el.innerText || el.textContent);
    }

    return {
      content: [
        {
          type: "text",
          text: text || "No text found",
        },
      ],
    };
  },

  get_elements: async function (args) {
    const {
      selector,
      attributes = ["id", "class", "href", "src", "alt", "title"],
    } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Getting elements:", selector);

    const elements = await this.page.$eval(
      selector,
      (els, attrs) => {
        return els.map((el) => {
          const result = {
            tagName: el.tagName.toLowerCase(),
            text: el.innerText || el.textContent,
          };

          attrs.forEach((attr) => {
            if (el.hasAttribute(attr)) {
              result[attr] = el.getAttribute(attr);
            }
          });

          return result;
        });
      },
      attributes
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(elements, null, 2),
        },
      ],
    };
  },

  wait_for: async function (args) {
    const {
      selector,
      state = "visible",
      timeout = 10000,
      switchToNewTab = true,
    } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Waiting for:", selector, state);

    // Check if there are new tabs and optionally switch to the latest one
    if (switchToNewTab && this.browser) {
      const context = this.browser.contexts()[0];
      const currentPages = context.pages();

      // If we have more pages than before, switch to the latest one
      if (currentPages.length > 1) {
        const latestPage = currentPages[currentPages.length - 1];
        if (latestPage !== this.page) {
          console.error(
            `[MCP] Found new tab, switching to latest tab (${latestPage.url()})`
          );
          this.page = latestPage;

          // Wait a bit for the new page to load
          try {
            await this.page.waitForLoadState("domcontentloaded", {
              timeout: 5000,
            });
          } catch (e) {
            console.error(
              "[MCP] New page didn't finish loading within 5s, continuing anyway"
            );
          }
        }
      }
    }

    try {
      await this.page.waitForSelector(selector, { state, timeout });

      return {
        content: [
          {
            type: "text",
            text: `Element ${selector} is now ${state}`,
          },
        ],
      };
    } catch (error) {
      // If waiting failed and we haven't tried switching tabs yet, try it now
      if (switchToNewTab && this.browser && error.message.includes("Timeout")) {
        console.error("[MCP] Timeout occurred, checking for new tabs...");
        const context = this.browser.contexts()[0];
        const currentPages = context.pages();

        if (currentPages.length > 1) {
          const latestPage = currentPages[currentPages.length - 1];
          if (latestPage !== this.page) {
            console.error(
              `[MCP] Switching to latest tab after timeout (${latestPage.url()})`
            );
            this.page = latestPage;

            // Try waiting again on the new page
            await this.page.waitForSelector(selector, {
              state,
              timeout: Math.min(timeout, 5000),
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Element ${selector} is now ${state} (found in new tab)`,
                },
              ],
            };
          }
        }
      }

      // Enhanced error message with scrolling suggestion
      if (
        error.message.includes("Timeout") ||
        error.message.includes("exceed")
      ) {
        throw new Error(
          `${error.message} The element '${selector}' was not found within ${timeout}ms. The element might be below the current viewport. Try using the 'scroll' tool to scroll down and bring the element into view, then retry the wait_for operation.`
        );
      }

      throw error;
    }
  },

  press_key: async function (args) {
    const { key, modifiers = [] } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Pressing key:", key, "with modifiers:", modifiers);

    // Press modifiers
    for (const mod of modifiers) {
      await this.page.keyboard.down(mod);
    }

    // Press the key
    await this.page.keyboard.press(key);

    // Release modifiers
    for (const mod of modifiers) {
      await this.page.keyboard.up(mod);
    }

    return {
      content: [
        {
          type: "text",
          text: `Pressed ${
            modifiers.length > 0 ? modifiers.join("+") + "+" : ""
          }${key}`,
        },
      ],
    };
  },

  screenshot: async function (args = {}) {
    const { fullPage = false, selector, sessionId } = args;

    let page = this.page;

    // 如果指定了sessionId且不是default，使用指定的session
    if (sessionId && sessionId !== "default") {
      const { page: sessionPage } = await getBrowserBySessionId(sessionId);
      page = sessionPage;
    }

    if (!page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error(
      "[MCP] Taking screenshot",
      sessionId ? `(Session: ${sessionId})` : ""
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(process.cwd(), filename);

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(
          `Element not found for screenshot: ${selector}. The element might be below the current view. Try using the 'scroll' tool to scroll down and bring the element into view before taking a screenshot.`
        );
      }
      await element.screenshot({ path: filepath });
    } else {
      await page.screenshot({ path: filepath, fullPage });
    }

    return {
      content: [
        {
          type: "text",
          text: `Screenshot saved to ${filepath}`,
        },
      ],
    };
  },

  scroll: async function (args = {}) {
    const { direction = "down", amount = 500 } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Scrolling:", direction, amount);

    const scrollMap = {
      down: { x: 0, y: amount },
      up: { x: 0, y: -amount },
      right: { x: amount, y: 0 },
      left: { x: -amount, y: 0 },
    };

    const scroll = scrollMap[direction];
    await this.page.evaluate(({ x, y }) => {
      window.scrollBy(x, y);
    }, scroll);

    return {
      content: [
        {
          type: "text",
          text: `Scrolled ${direction} by ${amount}px`,
        },
      ],
    };
  },

  get_page_info: async function () {
    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Getting page info");

    const info = await this.page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      documentHeight: document.documentElement.scrollHeight,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  },

  run_script: async function (args) {
    const {
      scriptPath,
      scriptUrl,
      args: scriptArgs = {},
      sessionId,
      createNewTab = false,
      autoCloseTab = false,
    } = args;

    // ============================================
    // 步骤 1: 根据 sessionId 获取浏览器
    // ============================================
    let browser, initialPage;

    if (sessionId) {
      // 使用指定 session 的浏览器
      console.error(`[MCP] Using specified session: ${sessionId}`);
      const sessionData = await getBrowserBySessionId(sessionId);
      browser = sessionData.browser;
      initialPage = sessionData.page;
    } else {
      // 使用当前实例的浏览器
      if (!this.browser || !this.page) {
        throw new Error(
          "Browser not connected. Use launch_browser or connect_browser first."
        );
      }
      browser = this.browser;
      initialPage = this.page;
    }

    // ============================================
    // 步骤 2: 决定使用哪个 Tab (page)
    // ============================================
    let page;
    let isNewTab = false;

    if (createNewTab) {
      // 创建新 Tab
      const context = browser.contexts()[0];
      page = await context.newPage();
      isNewTab = true;

      const tabId =
        page._guid ||
        `tab-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      console.error(`[MCP] Created new tab with ID: ${tabId}`);

      // 注册到 TabManager (如果存在)
      if (this.tabManager) {
        this.tabManager.registerTab(page);
      }
    } else {
      // 使用现有 page
      page = initialPage;
    }

    // Validate that exactly one of scriptPath or scriptUrl is provided
    if (!scriptPath && !scriptUrl) {
      throw new Error("Either scriptPath or scriptUrl must be provided");
    }

    if (scriptPath && scriptUrl) {
      throw new Error(
        "Cannot provide both scriptPath and scriptUrl. Use only one."
      );
    }

    let scriptContent;
    if (scriptPath) {
      console.error("[MCP] Running script from local path:", scriptPath);
      // Read the script file from local disk
      scriptContent = await fs.readFile(scriptPath, "utf-8");
    } else {
      console.error("[MCP] Running script from URL:", scriptUrl);
      // Fetch the script from remote URL
      const https = require("https");
      const http = require("http");
      const url = require("url");

      scriptContent = await new Promise((resolve, reject) => {
        const parsedUrl = url.parse(scriptUrl);
        const client = parsedUrl.protocol === "https:" ? https : http;

        client
          .get(scriptUrl, (res) => {
            if (res.statusCode !== 200) {
              reject(
                new Error(`Failed to fetch script: HTTP ${res.statusCode}`)
              );
              return;
            }

            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
          })
          .on("error", reject);
      });
    }

    // ============================================
    // 步骤 3: 执行脚本
    // ============================================
    try {
      const AsyncFunction = Object.getPrototypeOf(
        async function () {}
      ).constructor;
      const fn = new AsyncFunction("browser", "page", "args", scriptContent);
      const result = await fn(browser, page, scriptArgs);

      console.error("[MCP] Script executed successfully");

      // ============================================
      // 步骤 4: 自动关闭 Tab (如果需要)
      // ============================================
      if (isNewTab && autoCloseTab) {
        await page.close();
        console.error(`[MCP] Auto-closed tab after script completion`);

        // 从 TabManager 注销
        if (this.tabManager) {
          this.tabManager.unregisterTab(page);
        }
      }

      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] Script execution failed:", error);

      // 错误时也关闭新创建的 Tab
      if (isNewTab && autoCloseTab) {
        await page.close().catch(() => {});
        if (this.tabManager) {
          this.tabManager.unregisterTab(page);
        }
      }

      throw new Error(`Script execution failed: ${error.message}`);
    }
  },

  run_script_background: async function (args) {
    const {
      scriptPath,
      scriptUrl,
      args: scriptArgs = {},
      projectFolder,
      autoCloseBrowser = true,
      sessionId: requestedSessionId,
      createNewTab = false,
      autoCloseTab = false,
    } = args;

    // ============================================
    // 步骤 1: 根据 sessionId 获取浏览器
    // ============================================
    let browser, initialPage, sessionId, sessionRegistryFile;

    if (requestedSessionId) {
      // 使用指定 session 的浏览器
      console.error(`[MCP] Using specified session: ${requestedSessionId}`);
      const sessionData = await getBrowserBySessionId(requestedSessionId);
      browser = sessionData.browser;
      initialPage = sessionData.page;
      sessionId = requestedSessionId;
      sessionRegistryFile = getSessionRegistryFile();
    } else {
      // 使用当前实例的浏览器
      if (!this.browser || !this.page) {
        throw new Error(
          "Browser not connected. Use launch_browser or connect_browser first."
        );
      }
      browser = this.browser;
      initialPage = this.page;
      sessionId =
        this.sessionId ||
        `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      sessionRegistryFile = this.sessionRegistryFile;
    }

    // ============================================
    // 步骤 2: 决定使用哪个 Tab (page)
    // ============================================
    let page;
    let isNewTab = false;

    if (createNewTab) {
      // 创建新 Tab
      const context = browser.contexts()[0];
      page = await context.newPage();
      isNewTab = true;

      const tabId =
        page._guid ||
        `tab-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      console.error(
        `[MCP] Created new tab with ID: ${tabId} for background script`
      );

      // 注册到 TabManager (如果存在)
      if (this.tabManager) {
        this.tabManager.registerTab(page);
      }
    } else {
      // 使用现有 page
      page = initialPage;
    }

    // ============================================
    // 步骤 3: 智能处理 autoCloseBrowser
    // ============================================
    let finalAutoCloseBrowser = autoCloseBrowser;

    // 检查是否应该自动禁用浏览器关闭
    const shouldPreventBrowserClose =
      createNewTab === true && // 创建了新Tab
      autoCloseTab === true && // 要关闭Tab
      requestedSessionId !== undefined; // 指定了sessionId（跨session）

    // 如果用户没有明确设置 autoCloseBrowser，且满足禁用条件
    if (!args.hasOwnProperty("autoCloseBrowser") && shouldPreventBrowserClose) {
      finalAutoCloseBrowser = false;
      console.error(
        `[MCP] Auto-disabled browser close (cross-session with createNewTab + autoCloseTab)`
      );
      console.error(
        `[MCP] Tip: Set autoCloseBrowser: true explicitly if you want to close the browser`
      );
    }

    // Validate that exactly one of scriptPath or scriptUrl is provided
    if (!scriptPath && !scriptUrl) {
      throw new Error("Either scriptPath or scriptUrl must be provided");
    }

    if (scriptPath && scriptUrl) {
      throw new Error(
        "Cannot provide both scriptPath and scriptUrl. Use only one."
      );
    }

    // Determine output folder and sanitize path
    let outputDir = projectFolder || path.join("/tmp", sessionId);

    // Trim leading and trailing whitespace from the path
    outputDir = outputDir.trim();

    // Also trim each path segment to handle cases like "/tmp/folder /123"
    const pathSegments = outputDir.split(path.sep);
    outputDir = pathSegments
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join(path.sep);

    // Restore leading slash for absolute paths on Unix-like systems
    if (projectFolder && projectFolder.startsWith("/")) {
      outputDir = "/" + outputDir;
    }

    console.error(`[MCP] Sanitized output directory: "${outputDir}"`);
    if (projectFolder && projectFolder !== outputDir) {
      console.error(`[MCP] Original path had whitespace: "${projectFolder}"`);
    }

    // Ensure output directory exists
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      console.error(
        `[MCP] Failed to create output directory: ${error.message}`
      );
      throw new Error(`Failed to create output directory: ${error.message}`);
    }

    // Get script name for file naming
    let scriptName = "script";
    if (scriptPath) {
      scriptName = path.basename(scriptPath, path.extname(scriptPath));
    } else if (scriptUrl) {
      const urlParts = scriptUrl.split("/");
      const fileName = urlParts[urlParts.length - 1];
      scriptName = fileName.split(".")[0] || "remote_script";
    }

    // Generate timestamp
    const timestamp = Date.now();
    const outputFileName = `${scriptName}_script_output_${timestamp}.json`;
    const logFileName = `${scriptName}_script_output_${timestamp}.log`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const logFilePath = path.join(outputDir, logFileName);

    // Task info to return immediately
    const taskInfo = {
      sessionId,
      scriptName,
      scriptSource: scriptPath || scriptUrl,
      startTime: new Date().toISOString(),
      timestamp,
      outputDir,
      outputFile: outputFilePath,
      logFile: logFilePath,
      status: "started",
      autoCloseBrowser,
    };

    console.error("[MCP] Starting background script execution:", taskInfo);
    console.error(`[MCP] autoCloseBrowser setting: ${autoCloseBrowser}`);

    // Fetch script content
    let scriptContent;
    try {
      if (scriptPath) {
        console.error("[MCP] Reading script from local path:", scriptPath);
        scriptContent = await fs.readFile(scriptPath, "utf-8");
      } else {
        console.error("[MCP] Fetching script from URL:", scriptUrl);
        const https = require("https");
        const http = require("http");
        const url = require("url");

        scriptContent = await new Promise((resolve, reject) => {
          const parsedUrl = url.parse(scriptUrl);
          const client = parsedUrl.protocol === "https:" ? https : http;

          client
            .get(scriptUrl, (res) => {
              if (res.statusCode !== 200) {
                reject(
                  new Error(`Failed to fetch script: HTTP ${res.statusCode}`)
                );
                return;
              }

              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => resolve(data));
            })
            .on("error", reject);
        });
      }
    } catch (error) {
      const errorInfo = {
        ...taskInfo,
        status: "failed",
        error: error.message,
        endTime: new Date().toISOString(),
      };

      // Write error to output file
      await fs.writeFile(outputFilePath, JSON.stringify(errorInfo, null, 2));
      await fs.writeFile(
        logFilePath,
        `Error fetching script: ${error.message}\n`
      );

      throw new Error(`Failed to fetch script: ${error.message}`);
    }

    // Store browser and page references for background task
    const browserRef = browser;
    const pageRef = page;
    const sessionIdRef = sessionId;
    const sessionRegistryFileRef = sessionRegistryFile;
    const isNewTabRef = isNewTab;
    const autoCloseTabRef = autoCloseTab;
    const finalAutoCloseBrowserRef = finalAutoCloseBrowser;

    // Create an async function with enhanced page handling
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;

    // Wrap the script with page recovery logic
    const enhancedScriptContent = `
    // Enhanced page object with auto-recovery
    const originalPage = page;
    const enhancedPage = new Proxy(originalPage, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value === 'function') {
          return function(...args) {
            try {
              return value.apply(target, args);
            } catch (error) {
              if (error.message.includes('Target page, context or browser has been closed')) {
                console.error('[Script] Page context lost, attempting to get active page...');
                // Try to get the currently active page
                const contexts = browser.contexts();
                if (contexts.length > 0) {
                  const pages = contexts[0].pages();
                  if (pages.length > 0) {
                    const activePage = pages[pages.length - 1]; // Get the most recent page
                    console.error('[Script] Found active page, retrying operation...');
                    return value.apply(activePage, args);
                  }
                }
              }
              throw error;
            }
          };
        }
        return value;
      }
    });
    
    // Replace page reference in the script execution context
    page = enhancedPage;
    
    // Original script content
    ${scriptContent}
    `;

    const scriptFunction = new AsyncFunction(
      "browser",
      "page",
      "args",
      enhancedScriptContent
    );

    // Execute script and setup completion handling
    const executeScript = async () => {
      let result = null;
      let errorMessage = null;

      try {
        // Log start
        await fs.appendFile(
          logFilePath,
          `[${new Date().toISOString()}] Starting script execution\n`
        );
        await fs.appendFile(
          logFilePath,
          `Script source: ${scriptPath || scriptUrl}\n`
        );
        await fs.appendFile(logFilePath, `Session ID: ${sessionId}\n`);
        await fs.appendFile(logFilePath, `Output directory: ${outputDir}\n`);

        // Monitor external factors
        try {
          const { exec } = require("child_process");
          const util = require("util");
          const execAsync = util.promisify(exec);

          // Check if there are other chrome processes running
          const { stdout: chromeProcs } = await execAsync(
            "pgrep -f chrome"
          ).catch(() => ({ stdout: "" }));
          const chromeCount = chromeProcs
            ? chromeProcs
                .trim()
                .split("\n")
                .filter((p) => p).length
            : 0;
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] System Chrome processes: ${chromeCount}\n`
          );

          // Check system resources
          const { stdout: memInfo } = await execAsync(
            "free -m | grep Mem | awk '{print $3 \"/\" $2}'"
          ).catch(() => ({ stdout: "unknown" }));
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] System memory usage: ${memInfo.trim()}\n`
          );
        } catch (sysError) {
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Could not get system info: ${sysError.message}\n`
          );
        }

        await fs.appendFile(logFilePath, "=" + "=".repeat(50) + "\n");

        // Execute the script
        console.error(
          `[MCP] About to execute script function for session ${sessionId}...`
        );
        await fs.appendFile(
          logFilePath,
          `[${new Date().toISOString()}] About to execute script function\n`
        );

        try {
          // Check if browser is still connected before executing
          const contexts = browserRef.contexts();
          console.error(
            `[MCP] Browser has ${contexts.length} context(s) before script execution`
          );
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] Browser contexts before execution: ${contexts.length}\n`
          );
        } catch (checkError) {
          console.error(
            `[MCP] ERROR: Browser already disconnected before script execution: ${checkError.message}`
          );
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] ERROR: Browser disconnected before execution: ${checkError.message}\n`
          );
          throw new Error(
            `Browser disconnected before script execution: ${checkError.message}`
          );
        }

        // Add browser and page connection monitoring during script execution
        let monitoringInterval;
        const startMonitoring = () => {
          monitoringInterval = setInterval(async () => {
            try {
              const contexts = browserRef.contexts(); // This will throw if browser is closed
              await fs.appendFile(
                logFilePath,
                `[${new Date().toISOString()}] Monitor: Browser OK, ${contexts.length} context(s)\n`
              );

              // Check if page is still valid and detect page loss
              try {
                const currentUrl = pageRef.url(); // This will throw if page is closed/navigated
                await fs.appendFile(
                  logFilePath,
                  `[${new Date().toISOString()}] Monitor: Page OK, URL: ${currentUrl}\n`
                );
              } catch (pageError) {
                console.error(
                  `[CLOSE-EXTERNAL] Page connection lost during script execution for session ${sessionId}: ${pageError.message}`
                );
                await fs.appendFile(
                  logFilePath,
                  `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Page connection lost: ${pageError.message}\n`
                );

                // Check if any pages exist in contexts
                for (let i = 0; i < contexts.length; i++) {
                  const pages = contexts[i].pages();
                  await fs.appendFile(
                    logFilePath,
                    `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Context ${i} has ${pages.length} pages\n`
                  );

                  if (pages.length === 0) {
                    await fs.appendFile(
                      logFilePath,
                      `[${new Date().toISOString()}] [CLOSE-EXTERNAL] WARNING: All pages closed externally - possible anti-automation or security measure\n`
                    );
                  } else {
                    for (let j = 0; j < pages.length; j++) {
                      try {
                        const pageUrl = pages[j].url();
                        await fs.appendFile(
                          logFilePath,
                          `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Remaining page ${j}: ${pageUrl}\n`
                        );
                      } catch (e) {
                        await fs.appendFile(
                          logFilePath,
                          `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Page ${j} inaccessible: ${e.message}\n`
                        );
                      }
                    }
                  }
                }
              }
            } catch (error) {
              console.error(
                `[CLOSE-EXTERNAL] Browser connection lost during script execution for session ${sessionId}: ${error.message}`
              );
              await fs.appendFile(
                logFilePath,
                `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Browser connection lost: ${error.message}\n`
              );
              if (monitoringInterval) {
                clearInterval(monitoringInterval);
                monitoringInterval = null;
              }
            }
          }, 2000); // Check every 2 seconds (less aggressive)
        };

        const stopMonitoring = () => {
          if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
          }
        };

        try {
          startMonitoring();
          result = await scriptFunction(browserRef, pageRef, scriptArgs);
          stopMonitoring();
        } catch (scriptError) {
          stopMonitoring();

          // Check if it's a page context error and try to diagnose
          if (
            scriptError.message.includes(
              "Target page, context or browser has been closed"
            )
          ) {
            await fs.appendFile(
              logFilePath,
              `[${new Date().toISOString()}] [CLOSE-EXTERNAL] CRITICAL: Page/browser closed during script execution\n`
            );

            try {
              // Check if browser is still alive
              const contexts = browserRef.contexts();
              await fs.appendFile(
                logFilePath,
                `[${new Date().toISOString()}] Browser still has ${contexts.length} context(s) after page error\n`
              );

              // Check if we can get a new page
              if (contexts.length > 0) {
                const pages = contexts[0].pages();
                await fs.appendFile(
                  logFilePath,
                  `[${new Date().toISOString()}] Context has ${pages.length} page(s)\n`
                );

                if (pages.length === 0) {
                  await fs.appendFile(
                    logFilePath,
                    `[${new Date().toISOString()}] [CLOSE-EXTERNAL] CONFIRMED: All pages closed externally while browser remains active\n`
                  );
                  await fs.appendFile(
                    logFilePath,
                    `[${new Date().toISOString()}] [CLOSE-EXTERNAL] This indicates external closure (anti-automation, security policy, etc.)\n`
                  );
                  await fs.appendFile(
                    logFilePath,
                    `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Browser will be closed due to page loss, not script completion\n`
                  );
                } else {
                  for (let i = 0; i < pages.length; i++) {
                    try {
                      const newUrl = pages[i].url();
                      await fs.appendFile(
                        logFilePath,
                        `[${new Date().toISOString()}] Remaining page ${i} URL: ${newUrl}\n`
                      );
                    } catch (pageUrlError) {
                      await fs.appendFile(
                        logFilePath,
                        `[${new Date().toISOString()}] Page ${i} URL inaccessible: ${pageUrlError.message}\n`
                      );
                    }
                  }
                }
              } else {
                await fs.appendFile(
                  logFilePath,
                  `[${new Date().toISOString()}] [CLOSE-EXTERNAL] CONFIRMED: No contexts remain - complete external closure\n`
                );
              }
            } catch (diagError) {
              await fs.appendFile(
                logFilePath,
                `[${new Date().toISOString()}] [CLOSE-EXTERNAL] Browser diagnosis failed: ${diagError.message}\n`
              );
              await fs.appendFile(
                logFilePath,
                `[${new Date().toISOString()}] [CLOSE-EXTERNAL] This confirms browser was closed externally\n`
              );
            }
          }

          throw scriptError;
        }
        console.error(
          `[MCP] Script function completed successfully for session ${sessionId}`
        );

        await fs.appendFile(
          logFilePath,
          `\n[${new Date().toISOString()}] Script executed successfully\n`
        );
      } catch (error) {
        errorMessage = error.message;
        console.error(
          `[MCP] Script execution failed for session ${sessionId}: ${error.message}`
        );
        await fs.appendFile(
          logFilePath,
          `\n[${new Date().toISOString()}] Script execution failed: ${error.message}\n`
        );
        await fs.appendFile(logFilePath, `Stack trace:\n${error.stack}\n`);

        // Try to diagnose why browser was closed
        try {
          browserRef.contexts();
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] Browser is still connected after error\n`
          );
        } catch (browserCheckError) {
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] Browser is disconnected after error: ${browserCheckError.message}\n`
          );
        }
      }

      return { result, errorMessage };
    };

    // Handle script completion using Promise.then()
    executeScript()
      .then(async ({ result, errorMessage }) => {
        console.error(
          `[MCP] Script execution completed, processing results...`
        );

        // Prepare final output
        const finalOutput = {
          ...taskInfo,
          status: errorMessage ? "failed" : "completed",
          endTime: new Date().toISOString(),
          result: result !== undefined ? result : null,
          error: errorMessage,
        };

        // Write final output to JSON file
        await fs.writeFile(
          outputFilePath,
          JSON.stringify(finalOutput, null, 2)
        );
        console.error(
          `[MCP] Background script completed. Output saved to: ${outputFilePath}`
        );

        // 简化的日志记录，现在启动智能关闭监控
        await fs.appendFile(
          logFilePath,
          `\n[${new Date().toISOString()}] Script execution completed. Output file generated: ${outputFilePath}\n`
        );

        // ============================================
        // 关闭新创建的 Tab (如果需要)
        // ============================================
        if (isNewTabRef && autoCloseTabRef) {
          try {
            await pageRef.close();
            console.error(
              `[MCP] Auto-closed tab after background script completion`
            );
            await fs.appendFile(
              logFilePath,
              `[${new Date().toISOString()}] Auto-closed tab after script completion\n`
            );
          } catch (closeError) {
            console.error(`[MCP] Error closing tab: ${closeError.message}`);
            await fs.appendFile(
              logFilePath,
              `[${new Date().toISOString()}] Error closing tab: ${closeError.message}\n`
            );
          }
        }

        // 启动智能关闭监控（基于output文件存在性）
        if (finalAutoCloseBrowserRef) {
          startSmartBrowserCloser(
            outputFilePath,
            logFilePath,
            sessionIdRef,
            browserRef,
            sessionRegistryFileRef,
            timestamp
          );
        }
      })
      .catch(async (error) => {
        console.error(
          `[MCP] Script execution promise rejected: ${error.message}`
        );
        await fs.appendFile(
          logFilePath,
          `[${new Date().toISOString()}] Script execution promise rejected: ${error.message}\n`
        );

        // 即使脚本失败，也要启动智能关闭监控（但会超时关闭）
        if (finalAutoCloseBrowserRef) {
          await fs.appendFile(
            logFilePath,
            `[${new Date().toISOString()}] Starting smart closer due to script failure\n`
          );
          startSmartBrowserCloser(
            outputFilePath,
            logFilePath,
            sessionIdRef,
            browserRef,
            sessionRegistryFileRef,
            timestamp
          );
        }
      });

    // Return immediately with task info
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(taskInfo, null, 2),
        },
      ],
    };
  },

  go_back: async function () {
    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Going back to previous page");

    try {
      await this.page.goBack();
      const currentUrl = this.page.url();

      return {
        content: [
          {
            type: "text",
            text: `Navigated back to: ${currentUrl}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(
        `Failed to go back: ${error.message}. There might be no previous page in history.`
      );
    }
  },

  evaluate: async function (args) {
    const { code } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Evaluating code in browser context");

    try {
      const result = await this.page.evaluate((codeStr) => {
        try {
          // First try to execute the code as-is
          const fn = new Function(codeStr);
          return fn();
        } catch (e) {
          // If that fails, try wrapping with return
          try {
            const fnWithReturn = new Function("return (" + codeStr + ")");
            return fnWithReturn();
          } catch (e2) {
            // Last resort: execute and capture last expression
            const fnFinal = new Function(
              "return (function() { " + codeStr + " })()"
            );
            return fnFinal();
          }
        }
      }, code);

      return {
        content: [
          {
            type: "text",
            text:
              result === undefined
                ? "undefined"
                : result === null
                  ? "null"
                  : typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] Evaluation failed:", error);
      throw new Error(`Evaluation failed: ${error.message}`);
    }
  },

  switch_to_tab: async function (args) {
    const { index = 0, url, target } = args;

    if (!this.browser) {
      throw new Error(
        "No browser available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Switching to tab");

    const context = this.browser.contexts()[0];
    const currentPages = context.pages();

    if (currentPages.length === 0) {
      throw new Error("No pages available");
    }

    let targetPage;
    let targetIndex = index;

    // Handle special targets
    if (target === "latest" || index === -1) {
      targetIndex = currentPages.length - 1;
      console.error("[MCP] Switching to latest tab");
    } else if (target === "first") {
      targetIndex = 0;
      console.error("[MCP] Switching to first tab");
    }

    if (url) {
      // Find page by URL
      targetPage = currentPages.find((page) => page.url().includes(url));
      if (!targetPage) {
        throw new Error(`No tab found containing URL: ${url}`);
      }
    } else {
      // Find page by index
      if (targetIndex >= currentPages.length || targetIndex < 0) {
        throw new Error(
          `Tab index ${targetIndex} out of range. Available tabs: ${currentPages.length}`
        );
      }
      targetPage = currentPages[targetIndex];
    }

    const previousUrl = this.page ? this.page.url() : "none";
    this.page = targetPage;

    // Wait for the page to be ready
    try {
      await this.page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    } catch (e) {
      console.error(
        "[MCP] Page didn't finish loading within 5s, continuing anyway"
      );
    }

    return {
      content: [
        {
          type: "text",
          text: `Switched from ${previousUrl} to ${this.page.url()}`,
        },
      ],
    };
  },

  get_tabs: async function () {
    if (!this.browser) {
      throw new Error(
        "No browser available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Getting all tabs");

    const context = this.browser.contexts()[0];
    const currentPages = context.pages();

    const tabInfo = currentPages.map((page, index) => ({
      index,
      url: page.url(),
      title: page.title(),
      isCurrent: page === this.page,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(tabInfo, null, 2),
        },
      ],
    };
  },

  get_login: async function (args = {}) {
    const {
      url,
      waitMessage = "Please complete your login, then click 'Finish Connect'",
      autoClose = true,
      saveToFile = false,
    } = args;

    if (!url) {
      throw new Error("URL is required for login capture");
    }

    console.error(`[MCP] Starting interactive login capture for: ${url}`);

    try {
      // 启动浏览器（如果还没有）
      if (!this.browser || !this.page) {
        console.error("[MCP] No browser available, launching new browser...");
        await this.launch_browser({});
      }

      // 导航到登录页面
      console.error(`[MCP] Navigating to login URL: ${url}`);
      await this.page.goto(url, { waitUntil: "networkidle" });

      // 生成文件路径函数
      this.generateFilePath = (url) => {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");

        // 创建临时目录
        const tmpDir = path.join(os.tmpdir(), "mcp-browser-auth");
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        // 生成文件名
        const domain = new URL(url).hostname.replace(/\./g, "_");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `${domain}_${timestamp}.json`;
        return path.join(tmpDir, filename);
      };

      // 定义按钮注入函数（可重复调用）
      const injectLoginButton = async () => {
        try {
          console.error("[MCP] Injecting login button...");

          // 注入 CSS 样式（每次都重新注入确保样式存在）
          await this.page.addStyleTag({
            content: `
              /* 高特异性选择器覆盖所有样式 */
              button#mcp-finish-connect-btn,
              #mcp-finish-connect-btn,
              [id="mcp-finish-connect-btn"] {
                /* 重置所有继承样式 */
                all: unset !important;
                
                /* 核心定位和显示 */
                position: fixed !important;
                top: 40px !important;
                right: 20px !important;
                z-index: 999999 !important;
                display: inline-block !important;
                box-sizing: border-box !important;
                
                /* 视觉外观 */
                background: linear-gradient(135deg, #3d9040 0%, #2d7030 100%) !important;
                color: white !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
                border-radius: 25px !important;
                padding: 12px 24px !important;
                
                /* 字体样式 */
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 14px !important;
                font-weight: 600 !important;
                line-height: 1.2 !important;
                text-align: center !important;
                text-decoration: none !important;
                text-overflow: visible !important;
                white-space: nowrap !important;
                
                /* 交互性 */
                cursor: pointer !important;
                user-select: none !important;
                outline: none !important;
                outline-offset: 0 !important;
                
                /* 效果 */
                box-shadow: 0 4px 15px rgba(61, 144, 64, 0.3) !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
                transition: all 0.3s ease !important;
                
                /* 重置常见覆盖 */
                width: auto !important;
                height: auto !important;
                min-width: auto !important;
                min-height: auto !important;
                max-width: none !important;
                max-height: none !important;
                margin: 0 !important;
                vertical-align: baseline !important;
                text-transform: none !important;
                letter-spacing: normal !important;
                word-spacing: normal !important;
                opacity: 1 !important;
                visibility: visible !important;
                overflow: visible !important;
                
                /* 重置 flex/grid */
                flex: none !important;
                grid-area: auto !important;
                align-self: auto !important;
                justify-self: auto !important;
              }
              
              button#mcp-finish-connect-btn:hover,
              #mcp-finish-connect-btn:hover,
              [id="mcp-finish-connect-btn"]:hover {
                transform: translateY(-2px) !important;
                box-shadow: 0 6px 20px rgba(61, 144, 64, 0.4) !important;
                background: linear-gradient(135deg, #4da050 0%, #3d9040 100%) !important;
                color: white !important;
              }
              
              button#mcp-finish-connect-btn:active,
              #mcp-finish-connect-btn:active,
              [id="mcp-finish-connect-btn"]:active {
                transform: translateY(0) !important;
                box-shadow: 0 2px 10px rgba(61, 144, 64, 0.3) !important;
                background: linear-gradient(135deg, #3d9040 0%, #2d7030 100%) !important;
                color: white !important;
              }
              
              button#mcp-finish-connect-btn:focus,
              #mcp-finish-connect-btn:focus,
              [id="mcp-finish-connect-btn"]:focus {
                outline: 2px solid rgba(61, 144, 64, 0.5) !important;
                outline-offset: 2px !important;
                background: linear-gradient(135deg, #4da050 0%, #3d9040 100%) !important;
                color: white !important;
              }
              
              button#mcp-finish-connect-btn:before,
              #mcp-finish-connect-btn:before,
              [id="mcp-finish-connect-btn"]:before {
                content: '✓' !important;
                margin-right: 8px !important;
                font-size: 16px !important;
                font-weight: bold !important;
                color: white !important;
                display: inline !important;
              }
            `,
          });

          // 注入按钮 HTML 和事件处理
          await this.page.evaluate((saveToFileFlag) => {
            // 设置全局变量
            window.mcpSaveToFile = saveToFileFlag;

            // 移除现有按钮和监听器
            const existingBtn = document.getElementById(
              "mcp-finish-connect-btn"
            );
            if (existingBtn) {
              existingBtn.remove();
            }

            // 移除现有事件监听器
            const existingListeners = window.mcpCloseListeners;
            if (existingListeners && Array.isArray(existingListeners)) {
              existingListeners.forEach((listener) => {
                window.removeEventListener("mcp-connect-close", listener);
              });
            }

            // 创建按钮
            console.log("[MCP] Creating button element...");
            const button = document.createElement("button");
            button.id = "mcp-finish-connect-btn";
            button.textContent = saveToFileFlag
              ? "Once logged in, tap here to connect & save"
              : "Once logged in, tap here to connect";
            button.title = "Save connection and close this window";
            console.log("[MCP] Button element created:", button.id);

            // 创建事件处理器
            const clickHandler = () => {
              console.log(
                "[MCP] Button clicked - starting authentication capture..."
              );

              // 添加加载状态
              button.textContent = "Connecting...";
              button.style.opacity = "0.7";
              button.style.cursor = "not-allowed";

              // 移除点击监听器防止多次点击
              button.removeEventListener("click", clickHandler);

              console.log("[MCP] Button state updated to connecting...");

              // 如果是saveToFile模式，调用特殊的下载处理器
              if (window.mcpSaveToFile && window.mcpHandleButtonClick) {
                console.log("[MCP] Calling file save handler...");
                window.mcpHandleButtonClick();

                // 更新按钮状态
                setTimeout(() => {
                  button.textContent = "✅ Download triggered!";
                  button.style.background =
                    "linear-gradient(135deg, #00CC00 0%, #009900 100%)";
                }, 100);

                return; // 不执行后续的普通处理
              }

              // 收集认证数据（普通模式）
              try {
                // 获取所有存储数据
                const storageData = {
                  url: window.location.href,
                  domain: window.location.hostname,
                  timestamp: new Date().toISOString(),
                  cookies: document.cookie,
                  localStorage: {},
                  sessionStorage: {},
                };

                // 收集 localStorage
                try {
                  for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key)
                      storageData.localStorage[key] = localStorage.getItem(key);
                  }
                } catch (e) {
                  storageData.localStorageError = e.message;
                }

                // 收集 sessionStorage
                try {
                  for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key)
                      storageData.sessionStorage[key] =
                        sessionStorage.getItem(key);
                  }
                } catch (e) {
                  storageData.sessionStorageError = e.message;
                }

                // 保存到全局变量，供主进程读取
                window.mcpCapturedData = {
                  ...storageData,
                  captureInfo: {
                    tool: "get_login",
                    version: "1.0",
                    savedAt: new Date().toISOString(),
                    filePath: window.mcpFilePath || null, // 使用预设的文件路径
                    saveToFile: window.mcpSaveToFile,
                  },
                };

                console.log(
                  "[MCP] Data captured, saveToFile=" + window.mcpSaveToFile
                );
              } catch (error) {
                console.error("[MCP] Error capturing data:", error);
                window.mcpCaptureError = error.message;
              }

              // 发送消息到主进程
              window.dispatchEvent(new CustomEvent("mcp-connect-close"));

              // 更新按钮状态为成功
              setTimeout(() => {
                button.textContent = "✅ Data captured!";
                button.style.opacity = "0.8";
                button.style.cursor = "default";
                button.style.background =
                  "linear-gradient(135deg, #00CC00 0%, #009900 100%)";

                console.log("[MCP] Button state updated to success");

                // 3秒后淡出按钮
                setTimeout(() => {
                  button.style.opacity = "0";
                  button.style.transform = "translateY(-10px)";
                  setTimeout(() => {
                    if (button.parentNode) {
                      button.parentNode.removeChild(button);
                    }
                  }, 500);
                }, 3000);
              }, 100);
            };

            // 添加点击处理器
            button.addEventListener("click", clickHandler);

            // 添加到页面
            console.log("[MCP] Appending button to page...");
            document.body.appendChild(button);
            console.log("[MCP] Button appended to page");

            // 添加淡入动画
            setTimeout(() => {
              button.style.opacity = "1";
            }, 100);

            // 创建关闭事件监听器
            const closeListener = () => {
              console.log("Connect and close requested");
              window.mcpLoginFinished = true;
            };

            // 跟踪监听器
            window.mcpCloseListeners = [
              window.mcpCloseListeners || [],
              closeListener,
            ].flat();

            // 监听自定义事件
            window.addEventListener("mcp-connect-close", closeListener);
          }, saveToFile);

          console.error("[MCP] ✅ Login button injected successfully!");
          return true;
        } catch (error) {
          console.error("[MCP] ❌ Button injection failed:", error.message);
          return false;
        }
      };

      // 首次注入按钮
      try {
        await injectLoginButton();
        console.error("[MCP] saveToFile parameter:", saveToFile);
      } catch (injectionError) {
        console.error(
          `[MCP] Button injection failed: ${injectionError.message}`
        );
        console.error(
          `[MCP] WARNING: Could not inject interactive UI due to page security restrictions (CSP)`
        );
        console.error(`[MCP] FALLBACK MODE: Manual login required`);
        console.error(`[MCP] Browser URL: ${this.page.url()}`);
        console.error(
          `[MCP] Please complete login in browser, then use 'get_storage' tool to capture auth data`
        );

        // 备用方案：提供清晰指导
        return {
          content: [
            {
              type: "text",
              text: `# ⚠️ 手动登录模式 (CSP 限制回退)

## 🚫 问题说明
该网站的内容安全策略 (CSP) 阻止了交互式 UI 注入。这是网站的安全保护机制。

## 📋 手动操作步骤
### 步骤 1: 完成登录
- **当前浏览器已打开**: ${this.page.url()}
- **请在浏览器中完成登录** (输入用户名密码等)
- **确保登录状态生效** (能看到已登录的用户界面)

### 步骤 2: 捕获认证数据  
**登录完成后，运行此命令获取认证数据:**
\`\`\`
get_storage sessionId="default"
\`\`\`

## 🔧 自动化使用
获取到认证数据后，可以使用 \`set_storage\` 工具在自动化脚本中恢复登录状态:
\`\`\`
set_storage cookies=[...] localStorage={...} domain="${new URL(this.page.url()).hostname}"
\`\`\`

## 📊 当前状态
- ✅ **浏览器**: 已启动并保持打开
- ✅ **页面**: ${this.page.url()}
- ⏳ **等待**: 用户手动完成登录
- 🎯 **下一步**: 登录后使用 \`get_storage\` 捕获数据

**提示**: 这种回退模式确保即使在最严格的网站安全设置下也能完成认证捕获。`,
            },
          ],
        };
      }

      // 成功注入，继续正常流程
      console.error(
        `[MCP] ✅ Interactive login UI injected successfully using proven strategy!`
      );
      console.error(`[MCP] 📝 Instructions: ${waitMessage}`);
      console.error(
        `[MCP] 👀 Look for the blue 'Finish Connect' button in the top-right corner of the browser`
      );
      console.error(
        `[MCP] 🔄 Button will persist through page redirects automatically`
      );
      console.error(
        `[MCP] ⏰ Waiting for user interaction (timeout: 10 minutes)...`
      );

      // 启动定期检查机制，确保按钮始终可见
      const buttonCheckInterval = setInterval(async () => {
        try {
          const buttonStatus = await this.page.evaluate(() => {
            const btn = document.getElementById("mcp-finish-connect-btn");
            return {
              exists: !!btn,
              visible: btn && btn.offsetParent !== null,
              clicked: window.mcpLoginFinished === true,
            };
          });

          // 如果用户已点击完成，停止检查
          if (buttonStatus.clicked) {
            clearInterval(buttonCheckInterval);
            return;
          }

          // 如果按钮丢失或不可见，重新注入
          if (!buttonStatus.exists || !buttonStatus.visible) {
            console.error(`[MCP] Button missing or hidden, re-injecting...`);
            const reinjected = await injectLoginButton();
            if (reinjected) {
              console.error(`[MCP] ✅ Button successfully re-injected`);
            } else {
              console.error(`[MCP] ⚠️ Failed to re-inject button`);
            }
          }
        } catch (error) {
          console.error(`[MCP] Error during button check: ${error.message}`);
        }
      }, 3000); // 每3秒检查一次

      // 清理定时器的函数
      const cleanupInterval = () => {
        clearInterval(buttonCheckInterval);
        console.error(`[MCP] Button monitoring stopped`);
      };

      // 等待用户点击按钮
      console.error(
        `[MCP] 👆 Waiting for user to click 'Finish Connect' button`
      );

      // 等待用户点击按钮
      const startWaitTime = Date.now();
      try {
        // 使用轮询而不是 waitForFunction 来避免 CSP 限制
        const loginFinished = new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => {
              reject(new Error("Login timeout after 10 minutes"));
            },
            10 * 60 * 1000
          );

          const checkFinished = async () => {
            try {
              const finished = await this.page.evaluate(
                () => window.mcpLoginFinished === true
              );
              if (finished) {
                clearTimeout(timeout);
                resolve();
              } else {
                setTimeout(checkFinished, 1000); // 每秒检查一次
              }
            } catch (e) {
              // 如果 evaluate 失败，继续轮询
              setTimeout(checkFinished, 1000);
            }
          };

          checkFinished();
        });

        await loginFinished;

        console.error(
          `[MCP] ✅ User click detected, processing data and file save...`
        );

        // 用户点击了完成，清理定时器
        cleanupInterval();
      } catch (waitError) {
        // 超时或错误，清理定时器
        cleanupInterval();

        if (waitError.message.includes("Timeout")) {
          console.error(`[MCP] Login timeout after 10 minutes`);
          throw new Error(
            'Login timeout: Please complete login and click "Finish Connect" within 10 minutes'
          );
        }
        throw waitError;
      }

      const waitDuration = Date.now() - startWaitTime;
      console.error(
        `[MCP] User completed login after ${Math.round(waitDuration / 1000)}s`
      );

      // 检查是否需要保存文件
      console.error(`[MCP] 🔍 Checking captured data...`);
      const capturedData = await this.page.evaluate(() => {
        const data = window.mcpCapturedData || null;
        if (data) {
          console.log("[MCP] Found captured data:", {
            domain: data.domain,
            saveToFile: data.captureInfo
              ? data.captureInfo.saveToFile
              : "no captureInfo",
            filePath: data.captureInfo ? data.captureInfo.filePath : "no path",
          });
        } else {
          console.log("[MCP] No captured data found in window.mcpCapturedData");
        }
        return data;
      });

      let savedFilePath = null;
      console.error(`[MCP] 🔍 capturedData exists: ${!!capturedData}`);
      if (capturedData) {
        console.error(
          `[MCP] 🔍 captureInfo exists: ${!!capturedData.captureInfo}`
        );
        if (capturedData.captureInfo) {
          console.error(
            `[MCP] 🔍 saveToFile: ${capturedData.captureInfo.saveToFile}`
          );
          console.error(
            `[MCP] 🔍 filePath: ${capturedData.captureInfo.filePath}`
          );
        }
      }

      if (
        capturedData &&
        capturedData.captureInfo &&
        capturedData.captureInfo.saveToFile
      ) {
        try {
          // 获取完整的cookies
          const context = this.page.context();
          const browserCookies = await context.cookies();

          // 合并数据
          const completeData = {
            ...capturedData,
            cookies: browserCookies.map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              expires: cookie.expires,
              httpOnly: cookie.httpOnly,
              secure: cookie.secure,
              sameSite: cookie.sameSite,
            })),
            cookieString: capturedData.cookies, // 保留原始cookie字符串
          };

          // 使用标准的blob下载方式保存文件
          const filePath = capturedData.captureInfo.filePath;
          if (filePath) {
            console.error(`[MCP] 📥 Starting file save process...`);
            console.error(`[MCP] 📁 Target file path: ${filePath}`);

            // 打印数据统计
            const cookieCount = completeData.cookies
              ? completeData.cookies.length
              : 0;
            const localStorageCount = Object.keys(
              completeData.localStorage || {}
            ).length;
            const sessionStorageCount = Object.keys(
              completeData.sessionStorage || {}
            ).length;

            console.error(
              `[MCP] 📊 Data: ${cookieCount} cookies, ${localStorageCount} localStorage, ${sessionStorageCount} sessionStorage`
            );

            try {
              // 设置简单的下载监听器
              console.error(`[MCP] 🔄 Setting up download handler...`);

              const downloadPromise = new Promise((resolve, reject) => {
                const downloadHandler = async (download) => {
                  try {
                    console.error("[MCP] 📥 Download detected!");
                    const suggestedName = download.suggestedFilename();
                    console.error(
                      `[MCP] 💾 Saving ${suggestedName} to ${filePath}`
                    );

                    await download.saveAs(filePath);
                    savedFilePath = filePath;
                    console.error(
                      `[MCP] ✅ File saved successfully to: ${filePath}`
                    );

                    // 移除监听器
                    this.page.off("download", downloadHandler);
                    resolve(filePath);
                  } catch (error) {
                    console.error(
                      `[MCP] ❌ Download save failed: ${error.message}`
                    );
                    this.page.off("download", downloadHandler);
                    reject(error);
                  }
                };

                // 注册下载监听器
                this.page.on("download", downloadHandler);

                // 超时处理
                setTimeout(() => {
                  this.page.off("download", downloadHandler);
                  reject(new Error("Download timeout after 5 seconds"));
                }, 5000);
              });

              // 准备文件名
              const domain = completeData.domain.replace(/\./g, "_");
              const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-")
                .slice(0, 19);
              const fileName = `auth_${domain}_${timestamp}.json`;

              console.error(
                `[MCP] 🚀 Triggering standard blob download: ${fileName}`
              );

              // 将数据转为JSON字符串
              const jsonContent = JSON.stringify(completeData, null, 2);
              console.error(`[MCP] 📝 JSON size: ${jsonContent.length} chars`);

              // 在页面中触发下载 - 完全按照标准blob下载方式
              const downloadTriggerResult = await this.page.evaluate(
                (jsonStr, filename) => {
                  try {
                    console.log(
                      "[MCP] === Starting standard blob download ==="
                    );

                    // Step 1: Create a Blob object
                    console.log("[MCP] Step 1: Creating Blob object...");
                    const blob = new Blob([jsonStr], { type: "text/plain" });
                    console.log(`[MCP] Blob created, size: ${blob.size} bytes`);

                    // Step 2: Create an Object URL
                    console.log("[MCP] Step 2: Creating Object URL...");
                    const url = URL.createObjectURL(blob);
                    console.log("[MCP] Object URL created:", url);

                    // Step 3: Create a temporary anchor element
                    console.log("[MCP] Step 3: Creating anchor element...");
                    const link = document.createElement("a");

                    // Step 4: Configure the anchor element
                    console.log("[MCP] Step 4: Configuring anchor...");
                    link.href = url;
                    link.download = filename;

                    // Step 5: Append and click the link
                    console.log("[MCP] Step 5: Appending and clicking...");
                    document.body.appendChild(link);
                    link.click();
                    console.log("[MCP] Click triggered!");

                    // Step 6: Clean up (delayed to ensure download starts)
                    console.log("[MCP] Step 6: Scheduling cleanup...");
                    setTimeout(() => {
                      document.body.removeChild(link);
                      URL.revokeObjectURL(url);
                      console.log("[MCP] Cleanup completed");
                    }, 100);

                    console.log("[MCP] === Download trigger completed ===");
                    return {
                      success: true,
                      size: blob.size,
                      filename: filename,
                    };
                  } catch (error) {
                    console.error(
                      "[MCP] Download trigger error:",
                      error.message
                    );
                    return {
                      success: false,
                      error: error.message,
                    };
                  }
                },
                jsonContent,
                fileName
              );

              if (!downloadTriggerResult.success) {
                throw new Error(
                  `Download trigger failed: ${downloadTriggerResult.error}`
                );
              }

              console.error(`[MCP] ✅ Download triggered successfully`);
              console.error(
                `[MCP] 📊 File size: ${downloadTriggerResult.size} bytes`
              );
              console.error(
                `[MCP] 📄 Filename: ${downloadTriggerResult.filename}`
              );
              console.error(`[MCP] ⏳ Waiting for download to complete...`);

              // 等待下载完成
              try {
                await downloadPromise;
                console.error(`[MCP] ✅ File download and save completed!`);
              } catch (downloadError) {
                console.error(
                  `[MCP] ⚠️ Download handler error: ${downloadError.message}`
                );
                // 继续，可能是超时但文件已保存
              }

              // 验证文件是否存在（降级检查）
              if (!savedFilePath) {
                // 如果下载监听器没有触发，尝试直接保存
                console.error(
                  `[MCP] ⚠️ Download handler didn't trigger, trying direct save...`
                );
                const fs = require("fs");
                fs.writeFileSync(filePath, jsonContent);
                savedFilePath = filePath;
                console.error(
                  `[MCP] ✅ File saved directly via fs.writeFileSync`
                );
              }
            } catch (error) {
              console.error(
                `[MCP] ❌ Standard blob download failed: ${error.message}`
              );
              throw error; // 让外层catch处理降级逻辑
            }
          }
        } catch (saveError) {
          console.error(
            `[MCP] ⚠️ Failed to save file via Playwright: ${saveError.message}`
          );
          // 降级到直接文件写入
          try {
            const filePath = capturedData.captureInfo.filePath;
            if (filePath) {
              const fs = require("fs");
              const context = this.page.context();
              const browserCookies = await context.cookies();

              const completeData = {
                ...capturedData,
                cookies: browserCookies.map((cookie) => ({
                  name: cookie.name,
                  value: cookie.value,
                  domain: cookie.domain,
                  path: cookie.path,
                  expires: cookie.expires,
                  httpOnly: cookie.httpOnly,
                  secure: cookie.secure,
                  sameSite: cookie.sameSite,
                })),
                cookieString: capturedData.cookies,
              };

              fs.writeFileSync(filePath, JSON.stringify(completeData, null, 2));
              savedFilePath = filePath;
              console.error(
                `[MCP] ✅ Fallback: Authentication data saved via fs to: ${filePath}`
              );
            }
          } catch (fallbackError) {
            console.error(
              `[MCP] ❌ Fallback save also failed: ${fallbackError.message}`
            );
          }
        }
      }

      // 获取存储数据用于显示
      console.error("[MCP] Capturing authentication data for display...");
      const storageData = {
        url: this.page.url(),
        domain: new URL(this.page.url()).hostname,
        timestamp: new Date().toISOString(),
        loginDuration: Math.round(waitDuration / 1000),
        cookies: [],
        localStorage: {},
        sessionStorage: {},
      };

      // 获取cookies
      try {
        const context = this.page.context();
        const cookies = await context.cookies();
        storageData.cookies = cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        }));
        console.error(`[MCP] Captured ${storageData.cookies.length} cookies`);
      } catch (cookieError) {
        console.error(`[MCP] Error getting cookies: ${cookieError.message}`);
        storageData.cookieError = cookieError.message;
      }

      // 获取localStorage和sessionStorage
      try {
        const storageResult = await this.page.evaluate(() => {
          const result = {
            localStorage: {},
            sessionStorage: {},
          };

          // localStorage
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) result.localStorage[key] = localStorage.getItem(key);
            }
          } catch (e) {
            result.localStorageError = e.message;
          }

          // sessionStorage
          try {
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key) result.sessionStorage[key] = sessionStorage.getItem(key);
            }
          } catch (e) {
            result.sessionStorageError = e.message;
          }

          return result;
        });

        storageData.localStorage = storageResult.localStorage;
        storageData.sessionStorage = storageResult.sessionStorage;

        console.error(
          `[MCP] Captured ${Object.keys(storageData.localStorage).length} localStorage items`
        );
        console.error(
          `[MCP] Captured ${Object.keys(storageData.sessionStorage).length} sessionStorage items`
        );
      } catch (storageError) {
        console.error(`[MCP] Error getting storage: ${storageError.message}`);
        storageData.storageError = storageError.message;
      }

      // 移除UI元素
      try {
        await this.page.evaluate(() => {
          const button = document.getElementById("mcp-finish-connect-btn");
          const message = document.getElementById("mcp-login-message");
          if (button) button.remove();
          if (message) message.remove();
        });
      } catch (uiCleanupError) {
        console.error(
          `[MCP] Error removing UI elements: ${uiCleanupError.message}`
        );
      }

      console.error(`[MCP] Authentication data captured successfully!`);

      // 总是保存到临时文件
      const filePath = this.generateFilePath(url);
      try {
        const fs = require("fs");
        await fs.promises.writeFile(
          filePath,
          JSON.stringify(storageData, null, 2),
          "utf8"
        );
        savedFilePath = filePath;
        console.error(`[MCP] ✅ File saved successfully: ${filePath}`);
      } catch (saveError) {
        console.error(`[MCP] ❌ Failed to save file: ${saveError.message}`);
      }

      // 自动关闭浏览器（手动模式）
      if (autoClose) {
        console.error("[MCP] Auto-closing browser...");
        try {
          await this.page.close();
          console.error("[MCP] Browser closed successfully");
        } catch (closeError) {
          console.error(`[MCP] Error closing browser: ${closeError.message}`);
        }
      }

      // 返回结果（根据是否保存了文件显示不同信息）
      if (savedFilePath) {
        // saveToFile=true的情况，文件已保存
        return {
          content: [
            {
              type: "text",
              text: savedFilePath,
            },
          ],
        };
      } else {
        // saveToFile=false的情况，仅返回数据
        return {
          content: [
            {
              type: "text",
              text: `# 🔐 登录认证数据捕获完成

## ⏱️ 登录信息
- **登录耗时**: ${Math.round(waitDuration / 1000)} 秒
- **当前URL**: ${storageData.url}
- **域名**: ${storageData.domain}
- **捕获时间**: ${new Date().toLocaleString("zh-CN")}

## 🍪 数据统计
- **Cookies**: ${storageData.cookies.length} 个
- **LocalStorage**: ${Object.keys(storageData.localStorage).length} 个键值对  
- **SessionStorage**: ${Object.keys(storageData.sessionStorage).length} 个键值对

## 🔧 使用方法
可以使用 \`set_storage\` 工具恢复这些认证数据:

\`\`\`json
{
  "cookies": ${JSON.stringify(storageData.cookies, null, 2)},
  "localStorage": ${JSON.stringify(storageData.localStorage, null, 2)},
  "sessionStorage": ${JSON.stringify(storageData.sessionStorage, null, 2)},
  "domain": "${storageData.domain}"
}
\`\`\`

**提示**: 认证数据已成功捕获！${autoClose ? "浏览器已自动关闭。" : "浏览器保持打开状态。"}`,
            },
          ],
        };
      }
    } catch (error) {
      console.error("[MCP] Interactive login capture failed:", error);

      // 清理UI（如果存在）
      try {
        if (this.page) {
          await this.page.evaluate(() => {
            const button = document.getElementById("mcp-finish-connect-btn");
            const message = document.querySelector(
              '[style*="top: 70px"][style*="right: 20px"]'
            );
            if (button) button.remove();
            if (message) message.remove();
          });
        }
      } catch (cleanupError) {
        // 忽略清理错误
      }

      throw new Error(`Interactive login capture failed: ${error.message}`);
    }
  },

  get_storage: async function (args = {}) {
    const { sessionId = "default", includeHttpOnlyCookies = true } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Getting all storage data from current page");

    try {
      const storageData = {
        url: this.page.url(),
        domain: new URL(this.page.url()).hostname,
        timestamp: new Date().toISOString(),
        cookies: [],
        localStorage: {},
        sessionStorage: {},
      };

      // Get cookies
      try {
        const context = this.page.context();
        const cookies = await context.cookies();

        // Filter cookies for current domain if needed, or get all
        storageData.cookies = cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        }));

        console.error(`[MCP] Retrieved ${storageData.cookies.length} cookies`);
      } catch (cookieError) {
        console.error(`[MCP] Error getting cookies: ${cookieError.message}`);
        storageData.cookieError = cookieError.message;
      }

      // Get localStorage and sessionStorage
      try {
        const storageResult = await this.page.evaluate(() => {
          const result = {
            localStorage: {},
            sessionStorage: {},
            localStorageLength: 0,
            sessionStorageLength: 0,
          };

          // Get localStorage
          try {
            result.localStorageLength = localStorage.length;
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) {
                result.localStorage[key] = localStorage.getItem(key);
              }
            }
          } catch (e) {
            result.localStorageError = e.message;
          }

          // Get sessionStorage
          try {
            result.sessionStorageLength = sessionStorage.length;
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key) {
                result.sessionStorage[key] = sessionStorage.getItem(key);
              }
            }
          } catch (e) {
            result.sessionStorageError = e.message;
          }

          return result;
        });

        storageData.localStorage = storageResult.localStorage;
        storageData.sessionStorage = storageResult.sessionStorage;

        console.error(
          `[MCP] Retrieved ${storageResult.localStorageLength} localStorage items`
        );
        console.error(
          `[MCP] Retrieved ${storageResult.sessionStorageLength} sessionStorage items`
        );

        if (storageResult.localStorageError) {
          storageData.localStorageError = storageResult.localStorageError;
        }
        if (storageResult.sessionStorageError) {
          storageData.sessionStorageError = storageResult.sessionStorageError;
        }
      } catch (storageError) {
        console.error(`[MCP] Error getting storage: ${storageError.message}`);
        storageData.storageError = storageError.message;
      }

      // Generate summary
      const summary = {
        url: storageData.url,
        domain: storageData.domain,
        cookiesCount: storageData.cookies.length,
        localStorageCount: Object.keys(storageData.localStorage).length,
        sessionStorageCount: Object.keys(storageData.sessionStorage).length,
        timestamp: storageData.timestamp,
      };

      console.error(`[MCP] Storage data retrieved successfully:`, summary);

      return {
        content: [
          {
            type: "text",
            text: `# Storage Data Retrieved

## Summary
- **URL**: ${summary.url}
- **Domain**: ${summary.domain}
- **Cookies**: ${summary.cookiesCount} items
- **localStorage**: ${summary.localStorageCount} items  
- **sessionStorage**: ${summary.sessionStorageCount} items
- **Retrieved**: ${summary.timestamp}

## Full Storage Data
\`\`\`json
${JSON.stringify(storageData, null, 2)}
\`\`\`

## Usage
You can use this data with the \`set_storage\` tool to restore authentication state:
- Use the \`cookies\` array for the \`cookies\` parameter
- Use the \`localStorage\` object for the \`localStorage\` parameter  
- Use the \`sessionStorage\` object for the \`sessionStorage\` parameter
- Use the \`domain\` as the default domain for cookies`,
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] Failed to get storage data:", error);
      throw new Error(`Failed to get storage data: ${error.message}`);
    }
  },

  set_storage: async function (args = {}) {
    const {
      cookies,
      cookieString,
      localStorage,
      sessionStorage,
      domain,
      filePath,
      url,
      sessionId = "default",
    } = args;

    // 打印接收到的参数用于调试
    console.error(
      `[MCP] set_storage called with args:`,
      JSON.stringify(
        {
          hascookies: !!cookies,
          hasCookieString: !!cookieString,
          hasLocalStorage: !!localStorage,
          hasSessionStorage: !!sessionStorage,
          domain,
          filePath,
          url,
          sessionId,
        },
        null,
        2
      )
    );

    let browser = this.browser;
    let page = this.page;
    let currentSessionId = this.sessionId;
    let backgroundPage = null;
    let visiblePage = null; // 保存用户当前看到的页面引用

    // 如果指定了sessionId且不是default，使用指定的session
    if (sessionId && sessionId !== "default") {
      const { browser: sessionBrowser, page: sessionPage } =
        await getBrowserBySessionId(sessionId);
      browser = sessionBrowser;
      page = sessionPage;
      currentSessionId = sessionId;
    }

    if (!browser) {
      throw new Error(
        "No browser available. Launch or connect to browser first."
      );
    }

    // 如果提供了 URL，打开新标签页
    if (url) {
      console.error(`[MCP] Opening new tab for URL: ${url}`);
      const context = browser.contexts()[0];
      visiblePage = page; // 保存当前用户看到的页面

      try {
        // 使用 window.open() 在浏览器中打开真正的新标签页
        console.error(`[MCP] Attempting to open new tab with window.open()`);

        const newTabPromise = context.waitForEvent("page", { timeout: 5000 });

        const openResult = await page.evaluate((targetUrl) => {
          const newWindow = window.open(targetUrl, "_blank");
          return {
            opened: newWindow !== null,
            url: targetUrl,
          };
        }, url);

        console.error(
          `[MCP] window.open() result:`,
          JSON.stringify(openResult)
        );

        // 等待新标签页创建
        backgroundPage = await newTabPromise;
        console.error(`[MCP] New tab captured, URL: ${backgroundPage.url()}`);

        // 等待新标签页加载完成
        await backgroundPage.waitForLoadState("domcontentloaded", {
          timeout: 30000,
        });
        console.error(
          `[MCP] New tab loaded successfully: ${backgroundPage.url()}`
        );

        // 在新标签页显示 Toast 提示
        try {
          await backgroundPage.evaluate(() => {
            // 移除旧的Toast（如果存在）
            const oldToast = document.getElementById("mcp-login-toast");
            if (oldToast) {
              oldToast.remove();
            }

            const toast = document.createElement("div");
            toast.id = "mcp-login-toast";
            toast.textContent = "Logging in, please wait...";
            toast.style.cssText = `
              position: fixed;
              top: 20px;
              right: 20px;
              background-color: #4CAF50;
              color: white;
              padding: 16px 24px;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              font-weight: 500;
              z-index: 999999;
              animation: slideIn 0.3s ease-out;
            `;

            // 添加动画样式
            if (!document.getElementById("mcp-toast-styles")) {
              const style = document.createElement("style");
              style.id = "mcp-toast-styles";
              style.textContent = `
                @keyframes slideIn {
                  from {
                    transform: translateX(100%);
                    opacity: 0;
                  }
                  to {
                    transform: translateX(0);
                    opacity: 1;
                  }
                }
                @keyframes slideOut {
                  from {
                    transform: translateX(0);
                    opacity: 1;
                  }
                  to {
                    transform: translateX(100%);
                    opacity: 0;
                  }
                }
              `;
              document.head.appendChild(style);
            }
            document.body.appendChild(toast);
          });
          console.error(`[MCP] Toast displayed on new tab page`);
        } catch (toastError) {
          console.error(`[MCP] Failed to show toast:`, toastError.message);
        }

        // 使用后台标签页进行存储设置
        page = backgroundPage;
      } catch (error) {
        // 如果导航失败，关闭后台标签页并抛出错误
        await backgroundPage.close();
        throw new Error(`Failed to navigate to URL: ${url}, ${error.message}`);
      }
    }

    // 参数校验：filePath、cookies、cookieString 必须至少一个
    if (!filePath && !cookies && !cookieString) {
      throw new Error(
        "You must provide at least one of filePath, cookies, or cookieString."
      );
    }

    let storageData = {};
    if (filePath) {
      // 读取文件内容
      const fs = require("fs");
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      try {
        const content = fs.readFileSync(filePath, "utf8");
        storageData = JSON.parse(content);
      } catch (e) {
        throw new Error(
          `Failed to read or parse file: ${filePath}, ${e.message}`
        );
      }
    }

    // 优先用 filePath 里的数据，否则用参数
    const cookiesInput = storageData.cookies || cookies;
    const cookieStringInput = storageData.cookieString || cookieString;
    const localStorageInput = storageData.localStorage || localStorage;
    const sessionStorageInput = storageData.sessionStorage || sessionStorage;
    const domainInput = storageData.domain || domain;

    console.error(
      `[MCP] Setting authentication storage (cookies, localStorage, sessionStorage) for session ${currentSessionId}`
    );

    try {
      const context = browser.contexts()[0];
      let cookiesToSet = [];
      let results = {};

      // 处理Cookie设置
      if (cookieStringInput) {
        // 解析document.cookie格式的字符串
        console.error(
          `[MCP] Parsing cookie string: ${cookieStringInput.substring(0, 100)}...`
        );

        const parsedCookies = cookieStringInput
          .split(";")
          .map((cookiePair) => {
            const [name, value] = cookiePair.trim().split("=");
            if (name && value) {
              return {
                name: name.trim(),
                value: value.trim(),
                domain: domainInput || "localhost", // 默认域名
                path: "/",
              };
            }
            return null;
          })
          .filter(Boolean);

        cookiesToSet = parsedCookies;
        console.error(
          `[MCP] Parsed ${parsedCookies.length} cookies from string`
        );
      } else if (cookiesInput && Array.isArray(cookiesInput)) {
        // 使用提供的cookie数组
        cookiesToSet = cookiesInput.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || domainInput || "localhost",
          path: cookie.path || "/",
          httpOnly: cookie.httpOnly || false,
          secure: cookie.secure || false,
          sameSite: cookie.sameSite || "Lax",
        }));
        console.error(`[MCP] Using provided ${cookiesToSet.length} cookies`);
      }

      // 设置Cookie
      if (cookiesToSet.length > 0) {
        await context.addCookies(cookiesToSet);
        console.error(`[MCP] Successfully set ${cookiesToSet.length} cookies`);
        results.cookiesSet = cookiesToSet.length;
      }

      // 设置localStorage和sessionStorage
      if (
        (localStorageInput && Object.keys(localStorageInput).length > 0) ||
        (sessionStorageInput && Object.keys(sessionStorageInput).length > 0)
      ) {
        if (!page) {
          throw new Error("No active page available for setting storage");
        }

        const storageResults = await page.evaluate(
          (storageData) => {
            const { localData, sessionData } = storageData;
            const results = { localStorage: 0, sessionStorage: 0 };

            // 设置localStorage
            if (localData) {
              for (const [key, value] of Object.entries(localData)) {
                try {
                  window.localStorage.setItem(key, value);
                  results.localStorage++;
                } catch (e) {
                  console.error(`Failed to set localStorage ${key}:`, e);
                }
              }
            }

            // 设置sessionStorage
            if (sessionData) {
              for (const [key, value] of Object.entries(sessionData)) {
                try {
                  window.sessionStorage.setItem(key, value);
                  results.sessionStorage++;
                } catch (e) {
                  console.error(`Failed to set sessionStorage ${key}:`, e);
                }
              }
            }

            return results;
          },
          {
            localData: localStorageInput,
            sessionData: sessionStorageInput,
          }
        );

        results.localStorageSet = storageResults.localStorage;
        results.sessionStorageSet = storageResults.sessionStorage;
        console.error(
          `[MCP] Set ${storageResults.localStorage} localStorage items, ${storageResults.sessionStorage} sessionStorage items`
        );
      }

      // 验证设置结果
      if (cookiesToSet.length > 0) {
        const currentCookies = await context.cookies();
        console.error(
          `[MCP] Total cookies after setting: ${currentCookies.length}`
        );
      }

      // 如果创建了新标签页，关闭它（Toast会随着标签页关闭自动消失）
      if (backgroundPage) {
        console.error(`[MCP] Closing new tab`);
        await backgroundPage.close();
        console.error(`[MCP] New tab closed`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: `Successfully set storage data for session ${currentSessionId}`,
                sessionId: currentSessionId,
                backgroundTabUsed: !!url,
                url: url || undefined,
                results: {
                  cookiesSet: results.cookiesSet || 0,
                  localStorageSet: results.localStorageSet || 0,
                  sessionStorageSet: results.sessionStorageSet || 0,
                },
                cookieDetails: cookiesToSet.map((c) => ({
                  name: c.name,
                  domain: c.domain,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      // 确保在错误情况下也关闭新标签页（Toast会随着标签页关闭自动消失）
      if (backgroundPage) {
        try {
          await backgroundPage.close();
          console.error(`[MCP] New tab closed due to error`);
        } catch (closeError) {
          console.error(`[MCP] Failed to close new tab:`, closeError);
        }
      }
      console.error(`[MCP] Failed to set storage data:`, error);
      throw new Error(`Failed to set storage data: ${error.message}`);
    }
  },

  list_sessions: async function () {
    console.error("[MCP] Listing all active sessions");

    // 使用统一的session目录路径
    const sessionRegistryFile = getSessionRegistryFile();

    try {
      if (!require("fs").existsSync(sessionRegistryFile)) {
        return {
          content: [
            {
              type: "text",
              text: "No active sessions found",
            },
          ],
        };
      }

      const sessions = JSON.parse(
        require("fs").readFileSync(sessionRegistryFile, "utf8")
      );
      const activeSessions = [];

      // 检查每个session是否还活跃
      for (const [sessionId, sessionInfo] of Object.entries(sessions)) {
        let isActive = false;

        // 多重检查确保session真正活跃
        try {
          // 1. 检查MCP进程是否还在运行
          process.kill(sessionInfo.pid, 0);

          // 2. 检查Chrome进程是否还在运行
          if (sessionInfo.chromeProcessPid) {
            process.kill(sessionInfo.chromeProcessPid, 0);
          }

          // 3. 尝试连接到调试端口验证Chrome是否响应
          const { chromium } = require("playwright");
          try {
            const browser = await chromium.connectOverCDP(
              `http://127.0.0.1:${sessionInfo.debugPort}`
            );
            await browser.close();
            isActive = true;
          } catch (e) {
            console.error(
              `[MCP] Session ${sessionId} debug port ${sessionInfo.debugPort} not responsive:`,
              e.message
            );
            isActive = false;
          }
        } catch (e) {
          // 进程不存在或端口不响应
          console.error(`[MCP] Session ${sessionId} is inactive:`, e.message);
          isActive = false;
        }

        if (isActive) {
          activeSessions.push({
            sessionId,
            pid: sessionInfo.pid,
            debugPort: sessionInfo.debugPort,
            sessionDir: sessionInfo.sessionDir,
            createdAt: sessionInfo.createdAt,
            chromeProcessPid: sessionInfo.chromeProcessPid,
            isCurrentSession: sessionId === (this.sessionId || null),
          });
        } else {
          // 清理无效session的目录
          try {
            if (
              sessionInfo.sessionDir &&
              require("fs").existsSync(sessionInfo.sessionDir)
            ) {
              require("fs").rmSync(sessionInfo.sessionDir, {
                recursive: true,
                force: true,
              });
              console.error(
                `[MCP] Cleaned up directory for inactive session ${sessionId}: ${sessionInfo.sessionDir}`
              );
            }
          } catch (cleanupError) {
            console.error(
              `[MCP] Failed to cleanup directory for session ${sessionId}:`,
              cleanupError.message
            );
          }
        }
      }

      // 清理已失效的session记录
      const cleanedSessions = {};
      activeSessions.forEach((session) => {
        cleanedSessions[session.sessionId] = sessions[session.sessionId];
      });

      if (
        Object.keys(cleanedSessions).length !== Object.keys(sessions).length
      ) {
        require("fs").writeFileSync(
          sessionRegistryFile,
          JSON.stringify(cleanedSessions, null, 2)
        );
        console.error(
          `[MCP] Cleaned up ${
            Object.keys(sessions).length - Object.keys(cleanedSessions).length
          } inactive sessions`
        );
      }

      return {
        content: [
          {
            type: "text",
            text:
              activeSessions.length > 0
                ? JSON.stringify(activeSessions, null, 2)
                : "No active sessions found",
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] Error listing sessions:", error);
      throw new Error(`Failed to list sessions: ${error.message}`);
    }
  },

  close_browser: async function (args = {}) {
    const { sessionId } = args;
    const callTimestamp = new Date().toISOString();
    const callStack = new Error().stack;

    console.error(`[CLOSE-MANUAL] close_browser called at ${callTimestamp}`);
    console.error(`[CLOSE-MANUAL] Arguments: ${JSON.stringify(args)}`);
    console.error(
      `[CLOSE-MANUAL] Call stack preview: ${callStack.split("\n")[2]?.trim()}`
    );

    // 如果指定了sessionId且不是default，关闭指定的session
    if (sessionId && sessionId !== "default") {
      console.error(
        `[CLOSE-MANUAL] Closing specific browser session: ${sessionId}`
      );

      try {
        const sessionRegistryFile = getSessionRegistryFile();

        if (!require("fs").existsSync(sessionRegistryFile)) {
          throw new Error(`No sessions registry found`);
        }

        const sessions = JSON.parse(
          require("fs").readFileSync(sessionRegistryFile, "utf8")
        );
        const sessionInfo = sessions[sessionId];

        if (!sessionInfo) {
          throw new Error(`Session ${sessionId} not found`);
        }

        // 尝试连接到session并关闭
        let browserClosed = false;
        const connectStartTime = new Date().toISOString();
        console.error(
          `[CLOSE-MANUAL] Attempting CDP connection to session ${sessionId} on port ${sessionInfo.debugPort}`
        );

        try {
          const { chromium } = require("playwright");
          const browser = await chromium.connectOverCDP(
            `http://127.0.0.1:${sessionInfo.debugPort}`
          );

          const connectSuccessTime = new Date().toISOString();
          console.error(
            `[CLOSE-MANUAL] CDP connection successful at ${connectSuccessTime}`
          );

          // Log browser state before closing
          try {
            const contexts = browser.contexts();
            console.error(
              `[CLOSE-MANUAL] Browser has ${contexts.length} context(s) before close`
            );
            const browserVersion = await browser.version();
            console.error(`[CLOSE-MANUAL] Browser version: ${browserVersion}`);
          } catch (stateError) {
            console.error(
              `[CLOSE-MANUAL] Could not get browser state: ${stateError.message}`
            );
          }

          const closeStartTime = new Date().toISOString();
          await browser.close();
          const closeEndTime = new Date().toISOString();

          browserClosed = true;
          console.error(
            `[CLOSE-MANUAL] Browser for session ${sessionId} closed gracefully`
          );
          console.error(
            `[CLOSE-MANUAL] Close operation: ${closeStartTime} to ${closeEndTime}`
          );

          // 等待浏览器完全释放文件锁定
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (e) {
          console.error(
            `[CLOSE-MANUAL] Could not gracefully close browser for session ${sessionId}:`,
            e.message
          );
          console.error(
            `[CLOSE-MANUAL] Connection attempt started at: ${connectStartTime}`
          );
        }

        // 强制终止Chrome进程并等待退出
        if (sessionInfo.chromeProcessPid) {
          console.error(
            `[CLOSE-MANUAL] Attempting to kill Chrome process PID: ${sessionInfo.chromeProcessPid}`
          );
          try {
            // 先尝试优雅终止
            const sigTermTime = new Date().toISOString();
            process.kill(sessionInfo.chromeProcessPid, "SIGTERM");
            console.error(
              `[CLOSE-MANUAL] Sent SIGTERM to Chrome process ${sessionInfo.chromeProcessPid} at ${sigTermTime}`
            );

            // 等待进程退出
            await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                try {
                  process.kill(sessionInfo.chromeProcessPid, "SIGKILL");
                  console.error(
                    `[MCP] Force killed Chrome process ${sessionInfo.chromeProcessPid}`
                  );
                } catch (e) {
                  // Process already dead
                }
                resolve();
              }, 3000);

              // 定期检查进程是否还存在
              const checkInterval = setInterval(() => {
                try {
                  process.kill(sessionInfo.chromeProcessPid, 0);
                } catch (e) {
                  // Process is dead
                  clearTimeout(timeout);
                  clearInterval(checkInterval);
                  console.error(
                    `[MCP] Chrome process ${sessionInfo.chromeProcessPid} exited`
                  );
                  resolve();
                }
              }, 200);
            });
          } catch (e) {
            console.error(`[MCP] Could not kill Chrome process:`, e.message);
          }
        }

        // 从注册表移除session
        delete sessions[sessionId];
        require("fs").writeFileSync(
          sessionRegistryFile,
          JSON.stringify(sessions, null, 2)
        );
        console.error(`[MCP] Session unregistered from registry: ${sessionId}`);

        // 确保清理session目录（使用重试机制）
        if (sessionInfo.sessionDir) {
          let retryCount = 0;
          const maxRetries = 3;
          let deleted = false;

          while (retryCount < maxRetries && !deleted) {
            try {
              if (require("fs").existsSync(sessionInfo.sessionDir)) {
                require("fs").rmSync(sessionInfo.sessionDir, {
                  recursive: true,
                  force: true,
                });
                console.error(
                  `[MCP] Session directory successfully deleted: ${sessionInfo.sessionDir}`
                );
                deleted = true;
              } else {
                console.error(
                  `[MCP] Session directory already removed: ${sessionInfo.sessionDir}`
                );
                deleted = true;
              }
            } catch (cleanupError) {
              retryCount++;
              console.error(
                `[MCP] Failed to delete session directory (attempt ${retryCount}/${maxRetries}): ${cleanupError.message}`
              );

              if (retryCount < maxRetries) {
                // 等待更长时间再重试
                await new Promise((resolve) =>
                  setTimeout(resolve, 1000 * retryCount)
                );
              }
            }
          }

          if (!deleted) {
            console.error(
              `[MCP] Warning: Could not delete session directory after ${maxRetries} attempts: ${sessionInfo.sessionDir}`
            );
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Session ${sessionId} closed and directory cleaned successfully`,
            },
          ],
        };
      } catch (error) {
        throw new Error(
          `Failed to close session ${sessionId}: ${error.message}`
        );
      }
    }

    // 关闭当前session
    const currentSessionCloseTime = new Date().toISOString();
    console.error(
      `[CLOSE-MANUAL] Closing current session browser at ${currentSessionCloseTime} (Session: ${this.sessionId || "unknown"})`
    );

    let browserClosed = false;
    let processClosed = false;

    // 优雅关闭浏览器
    if (this.browser) {
      try {
        // Log current browser state
        try {
          const contexts = this.browser.contexts();
          console.error(
            `[CLOSE-MANUAL] Current session browser has ${contexts.length} context(s)`
          );
          const browserVersion = await this.browser.version();
          console.error(
            `[CLOSE-MANUAL] Current session browser version: ${browserVersion}`
          );
        } catch (stateError) {
          console.error(
            `[CLOSE-MANUAL] Could not get current session browser state: ${stateError.message}`
          );
        }

        const browserCloseStart = new Date().toISOString();
        await this.browser.close();
        const browserCloseEnd = new Date().toISOString();

        browserClosed = true;
        console.error(
          `[CLOSE-MANUAL] Current session browser closed gracefully`
        );
        console.error(
          `[CLOSE-MANUAL] Browser close duration: ${browserCloseStart} to ${browserCloseEnd}`
        );
        this.browser = null;
        this.page = null;
        // 等待浏览器完全释放文件锁定
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e) {
        console.error(
          `[CLOSE-MANUAL] Error closing current session browser gracefully: ${e.message}`
        );
        console.error(
          `[CLOSE-MANUAL] Close attempt timestamp: ${currentSessionCloseTime}`
        );
      }
    } else {
      console.error(
        `[CLOSE-MANUAL] No current session browser to close at ${currentSessionCloseTime}`
      );
    }

    // 优雅终止Chrome进程
    if (this.chromeProcess && !this.chromeProcess.killed) {
      try {
        const processPid = this.chromeProcess.pid;
        console.error(
          `[CLOSE-MANUAL] Attempting to terminate current session Chrome process PID: ${processPid}`
        );

        // 先尝试SIGTERM优雅终止
        const sigTermTime = new Date().toISOString();
        this.chromeProcess.kill("SIGTERM");
        console.error(
          `[CLOSE-MANUAL] Sent SIGTERM to current session Chrome process ${processPid} at ${sigTermTime}`
        );

        // 等待进程优雅退出
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try {
              process.kill(processPid, "SIGKILL");
              console.error("[MCP] Force killed Chrome process");
            } catch (e) {
              // Process already dead
            }
            processClosed = true;
            resolve();
          }, 3000);

          // 定期检查进程是否还存在
          const checkInterval = setInterval(() => {
            try {
              process.kill(processPid, 0);
            } catch (e) {
              // Process is dead
              clearTimeout(timeout);
              clearInterval(checkInterval);
              processClosed = true;
              console.error("[MCP] Chrome process exited gracefully");
              resolve();
            }
          }, 200);
        });

        this.chromeProcess = null;
      } catch (e) {
        console.error("[MCP] Error terminating Chrome process:", e);
        processClosed = true; // 假设已经终止
      }
    }

    // 从注册表注销session并清理目录
    if (this.sessionId && this.sessionRegistryFile) {
      try {
        // 从注册表移除session
        if (require("fs").existsSync(this.sessionRegistryFile)) {
          const sessions = JSON.parse(
            require("fs").readFileSync(this.sessionRegistryFile, "utf8")
          );
          const sessionInfo = sessions[this.sessionId];
          delete sessions[this.sessionId];
          require("fs").writeFileSync(
            this.sessionRegistryFile,
            JSON.stringify(sessions, null, 2)
          );
          console.error(
            `[MCP] Session unregistered from registry: ${this.sessionId}`
          );

          // 确保清理session目录（使用重试机制）
          if (sessionInfo && sessionInfo.sessionDir) {
            let retryCount = 0;
            const maxRetries = 3;
            let deleted = false;

            while (retryCount < maxRetries && !deleted) {
              try {
                if (require("fs").existsSync(sessionInfo.sessionDir)) {
                  require("fs").rmSync(sessionInfo.sessionDir, {
                    recursive: true,
                    force: true,
                  });
                  console.error(
                    `[MCP] Session directory successfully deleted: ${sessionInfo.sessionDir}`
                  );
                  deleted = true;
                } else {
                  console.error(
                    `[MCP] Session directory already removed: ${sessionInfo.sessionDir}`
                  );
                  deleted = true;
                }
              } catch (cleanupError) {
                retryCount++;
                console.error(
                  `[MCP] Failed to delete session directory (attempt ${retryCount}/${maxRetries}): ${cleanupError.message}`
                );

                if (retryCount < maxRetries) {
                  // 等待更长时间再重试
                  await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * retryCount)
                  );
                }
              }
            }

            if (!deleted) {
              console.error(
                `[MCP] Warning: Could not delete session directory after ${maxRetries} attempts: ${sessionInfo.sessionDir}`
              );
            }
          }
        }
      } catch (error) {
        console.error(`[MCP] Failed to cleanup session:`, error.message);
      }
    }

    const status =
      browserClosed && processClosed
        ? "Browser and process closed gracefully, session directory cleaned"
        : browserClosed
          ? "Browser closed gracefully, process terminated, session directory cleaned"
          : "Browser force closed, session directory cleaned";

    return {
      content: [
        {
          type: "text",
          text: status,
        },
      ],
    };
  },

  close_all_browsers: async function (args = {}) {
    const { force = false } = args;
    const batchCloseTimestamp = new Date().toISOString();
    const callStack = new Error().stack;

    console.error(
      `[CLOSE-BATCH] ${force ? "FORCE" : "Gracefully"} closing all browser sessions at ${batchCloseTimestamp}`
    );
    console.error(`[CLOSE-BATCH] Arguments: ${JSON.stringify(args)}`);
    console.error(
      `[CLOSE-BATCH] Call stack preview: ${callStack.split("\n")[2]?.trim()}`
    );

    const sessionRegistryFile = getSessionRegistryFile();

    if (!require("fs").existsSync(sessionRegistryFile)) {
      console.error(
        `[CLOSE-BATCH] No sessions registry found at ${sessionRegistryFile}`
      );
      return {
        content: [
          {
            type: "text",
            text: "No active sessions found",
          },
        ],
      };
    }

    const sessions = JSON.parse(
      require("fs").readFileSync(sessionRegistryFile, "utf8")
    );
    const sessionIds = Object.keys(sessions);

    if (sessionIds.length === 0) {
      console.error(`[CLOSE-BATCH] Registry exists but contains no sessions`);
      return {
        content: [
          {
            type: "text",
            text: "No active sessions found",
          },
        ],
      };
    }

    console.error(`[CLOSE-BATCH] Found ${sessionIds.length} sessions to close`);
    sessionIds.forEach((sessionId, index) => {
      const sessionInfo = sessions[sessionId];
      console.error(
        `[CLOSE-BATCH] Session ${index + 1}: ${sessionId} (PID: ${sessionInfo.chromeProcessPid || "unknown"}, Port: ${sessionInfo.debugPort || "unknown"})`
      );
    });

    let closedCount = 0;
    let errorCount = 0;

    for (const sessionId of sessionIds) {
      try {
        const sessionInfo = sessions[sessionId];

        if (force) {
          // Force模式：直接kill进程
          console.error(
            `[CLOSE-BATCH] Processing session ${sessionId} in FORCE mode`
          );
          try {
            if (sessionInfo.chromeProcessPid) {
              const forceKillTime = new Date().toISOString();
              process.kill(sessionInfo.chromeProcessPid, "SIGKILL");
              console.error(
                `[CLOSE-BATCH] Force killed Chrome process ${sessionInfo.chromeProcessPid} for session ${sessionId} at ${forceKillTime}`
              );
            } else {
              console.error(
                `[CLOSE-BATCH] Session ${sessionId} has no Chrome process PID to kill`
              );
            }
          } catch (e) {
            console.error(
              `[CLOSE-BATCH] Chrome process ${sessionInfo.chromeProcessPid} already dead for session ${sessionId}: ${e.message}`
            );
          }
        } else {
          // 优雅模式：先尝试优雅关闭，失败后force kill
          console.error(
            `[CLOSE-BATCH] Processing session ${sessionId} in GRACEFUL mode`
          );
          const gracefulStartTime = new Date().toISOString();

          try {
            console.error(
              `[CLOSE-BATCH] Attempting CDP connection to session ${sessionId} on port ${sessionInfo.debugPort}`
            );
            const { chromium } = require("playwright");
            const browser = await chromium.connectOverCDP(
              `http://127.0.0.1:${sessionInfo.debugPort}`
            );

            const gracefulCloseTime = new Date().toISOString();
            await browser.close();
            console.error(
              `[CLOSE-BATCH] Browser for session ${sessionId} closed gracefully at ${gracefulCloseTime}`
            );
          } catch (e) {
            console.error(
              `[CLOSE-BATCH] Could not gracefully close session ${sessionId}, force killing... Error: ${e.message}`
            );
            console.error(
              `[CLOSE-BATCH] Graceful attempt started at: ${gracefulStartTime}`
            );

            try {
              if (sessionInfo.chromeProcessPid) {
                const forceKillTime = new Date().toISOString();
                process.kill(sessionInfo.chromeProcessPid, "SIGKILL");
                console.error(
                  `[CLOSE-BATCH] Force killed Chrome process ${sessionInfo.chromeProcessPid} at ${forceKillTime}`
                );
              } else {
                console.error(
                  `[CLOSE-BATCH] Session ${sessionId} has no Chrome process PID for force kill`
                );
              }
            } catch (killError) {
              console.error(
                `[CLOSE-BATCH] Process already dead: ${sessionInfo.chromeProcessPid} - ${killError.message}`
              );
            }
          }
        }

        // 清理session目录
        if (
          sessionInfo.sessionDir &&
          require("fs").existsSync(sessionInfo.sessionDir)
        ) {
          require("fs").rmSync(sessionInfo.sessionDir, {
            recursive: true,
            force: true,
          });
          console.error(`[MCP] Cleaned directory: ${sessionInfo.sessionDir}`);
        }

        closedCount++;
      } catch (error) {
        console.error(
          `[CLOSE-BATCH] Failed to close session ${sessionId}: ${error.message}`
        );
        errorCount++;
      }
    }

    const batchCompleteTime = new Date().toISOString();
    console.error(
      `[CLOSE-BATCH] Batch operation completed at ${batchCompleteTime}`
    );
    console.error(
      `[CLOSE-BATCH] Results: ${closedCount} closed, ${errorCount} errors out of ${sessionIds.length} total sessions`
    );

    // 清空注册表
    require("fs").writeFileSync(sessionRegistryFile, "{}");
    console.error(
      `[CLOSE-BATCH] Sessions registry cleared at ${new Date().toISOString()}`
    );

    const message = `Closed ${closedCount} active sessions${
      errorCount > 0 ? `, ${errorCount} failed` : ""
    }`;

    return {
      content: [
        {
          type: "text",
          text: message,
        },
      ],
    };
  },

  cleanup_sessions: async function () {
    console.error(
      "[MCP] Cleaning up inactive sessions and orphaned directories (preserving active sessions)"
    );

    const sessionRegistryFile = getSessionRegistryFile();
    const baseDir = getSessionBaseDir();

    let cleanedCount = 0;
    let orphanedDirs = [];
    let removedSessions = 0;

    // 1. 清理注册表中的无效session，保留活跃的
    if (require("fs").existsSync(sessionRegistryFile)) {
      try {
        const sessions = JSON.parse(
          require("fs").readFileSync(sessionRegistryFile, "utf8")
        );
        const activeSessions = {};

        console.error(
          `[MCP] Checking ${Object.keys(sessions).length} registered sessions`
        );

        for (const [sessionId, sessionInfo] of Object.entries(sessions)) {
          let isActive = false;

          try {
            // 多重检查确保session真正活跃
            process.kill(sessionInfo.pid, 0);
            if (sessionInfo.chromeProcessPid) {
              process.kill(sessionInfo.chromeProcessPid, 0);
            }

            // 尝试连接验证Chrome响应
            const { chromium } = require("playwright");
            const browser = await chromium.connectOverCDP(
              `http://127.0.0.1:${sessionInfo.debugPort}`
            );
            await browser.close();
            isActive = true;
            console.error(`[MCP] Session ${sessionId} is active, preserving`);
          } catch (e) {
            // Session无效，清理目录
            console.error(
              `[MCP] Session ${sessionId} is inactive: ${e.message}`
            );
            try {
              if (
                sessionInfo.sessionDir &&
                require("fs").existsSync(sessionInfo.sessionDir)
              ) {
                require("fs").rmSync(sessionInfo.sessionDir, {
                  recursive: true,
                  force: true,
                });
                console.error(
                  `[MCP] Cleaned directory for inactive session ${sessionId}: ${sessionInfo.sessionDir}`
                );
                cleanedCount++;
              }
              removedSessions++;
            } catch (cleanupError) {
              console.error(
                `[MCP] Failed to cleanup directory for session ${sessionId}:`,
                cleanupError.message
              );
            }
          }

          if (isActive) {
            activeSessions[sessionId] = sessionInfo;
          }
        }

        // 只有当有变化时才更新注册表
        if (
          Object.keys(activeSessions).length !== Object.keys(sessions).length
        ) {
          require("fs").writeFileSync(
            sessionRegistryFile,
            JSON.stringify(activeSessions, null, 2)
          );
          console.error(
            `[MCP] Updated sessions registry: kept ${
              Object.keys(activeSessions).length
            } active, removed ${removedSessions} inactive`
          );
        } else {
          console.error(
            `[MCP] All ${
              Object.keys(sessions).length
            } sessions are active, no cleanup needed`
          );
        }
      } catch (error) {
        console.error("[MCP] Error cleaning sessions registry:", error.message);
      }
    }

    // 2. 清理孤立的session目录（没有在注册表中的目录）
    if (require("fs").existsSync(baseDir)) {
      try {
        const allDirs = require("fs")
          .readdirSync(baseDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        const registeredDirs = new Set();
        if (require("fs").existsSync(sessionRegistryFile)) {
          const sessions = JSON.parse(
            require("fs").readFileSync(sessionRegistryFile, "utf8")
          );
          Object.values(sessions).forEach((sessionInfo) => {
            if (sessionInfo.sessionDir) {
              const dirName = path.basename(sessionInfo.sessionDir);
              registeredDirs.add(dirName);
            }
          });
        }

        // 找到孤立的目录
        for (const dirName of allDirs) {
          if (
            dirName !== "sessions-registry.json" &&
            !registeredDirs.has(dirName)
          ) {
            const orphanedPath = path.join(baseDir, dirName);
            try {
              require("fs").rmSync(orphanedPath, {
                recursive: true,
                force: true,
              });
              orphanedDirs.push(dirName);
              console.error(
                `[MCP] Cleaned orphaned directory: ${orphanedPath}`
              );
              cleanedCount++;
            } catch (cleanupError) {
              console.error(
                `[MCP] Failed to cleanup orphaned directory ${orphanedPath}:`,
                cleanupError.message
              );
            }
          }
        }
      } catch (error) {
        console.error(
          "[MCP] Error scanning for orphaned directories:",
          error.message
        );
      }
    }

    const results = [];
    if (removedSessions > 0)
      results.push(`${removedSessions} inactive sessions removed`);
    if (orphanedDirs.length > 0)
      results.push(`${orphanedDirs.length} orphaned directories cleaned`);
    if (cleanedCount > 0)
      results.push(`${cleanedCount} total directories cleaned`);

    const message =
      results.length > 0
        ? `Cleanup completed: ${results.join(", ")}`
        : "No inactive sessions or orphaned directories found";

    return {
      content: [
        {
          type: "text",
          text: message,
        },
      ],
    };
  },
};

// Filter handlers based on lite mode (only include handlers for lite tools)
const liteTools = [
  "launch_browser",
  "close_browser",
  "close_all_browsers",
  "cleanup_sessions",
  "navigate_to",
  "run_script",
  "run_script_background",
  "get_login",
  "get_storage",
  "set_storage",
];

const filteredHandlers =
  process.env.MCP_LITE_MODE === "true"
    ? Object.fromEntries(
        Object.entries(toolHandlers).filter(([name]) =>
          liteTools.includes(name)
        )
      )
    : toolHandlers;

module.exports = {
  toolHandlers: filteredHandlers,
  allToolHandlers: toolHandlers, // Export all for debugging if needed
  TabManager, // Export TabManager class
};
