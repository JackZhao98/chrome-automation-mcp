const timestamp = Date.now();

const toolDefinitions = [
  {
    name: "launch_browser",
    description: "Launch Chrome browser with debugging port",
    inputSchema: {
      type: "object",
      properties: {
        headless: {
          type: "boolean",
          description: "Run browser in headless mode",
          default: false,
        },
        userDataDir: {
          type: "string",
          description: "Chrome user data directory path",
          default: `/tmp/chrome-debug-mcp-${timestamp}`,
        },
        debugPort: {
          type: "number",
          description: "Remote debugging port",
          default: 9222,
        },
      },
    },
  },
  {
    name: "connect_browser",
    description: "Connect to existing Chrome instance with debugging port",
    inputSchema: {
      type: "object",
      properties: {
        debugPort: {
          type: "number",
          description: "Remote debugging port",
          default: 9222,
        },
      },
    },
  },
  {
    name: "navigate_to",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to",
        },
        waitUntil: {
          type: "string",
          description: "When to consider navigation complete",
          enum: ["load", "domcontentloaded", "networkidle"],
          default: "networkidle",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description: "Click on an element",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector or text to click",
        },
        clickByText: {
          type: "boolean",
          description: "If true, click element containing this text",
          default: false,
        },
        force: {
          type: "boolean",
          description: "Force click even if element is not visible",
          default: false,
        },
        index: {
          type: "number",
          description:
            "If multiple elements match, which index to click (0-based)",
          default: 0,
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds",
          default: 5000,
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "click_visible",
    description: "Click the first visible element matching selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds",
          default: 5000,
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "type_text",
    description: "Type text into an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the input field",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
        clear: {
          type: "boolean",
          description: "Clear the field before typing",
          default: true,
        },
        delay: {
          type: "number",
          description: "Delay between keystrokes in ms",
          default: 50,
        },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "read_text",
    description: "Read text content from the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "CSS selector to read from (optional, reads whole page if not provided)",
        },
        all: {
          type: "boolean",
          description: "If true, return text from all matching elements",
          default: false,
        },
      },
    },
  },
  {
    name: "get_elements",
    description: "Get information about elements on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to find elements",
        },
        attributes: {
          type: "array",
          description: "List of attributes to retrieve",
          items: { type: "string" },
          default: ["id", "class", "href", "src", "alt", "title"],
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "find_buttons",
    description: "Find all buttons on the page",
    inputSchema: {
      type: "object",
      properties: {
        containing: {
          type: "string",
          description: "Optional text that button should contain",
        },
      },
    },
  },
  {
    name: "find_links",
    description: "Find all links on the page",
    inputSchema: {
      type: "object",
      properties: {
        containing: {
          type: "string",
          description: "Optional text that link should contain",
        },
      },
    },
  },
  {
    name: "find_inputs",
    description: "Find all input fields on the page",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Input type to filter by (text, email, password, etc.)",
        },
      },
    },
  },
  {
    name: "wait_for",
    description: "Wait for an element or condition",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for",
        },
        state: {
          type: "string",
          description: "State to wait for",
          enum: ["visible", "hidden", "attached", "detached"],
          default: "visible",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds",
          default: 10000,
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "press_key",
    description: "Press a keyboard key",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Key to press (Enter, Escape, Tab, ArrowDown, etc.)",
        },
        modifiers: {
          type: "array",
          description: "Modifier keys to hold",
          items: {
            type: "string",
            enum: ["Control", "Shift", "Alt", "Meta"],
          },
          default: [],
        },
      },
      required: ["key"],
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the page",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "Capture full page",
          default: false,
        },
        selector: {
          type: "string",
          description: "Capture only this element",
        },
      },
    },
  },
  {
    name: "scroll",
    description: "Scroll the page",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          description: "Scroll direction",
          enum: ["up", "down", "left", "right"],
          default: "down",
        },
        amount: {
          type: "number",
          description: "Amount to scroll in pixels",
          default: 500,
        },
      },
    },
  },
  {
    name: "get_page_info",
    description: "Get current page information",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_script",
    description: "Execute a Playwright script file",
    inputSchema: {
      type: "object",
      properties: {
        scriptPath: {
          type: "string",
          description: "Path to the JavaScript file to execute",
        },
        args: {
          type: "object",
          description: "Arguments to pass to the script",
          default: {},
        },
      },
      required: ["scriptPath"],
    },
  },
  {
    name: "execute_code",
    description:
      "Execute Playwright code in Node.js context (use for page.goto, page.click, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript code to execute with access to browser and page objects",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "evaluate",
    description:
      "Execute JavaScript code in the browser page context (use for DOM manipulation)",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript code to execute in browser context (has access to document, window, etc.)",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "close_browser",
    description: "Close the browser connection",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

module.exports = { toolDefinitions };