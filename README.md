# 🥚 Egg Command Dashboard

![Status](https://img.shields.io/badge/Status-Active-green) ![License](https://img.shields.io/badge/License-MIT-blue)

[![Live Demo](https://img.shields.io/badge/demo-live%20preview-success?style=for-the-badge&logo=html5)](https://streamline1175.github.io/egg-command/demo/)


**Egg Command** is a modern, dark-mode control center for **Big Green Egg Genius** and **Flame Boss** WiFi controllers. 

Unlike the official mobile app, this dashboard runs entirely on your local network (Local First). It provides a larger visual interface, AI-based cook predictions, and voice announcements—perfect for running on a Raspberry Pi or laptop next to your smoker.

## ✨ Key Features

* **🚫 No Cloud Lag:** Connects directly to your device's local API.
* **🧠 AI Cook Predictor:** Analyzes temperature trends to estimate exactly when your meat will hit target temp.
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

    *On the dashboard: Click Settings ⚙️ > Select "Live Device" > Enter your Egg Genius IP address.*

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

## 🔧 Configuration Tips

### finding your Egg Genius IP
The dashboard requires the local IP of your controller. 
1.  Open your Router's admin page and look for "Client List".
2.  Look for a device named "Espressif" or "FlameBoss".
3.  **Note:** Ensure "Local Access" is turned ON in the official mobile app settings.

### Customizing
The frontend is built with **React** and **TailwindCSS**. 
* Frontend code is in `/client/src`
* Backend proxy is `server.js`

## 🤝 Contributing
Got a feature idea? Pull requests are welcome! 
1.  Fork the repo
2.  Create a feature branch (`git checkout -b feature/AmazingFeature`)
3.  Commit changes
4.  Push to branch
5.  Open a Pull Request

## 📄 License
Distributed under the MIT License.
