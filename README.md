# Chrome Automation MCP

*中文版：[README-zh.md](README-zh.md)*

A Model Context Protocol (MCP) server for browser automation using Playwright to control Chrome browsers and execute custom scripts.

[![npm version](https://badge.fury.io/js/chrome-automation-mcp.svg)](https://badge.fury.io/js/chrome-automation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🚀 Launch and control Chrome browsers programmatically
- 🔗 Connect to existing Chrome instances via debugging port
- 📱 **Smart tab management** - Auto-switch to new tabs, handle popup windows
- 🎯 **Intelligent element finding** - Auto-scroll when elements aren't visible
- 📝 Execute custom JavaScript scripts with browser and page access
- 🔧 **20 streamlined tools** - Eliminated redundancy, cleaner API
- 🎪 Rich browser automation (click, type, scroll, screenshot, navigate)
- 📦 Easy integration with Claude Desktop and other MCP clients

## Installation

### From GitHub

```bash
# Clone the repository
git clone https://github.com/JackZhao98/chrome-automation-mcp.git
cd chrome-automation-mcp

# Install dependencies
npm install

# Optional: Install globally
npm install -g .
```

### From npm

```bash
npm install -g chrome-automation-mcp
```

**System Requirements:**
- **macOS only** (macOS 10.15 or later)
- **Google Chrome** must be installed (download from [chrome.google.com](https://chrome.google.com))

**Installation Location:**
- **macOS**: `/usr/local/lib/node_modules/chrome-automation-mcp`

To find your global installation path:
```bash
npm root -g
```

## Usage

### As MCP Server

#### Step 1: Install the Package
Choose one of the installation methods above.

#### Step 2: Configure MCP Client

1. **Find your MCP client config file:**
   - **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Other MCP clients**: Refer to your client's documentation

2. **Add server configuration:**

**Option A: If installed globally via npm:**
```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "chrome-automation-mcp"
    }
  }
}
```

**Option B: If cloned from GitHub:**
```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "node",
      "args": ["/absolute/path/to/chrome-automation-mcp/bin/cli.js"]
    }
  }
}
```

#### Step 3: Restart MCP Client
Close and restart your MCP client for the configuration to take effect.

#### Step 4: Verify Installation
In your MCP client, you should now be able to use browser automation commands like:
- "Launch a browser and go to google.com"
- "Take a screenshot of the current page"
- "Click on the search button"

### Programmatic Usage

```javascript
const { ChromeAutomationServer, createServer } = require('chrome-automation-mcp');

// Method 1: Use convenience function
const server = createServer();
server.run();

// Method 2: Create instance manually
const server = new ChromeAutomationServer();
server.run();
```

## Available Tools (20 Core Tools)

*Streamlined from 24 tools to 20 essential tools, eliminating redundancy while maintaining full functionality.*

**Recent Improvements:**
- ✅ Removed redundant tools (`click_visible`, `find_*` functions, `get_current_url`)
- ✅ Enhanced error messages with actionable suggestions
- ✅ Added smart tab switching for popup handling
- ✅ Improved element visibility detection and auto-scrolling

### 🚀 Browser Management (3 tools)
- `launch_browser` - Launch Chrome with debugging port
- `connect_browser` - Connect to existing Chrome instance  
- `close_browser` - Close browser connection

### 📍 Navigation (2 tools)
- `navigate_to` - Navigate to URL
- `go_back` - Navigate back to previous page in browser history

### 🎯 Page Interaction (4 tools)
- `click` - Click on elements (by selector or text, with automatic visibility detection)
- `type_text` - Type text into input fields
- `press_key` - Press keyboard keys with modifiers
- `scroll` - Scroll page to find elements not currently visible

### 📊 Information Gathering (3 tools)
- `get_elements` - Get element information and attributes (replaces find_buttons/find_links/find_inputs)
- `read_text` - Read text content from page/elements
- `get_page_info` - Get current page information (includes URL, title, viewport, etc.)

### ⏳ State & Timing (2 tools)
- `wait_for` - Wait for elements/conditions (auto-switches to new tabs when needed)
- `screenshot` - Take page screenshot

### 🖥️ Tab Management (3 tools)
- `switch_to_latest_tab` - Switch to the most recently opened tab
- `switch_to_tab` - Switch to specific tab by index or URL
- `get_tabs` - Get information about all open tabs

### 💻 Code Execution (3 tools)
- `run_script` - Execute external JavaScript files with browser/page access
- `execute_code` - Execute Playwright code in Node.js context
- `evaluate` - Execute JavaScript in browser context

## Quick Start Example

1. **Launch Browser**
```json
{
  "tool": "launch_browser",
  "arguments": {
    "headless": false,
    "debugPort": 9222
  }
}
```

2. **Navigate to Website**
```json
{
  "tool": "navigate_to",
  "arguments": {
    "url": "https://example.com"
  }
}
```

3. **Take Screenshot**
```json
{
  "tool": "screenshot",
  "arguments": {
    "fullPage": true
  }
}
```

## Advanced Features

### Smart Tab Handling
The `wait_for` tool automatically detects and switches to new tabs when elements aren't found:

```json
{
  "tool": "click", 
  "arguments": {"selector": "a[target='_blank']"}
}
// Opens new tab

{
  "tool": "wait_for",
  "arguments": {"selector": ".new-page-content"}
}
// Automatically switches to new tab and waits for element
```

### Intelligent Element Finding
Tools provide helpful guidance when elements aren't visible:

```json
{
  "tool": "click",
  "arguments": {"selector": ".button-at-bottom"}
}
// If element not found: "Try using the 'scroll' tool to scroll down..."
```

### Script Development

**Two ways to execute custom code:**

#### 1. External Script Files (`run_script`)
Create a `.js` file and execute it with the MCP:

```javascript
// my-automation-script.js
const searchQuery = args.query || 'MCP servers';

// Navigate to Google
await page.goto('https://google.com');

// Search
await page.fill('input[name="q"]', searchQuery);
await page.keyboard.press('Enter');

// Wait for results (auto-switches to new tab if needed)
await page.waitForSelector('h3');

// Get all results
const results = await page.$$eval('h3', els => 
  els.map(el => el.textContent)
);

return { 
  query: searchQuery,
  searchResults: results,
  count: results.length
};
```

Then use: `{"tool": "run_script", "arguments": {"scriptPath": "./my-automation-script.js", "args": {"query": "playwright automation"}}}`

#### 2. Inline Code (`execute_code`)
Execute code directly without creating files:

```javascript
// Direct code execution
await page.goto('https://google.com');
await page.fill('input[name="q"]', 'MCP servers');
await page.keyboard.press('Enter');
await page.waitForSelector('h3');
return await page.$$eval('h3', els => els.map(el => el.textContent));
```

**Both methods have access to:**
- `browser` - Playwright browser instance  
- `page` - Current page object
- `args` - Passed arguments (run_script only)

## Configuration Options

### Launch Browser Options
- `headless` (boolean) - Run in headless mode (default: false)
- `userDataDir` (string) - Chrome user data directory
- `debugPort` (number) - Remote debugging port (default: 9222)

### Tool-Specific Options
Most tools support:
- `timeout` - Operation timeout in milliseconds
- `force` - Force action even if element not visible
- `selector` - CSS selector for element targeting

## Integration Examples

### With Claude Desktop

1. Clone and install: Follow installation instructions above
2. Add to Claude Desktop config with absolute path
3. Restart Claude Desktop
4. Use natural language to control browsers!

Example conversation:
> "Please open Google, search for 'MCP servers', and take a screenshot"

### Custom MCP Client

```javascript
const { spawn } = require('child_process');

const mcpServer = spawn('chrome-automation-mcp');

// Send MCP requests via stdin
// Handle responses via stdout
```

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Ensure Chrome allows remote debugging
   - Check if port is already in use
   - Verify firewall settings

2. **Element Not Found**
   - **NEW**: Tools now auto-suggest using `scroll` when elements aren't visible
   - **NEW**: `click` tool automatically tries scrolling once before failing
   - Use `wait_for` before interacting with elements
   - Check if element is in correct frame/context
   - Try different selector strategies

3. **New Tab Issues** 
   - **FIXED**: `wait_for` automatically switches to new tabs
   - Use `get_tabs` to see all open tabs
   - Use `switch_to_latest_tab` to manually switch tabs

4. **Script Execution Errors**
   - Validate JavaScript syntax  
   - Check for typos in variable names
   - Add error handling in scripts

### Debug Mode

Launch with debug logging:
```bash
DEBUG=chrome-automation-mcp chrome-automation-mcp
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push branch: `git push origin feature-name`
5. Submit pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [GitHub Repository](https://github.com/JackZhao98/chrome-automation-mcp)
- [npm Package](https://www.npmjs.com/package/chrome-automation-mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Playwright Documentation](https://playwright.dev/)

---

Built with ❤️ for the MCP ecosystem