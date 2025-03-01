require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { OpenAI } = require("openai");
const mqtt = require("mqtt");

const app = express();

// Cấu hình Multer để nhận file từ Android
const upload = multer({ dest: "uploads/" });

// Tạo client GPT-4O
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Kết nối MQTT
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: "mqtts",
  port: 8883,
  rejectUnauthorized: false
});

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker!");
});

// Nhận file ảnh từ Android, mã hóa Base64 rồi gửi đến GPT-4o
app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No image uploaded" });
  }

  try {
    // Đọc file ảnh từ thư mục tạm thời
    const imageBuffer = fs.readFileSync(req.file.path);

    // Chuyển ảnh thành Base64
    const base64Image = imageBuffer.toString("base64");

    // Xóa file tạm sau khi mã hóa Base64
    fs.unlinkSync(req.file.path);

    console.log("Image successfully converted to Base64!");

    // Gọi GPT-4O Vision
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
    console.log("Description from GPT-4O Vision:", description);

    // Publish MQTT
    mqttClient.publish("kltn/test", description, { qos: 1 }, (err) => {
      if (err) console.error("Error publishing to MQTT:", err);
    });

    res.json({ description });
  } catch (err) {
    console.error("Error analyzing image:", err);
    res.status(500).json({ error: err.toString() });
  }
});

// Khởi động server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
