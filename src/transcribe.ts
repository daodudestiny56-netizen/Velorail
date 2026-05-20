import axios from "axios";
import FormData from "form-data";

const MAX_FILE_BYTES = 50 * 1024; // 50KB
const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeVoice(
  fileId: string,
  duration: number,
  bot: any
): Promise<string> {
  const maxVoiceSeconds = parseInt(process.env.MAX_VOICE_SECONDS || "30", 10);
  const openAIKey = process.env.OPENAI_API_KEY;
  const mockText = process.env.MOCK_TRANSCRIPTION_TEXT || "Transfer 250 USD to Alice for groceries";

  // Mock Mode fallback check
  if (!openAIKey || openAIKey.trim() === "") {
    return mockText;
  }

  // Duration Guard
  if (duration > maxVoiceSeconds) {
    throw new Error(`Duration exceeds limit of ${maxVoiceSeconds} seconds.`);
  }

  // Retrieve file path info from Telegram
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN.");
  }

  const fileInfo = await bot.api.getFile(fileId);
  const filePath = fileInfo.file_path;
  if (!filePath) {
    throw new Error("Could not retrieve file path from Telegram API.");
  }

  // Download binary buffer
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await axios.get(downloadUrl, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data);

  // Size Guard
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`File size of ${buffer.length} bytes exceeds 50KB limit.`);
  }

  // Prepare Whisper multipart request
  const form = new FormData();
  form.append("file", buffer, {
    filename: "voice.ogg",
    contentType: "audio/ogg",
  });
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  // Call OpenAI Whisper API
  const apiResponse = await axios.post(WHISPER_URL, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${openAIKey}`,
    },
  });

  if (typeof apiResponse.data === "string") {
    return apiResponse.data.trim();
  } else if (apiResponse.data && typeof apiResponse.data.text === "string") {
    return apiResponse.data.text.trim();
  }

  throw new Error("Unexpected transcription payload response structure from Whisper.");
}
