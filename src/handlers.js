const { chromium } = require("playwright");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const os = require("os");

const execAsync = promisify(exec);

const toolHandlers = {
  launch_browser: async function(args) {
    const {
      headless = false,
      userDataDir = "/tmp/chrome-debug-mcp",
      debugPort = 9222,
    } = args;

    console.error("[MCP] Launching browser with args:", {
      headless,
      userDataDir,
      debugPort,
    });

    // Kill any existing Chrome process
    const platform = os.platform();
    if (platform === "darwin") {
      try {
        await execAsync('killall "Google Chrome"');
        console.error("[MCP] Killed existing Chrome process");
      } catch (e) {
        // Chrome might not be running
      }
    } else if (platform === "win32") {
      try {
        await execAsync("taskkill /F /IM chrome.exe");
      } catch (e) {
        // Chrome might not be running
      }
    }

    // Launch Chrome with debugging port
    const chromePath =
      platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "google-chrome";

    const chromeArgs = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];

    if (headless) {
      chromeArgs.push("--headless=new");
    }

    console.error(
      "[MCP] Starting Chrome with command:",
      chromePath,
      chromeArgs
    );

    this.chromeProcess = spawn(chromePath, chromeArgs, {
      detached: false,
      stdio: "ignore",
    });

    this.debugPort = debugPort;

    // Wait for Chrome to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Connect with Playwright
    try {
      this.browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${debugPort}`
      );
      const context = this.browser.contexts()[0];
      const pages = context.pages();
      this.page = pages.length > 0 ? pages[0] : await context.newPage();

      console.error("[MCP] Browser launched and connected successfully");

      return {
        content: [
          {
            type: "text",
            text: `Browser launched successfully on port ${debugPort}`,
          },
        ],
      };
    } catch (error) {
      console.error("[MCP] Failed to connect:", error);
      throw new Error(`Failed to connect to browser: ${error.message}`);
    }
  },

  connect_browser: async function(args) {
    const { debugPort = 9222 } = args;

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
  },

  navigate_to: async function(args) {
    const { url, waitUntil = "networkidle" } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Navigating to:", url);
    await this.page.goto(url, { waitUntil });

    return {
      content: [
        {
          type: "text",
          text: `Navigated to ${url}`,
        },
      ],
    };
  },

  click: async function(args) {
    const {
      selector,
      clickByText = false,
      timeout = 5000,
      force = false,
      index = 0,
    } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error(
      "[MCP] Clicking:",
      selector,
      clickByText ? "(by text)" : "(by selector)"
    );

    try {
      if (clickByText) {
        // Click element containing text
        const elements = await this.page.getByText(selector).all();
        if (elements.length > 0) {
          console.error(
            `[MCP] Found ${elements.length} elements with text "${selector}", clicking index ${index}`
          );
          await elements[index].click({ timeout, force });
        } else {
          throw new Error(`No elements found with text: ${selector}. Try scrolling down using the 'scroll' tool to find more content, or use a more specific selector.`);
        }
      } else {
        // Try to find all matching elements and click the visible one
        let elements = await this.page.$$(selector);

        if (elements.length === 0) {
          // Try scrolling down to find the element
          console.error("[MCP] Element not found, trying to scroll down to find it");
          await this.page.evaluate(() => {
            window.scrollBy(0, 500);
          });
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for scroll
          
          // Try again after scrolling
          const elementsAfterScroll = await this.page.$$(selector);
          if (elementsAfterScroll.length === 0) {
            throw new Error(`No elements found for selector: ${selector}. Tried scrolling down but element still not found. The element might be further down the page - use the 'scroll' tool to scroll more, or check if the selector is correct.`);
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
        await this.page
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


  type_text: async function(args) {
    const { selector, text, clear = true, delay = 50 } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Typing into:", selector);

    const element = await this.page.$(selector);
    if (!element) {
      throw new Error(`Input element not found: ${selector}. The element might be below the current view. Try using the 'scroll' tool to scroll down and find the input field.`);
    }

    if (clear) {
      await element.click();
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("A");
      await this.page.keyboard.up("Control");
      await this.page.keyboard.press("Backspace");
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

  read_text: async function(args = {}) {
    const { selector, all = false } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Reading text from:", selector || "entire page");

    let text;

    if (!selector) {
      // Read entire page text
      text = await this.page.evaluate(() => document.body.innerText);
    } else if (all) {
      // Read all matching elements
      const texts = await this.page.$eval(selector, (elements) =>
        elements.map((el) => el.innerText || el.textContent)
      );
      text = texts.join("\n---\n");
    } else {
      // Read single element
      const element = await this.page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}. The element might be below the current view. Try using the 'scroll' tool to scroll down and find the element.`);
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

  get_elements: async function(args) {
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


  wait_for: async function(args) {
    const { selector, state = "visible", timeout = 10000, switchToNewTab = true } = args;

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
          console.error(`[MCP] Found new tab, switching to latest tab (${latestPage.url()})`);
          this.page = latestPage;
          
          // Wait a bit for the new page to load
          try {
            await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
          } catch (e) {
            console.error("[MCP] New page didn't finish loading within 5s, continuing anyway");
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
      if (switchToNewTab && this.browser && error.message.includes('Timeout')) {
        console.error("[MCP] Timeout occurred, checking for new tabs...");
        const context = this.browser.contexts()[0];
        const currentPages = context.pages();
        
        if (currentPages.length > 1) {
          const latestPage = currentPages[currentPages.length - 1];
          if (latestPage !== this.page) {
            console.error(`[MCP] Switching to latest tab after timeout (${latestPage.url()})`);
            this.page = latestPage;
            
            // Try waiting again on the new page
            await this.page.waitForSelector(selector, { state, timeout: Math.min(timeout, 5000) });
            
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
      if (error.message.includes('Timeout') || error.message.includes('exceed')) {
        throw new Error(`${error.message} The element '${selector}' was not found within ${timeout}ms. The element might be below the current viewport. Try using the 'scroll' tool to scroll down and bring the element into view, then retry the wait_for operation.`);
      }
      
      throw error;
    }
  },

  press_key: async function(args) {
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

  screenshot: async function(args = {}) {
    const { fullPage = false, selector } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Taking screenshot");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(process.cwd(), filename);

    if (selector) {
      const element = await this.page.$(selector);
      if (!element) {
        throw new Error(`Element not found for screenshot: ${selector}. The element might be below the current view. Try using the 'scroll' tool to scroll down and bring the element into view before taking a screenshot.`);
      }
      await element.screenshot({ path: filepath });
    } else {
      await this.page.screenshot({ path: filepath, fullPage });
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

  scroll: async function(args = {}) {
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

  get_page_info: async function() {
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


  go_back: async function() {
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
      throw new Error(`Failed to go back: ${error.message}. There might be no previous page in history.`);
    }
  },



  evaluate: async function(args) {
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

  execute_code: async function(args) {
    const { code } = args;

    if (!this.browser || !this.page) {
      throw new Error(
        "Browser not connected. Use launch_browser or connect_browser first."
      );
    }

    console.error("[MCP] Executing code");

    try {
      // Create an async function and execute it
      const AsyncFunction = Object.getPrototypeOf(
        async function () {}
      ).constructor;
      const fn = new AsyncFunction("browser", "page", code);
      const result = await fn(this.browser, this.page);

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
      console.error("[MCP] Code execution failed:", error);
      throw new Error(`Code execution failed: ${error.message}`);
    }
  },

  switch_to_latest_tab: async function() {
    if (!this.browser) {
      throw new Error(
        "No browser available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Switching to latest tab");

    const context = this.browser.contexts()[0];
    const currentPages = context.pages();
    
    if (currentPages.length === 0) {
      throw new Error("No pages available");
    }
    
    const latestPage = currentPages[currentPages.length - 1];
    const previousUrl = this.page ? this.page.url() : "none";
    this.page = latestPage;
    
    // Wait for the new page to load
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch (e) {
      console.error("[MCP] New page didn't finish loading within 5s, continuing anyway");
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

  switch_to_tab: async function(args) {
    const { index = 0, url } = args;

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
    
    if (url) {
      // Find page by URL
      targetPage = currentPages.find(page => page.url().includes(url));
      if (!targetPage) {
        throw new Error(`No tab found containing URL: ${url}`);
      }
    } else {
      // Find page by index
      if (index >= currentPages.length) {
        throw new Error(`Tab index ${index} out of range. Available tabs: ${currentPages.length}`);
      }
      targetPage = currentPages[index];
    }
    
    const previousUrl = this.page ? this.page.url() : "none";
    this.page = targetPage;
    
    // Wait for the page to be ready
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch (e) {
      console.error("[MCP] Page didn't finish loading within 5s, continuing anyway");
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

  get_tabs: async function() {
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
      isCurrent: page === this.page
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

  close_browser: async function() {
    console.error("[MCP] Closing browser");

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }

    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }

    return {
      content: [
        {
          type: "text",
          text: "Browser closed successfully",
        },
      ],
    };
  },
};

module.exports = { toolHandlers };