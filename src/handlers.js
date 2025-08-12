const { chromium } = require("playwright");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
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
          throw new Error(`No elements found with text: ${selector}`);
        }
      } else {
        // Try to find all matching elements and click the visible one
        const elements = await this.page.$(selector);

        if (elements.length === 0) {
          throw new Error(`No elements found for selector: ${selector}`);
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
          `Failed to click ${selector}: ${error.message}. Found multiple elements or element not visible. Try using a more specific selector or set force:true`
        );
      }
    }
  },

  click_visible: async function(args) {
    const { selector, timeout = 5000 } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Clicking first visible element matching:", selector);

    // Use Playwright's built-in visible selector
    const visibleSelector = `${selector}:visible`;

    try {
      await this.page.click(visibleSelector, { timeout });

      return {
        content: [
          {
            type: "text",
            text: `Clicked visible element: ${selector}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`No visible element found for selector: ${selector}`);
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
      throw new Error(`Element not found: ${selector}`);
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
        throw new Error(`Element not found: ${selector}`);
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

  find_buttons: async function(args = {}) {
    const { containing } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Finding buttons");

    const buttons = await this.page.$$eval(
      'button, input[type="button"], input[type="submit"], [role="button"]',
      (elements, text) => {
        return elements
          .filter(
            (el) => !text || (el.innerText && el.innerText.includes(text))
          )
          .map((el) => ({
            tagName: el.tagName.toLowerCase(),
            type: el.getAttribute("type"),
            text: el.innerText || el.value || el.getAttribute("aria-label"),
            id: el.id,
            class: el.className,
            disabled: el.disabled,
          }));
      },
      containing
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(buttons, null, 2),
        },
      ],
    };
  },

  find_links: async function(args = {}) {
    const { containing } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Finding links");

    const links = await this.page.$$eval(
      "a[href]",
      (elements, text) => {
        return elements
          .filter(
            (el) => !text || (el.innerText && el.innerText.includes(text))
          )
          .map((el) => ({
            text: el.innerText || el.textContent,
            href: el.href,
            target: el.target,
            id: el.id,
            class: el.className,
          }));
      },
      containing
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(links, null, 2),
        },
      ],
    };
  },

  find_inputs: async function(args = {}) {
    const { type } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Finding inputs");

    const selector = type
      ? `input[type="${type}"], textarea`
      : "input, textarea, select";

    const inputs = await this.page.$$eval(selector, (elements) => {
      return elements.map((el) => ({
        tagName: el.tagName.toLowerCase(),
        type: el.type || "text",
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        value: el.value,
        required: el.required,
        disabled: el.disabled,
        class: el.className,
      }));
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(inputs, null, 2),
        },
      ],
    };
  },

  wait_for: async function(args) {
    const { selector, state = "visible", timeout = 10000 } = args;

    if (!this.page) {
      throw new Error(
        "No browser page available. Launch or connect to browser first."
      );
    }

    console.error("[MCP] Waiting for:", selector, state);

    await this.page.waitForSelector(selector, { state, timeout });

    return {
      content: [
        {
          type: "text",
          text: `Element ${selector} is now ${state}`,
        },
      ],
    };
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
        throw new Error(`Element not found: ${selector}`);
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

  run_script: async function(args) {
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