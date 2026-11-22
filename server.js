
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "1mb" }));

// Serve your existing HTML file
app.use(express.static(__dirname));

// Groq AI review endpoint
app.post("/api/review", async (req, res) => {
    try {
        const apiKey = process.env.GROQ_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "Groq API key is missing in .env"
            });
        }

        const { messages } = req.body;

        if (!Array.isArray(messages)) {
            return res.status(400).json({
                error: "Invalid messages"
            });
        }

        const response = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "openai/gpt-oss-120b",
                    temperature: 0,
                    messages: messages
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || "Groq API request failed"
            });
        }

        res.json(data);

    } catch (error) {
        console.error("Groq error:", error.message);

        res.status(500).json({
            error: "Unable to connect to Groq AI"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Java Auto Fixer running at http://localhost:${PORT}`);
});
