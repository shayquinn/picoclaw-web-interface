# PicoClaw Web Interface Configuration Guide

## 🔧 Current Status

Based on your gateway output, here's what's happening:

### ✅ **What's Working:**
1. **PicoClaw Gateway**: ✅ Running on `localhost:18790`
2. **Web Interface**: ✅ Running on `localhost:3000`
3. **Node.js**: ✅ Installed (v25.6.0)
4. **Dependencies**: ✅ Installed

### ⚠️ **What Needs Configuration:**
1. **API Authentication**: ❌ Missing Authorization header
2. **LLM Provider**: ❌ Not configured
3. **API Keys**: ❌ Not set up

## 🚨 Error Analysis

From your gateway logs:
```
2026/02/28 20:46:45 [2026-02-28T20:46:45Z] [ERROR] agent: LLM call failed {agent_id=main, iteration=1, error=API request failed:
  Status: 401
  Body:   {"error":{"code":"1001","message":"Header中未收到Authorization参数，无法进行身份验证。"}}
```

**Translation**: "Authorization parameter not received in header, cannot authenticate."

## 🔑 Configuration Steps

### Step 1: Configure PicoClaw

Run the onboard command to set up your API keys:

```powershell
cd picoclaw
.\build\picoclaw-windows-amd64.exe onboard
```

This will:
1. Create a configuration file
2. Prompt you for API keys
3. Set up your LLM provider (Claude, OpenAI, etc.)

### Step 2: Choose Your LLM Provider

PicoClaw supports multiple providers. You'll need to configure at least one:

#### **Option A: Claude (Anthropic)**
```bash
# You'll need an Anthropic API key
# Visit: https://console.anthropic.com/
```

#### **Option B: OpenAI**
```bash
# You'll need an OpenAI API key
# Visit: https://platform.openai.com/api-keys
```

#### **Option C: Local Models**
```bash
# Configure local models if you have them running
```

### Step 3: Verify Configuration

After running `onboard`, check your configuration:

```powershell
# Check if config file was created
dir config\config.json

# View the config (optional)
type config\config.json
```

### Step 4: Restart Gateway

Stop the current gateway (Ctrl+C) and restart:

```powershell
.\build\picoclaw-windows-amd64.exe gateway
```

## 🌐 Web Interface Setup

### 1. **Open the Web Interface**
- Browser: http://localhost:3000
- You should see the PicoClaw chat interface

### 2. **Check Connection Status**
- Click the "Settings" button (⚙️)
- Look for "Gateway Status"
- It should show "Connected" once configured

### 3. **Test the Connection**
- Type a message in the chat
- If configured correctly, you'll get a real AI response

## 📁 Configuration Files

### **Main Configuration**
```
picoclaw/config/config.json
```

### **Example Configuration Structure**
```json
{
  "providers": {
    "anthropic": {
      "api_key": "your-claude-api-key-here"
    },
    "openai": {
      "api_key": "your-openai-api-key-here"
    }
  },
  "channels": {
    "web": {
      "enabled": true
    }
  }
}
```

## 🔍 Troubleshooting

### **Issue: "Authorization parameter not received"**
**Solution:**
1. Run `.\build\picoclaw-windows-amd64.exe onboard`
2. Enter your API key when prompted
3. Restart the gateway

### **Issue: Web interface shows "Gateway not connected"**
**Solution:**
1. Make sure gateway is running on `localhost:18790`
2. Check the gateway URL in web interface settings
3. Verify the gateway is accessible:
   ```powershell
   curl http://localhost:18790/health
   ```

### **Issue: "No channels enabled" warning**
**Solution:**
This is normal for web interface. The web channel is implicit.

## 🎯 Quick Start Commands

### **Complete Setup Sequence:**
```powershell
# 1. Build PicoClaw (if not already built)
cd picoclaw
go generate ./...
go build -v -tags stdjson -o build/picoclaw-windows-amd64.exe ./cmd/picoclaw

# 2. Configure API keys
.\build\picoclaw-windows-amd64.exe onboard

# 3. Start Gateway
.\build\picoclaw-windows-amd64.exe gateway

# 4. In a NEW terminal, start web interface
cd picoclaw\web-interface
npm start

# 5. Open browser
start http://localhost:3000
```

## 🔗 API Integration

### **Web Interface API Endpoints:**
- `GET /api/status` - Check gateway status
- `POST /api/chat` - Send messages
- `POST /api/gateway/start` - Start gateway
- `POST /api/gateway/stop` - Stop gateway

### **PicoClaw Gateway Endpoints:**
- `GET /health` - Health check
- `POST /api/v1/chat` - Chat endpoint (main API)
- Various other endpoints for skills/tools

## 📝 Notes

1. **First-time Setup**: The `onboard` command is essential for first-time users
2. **API Keys**: Keep your API keys secure. They're stored in `config/config.json`
3. **Multiple Providers**: You can configure multiple LLM providers
4. **Fallback**: PicoClaw can use fallback providers if one fails
5. **Web Interface**: Works in "demo mode" even without gateway for testing UI

## 🆘 Need Help?

1. **Check Logs**: Gateway logs show detailed error information
2. **Verify Configuration**: Ensure `config/config.json` exists and has valid keys
3. **Test API Key**: Try using your API key directly with the provider's API
4. **Community**: Check PicoClaw GitHub issues for similar problems

## ✅ Success Checklist

- [ ] Ran `onboard` command
- [ ] Entered valid API key(s)
- [ ] Gateway starts without authentication errors
- [ ] Web interface shows "Connected" status
- [ ] Can send and receive messages

Once configured, you'll have a fully functional AI assistant with a beautiful web interface! 🎉