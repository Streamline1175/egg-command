# 🥚 Egg Command Dashboard

![Status](https://img.shields.io/badge/Status-Active-green) ![License](https://img.shields.io/badge/License-MIT-blue)

[![Live Demo](https://img.shields.io/badge/demo-live%20preview-success?style=for-the-badge&logo=html5)](https://streamline1175.github.io/egg-command/)


**Egg Command** is a modern, dark-mode control center for **Big Green Egg Genius** and **Flame Boss** WiFi controllers. 

It reads and **controls** the controller (pit set point, meat probe targets, alarm silence) using the official [Flame Boss MQTT API](https://github.com/flameboss/fb-api-doc) — either directly over your home network or through your Flame Boss / EGG Genius account. It provides a larger visual interface, cook-time predictions, and voice announcements—perfect for running on a Raspberry Pi or laptop next to your smoker.

## ✨ Key Features

* **🎛️ Real Control:** Change the pit set point and meat probe targets; every change is confirmed by the controller before the UI reports success.
* **🏠 Local or Cloud:** Talk to the controller's built-in MQTT broker on your LAN, or sign in with your app account to use the Flame Boss cloud.
* **🧠 Cook Predictor:** Analyzes temperature trends to estimate exactly when your meat will hit target temp.
* **🗣️ Voice Announcements:** "Pork Butt is ready" or "Pit Temp High" spoken alerts so you don't have to watch the screen.
* **📊 CSV Export:** One-click download of your cook history for Excel analysis.
* **📱 Responsive:** Works beautifully on Phones, Tablets, and Desktops.

## 🚀 Quick Start (Desktop)

You need [Node.js](https://nodejs.org/) installed on your computer.

1.  **Clone the repo**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/egg-command.git](https://github.com/YOUR_USERNAME/egg-command.git)
    cd egg-command
    ```

2.  **Install dependencies**
    ```bash
    npm run install-all
    ```

3.  **Build the dashboard**
    ```bash
    npm run build
    ```

4.  **Start the app**
    ```bash
    npm start
    ```

5.  **Open your browser**
    Go to `http://localhost:3000`

    *On the dashboard: Click Settings ⚙️ and pick a data source (see [Connecting your controller](#-connecting-your-controller)).*

---

## 🥧 Raspberry Pi Setup (Headless Monitor)

To run this 24/7 on a Raspberry Pi:

1.  **Install Node.js on the Pi**
    ```bash
    curl -fsSL [https://deb.nodesource.com/setup_18.x](https://deb.nodesource.com/setup_18.x) | sudo -E bash -
    sudo apt-get install -y nodejs
    ```

2.  **Clone & Install**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/egg-command.git](https://github.com/YOUR_USERNAME/egg-command.git)
    cd egg-command
    npm run install-all
    npm run build
    ```

3.  **Setup Auto-Start (PM2)**
    Use PM2 to keep the dashboard running even if the Pi reboots.
    ```bash
    sudo npm install -g pm2
    pm2 start server.js --name "egg-command"
    pm2 save
    pm2 startup
    ```

4.  **Access it remotely**
    Find your Pi's IP address (`hostname -I`). Open that IP on your phone:
    `http://192.168.1.XX:3000`

---

## 🔌 Connecting your controller

Open Settings ⚙️ and choose a data source. Settings are saved on the server in `data/config.json` (git-ignored), so it reconnects by itself after a restart.

### Option A — Flame Boss cloud (easiest)
1. Choose **Flame Boss cloud** and sign in with the email/password you use in the EGG Genius / Flame Boss app.
2. Click **Save & connect**. The first controller on your account is used; enter a **Device ID** to pick a specific one.

Your password is sent once to `myflameboss.com` to obtain an MQTT token; only the token is stored.

### Option B — Local network (no internet needed)
1. In the official app, turn **Local Access** on for the controller.
2. Find the controller's IP (router "client list", often shown as "Espressif" or "FlameBoss").
3. Find the **Device PIN** (controller settings screen / app).
4. Choose **Local network**, enter the IP and PIN, then **Save & connect**.

This uses the controller's built-in MQTT broker on port 1883 (username `fb`, password = PIN).

### Checking a connection from the command line
```bash
npm run probe -- --lan 192.168.1.50 --pin 123456
npm run probe -- --cloud --email you@example.com --password 'your-password'
```
This prints every raw message from the controller with decoded temperatures — useful to confirm readings match the controller's display. The dashboard also shows the last 50 raw messages under Settings → *Raw controller messages*.

### Safety
* Set-point changes are limited to the controller's reported range and never go outside 122–698°F.
* Changes larger than 50°F ask for confirmation.
* Anyone who can open the dashboard can change the set point — only run it on a network you trust.

## 🔧 Development
* Frontend (React + Tailwind): `/client/src`
* Server + controller connection: `server.js`, `lib/flameboss/`
* Tests: `npm test` (runs against an in-process MQTT broker playing the controller and the cloud)
* `npm run dev` runs the server and the Vite dev server together (Demo mode needs no hardware).

## 🤝 Contributing
Got a feature idea? Pull requests are welcome! 
1.  Fork the repo
2.  Create a feature branch (`git checkout -b feature/AmazingFeature`)
3.  Commit changes
4.  Push to branch
5.  Open a Pull Request

## 📄 License
Distributed under the MIT License.
