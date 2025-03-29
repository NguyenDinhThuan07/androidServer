require("dotenv").config();
const express = require("express");
const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const mqtt = require("mqtt");
const { OpenAI } = require("openai");

// 1) Tạo app Express + route GET / để kiểm tra
const app = express();
app.get("/", (req, res) => {
  res.send("hello");
});

// 2) Lấy cổng và MQTT_TOPIC từ .env
const PORT = process.env.PORT || 3000;
const MQTT_TOPIC = process.env.MQTT_TOPIC || "esp32/cam/description"; 
// Nếu chưa có trong .env, mặc định "esp32/cam/description"

// 3) Tạo server HTTP & WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 4) Kết nối MQTT
const mqttOptions = {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: "mqtts",
  port: 8883,
  rejectUnauthorized: false,
};

const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, mqttOptions);

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker!");
});

// 5) Tạo client GPT-4O mini
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 6) Nhận dữ liệu ảnh qua WebSocket
wss.on("connection", (ws) => {
  console.log("[WebSocket] Android client connected");

  ws.on("message", async (data) => {
    console.log("[WebSocket] Received data from Android");

    if (!(data instanceof Buffer)) {
      console.warn("Data is not a Buffer -> ignoring");
      return;
    }

    try {
      // Chuyển buffer ảnh thành base64
      const base64Image = data.toString("base64");

      // Gọi GPT-4o-mini
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Tôi là một người mù, tôi cần biết có những gì xuất hiện trong ảnh tôi vừa chụp cho bạn. Nếu ảnh có cảnh vật, hãy mô tả cho tôi cảnh vật trong khoảng 15 từ, không cần giải thích gì thêm. Nếu ảnh có chữ viết, hãy cho tôi biết trên đó viết gì, không giới hạn từ ngữ"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 300
      });

      const description = response.choices[0].message.content;
      console.log("[GPT-4O] Response:", description);

      // 7) Publish kết quả qua MQTT
      mqttClient.publish(MQTT_TOPIC, description, { qos: 1 }, (err) => {
        if (err) console.error("Error publishing to MQTT:", err);
      });

      // 8) Ghi log
      const timestamp = new Date().toISOString();
      const logLine = `${timestamp} - ${description}\n`;
      fs.appendFile("log.txt", logLine, (err) => {
        if (err) console.error("Error writing log:", err);
      });

      // (Tùy chọn) Gửi phản hồi lại cho Android qua WebSocket
      ws.send(JSON.stringify({ success: true, description }));

    } catch (err) {
      console.error("Error analyzing image:", err);
      ws.send(JSON.stringify({ error: err.toString() }));
    }
  });

  ws.on("close", () => {
    console.warn("[WebSocket] Android client disconnected");
  });
});

// 9) Lắng nghe cổng
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
