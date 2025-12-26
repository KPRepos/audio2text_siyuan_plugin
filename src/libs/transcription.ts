/**
 * Audio transcription service using OpenAI Whisper API
 */

import { getFileBlob } from "../api";

export interface TranscriptionOptions {
    apiKey: string;
    language?: string;
}

const OPENAI_ALLOWED_EXTS = new Set([
    "flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm"
]);

function guessExtFromMime(mime: string | undefined | null): string | null {
    if (!mime) return null;
    const m = mime.toLowerCase();
    if (m.includes("wav")) return "wav";
    if (m.includes("webm")) return "webm";
    if (m.includes("ogg") || m.includes("oga")) return "ogg";
    if (m.includes("mp4")) return "mp4";
    if (m.includes("mpeg")) return "mp3"; // covers audio/mpeg
    if (m.includes("mp3")) return "mp3";
    if (m.includes("flac")) return "flac";
    if (m.includes("m4a") || m.includes("mp4a")) return "m4a";
    return null;
}

function getBasename(path: string): string {
    const clean = path.split("?")[0].split("#")[0];
    const parts = clean.split("/");
    return parts[parts.length - 1] || "audio";
}

function ensureFilename(path: string, blob: Blob): string {
    const base = getBasename(path);
    const hasExt = /\.[a-z0-9]{1,5}$/i.test(base);
    if (hasExt) return base;
    const ext = guessExtFromMime(blob.type) || "wav";
    return `${base}.${ext}`;
}

/**
 * Transcribe audio file using OpenAI Whisper API
 * @param audioPath Path to the audio file in SiYuan
 * @param options Transcription options including API key
 * @returns Transcribed text
 */
export async function transcribeAudio(
    audioPath: string,
    options: TranscriptionOptions
): Promise<string> {
    if (!options.apiKey) {
        throw new Error("OpenAI API key is required");
    }

    // Get the audio file as a blob
    const audioBlob = await getFileBlob(audioPath);
    if (!audioBlob) {
        throw new Error("Failed to load audio file");
    }

    const filename = ensureFilename(audioPath, audioBlob);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (ext && !OPENAI_ALLOWED_EXTS.has(ext)) {
        throw new Error(`Unsupported audio format ".${ext}". Supported: ${Array.from(OPENAI_ALLOWED_EXTS).join(", ")}`);
    }

    // Helpful debug for diagnosing "invalid file format"
    console.log("[transcribe] audioPath:", audioPath);
    console.log("[transcribe] filename:", filename, "blob.type:", audioBlob.type, "blob.size:", audioBlob.size);

    // Create FormData for the API request
    const formData = new FormData();
    // Preserve the original filename/extension so OpenAI can correctly detect the format (e.g. wav vs mp3)
    // Prefer File when available (browser/Electron), otherwise fall back to Blob + filename.
    const fileLike: any = (typeof File !== "undefined")
        ? new File([audioBlob], filename, { type: audioBlob.type || undefined })
        : audioBlob;
    formData.append("file", fileLike, filename);
    formData.append("model", "whisper-1");
    if (options.language) {
        formData.append("language", options.language);
    }

    // Call OpenAI Whisper API
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${options.apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
        throw new Error(error.error?.message || `API error: ${response.statusText}`);
    }

    const result = await response.json();
    return result.text || "";
}

/**
 * Extract audio file path from audio block element
 * @param element Audio block element
 * @returns Audio file path or null
 */
export function getAudioPathFromElement(element: HTMLElement): string | null {
    // Try to find the audio element
    const audioElement = element.querySelector("audio");
    if (audioElement && audioElement.src) {
        // Extract path from src (format: /assets/... or data:...)
        const src = audioElement.src;
        
        // Handle data URLs (not supported for transcription)
        if (src.startsWith("data:")) {
            return null;
        }
        
        // Extract path from URL
        try {
            const url = new URL(src);
            let path = url.pathname;
            // SiYuan assets are typically in /assets/ directory
            if (path.startsWith("/assets/")) {
                return path;
            }
            return path;
        } catch (e) {
            // If it's a relative path, use it directly
            if (src.startsWith("/")) {
                return src;
            }
            // If it starts with assets/, add leading slash
            if (src.startsWith("assets/")) {
                return "/" + src;
            }
        }
    }

    // Try to get from data attributes
    const dataSrc = element.getAttribute("data-src") || element.getAttribute("data-url");
    if (dataSrc) {
        // Ensure it starts with / if it's an asset path
        if (dataSrc.startsWith("assets/")) {
            return "/" + dataSrc;
        }
        return dataSrc;
    }

    // Try to find in the element's inner HTML or markdown
    // Audio blocks in SiYuan typically have format: ![name](path)
    const markdownMatch = element.textContent?.match(/!\[.*?\]\((.*?)\)/);
    if (markdownMatch && markdownMatch[1]) {
        const path = markdownMatch[1];
        // Ensure it starts with / if it's an asset path
        if (path.startsWith("assets/")) {
            return "/" + path;
        }
        return path;
    }

    return null;
}

