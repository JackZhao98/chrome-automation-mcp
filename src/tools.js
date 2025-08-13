const timestamp = Date.now();

const toolDefinitions = [
  {
    name: "launch_browser",
    lite: true, // Essential for lite mode
    description: "Launch Chrome browser with session management. Each instance gets a unique session ID, port, and user data directory for isolation.",
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
          description: "Chrome user data directory path (auto-generated per session if not provided)",
        },
        debugPort: {
          type: "number",
          description: "Remote debugging port (auto-assigned per session if not provided)",
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
    name: "wait_for",
    description: "⏳ Wait for elements to load or appear. Smart tool that automatically checks new tabs if element not found on current page. Use when pages are loading or dynamic content appears.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for (e.g., '.login-button', '#content')",
        },
        state: {
          type: "string",
          description: "Element state to wait for",
          enum: ["visible", "hidden", "attached", "detached"],
          default: "visible",
        },
        timeout: {
          type: "number",
          description: "Maximum wait time in milliseconds",
          default: 10000,
        },
        switchToNewTab: {
          type: "boolean",
          description: "Auto-switch to new tabs if element not found (useful for popups/redirects)",
          default: true,
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
          description: "Key to press (Enter, Escape, Tab, ArrowDown, etc.)",
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
    description: "📜 ESSENTIAL: Scroll to find hidden elements. Many buttons/forms are below the visible area. Always try scrolling when elements are not found!",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          description: "Scroll direction to find content",
          enum: ["up", "down", "left", "right"],
          default: "down",
        },
        amount: {
          type: "number",
          description: "Distance to scroll in pixels",
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
    name: "go_back",
    description: "Navigate back to the previous page in browser history",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_script",
    lite: true, // Essential for lite mode
    description: "📁 Execute a JavaScript file from disk with access to browser automation. Use for complex automation scripts or reusable workflows.",
    inputSchema: {
      type: "object",
      properties: {
        scriptPath: {
          type: "string",
          description: "Path to the JavaScript file (e.g., 'scripts/login-workflow.js')",
        },
        args: {
          type: "object",
          description: "Arguments to pass to the script. Common: {query: 'search term', url: 'target.com'}",
          properties: {
            query: {
              type: "string",
              description: "Search query or input for the script",
            },
          },
          default: {},
        },
      },
      required: ["scriptPath"],
    },
  },
  {
    name: "evaluate",
    description: "🌐 Execute JavaScript code IN THE WEBPAGE (has access to document, window, DOM). Use for reading page data, checking elements, or simple DOM manipulation.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to run in browser page context. Example: 'document.title' or 'document.querySelector(\".username\").innerText'",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "switch_to_tab",
    description: "Switch to a specific tab by index or URL. Use index -1 or 'latest' to switch to the most recently opened tab",
    inputSchema: {
      type: "object",
      properties: {
        index: {
          type: "number",
          description: "Tab index to switch to (0-based). Use -1 for latest tab",
          default: 0,
        },
        url: {
          type: "string",
          description: "Partial URL to find and switch to",
        },
        target: {
          type: "string",
          description: "Quick target selection",
          enum: ["latest", "first"],
        },
      },
    },
  },
  {
    name: "get_tabs",
    description: "Get information about all open tabs",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "set_storage",
    lite: true, // Essential for lite mode
    description: "🔐 PREFERRED TOOL for setting login state and authentication data. Use this instead of evaluate() to set cookies, localStorage, and sessionStorage to maintain user login sessions across browser automation.",
    inputSchema: {
      type: "object",
      properties: {
        cookies: {
          type: "array",
          description: "🍪 Array of cookie objects for authentication tokens, session IDs, etc.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Cookie name (e.g., 'session_id', 'auth_token')" },
              value: { type: "string", description: "Cookie value (the actual token/session data)" },
              domain: { type: "string", description: "Website domain (e.g., 'localhost', 'example.com')" },
              path: { type: "string", description: "Cookie path (usually '/' for site-wide)", default: "/" },
              httpOnly: { type: "boolean", description: "HTTP-only flag for security", default: false },
              secure: { type: "boolean", description: "HTTPS-only flag", default: false },
              sameSite: { type: "string", description: "Cross-site request protection", enum: ["Strict", "Lax", "None"], default: "Lax" }
            },
            required: ["name", "value", "domain"]
          }
        },
        cookieString: {
          type: "string",
          description: "🍪 EASY WAY: Raw cookie string copied from browser (document.cookie). Example: 'session_id=abc123; user_token=xyz789; theme=dark'"
        },
        localStorage: {
          type: "object",
          description: "💾 Persistent browser storage that survives page reloads. Used for user preferences, auth tokens, app state. Example: {'auth_token': 'bearer_xyz', 'user_id': '12345'}"
        },
        sessionStorage: {
          type: "object", 
          description: "🔄 Temporary storage that clears when tab closes. Used for session-specific data. Example: {'temp_data': 'value', 'session_state': 'active'}"
        },
        domain: {
          type: "string", 
          description: "🌐 Default website domain for cookies when not specified individually. Example: 'localhost:3001', 'app.example.com'"
        }
      }
    },
  },
  {
    name: "list_sessions",
    description: "List all active browser automation sessions",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "close_browser",
    lite: true, // Essential for lite mode
    description: "Gracefully close the browser connection and clean up session data",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Filter tools based on lite mode
const filteredToolDefinitions = process.env.MCP_LITE_MODE === 'true' 
  ? toolDefinitions.filter(tool => tool.lite === true)
  : toolDefinitions;

module.exports = { 
  toolDefinitions: filteredToolDefinitions,
  allToolDefinitions: toolDefinitions // Export all for debugging if needed
};
