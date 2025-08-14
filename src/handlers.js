const { chromium } = require("playwright");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

const execAsync = promisify(exec);

// 辅助函数：根据sessionId获取浏览器连接
async function getBrowserBySessionId(sessionId) {
  const sessionRegistryFile = `/tmp/chrome-browser-automation-sessions/sessions-registry.json`;

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

  // 连接到该session的调试端口
  const { chromium } = require("playwright");
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${sessionInfo.debugPort}`
  );
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  return { browser, page, sessionInfo };
}

const toolHandlers = {
  launch_browser: async function (args) {
    const { headless = false, debugPort } = args;

    // 生成sessionId和目录
    const timestamp = Date.now();
    const randomCode = Math.random().toString(36).substring(2, 8);
    const sessionId = `${timestamp}-${randomCode}`;
    const tempUserDataDir = `/tmp/chrome-browser-automation-sessions/${sessionId}`;

    // 设置注册表文件路径
    const sessionRegistryFile = `/tmp/chrome-browser-automation-sessions/sessions-registry.json`;

    // 生成端口号（基于timestamp避免冲突）
    const basePort = 9222;
    const portOffset = timestamp % 1000; // 使用timestamp的最后3位作为偏移
    const actualDebugPort = debugPort || basePort + portOffset;

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

    console.error(`[MCP] Using temp user data dir: ${tempUserDataDir}`);
    console.error(`[MCP] Using debug port: ${actualDebugPort}`);

    console.error(`[MCP] Launching browser with args:`, {
      headless,
      debugPort: actualDebugPort,
      userDataDir: tempUserDataDir,
    });

    // 强制清理可能冲突的端口进程
    const platform = os.platform();

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
            pids.forEach((pid) => {
              try {
                // 先尝试SIGTERM
                process.kill(parseInt(pid.trim()), "SIGTERM");
                console.error(
                  `[MCP] Sent SIGTERM to process ${pid} on port ${actualDebugPort}`
                );

                // 如果SIGTERM不够，等待一秒后强制SIGKILL
                setTimeout(() => {
                  try {
                    process.kill(parseInt(pid.trim()), "SIGKILL");
                    console.error(
                      `[MCP] Force killed process ${pid} on port ${actualDebugPort}`
                    );
                  } catch (e) {
                    // Process already dead, ignore
                  }
                }, 1000);
              } catch (e) {
                console.error(
                  `[MCP] Failed to terminate process ${pid}:`,
                  e.message
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
    const chromePath =
      platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "google-chrome";

    const chromeArgs = [
      `--remote-debugging-port=${actualDebugPort}`,
      `--user-data-dir=${tempUserDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-features=TranslateUI`,
      `--disable-ipc-flooding-protection`,
    ];

    if (headless) {
      chromeArgs.push("--headless=new");
    }

    console.error(`[MCP] Starting Chrome:`, chromePath, chromeArgs);

    this.chromeProcess = spawn(chromePath, chromeArgs, {
      detached: false,
      stdio: "ignore",
    });

    this.debugPort = actualDebugPort;

    // Wait for Chrome to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Connect with Playwright (with retry logic)
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.error(
          `[MCP] Connection attempt ${attempt}/3 to port ${actualDebugPort}`
        );

        this.browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${actualDebugPort}`
        );
        const context = this.browser.contexts()[0];
        const pages = context.pages();
        this.page = pages.length > 0 ? pages[0] : await context.newPage();

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
            this.chromeProcess.kill("SIGTERM");
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          // 用新端口重新启动Chrome
          actualDebugPort = newPort;
          this.debugPort = actualDebugPort;

          const chromeArgs = [
            `--remote-debugging-port=${actualDebugPort}`,
            `--user-data-dir=${tempUserDataDir}`,
            "--no-first-run",
            "--no-default-browser-check",
            `--disable-features=TranslateUI`,
            `--disable-ipc-flooding-protection`,
          ];

          if (headless) {
            chromeArgs.push("--headless=new");
          }

          const platform = os.platform();
          const chromePath =
            platform === "darwin"
              ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
              : platform === "win32"
              ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
              : "google-chrome";

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
        const { browser, page, sessionInfo } = await getBrowserBySessionId(
          sessionId
        );
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

      try {
        this.browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${debugPort}`
        );
        const context = this.browser.contexts()[0];
        const pages = context.pages();
        this.page = pages.length > 0 ? pages[0] : await context.newPage();
        this.debugPort = debugPort;

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
        console.error("[MCP] Connection failed:", error);
        throw new Error(
          `Failed to connect to browser on port ${debugPort}: ${error.message}`
        );
      }
    }
  },

  navigate_to: async function (args) {
    const { url, sessionId, waitUntil = "networkidle" } = args;

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
      "[MCP] Navigating to:",
      url,
      sessionId ? `(Session: ${sessionId})` : ""
    );
    await page.goto(url, { waitUntil });

    return {
      content: [
        {
          type: "text",
          text: `Navigated to ${url}${
            sessionId ? ` (Session: ${sessionId})` : ""
          }`,
        },
      ],
    };
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
    const { scriptPath, args: scriptArgs = {} } = args;

    if (!this.browser || !this.page) {
      throw new Error(
        "Browser not connected. Use launch_browser or connect_browser first."
      );
    }

    console.error("[MCP] Running script:", scriptPath);

    // Read the script file
    const scriptContent = await fs.readFile(scriptPath, "utf-8");

    // Create an async function and execute it
    try {
      const AsyncFunction = Object.getPrototypeOf(
        async function () {}
      ).constructor;
      const fn = new AsyncFunction("browser", "page", "args", scriptContent);
      const result = await fn(this.browser, this.page, scriptArgs);

      console.error("[MCP] Script executed successfully");

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
      throw new Error(`Script execution failed: ${error.message}`);
    }
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

  set_storage: async function (args = {}) {
    const { cookies, cookieString, localStorage, sessionStorage, domain } =
      args;

    if (!this.browser) {
      throw new Error(
        "No browser available. Launch or connect to browser first."
      );
    }

    console.error(
      `[MCP] Setting authentication storage (cookies, localStorage, sessionStorage) for session ${this.sessionId}`
    );

    try {
      const context = this.browser.contexts()[0];
      let cookiesToSet = [];
      let results = {};

      // 处理Cookie设置
      if (cookieString) {
        // 解析document.cookie格式的字符串
        console.error(
          `[MCP] Parsing cookie string: ${cookieString.substring(0, 100)}...`
        );

        const parsedCookies = cookieString
          .split(";")
          .map((cookiePair) => {
            const [name, value] = cookiePair.trim().split("=");
            if (name && value) {
              return {
                name: name.trim(),
                value: value.trim(),
                domain: domain || "localhost", // 默认域名
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
      } else if (cookies && Array.isArray(cookies)) {
        // 使用提供的cookie数组
        cookiesToSet = cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || domain || "localhost",
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
        (localStorage && Object.keys(localStorage).length > 0) ||
        (sessionStorage && Object.keys(sessionStorage).length > 0)
      ) {
        if (!this.page) {
          throw new Error("No active page available for setting storage");
        }

        const storageResults = await this.page.evaluate(
          (localData, sessionData) => {
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
          localStorage,
          sessionStorage
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: `Successfully set storage data for session ${this.sessionId}`,
                sessionId: this.sessionId,
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
      console.error(`[MCP] Failed to set storage data:`, error);
      throw new Error(`Failed to set storage data: ${error.message}`);
    }
  },

  list_sessions: async function () {
    console.error("[MCP] Listing all active sessions");

    // 使用统一的session目录路径
    const sessionRegistryFile = `/tmp/chrome-browser-automation-sessions/sessions-registry.json`;

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

    // 如果指定了sessionId且不是default，关闭指定的session
    if (sessionId && sessionId !== "default") {
      console.error(`[MCP] Closing browser session: ${sessionId}`);

      try {
        const sessionRegistryFile = `/tmp/chrome-browser-automation-sessions/sessions-registry.json`;

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
        try {
          const { chromium } = require("playwright");
          const browser = await chromium.connectOverCDP(
            `http://127.0.0.1:${sessionInfo.debugPort}`
          );
          await browser.close();
          browserClosed = true;
          console.error(
            `[MCP] Browser for session ${sessionId} closed gracefully`
          );
          // 等待浏览器完全释放文件锁定
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (e) {
          console.error(
            `[MCP] Could not gracefully close browser for session ${sessionId}:`,
            e.message
          );
        }

        // 强制终止Chrome进程并等待退出
        if (sessionInfo.chromeProcessPid) {
          try {
            // 先尝试优雅终止
            process.kill(sessionInfo.chromeProcessPid, "SIGTERM");
            console.error(
              `[MCP] Sent SIGTERM to Chrome process ${sessionInfo.chromeProcessPid}`
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
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
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
    console.error(
      `[MCP] Closing browser (Session: ${this.sessionId || "unknown"})`
    );

    let browserClosed = false;
    let processClosed = false;

    // 优雅关闭浏览器
    if (this.browser) {
      try {
        await this.browser.close();
        browserClosed = true;
        console.error("[MCP] Browser closed gracefully");
        this.browser = null;
        this.page = null;
        // 等待浏览器完全释放文件锁定
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.error("[MCP] Error closing browser gracefully:", e);
      }
    }

    // 优雅终止Chrome进程
    if (this.chromeProcess && !this.chromeProcess.killed) {
      try {
        const processPid = this.chromeProcess.pid;
        // 先尝试SIGTERM优雅终止
        this.chromeProcess.kill("SIGTERM");
        console.error("[MCP] Sent SIGTERM to Chrome process");

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
          console.error(`[MCP] Session unregistered from registry: ${this.sessionId}`);

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
                  await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
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

    console.error(
      `[MCP] ${force ? "FORCE" : "Gracefully"} closing all browser sessions`
    );

    const sessionRegistryFile = `/tmp/chrome-browser-automation-sessions/sessions-registry.json`;

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
    const sessionIds = Object.keys(sessions);

    if (sessionIds.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No active sessions found",
          },
        ],
      };
    }

    console.error(`[MCP] Found ${sessionIds.length} sessions to close`);

    let closedCount = 0;
    let errorCount = 0;

    for (const sessionId of sessionIds) {
      try {
        const sessionInfo = sessions[sessionId];

        if (force) {
          // Force模式：直接kill进程
          try {
            if (sessionInfo.chromeProcessPid) {
              process.kill(sessionInfo.chromeProcessPid, "SIGKILL");
              console.error(
                `[MCP] Force killed Chrome process ${sessionInfo.chromeProcessPid} for session ${sessionId}`
              );
            }
          } catch (e) {
            console.error(
              `[MCP] Chrome process ${sessionInfo.chromeProcessPid} already dead`
            );
          }
        } else {
          // 优雅模式：先尝试优雅关闭，失败后force kill
          try {
            const { chromium } = require("playwright");
            const browser = await chromium.connectOverCDP(
              `http://127.0.0.1:${sessionInfo.debugPort}`
            );
            await browser.close();
            console.error(
              `[MCP] Browser for session ${sessionId} closed gracefully`
            );
          } catch (e) {
            console.error(
              `[MCP] Could not gracefully close session ${sessionId}, force killing...`
            );
            try {
              if (sessionInfo.chromeProcessPid) {
                process.kill(sessionInfo.chromeProcessPid, "SIGKILL");
                console.error(
                  `[MCP] Force killed Chrome process ${sessionInfo.chromeProcessPid}`
                );
              }
            } catch (killError) {
              console.error(
                `[MCP] Process already dead: ${sessionInfo.chromeProcessPid}`
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
          `[MCP] Failed to close session ${sessionId}:`,
          error.message
        );
        errorCount++;
      }
    }

    // 清空注册表
    require("fs").writeFileSync(sessionRegistryFile, "{}");
    console.error("[MCP] Sessions registry cleared");

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

    const sessionRegistryFile = `/tmp/chrome-browser-automation-sessions/sessions-registry.json`;
    const baseDir = `/tmp/chrome-browser-automation-sessions`;

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
  "run_script",
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
};
