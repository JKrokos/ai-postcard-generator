// Global Buffer declaration for Cloudflare Workers with nodejs_compat
declare global {
  const Buffer: {
    from(data: string, encoding: "base64" | "utf8" | "hex"): ArrayBuffer;
  };
}

// Cloudflare AI Response Types

export interface AITextContent {
  type: "output_text";
  text: string;
}

export interface AIMessage {
  type: "message";
  role: "assistant" | "user" | "system";
  content: AITextContent[];
}

export interface AITextResponse {
  output: AIMessage[];
}

export interface AIImageResponse {
  image: string; // base64 encoded image
}

// D1 Database Types
export interface D1Result<T = any> {
  results?: T[];
  success: boolean;
  meta: {
    last_row_id?: number;
    changes: number;
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

export interface PostcardRecord {
  ID: number;
  city: string;
  image_prompt: string;
  image_key: string | null;
}

// Environment Bindings
export interface Env {
  AI: any; // Cloudflare AI binding
  DB: D1Database;
  BUCKET: R2Bucket;
  BEARER_TOKEN: string;
}
