# MCP Browser Automation Server

一个通用的MCP服务器，用于通过Playwright控制Chrome浏览器并执行自定义脚本。

## 安装

```bash
# 创建项目目录
mkdir mcp-browser-automation
cd mcp-browser-automation

# 复制 package.json 和 index.js

# 安装依赖
npm install
```

## 配置Claude Desktop

1. 找到Claude Desktop配置文件：
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. 添加MCP服务器配置：

```json
{
  "mcpServers": {
    "browser-automation": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-browser-automation/index.js"],
      "env": {}
    }
  }
}
```

3. 重启Claude Desktop

## 使用方法

### 在Claude中使用MCP工具：

1. **启动浏览器**
```
使用 launch_browser 工具，参数：
- headless: false（显示浏览器窗口）
- userDataDir: "/tmp/chrome-debug-mcp"
- debugPort: 9222
```

2. **连接到已有浏览器**
```
使用 connect_browser 工具，参数：
- debugPort: 9222
```

3. **运行脚本文件**
```
使用 run_script 工具，参数：
- scriptPath: "/path/to/your/script.js"
- args: { question: "你的问题" }
```

4. **直接执行代码**
```
使用 execute_code 工具，参数：
- code: "await page.goto('https://google.com'); return await page.title();"
```

5. **关闭浏览器**
```
使用 close_browser 工具
```

## 脚本编写指南

脚本可以访问以下变量：
- `browser` - Playwright browser实例
- `page` - 当前页面
- `args` - 传入的参数对象

### 示例脚本

```javascript
// chatgpt-ask.js
const question = args.question || '默认问题';

await page.goto('https://chat.openai.com/');
await page.waitForTimeout(3000);

const input = await page.$('#prompt-textarea');
await input.type(question);
await page.keyboard.press('Enter');

await page.waitForTimeout(5000);

const response = await page.evaluate(() => {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    return messages.length > 0 ? messages[messages.length - 1].textContent : '无回复';
});

return { question, response };
```

## 在AI工作流中使用

1. 先调用 `launch_browser` 或 `connect_browser` 建立连接
2. 使用 `run_script` 执行你的自动化脚本
3. 脚本返回的结果会传回给AI进行处理
4. 最后调用 `close_browser` 清理资源

## 注意事项

- 脚本在Node.js环境中执行，可以使用Playwright的所有API
- 确保Chrome以调试模式启动才能连接
- 脚本执行错误会返回错误信息
- 建议在脚本中添加适当的等待和错误处理

## 故障排除

如果连接失败：
1. 确保Chrome正确启动：`chrome --remote-debugging-port=9222`
2. 检查端口：访问 `http://127.0.0.1:9222/json/version`
3. 查看MCP服务器日志

