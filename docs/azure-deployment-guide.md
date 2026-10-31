# INTERLOCK — Azure Deployment Guide

This guide walks you through deploying **INTERLOCK (PS-006)** to **Microsoft Azure App Service** in under 5 minutes.

---

## 🚀 Recommended Method: Azure App Service (Linux + Node.js 20)

Azure App Service provides native Node.js hosting with integrated WebSockets and zero container complexity.

---

### Step 1: Create the Web App in Azure Portal

1. Log in to the **[Azure Portal](https://portal.azure.com/)**.
2. In the top search bar, search for **App Services** and click **+ Create** $\rightarrow$ **Web App**.
3. Fill in the **Basics** tab:
   - **Subscription**: Your Azure subscription.
   - **Resource Group**: Select an existing one or click **Create new** (e.g., `rg-interlock`).
   - **Name**: Enter a unique name (e.g., `a3-ps006-tc329` or `interlock-ps006`).
     > Your live URL will be: `https://<YOUR-APP-NAME>.azurewebsites.net`
   - **Publish**: Select **Code**.
   - **Runtime stack**: Select **Node 20 LTS**.
   - **Operating System**: **Linux**.
   - **Pricing Plan**:
     - For free testing: **Free F1** (under Dev/Test tab).
     - For unrestricted performance & custom domains: **Basic B1** (recommended).
4. Click **Review + Create**, then click **Create**. Wait ~60 seconds for deployment to complete.

---

### Step 2: Configure WebSockets & Environment Variables (Crucial!)

Once the Web App is created, click **Go to resource**:

#### 1. Enable WebSockets (For Realtime Socket.IO Telemetry)
1. In the left sidebar, navigate to **Settings** $\rightarrow$ **Configuration** (or **Environment variables**).
2. Go to the **General settings** tab.
3. Toggle **Web sockets** to **On**.
4. Click **Save** at the top.

#### 2. Set Application Settings / Environment Variables
In the **Application settings** tab, add the following key-value pairs by clicking **+ New application setting**:

| Name | Value | Purpose |
|---|---|---|
| `WEBSITES_PORT` | `3000` | **Mandatory**: Tells Azure to forward web traffic to port 3000 |
| `WEBSITE_WEB_SOCKETS_ENABLED` | `true` | Enables WebSocket connections through Azure edge proxy |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` | Instructs Azure Oryx to run `npm install` & `npm run build` |
| `NODE_ENV` | `production` | Production mode |
| `DATABASE_URL` | `file:./dev.db` | Local SQLite database |
| `ADMIN_API_KEY` | `interlock-admin-secret` | Admin API authentication key |
| `SESSION_SECRET` | `interlock-session-secret-key-32chars` | Signed session cookies |
| `REALTIME_TOKEN` | `interlock-dev-token` | Internal Socket.IO auth token |
| `REALTIME_PORT` | `3033` | Background WebSocket bridge port |
| `ALLOW_INSECURE_DEMO_MODE` | `true` | Allows instant judge evaluation without manual login |

Click **Apply** / **Save** at the top to save all environment variables.

---

### Step 3: Connect GitHub Repository (Automated Deployment)

1. In the left sidebar of your Web App, click **Deployment Center**.
2. Under **Source**, select **GitHub**.
3. Sign in to GitHub if prompted, and select:
   - **Organization**: `aiori-hackathon`
   - **Repository**: `A3-PS006-TC329`
   - **Branch**: `main`
4. Under **Build provider**, select **GitHub Actions**.
5. Click **Save** at the top.

Azure will automatically commit an optimized workflow file and immediately start building and deploying your project!

---

### Step 4: Verify Deployment

1. Go to the **Overview** page of your Web App in the Azure Portal.
2. Click on the **Default domain** URL (e.g. `https://<YOUR-APP-NAME>.azurewebsites.net`).
3. You will see the **INTERLOCK Control Room** running live with:
   - Live telemetry status
   - Scenario runner (S1–S9)
   - Real-time audit tape
   - Cryptographic verifier

---

## ⚡ Alternative Method: Deploy from Azure Cloud Shell (1 Command)

If you have Azure CLI open or use the **Cloud Shell** icon `>_` at the top of the Azure Portal:

```bash
# Clone the repository inside Cloud Shell
git clone https://github.com/aiori-hackathon/A3-PS006-TC329.git
cd A3-PS006-TC329

# Create and deploy Web App in one single command
az webapp up \
  --name interlock-ps006 \
  --runtime "NODE:20-lts" \
  --sku B1 \
  --os-type Linux

# Configure required port and WebSockets
az webapp config appsettings set \
  --name interlock-ps006 \
  --settings \
    WEBSITES_PORT=3000 \
    WEBSITE_WEB_SOCKETS_ENABLED=true \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    ALLOW_INSECURE_DEMO_MODE=true \
    DATABASE_URL="file:./dev.db" \
    ADMIN_API_KEY="interlock-admin-secret" \
    SESSION_SECRET="interlock-session-secret-key-32chars" \
    REALTIME_TOKEN="interlock-dev-token" \
    REALTIME_PORT=3033
```

---

## 🔍 Troubleshooting Tips

- **Container failed to start or Port 80 error**:  
  Ensure `WEBSITES_PORT` is set to `3000` in Application settings. Azure defaults to port 8080 or 80 unless `WEBSITES_PORT` is specified.
- **WebSocket connection failed**:  
  Make sure **Web sockets** is set to **On** under **Configuration $\rightarrow$ General settings**.
- **Inspect Live Logs**:  
  In the Azure Portal, go to **Monitoring** $\rightarrow$ **Log stream** to see live output from Next.js and the Realtime Bridge.
