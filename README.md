# Chrome Automation MCP

*中文版文档：[docs/README-zh.md](docs/README-zh.md)*

A Model Context Protocol (MCP) server for browser automation using Playwright to control Chrome browsers.

[![npm version](https://badge.fury.io/js/chrome-automation-mcp.svg)](https://badge.fury.io/js/chrome-automation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install -g chrome-automation-mcp@1.2.0
```

**Requirements:**
- Node.js 18.0.0 or higher
- Google Chrome browser

## MCP Configuration

### Claude Desktop Setup

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "chrome-automation-mcp"
    }
  }
}
```

### Lite Mode (Essential Tools Only)

```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "chrome-automation-mcp-lite"
    }
  }
}
```

## Available Tools

### 🚀 Browser Management
- `launch_browser` - Launch Chrome browser with session management
- `connect_browser` - Connect to existing Chrome instance  
- `close_browser` - Close browser connection

### 📍 Navigation & Interaction
- `navigate_to` - Navigate to URL
- `click` - Click on elements with smart visibility detection
- `type_text` - Type text into input fields
- `scroll` - Scroll page to find hidden elements
- `wait_for` - Wait for elements (auto-switches to new tabs)

### 📊 Information Gathering
- `read_text` - Read text content from page/elements
- `get_elements` - Get element information and attributes
- `screenshot` - Take page screenshots
- `get_page_info` - Get current page information

### 🖥️ Tab Management
- `switch_to_tab` - Switch between tabs
- `get_tabs` - Get information about all open tabs

### 💻 Code Execution
- `run_script` - Execute external JavaScript files with browser access
- `evaluate` - Execute JavaScript in browser context
- `set_storage` - Set browser storage (cookies, localStorage, etc.)

### ⚙️ Session Management
- `list_sessions` - List active browser sessions
- `press_key` - Press keyboard keys with modifiers
- `go_back` - Navigate back in browser history

## Quick Start

1. **Launch Browser**
```json
{"tool": "launch_browser", "arguments": {"headless": false}}
```

2. **Navigate to Website**
```json
{"tool": "navigate_to", "arguments": {"url": "https://google.com"}}
```

3. **Take Screenshot**
```json
{"tool": "screenshot", "arguments": {"fullPage": true}}
```

## Script Development

Create custom automation scripts:

```javascript
// my-automation-script.js
const searchQuery = args.query || 'MCP servers';

// Navigate to Google
await page.goto('https://google.com');

// Search
await page.fill('input[name="q"]', searchQuery);
await page.press('input[name="q"]', 'Enter');

// Wait for results
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

Use the script:
```json
{
  "tool": "run_script", 
  "arguments": {
    "scriptPath": "./my-automation-script.js",
    "args": {"query": "playwright automation"}
  }
}
```

**Available in scripts:**
- `browser` - Playwright browser instance  
- `page` - Current page object
- `args` - Passed arguments

## Lite Mode Features

Lite mode includes only essential tools for basic automation:
- Browser management (`launch_browser`, `close_browser`)
- Script execution (`run_script`)
- Storage management (`set_storage`)

Perfect for lightweight integrations and custom script-based workflows.

## Links

- [GitHub Repository](https://github.com/JackZhao98/chrome-automation-mcp)
- [npm Package](https://www.npmjs.com/package/chrome-automation-mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Playwright Documentation](https://playwright.dev/)

---

Built with ❤️ for the MCP ecosystem