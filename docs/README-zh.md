# Chrome Automation MCP

一个使用 Playwright 控制 Chrome 浏览器的模型上下文协议（MCP）服务器。

[![npm version](https://badge.fury.io/js/chrome-automation-mcp.svg)](https://badge.fury.io/js/chrome-automation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 安装

```bash
npm install -g chrome-automation-mcp@1.2.0
```

**系统要求：**
- Node.js 18.0.0 或更高版本
- Google Chrome 浏览器

## MCP 配置

### Claude Desktop 配置

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "chrome-automation-mcp"
    }
  }
}
```

### Lite 模式（精简工具集）

```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "chrome-automation-mcp-lite"
    }
  }
}
```

## 可用工具

### 🚀 浏览器管理
- `launch_browser` - 启动 Chrome 浏览器
- `connect_browser` - 连接现有 Chrome 实例  
- `close_browser` - 关闭浏览器

### 📍 导航与交互
- `navigate_to` - 导航到 URL
- `click` - 点击元素
- `type_text` - 输入文本
- `scroll` - 滚动页面
- `wait_for` - 等待元素出现

### 📊 信息获取
- `read_text` - 读取页面文本
- `get_elements` - 获取元素信息
- `screenshot` - 截图
- `get_page_info` - 获取页面信息

### 🖥️ 标签页管理
- `switch_to_tab` - 切换标签页
- `get_tabs` - 获取标签页列表

### 💻 代码执行
- `run_script` - 执行 JavaScript 文件
- `evaluate` - 在浏览器中执行 JavaScript
- `set_storage` - 设置浏览器存储（cookies, localStorage 等）

### ⚙️ 会话管理
- `list_sessions` - 列出活动会话
- `press_key` - 按键操作
- `go_back` - 返回上一页

## 快速开始

1. **启动浏览器**
```json
{"tool": "launch_browser", "arguments": {}}
```

2. **导航到网站**
```json
{"tool": "navigate_to", "arguments": {"url": "https://google.com"}}
```

3. **截图**
```json
{"tool": "screenshot", "arguments": {"fullPage": true}}
```

## 脚本开发

创建自定义脚本文件：

```javascript
// my-script.js
const query = args.query || 'MCP';

await page.goto('https://google.com');
await page.fill('input[name="q"]', query);
await page.press('input[name="q"]', 'Enter');
await page.waitForSelector('h3');

const results = await page.$$eval('h3', els => 
  els.map(el => el.textContent)
);

return { query, results };
```

使用脚本：
```json
{
  "tool": "run_script", 
  "arguments": {
    "scriptPath": "./my-script.js",
    "args": {"query": "browser automation"}
  }
}
```

## 链接

- [GitHub](https://github.com/JackZhao98/chrome-automation-mcp)
- [npm](https://www.npmjs.com/package/chrome-automation-mcp)
- [MCP 协议](https://modelcontextprotocol.io/)