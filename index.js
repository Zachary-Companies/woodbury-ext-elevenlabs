/**
 * Woodbury ElevenLabs Extension
 *
 * Provides text-to-speech tools using the ElevenLabs API.
 * Generates audio files from text — ideal for voiceovers, narration, and dialogue.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const API_BASE = 'https://api.elevenlabs.io/v1';

const MODELS = {
  multilingual_v2: 'eleven_multilingual_v2',
  flash_v2_5: 'eleven_flash_v2_5',
  turbo_v2_5: 'eleven_turbo_v2_5',
  monolingual_v1: 'eleven_monolingual_v1',
};

const OUTPUT_FORMATS = [
  'mp3_22050_32',
  'mp3_44100_64',
  'mp3_44100_96',
  'mp3_44100_128',
  'mp3_44100_192',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
];

/**
 * List available voices from ElevenLabs.
 */
async function listVoices(apiKey) {
  const response = await fetch(`${API_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.voices || [];
}

/**
 * Generate speech from text using ElevenLabs TTS API.
 * Returns the raw audio buffer.
 */
async function generateSpeech(params, apiKey) {
  const {
    text,
    voice_id,
    model_id = 'eleven_multilingual_v2',
    output_format = 'mp3_44100_128',
    stability,
    similarity_boost,
    style,
    speed,
    language_code,
  } = params;

  const url = `${API_BASE}/text-to-speech/${voice_id}?output_format=${output_format}`;

  const body = { text, model_id };

  if (language_code) body.language_code = language_code;

  // Build voice_settings only if any setting is provided
  const hasSettings = stability !== undefined
    || similarity_boost !== undefined
    || style !== undefined
    || speed !== undefined;

  if (hasSettings) {
    body.voice_settings = {};
    if (stability !== undefined) body.voice_settings.stability = stability;
    if (similarity_boost !== undefined) body.voice_settings.similarity_boost = similarity_boost;
    if (style !== undefined) body.voice_settings.style = style;
    if (speed !== undefined) body.voice_settings.speed = speed;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * @param {import('woodbury').ExtensionContext} ctx
 */
export async function activate(ctx) {
  ctx.log.info('ElevenLabs extension activated');

  const apiKey = ctx.env.ELEVENLABS_API_KEY || '';
  const audioOutputDir = ctx.env.AUDIO_OUTPUT_DIR || '';
  const defaultVoice = ctx.env.ELEVENLABS_DEFAULT_VOICE || '';
  const defaultModel = ctx.env.ELEVENLABS_DEFAULT_MODEL || 'eleven_multilingual_v2';

  // -------------------------------------------------------------------------
  // Tool: tts_speak — generate speech audio from text
  // -------------------------------------------------------------------------
  ctx.registerTool(
    {
      name: 'tts_speak',
      description: `Generate speech audio from text using ElevenLabs. Returns a saved audio file path.

Use this to create voiceovers, narration, or dialogue audio files. The output MP3 can be used directly as an asset in blender-automat video projects.

**Required:** text, voice_id (use tts_voices to find available voices)
**Returns:** path to the saved audio file`,
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to convert to speech',
          },
          voice_id: {
            type: 'string',
            description: 'ElevenLabs voice ID. Use tts_voices to list available voices. Can be omitted if ELEVENLABS_DEFAULT_VOICE is configured.',
          },
          output_path: {
            type: 'string',
            description: 'Where to save the audio file. Defaults to AUDIO_OUTPUT_DIR with auto-generated filename.',
          },
          model: {
            type: 'string',
            enum: ['multilingual_v2', 'flash_v2_5', 'turbo_v2_5', 'monolingual_v1'],
            description: 'Model to use. multilingual_v2 (best quality, default), flash_v2_5 (fastest, low latency), turbo_v2_5 (fast), monolingual_v1 (English only legacy).',
          },
          output_format: {
            type: 'string',
            enum: OUTPUT_FORMATS,
            description: 'Audio format. Default: mp3_44100_128. Use mp3_44100_192 for highest MP3 quality.',
          },
          stability: {
            type: 'number',
            description: 'Voice stability (0.0-1.0). Lower = more expressive/variable. Higher = more consistent. Default varies by voice.',
          },
          similarity_boost: {
            type: 'number',
            description: 'Similarity boost (0.0-1.0). Higher = closer to original voice. Default varies by voice.',
          },
          style: {
            type: 'number',
            description: 'Style exaggeration (0.0-1.0). Higher = more stylistic. Can reduce stability. Default: 0.',
          },
          speed: {
            type: 'number',
            description: 'Speech speed multiplier (0.7-1.2). Default: 1.0.',
          },
          language_code: {
            type: 'string',
            description: 'ISO 639-1 language code (e.g. "en", "es", "fr", "de", "ja"). Only needed for multilingual models when auto-detection is insufficient.',
          },
        },
        required: ['text'],
      },
    },
    async (params) => {
      const key = apiKey || process.env.ELEVENLABS_API_KEY;
      if (!key) {
        return JSON.stringify({
          success: false,
          error: 'ELEVENLABS_API_KEY not configured. Set it in the Woodbury dashboard or as an environment variable. Get a key at https://elevenlabs.io',
        });
      }

      const voiceId = params.voice_id || defaultVoice;
      if (!voiceId) {
        return JSON.stringify({
          success: false,
          error: 'No voice_id provided and no ELEVENLABS_DEFAULT_VOICE configured. Use tts_voices to list available voices and pick one.',
        });
      }

      // Resolve model
      const modelId = params.model
        ? (MODELS[params.model] || params.model)
        : defaultModel;

      // Determine output path
      let outputPath = params.output_path;
      if (!outputPath) {
        const dir = audioOutputDir
          ? (path.isAbsolute(audioOutputDir) ? audioOutputDir : path.resolve(ctx.workingDirectory, audioOutputDir))
          : ctx.workingDirectory;
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const ext = (params.output_format || 'mp3_44100_128').startsWith('pcm') ? '.pcm' : '.mp3';
        outputPath = path.join(dir, `tts_${Date.now()}${ext}`);
      }

      if (!path.isAbsolute(outputPath)) {
        outputPath = path.resolve(ctx.workingDirectory, outputPath);
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      try {
        const audioBuffer = await generateSpeech(
          {
            text: params.text,
            voice_id: voiceId,
            model_id: modelId,
            output_format: params.output_format || 'mp3_44100_128',
            stability: params.stability,
            similarity_boost: params.similarity_boost,
            style: params.style,
            speed: params.speed,
            language_code: params.language_code,
          },
          key
        );

        fs.writeFileSync(outputPath, audioBuffer);

        const fileSizeKB = Math.round(audioBuffer.length / 1024);

        return JSON.stringify({
          success: true,
          audio_path: outputPath,
          voice_id: voiceId,
          model: modelId,
          format: params.output_format || 'mp3_44100_128',
          size_kb: fileSizeKB,
          text_length: params.text.length,
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err.message,
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: tts_voices — list available voices
  // -------------------------------------------------------------------------
  ctx.registerTool(
    {
      name: 'tts_voices',
      description: `List available ElevenLabs voices. Returns voice IDs, names, and categories. Use this to find the right voice_id for tts_speak.`,
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Optional search term to filter voices by name',
          },
        },
      },
    },
    async (params) => {
      const key = apiKey || process.env.ELEVENLABS_API_KEY;
      if (!key) {
        return JSON.stringify({
          success: false,
          error: 'ELEVENLABS_API_KEY not configured.',
        });
      }

      try {
        const voices = await listVoices(key);

        let filtered = voices;
        if (params.search) {
          const term = params.search.toLowerCase();
          filtered = voices.filter(
            (v) =>
              (v.name && v.name.toLowerCase().includes(term)) ||
              (v.description && v.description.toLowerCase().includes(term)) ||
              (v.labels && Object.values(v.labels).some((l) => l.toLowerCase().includes(term)))
          );
        }

        const result = filtered.map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category || null,
          description: v.description || null,
          labels: v.labels || {},
          preview_url: v.preview_url || null,
        }));

        return JSON.stringify({
          success: true,
          count: result.length,
          default_voice: defaultVoice || null,
          voices: result,
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err.message,
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Command: /elevenlabs-status
  // -------------------------------------------------------------------------
  ctx.registerCommand({
    name: 'elevenlabs-status',
    description: 'Check ElevenLabs API key and configuration status',
    handler: async (args, cmdCtx) => {
      const key = apiKey || process.env.ELEVENLABS_API_KEY;
      if (key) {
        cmdCtx.print(`API Key: configured (${key.slice(0, 8)}...)`);
      } else {
        cmdCtx.print('API Key: NOT CONFIGURED');
        cmdCtx.print('  Set ELEVENLABS_API_KEY in the Woodbury dashboard');
      }

      if (defaultVoice) {
        cmdCtx.print(`Default voice: ${defaultVoice}`);
      } else {
        cmdCtx.print('Default voice: not set (must provide voice_id each time)');
      }

      cmdCtx.print(`Default model: ${defaultModel}`);

      if (audioOutputDir) {
        const resolved = path.isAbsolute(audioOutputDir)
          ? audioOutputDir
          : path.resolve(cmdCtx.workingDirectory, audioOutputDir);
        cmdCtx.print(`Audio output: ${resolved}`);
      } else {
        cmdCtx.print('Audio output: working directory (no AUDIO_OUTPUT_DIR set)');
      }
    },
  });

  // -------------------------------------------------------------------------
  // System prompt
  // -------------------------------------------------------------------------
  const outputNote = audioOutputDir
    ? `Audio files are saved to: ${audioOutputDir}`
    : 'Audio files are saved to the working directory by default. Configure AUDIO_OUTPUT_DIR in the dashboard.';

  ctx.addSystemPrompt(`## ElevenLabs Extension (Text-to-Speech)

You have access to ElevenLabs text-to-speech for generating voiceover and narration audio.

### Tools

**tts_speak** — Convert text to speech audio. Returns the saved file path.
- Required: text (the script/narration) and voice_id (from tts_voices)
- Models: multilingual_v2 (best quality), flash_v2_5 (fastest)
- Output: MP3 file ready to use as audio asset in video projects
- Voice settings: stability, similarity_boost, style, speed

**tts_voices** — List available voices with IDs, names, and categories.
- Use the search param to filter by name or label
- Returns voice_id needed for tts_speak

### Command: /elevenlabs-status
Check API key and configuration.

### Workflow with Blender Automat

1. Use tts_voices to find a suitable voice
2. Use tts_speak to generate narration audio from script text
3. Use the output audio_path as an audio asset in a blender-automat project
4. Render the video with video_render

### ${outputNote}`);
}

export function deactivate() {
  // Cleanup
}
