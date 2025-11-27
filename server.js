const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- API PROXY ---
app.get('/api/status', async (req, res) => {
    const { ip } = req.query;
    if (!ip) return res.status(400).json({ error: "Missing IP" });

    try {
        const response = await axios.get(`http://${ip}/json`, { timeout: 4000 });
        res.json(response.data);
    } catch (error) {
        res.status(502).json({ error: "Unreachable", details: error.message });
    }
});

// --- SERVE REACT APP ---
// Points to the 'dist' folder created by Vite
app.use(express.static(path.join(__dirname, 'client/dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🥚 Egg Command Active`);
    console.log(`👉 Access: http://localhost:${PORT}`);
});
