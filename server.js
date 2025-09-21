import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { MongoClient, ObjectId } from "mongodb";
import ffmpeg from "fluent-ffmpeg";
// import ytdl from "ytdl-core";
import { exec } from "child_process";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------- MongoDB Connection -----------------
const client = new MongoClient(
  "mongodb+srv://Ishan:testingbingo@bingo.bhqrq.mongodb.net/?retryWrites=true&w=majority&appName=Bingo"
);
await client.connect();
const db = client.db("test");
const formCollection = db.collection("TruthTell");
console.log("Connected to MongoDB");

// ----------------- Upload Paths -----------------
const AUDIO_UPLOAD_FOLDER = "./uploads/audios";
const VIDEO_UPLOAD_FOLDER = "./uploads/videos";

fs.mkdirSync(AUDIO_UPLOAD_FOLDER, { recursive: true });
fs.mkdirSync(VIDEO_UPLOAD_FOLDER, { recursive: true });

const upload = multer({ dest: VIDEO_UPLOAD_FOLDER });

// ----------------- Utils -----------------
async function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

// async function downloadYouTubeVideo(url, saveDir = "./downloads") {
//     return new Promise((resolve, reject) => {
//       const filePath = path.join(saveDir, `${Date.now()}.mp4`);
//       const command = `yt-dlp -f mp4 -o "${filePath}" ${url}`;

//       exec(command, (error, stdout, stderr) => {
//         if (error) {
//           console.error("❌ Error downloading video:", stderr);
//           reject(error);
//         } else {
//           console.log("✅ Download complete:", filePath);
//           resolve(filePath);
//         }
//       });
//     });
//   }
async function scrapeArticle(url) {
  try {
    const { data } = await axios.get(url);
    return data.slice(0, 500); // crude scraping (replace with cheerio if needed)
  } catch (err) {
    console.error("Scraping error:", err);
    return null;
  }
}

// ----------------- OpenAI -----------------
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------- Routes -----------------
app.post("/upload-media", upload.any(), async (req, res) => {
  console.log("Received media upload request");

  const { name, email, textInput, relatedLinks, videoLinks } = req.body;

  try {
    // ----------------- Handle uploaded files -----------------
    let uploadedVideos = [];
    if (req.files) {
      for (let file of req.files) {
        if (file.mimetype.startsWith("video/")) {
          const savePath = path.join(VIDEO_UPLOAD_FOLDER, file.originalname);
          fs.renameSync(file.path, savePath);
          uploadedVideos.push({
            filename: file.originalname,
            path: savePath,
            size: file.size,
          });
          console.log(`Saved video ${file.originalname} at ${savePath}`);
        }
      }
    }

    // ----------------- Store raw data without processing -----------------
    const dbEntry = {
      name: name || null,
      email: email || null,
      textInput: textInput || null,
      blogLinks: relatedLinks ? JSON.parse(relatedLinks) : null,
      videoLinks: videoLinks ? JSON.parse(videoLinks) : null,
      uploadedVideos: uploadedVideos.length ? uploadedVideos : null,
      inputInsights: `Raw input submitted: Text - "${
        textInput || "No text provided"
      }", Blog Links - ${
        relatedLinks ? JSON.parse(relatedLinks).length : 0
      } links, Video Links - ${
        videoLinks ? JSON.parse(videoLinks).length : 0
      } links, Uploaded Videos - ${uploadedVideos.length} files`,
      createdAt: new Date(),
    };

    await formCollection.insertOne(dbEntry);
    console.log("Inserted raw data into MongoDB:", dbEntry);

    res.status(200).json({
      message: "Raw data uploaded successfully!",
    });
  } catch (err) {
    console.error("Error during processing:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Get Latest Entry -----------------
app.get("/get-latest-data", async (req, res) => {
  const { email } = req.query;
  if (!email)
    return res.status(400).json({ message: "Email is required", data: null });

  try {
    const latestEntry = await formCollection.findOne(
      { email },
      { sort: { createdAt: -1 } }
    );
    if (!latestEntry)
      return res.status(404).json({ message: "No records found", data: null });

    latestEntry._id = latestEntry._id.toString();
    res.json({ message: "Latest entry retrieved", data: latestEntry });
  } catch (err) {
    res
      .status(500)
      .json({ message: `Error fetching data: ${err}`, data: null });
  }
});

// ----------------- Get Top 5 Entries -----------------
app.get("/get-top-data", async (req, res) => {
  const { email } = req.query;
  if (!email)
    return res.status(400).json({ message: "Email is required", data: null });

  try {
    const entries = await formCollection
      .find({ email })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    entries.forEach((e) => (e._id = e._id.toString()));
    res.json({ message: "Last 5 entries retrieved", data: entries });
  } catch (err) {
    res
      .status(500)
      .json({ message: `Error fetching data: ${err}`, data: null });
  }
});

// ----------------- Start Server -----------------
const PORT = 8000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on http://0.0.0.0:${PORT}`)
);
