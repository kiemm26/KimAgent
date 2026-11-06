// src/gateway/waha.ts
// WAHA (WhatsApp HTTP API) client wrapper
import axios, { type AxiosInstance } from "axios";
import { env } from "../config.js";
import { logger } from "../logger.js";

interface SendTextParams {
  chatId: string;
  text: string;
  session?: string;
  replyTo?: string;
}

interface SendImageParams {
  chatId: string;
  file: { url?: string; data?: string; mimetype?: string };
  caption?: string;
  session?: string;
}

interface SendFileParams {
  chatId: string;
  file: { url?: string; data?: string; filename?: string; mimetype?: string };
  caption?: string;
  session?: string;
}

interface TypingParams {
  chatId: string;
  session?: string;
}

export class WahaClient {
  private readonly http: AxiosInstance;
  private readonly session: string;

  constructor() {
    this.session = env.WAHA_SESSION;
    this.http = axios.create({
      baseURL: env.WAHA_BASE_URL,
      headers: {
        "Content-Type": "application/json",
        ...(env.WAHA_API_KEY ? { "X-Api-Key": env.WAHA_API_KEY } : {}),
      },
      timeout: 15_000,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        logger.error(
          {
            url: err.config?.url,
            status: err.response?.status,
            data: err.response?.data,
          },
          "WAHA API error"
        );
        return Promise.reject(err);
      }
    );
  }

  /**
   * Send a plain text message.
   */
  async sendText(params: SendTextParams): Promise<void> {
    const { chatId, text, session = this.session, replyTo } = params;

    await this.http.post("/api/sendText", {
      session,
      chatId,
      text,
      ...(replyTo ? { replyTo } : {}),
    });

    logger.debug({ chatId, preview: text.slice(0, 60) }, "WAHA: text sent");
  }

  /**
   * Simulate typing indicator before sending a response.
   */
  async startTyping(params: TypingParams): Promise<void> {
    try {
      await this.http.post("/api/startTyping", {
        session: params.session ?? this.session,
        chatId: params.chatId,
      });
    } catch {
      // Typing indicator failure is non-critical, suppress error
    }
  }

  async stopTyping(params: TypingParams): Promise<void> {
    try {
      await this.http.post("/api/stopTyping", {
        session: params.session ?? this.session,
        chatId: params.chatId,
      });
    } catch {
      // Non-critical
    }
  }

  /**
   * Send an image with optional caption.
   */
  async sendImage(params: SendImageParams): Promise<void> {
    const { chatId, file, caption = "", session = this.session } = params;
    await this.http.post("/api/sendImage", { session, chatId, file, caption });
    logger.debug({ chatId }, "WAHA: image sent");
  }

  /**
   * Send a file/document.
   */
  async sendFile(params: SendFileParams): Promise<void> {
    const { chatId, file, caption = "", session = this.session } = params;
    await this.http.post("/api/sendFile", { session, chatId, file, caption });
    logger.debug({ chatId }, "WAHA: file sent");
  }

  /**
   * Simulate human typing delay then send text.
   * Delay is random within configured min-max range.
   */
  async sendWithTypingEffect(chatId: string, text: string): Promise<void> {
    const minDelay = 300;
    const maxDelay = 800;
    const delay = Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);

    await this.startTyping({ chatId });
    await sleep(delay);
    await this.stopTyping({ chatId });
    await this.sendText({ chatId, text });
  }

  /**
   * Check WAHA service health.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.http.get("/api/health");
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get current session status.
   */
  async getSessionStatus(): Promise<string> {
    try {
      const res = await this.http.get<{ status: string }>(
        `/api/sessions/${this.session}`
      );
      return res.data.status;
    } catch {
      return "UNKNOWN";
    }
  }

  /**
   * Start a session (useful after VPS resume).
   */
  async startSession(): Promise<void> {
    await this.http.post(`/api/sessions/${this.session}/start`);
    logger.info({ session: this.session }, "WAHA: session start requested");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton instance
let _wahaClient: WahaClient | null = null;
export function getWahaClient(): WahaClient {
  if (!_wahaClient) _wahaClient = new WahaClient();
  return _wahaClient;
}
