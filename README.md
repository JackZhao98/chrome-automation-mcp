# Browser Automation MCP

*中文版：[README-zh.md](README-zh.md)*

A Model Context Protocol (MCP) server for browser automation using Playwright to control Chrome browsers and execute custom scripts.

[![npm version](https://badge.fury.io/js/browser-automation-mcp.svg)](https://badge.fury.io/js/browser-automation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🚀 Launch and control Chrome browsers programmatically
- 🔗 Connect to existing Chrome instances via debugging port
- 📝 Execute custom JavaScript scripts with browser and page access
- 🎯 Rich set of browser automation tools (click, type, scroll, screenshot, etc.)
- 🔧 Both CLI and programmatic API support
- 📦 Easy integration with Claude Desktop and other MCP clients

## Installation

### From GitHub

```bash
# Clone the repository
git clone https://github.com/JackZhao98/browser-automation-mcp.git
cd browser-automation-mcp

# Install dependencies
npm install

# Optional: Install globally
npm install -g .
```

### From npm (Coming Soon)

```bash
# Will be available after publishing to npm
npm install -g browser-automation-mcp
```

## Usage

### As MCP Server

Configure in your MCP client (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "browser-automation": {
      "command": "node",
      "args": ["/absolute/path/to/browser-automation-mcp/bin/cli.js"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "browser-automation": {
      "command": "browser-automation-mcp"
    }
  }
}
```

### Programmatic Usage

```javascript
const { BrowserAutomationServer, createServer } = require('browser-automation-mcp');

// Method 1: Use convenience function
const server = createServer();
server.run();

// Method 2: Create instance manually
const server = new BrowserAutomationServer();
server.run();
```

## Available Tools

### Browser Management
- `launch_browser` - Launch Chrome with debugging port
- `connect_browser` - Connect to existing Chrome instance
- `close_browser` - Close browser connection

### Navigation & Page Control
- `navigate_to` - Navigate to URL
- `get_page_info` - Get current page information
- `screenshot` - Take page screenshot
- `scroll` - Scroll page in specified direction

### Element Interaction
- `click` - Click on elements (by selector or text)
- `click_visible` - Click first visible element
- `type_text` - Type text into input fields
- `press_key` - Press keyboard keys with modifiers

### Content Extraction
- `read_text` - Read text content from page/elements
- `get_elements` - Get element information and attributes
- `find_buttons` - Find all buttons on page
- `find_links` - Find all links on page
- `find_inputs` - Find all input fields

### Advanced Operations
- `wait_for` - Wait for elements/conditions
- `evaluate` - Execute JavaScript in browser context
- `execute_code` - Execute Playwright code in Node.js context
- `run_script` - Execute external script files

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

## Script Development

When using `run_script` or `execute_code`, you have access to:
- `browser` - Playwright browser instance
- `page` - Current page object
- `args` - Passed arguments object

### Example Script

```javascript
// example-script.js
const searchQuery = args.query || 'default search';

// Navigate to Google
await page.goto('https://google.com');

// Search
await page.fill('input[name="q"]', searchQuery);
await page.press('input[name="q"]', 'Enter');

// Wait for results
await page.waitForSelector('h3');

// Get first result
const firstResult = await page.textContent('h3');

return {
  query: searchQuery,
  firstResult: firstResult
};
```

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

const mcpServer = spawn('browser-automation-mcp');

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
   - Use `wait_for` before interacting with elements
   - Check if element is in correct frame/context
   - Try different selector strategies

3. **Script Execution Errors**
   - Validate JavaScript syntax
   - Check for typos in variable names
   - Add error handling in scripts

### Debug Mode

Launch with debug logging:
```bash
DEBUG=browser-automation-mcp browser-automation-mcp
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

- [GitHub Repository](https://github.com/JackZhao98/browser-automation-mcp)
- [npm Package](https://www.npmjs.com/package/browser-automation-mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Playwright Documentation](https://playwright.dev/)

---

Built with ❤️ for the MCP ecosystem